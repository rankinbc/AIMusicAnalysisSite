import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import { capture } from '../../lib/analytics';
import type {
  CoachCapsDto,
  CoachConversationDto,
  CreateCoachMessageResponse,
} from '../../api/types';
import {
  parseFrame,
  extractErrorCode,
  extractErrorMessage,
} from './coach-stream-frames';
import {
  appendToLastAssistant,
  finalizeLastAssistant,
  finalizeOrTrimOnAbort,
  trimEmptyPending,
  type ChatTurn,
} from './coach-chat-helpers';

// adhoc-coachchat-split (2026-09-19) — the conversation/streaming state
// machine extracted from CoachChat.tsx so the component file stays under
// the CLAUDE.md ~500-line ceiling. Pure move: turns/streaming/offlineState/
// streamStatus/caps, abortRef/sendingRef, the hydration + reset effects,
// send/handleStop/handleRetry — same statements, same conditions, same
// dependency arrays, only the file they live in changed.

// Story 1.8 / AC6 + Dev Note 10 — copy lives in three places: this constant,
// the BFF's CoachConversationEndpoints.cs:31-32, and the worker's
// coach_actor.py COACH_OFFLINE_BODY. Future edits start at the worker.
export const COACH_OFFLINE_COPY =
  'Coach is offline — your measured analysis and rule-based findings are unaffected.';

// AR38 error codes that flip the chat into the offline state. story 1.4
// + 1.5 + 1.6 emit these from circuit-breaker / gateway / SSE relay
// respectively. `coach_cap_reached` is intentionally NOT in this list —
// caps belong to story 1.9 and surface a different UI (CoachGateInline).
//
// Code-review P21 extras (`coach_offline`, `coach_queue_unavailable`,
// `coach_stream_idle`) are real BFF emissions — see
// CoachConversationEndpoints.cs:31, :178, :481. Documented in story Dev
// Note 13 (updated by the same review patch).
const OFFLINE_CODES = new Set<string>([
  'coach_offline',
  'coach_unavailable',
  'circuit_open',
  'llm_provider_down',
  'coach_queue_unavailable',
  'coach_stream_idle',
]);

interface UseCoachSessionArgs {
  analysisId: string;
  /** teach-mode-coach + adhoc-concise: the wire mode derived from the
   *  header's Concise/Normal/Teach toggle. Read fresh on every `send()`
   *  call (it's a hook argument, recomputed by the caller each render) so
   *  a mid-flight toggle-then-send never uses a stale mode. */
  wireMode: 'qa' | 'teach' | 'concise';
  input: string;
  clearInput: () => void;
  scheduleAriaLive: (delta: string) => void;
  flushAriaLive: () => void;
  resetAriaLive: () => void;
  cancelAriaLiveTimer: () => void;
}

export function useCoachSession({
  analysisId,
  wireMode,
  input,
  clearInput,
  scheduleAriaLive,
  flushAriaLive,
  resetAriaLive,
  cancelAriaLiveTimer,
}: UseCoachSessionArgs) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [offlineState, setOfflineState] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>('');
  // Story 1.9 — per-analysis cap state. `null` pre-hydration; the server is
  // the single source of truth (no frontend arithmetic — see Task 6.2).
  const [caps, setCaps] = useState<CoachCapsDto | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Code-review P3 — synchronous double-send guard. `streaming` state is
  // batched; rapid Enter+click could slip through the React-state check.
  const sendingRef = useRef<boolean>(false);

  // Code-review P1 — unmount cleanup: abort in-flight fetch. Without this,
  // navigating away mid-stream leaks the SSE fetch (the BFF never receives
  // the abort signal that triggers `coach:cancel:{id}`). The other half of
  // this cleanup (clearing the aria-live timer) now lives inside
  // useCoachAriaLive's own unmount effect, next to the refs it owns.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Code-review P13 — reset all per-conversation state when the analysis
  // changes (user navigates to a different report without unmounting).
  useEffect(() => {
    setOfflineState(false);
    setTurns([]);
    setStreaming(false);
    setStreamStatus('');
    sendingRef.current = false;
    setCaps(null);  // Re-hydrate from the new analysis.
  }, [analysisId]);

  // Story 1.9 / Task 6.1 — hydrate caps + transcript from
  // GET /api/coach/{analysisId}/conversation on mount and on analysis
  // change. The same endpoint surfaces both messages and caps so the chip
  // + gate state are correct on first paint without a separate roundtrip.
  // review-fix P5 — also fire the SR announcement when the user lands on
  // a page where the cap is already reached (no POST in flight, but the
  // gate will appear on first render).
  useEffect(() => {
    const ac = new AbortController();
    const hydrationAnalysisId = analysisId;
    const token = getAccessToken();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    (async () => {
      try {
        const res = await fetch(`/api/coach/${analysisId}/conversation`, {
          headers: authHeaders,
          signal: ac.signal,
        });
        if (!res.ok) return;
        const dto = (await res.json()) as CoachConversationDto;
        // review-fix P15 — guard against the analysisId changing mid-fetch.
        // If the user navigated away during the await, do not overwrite the
        // new analysis's state with this stale response.
        if (hydrationAnalysisId !== analysisId) return;
        setCaps(dto.caps);
        if (dto.caps.capReached) {
          setStreamStatus(
            'Coach follow-ups exhausted for this analysis. Pro and credit options available.',
          );
        }
        // Hydrate prior turns so a refresh mid-conversation keeps context.
        if (dto.messages.length > 0) {
          const prior: ChatTurn[] = dto.messages.map((m) => {
            const turn: ChatTurn = {
              role: m.role,
              text: m.content,
              finalized: m.status === 'complete' || m.status === 'refused',
            };
            if (m.evidence) turn.evidence = m.evidence;
            if (m.mode === 'teach') turn.mode = 'teach';
            if (m.status === 'refused') {
              turn.refused = true;
              if (m.refusalReason) turn.refusalReason = m.refusalReason;
            }
            return turn;
          });
          setTurns(prior);
        }
      } catch {
        /* hydration is best-effort; the user can still send messages */
      }
    })();

    return () => ac.abort();
  }, [analysisId]);

  const handleStop = useCallback(() => {
    // Aborting the SSE fetch triggers the BFF's
    // ct.IsCancellationRequested branch, which SETs `coach:cancel:{messageId}`
    // in Redis. The worker checks that key between deltas and breaks its
    // generation loop. No separate cancel endpoint exists — the fetch abort
    // IS the cancel.
    abortRef.current?.abort();
    setStreamStatus('Coach response cancelled.');
  }, []);

  const handleRetry = useCallback(() => {
    setOfflineState(false);
    setStreamStatus('');
  }, []);

  const send = useCallback(async () => {
    const msg = input.trim();
    // Story 1.9 — defence-in-depth: even if the gate is rendered we never
    // emit a POST when the cap is already reached (the server would reject
    // it with `coach_cap_reached` anyway).
    if (!msg || sendingRef.current || streaming || offlineState) return;
    if (caps?.capReached) return;
    // review-fix P15 — snapshot the analysisId at send time so the POST
    // response can't overwrite a freshly-mounted analysis's caps with the
    // outgoing analysis's reply.
    const sendAnalysisId = analysisId;
    // Snapshot the toggle at send time so a mid-flight toggle can't relabel
    // the in-flight turn. Both bubbles carry it so the assistant answer badges.
    const turnMode: 'qa' | 'teach' | 'concise' = wireMode;
    sendingRef.current = true;
    clearInput();
    setTurns((t) => [
      ...t,
      { role: 'user', text: msg, mode: turnMode },
      { role: 'assistant', text: '', finalized: false, mode: turnMode },
    ]);
    setStreaming(true);
    setStreamStatus('Coach is responding…');
    resetAriaLive();

    const ac = new AbortController();
    abortRef.current = ac;
    const token = getAccessToken();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    try {
      // ── Phase 1: POST the user message.
      const postRes = await fetch(`/api/coach/${analysisId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ content: msg, mode: turnMode }),
        signal: ac.signal,
      });

      if (postRes.ok) capture('coach_message_sent'); // KPI: follow-up rate
      if (!postRes.ok) {
        const errBody = await postRes.json().catch(() => null as unknown);
        const code = extractErrorCode(errBody);
        if (code && OFFLINE_CODES.has(code)) {
          setOfflineState(true);
          setTurns((t) => trimEmptyPending(t));
          setStreamStatus(COACH_OFFLINE_COPY);
          return;
        }
        // Story 1.9 / review-fix P1 — AR38 cap-reached. Single setTurns
        // updater so the two-step rollback can't desync under React 18+
        // automatic batching (an earlier two-call form would re-read the
        // same `t` in both closures and skip the user-bubble removal).
        // We trim the empty pending assistant AND the optimistic user
        // bubble in one pass.
        if (code === 'coach_cap_reached') {
          setTurns((t) => {
            const trimmed = trimEmptyPending(t);
            return trimmed.length > 0 && trimmed[trimmed.length - 1]?.role === 'user'
              ? trimmed.slice(0, -1)
              : trimmed;
          });
          const details = (errBody as { error?: { details?: { used?: number; limit?: number } } })
            ?.error?.details;
          if (typeof details?.used === 'number' && typeof details?.limit === 'number') {
            setCaps({ used: details.used, limit: details.limit, capReached: true });
          } else if (caps) {
            // Fall back to local arithmetic only if the server omitted details.
            setCaps({ used: caps.limit, limit: caps.limit, capReached: true });
          }
          // review-fix P5 — canonical SR copy from Task 5.4.
          setStreamStatus(
            'Coach follow-ups exhausted for this analysis. Pro and credit options available.',
          );
          return;
        }
        throw new Error(extractErrorMessage(errBody) ?? `HTTP ${postRes.status}`);
      }

      const created = (await postRes.json()) as CreateCoachMessageResponse;
      const messageId = created.pendingAssistantMessageId;
      // Story 1.9 / Task 6.2 — server-computed caps reflect the new user row.
      // review-fix P15 — drop stale response if analysis changed mid-flight.
      if (sendAnalysisId !== analysisId) return;
      setCaps(created.caps);

      // ── Phase 2: open the SSE stream.
      const streamRes = await fetch(
        `/api/coach/${analysisId}/messages/${messageId}/stream`,
        {
          method: 'GET',
          headers: { Accept: 'text/event-stream', ...authHeaders },
          signal: ac.signal,
        },
      );

      if (!streamRes.ok || !streamRes.body) {
        // P7 — mirror the POST offline-code check on stream open.
        const errBody = await streamRes.json().catch(() => null as unknown);
        const code = extractErrorCode(errBody);
        if (code && OFFLINE_CODES.has(code)) {
          setOfflineState(true);
          setTurns((t) => trimEmptyPending(t));
          setStreamStatus(COACH_OFFLINE_COPY);
          return;
        }
        throw new Error(`stream HTTP ${streamRes.status}`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = parseFrame(frame);
          if (!event) continue;
          if (event.kind === 'comment') continue;

          if (event.kind === 'token') {
            const text = event.payload.text.replace(/\\n/g, '\n');
            setTurns((t) => appendToLastAssistant(t, text));
            scheduleAriaLive(text);
            continue;
          }
          if (event.kind === 'done') {
            setTurns((t) => finalizeLastAssistant(t, { evidence: event.payload.evidence }));
            flushAriaLive();
            setStreamStatus('Coach finished responding.');
            return;
          }
          if (event.kind === 'refusal') {
            setTurns((t) =>
              finalizeLastAssistant(t, {
                replaceText: event.payload.body,
                refused: true,
                refusalReason: event.payload.reason,
              }),
            );
            flushAriaLive();
            setStreamStatus('Coach declined to answer.');
            return;
          }
          if (event.kind === 'error') {
            if (OFFLINE_CODES.has(event.payload.code)) {
              setOfflineState(true);
              setTurns((t) => trimEmptyPending(t));
              flushAriaLive();
              setStreamStatus(COACH_OFFLINE_COPY);
              return;
            }
            setTurns((t) =>
              finalizeLastAssistant(t, {
                replaceText: event.payload.message,
                refused: true,
                refusalReason: event.payload.code,
              }),
            );
            flushAriaLive();
            setStreamStatus('Coach stream error.');
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // P4 — finalize partial-text turns so EvidenceChips logic is
        // consistent on subsequent sends. Empty pending turns are dropped.
        setTurns((t) => finalizeOrTrimOnAbort(t));
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Coach chat failed');
      setTurns((t) => trimEmptyPending(t));
    } finally {
      setStreaming(false);
      abortRef.current = null;
      sendingRef.current = false;
      cancelAriaLiveTimer();
    }
  }, [
    analysisId,
    cancelAriaLiveTimer,
    caps,
    clearInput,
    flushAriaLive,
    input,
    offlineState,
    resetAriaLive,
    scheduleAriaLive,
    streaming,
    wireMode,
  ]);

  return {
    turns,
    streaming,
    offlineState,
    streamStatus,
    caps,
    send,
    handleStop,
    handleRetry,
  };
}
