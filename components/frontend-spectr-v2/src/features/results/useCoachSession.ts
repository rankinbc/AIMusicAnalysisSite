import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import { capture } from '../../lib/analytics';
import { invalidateGuestState } from '../demo/useGuestState';
import type {
  CoachCapsDto,
  CoachConversationDto,
  CreateCoachMessageResponse,
} from '../../api/types';
import { extractErrorCode, extractErrorMessage } from './coach-stream-frames';
import { readCoachStream } from './coach-stream-reader';
import { useCoachBriefFollow } from './useCoachBriefFollow';
import {
  appendToLastAssistant,
  finalizeLastAssistant,
  finalizeOrTrimOnAbort,
  mapMessagesToTurns,
  trimEmptyPending,
  type ChatTurn,
} from './coach-chat-helpers';

// adhoc-coachchat-split (2026-09-19) — the conversation/streaming state
// machine extracted from CoachChat.tsx so the component file stays under
// the CLAUDE.md ~500-line ceiling. Pure move: turns/streaming/offlineState/
// streamStatus/caps, abortRef/sendingRef, the hydration + reset effects,
// send/handleStop/handleRetry — same statements, same conditions, same
// dependency arrays, only the file they live in changed.
//
// Task G6 fix round 1 — the opening brief's live-follow + poll-fallback
// machinery (`followMessage`) now lives in useCoachBriefFollow.ts, for the
// same line-budget reason. It shares `sendingRef`/`abortRef`/the turn
// setters declared below.

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
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  // Code-review P3 — synchronous double-send guard. `streaming` state is
  // batched; rapid Enter+click could slip through the React-state check.
  const sendingRef = useRef<boolean>(false);

  // Task G6 fix round 1 (item 1 + 2) — the brief lives on the SAME
  // abortRef/sendingRef/turn-setters `send()` uses below (they never run
  // concurrently), so its Stop-button + unmount-abort behaviour is
  // identical to a normal reply's for free.
  const { followMessage, drainQueuedBrief } = useCoachBriefFollow({
    analysisId,
    sendingRef,
    abortRef,
    setTurns,
    setCaps,
    setStreaming,
    setStreamStatus,
  });

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
          setTurns(mapMessagesToTurns(dto.messages));
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

      if (postRes.ok) {
        capture('coach_message_sent'); // KPI: follow-up rate
        invalidateGuestState(qc); // D10 fix1 (item 3) — a guest's coach-message count changed
      }
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

      // ── Phase 2: open the SSE stream. Task G6 fix round 1 (item 1) — the
      // read loop itself now lives in coach-stream-reader.ts (shared with
      // useCoachBriefFollow's `followMessage`); every handler below
      // reproduces EXACTLY what the inline loop used to do, so this is a
      // mechanical extraction, not a behaviour change.
      const result = await readCoachStream(
        `/api/coach/${analysisId}/messages/${messageId}/stream`,
        authHeaders,
        ac.signal,
        {
          onToken: (text) => {
            setTurns((t) => appendToLastAssistant(t, text));
            scheduleAriaLive(text);
          },
          onDone: (evidence) => {
            setTurns((t) => finalizeLastAssistant(t, { evidence }));
            flushAriaLive();
            setStreamStatus('Coach finished responding.');
          },
          onRefusal: (reason, body) => {
            setTurns((t) =>
              finalizeLastAssistant(t, { replaceText: body, refused: true, refusalReason: reason }),
            );
            flushAriaLive();
            setStreamStatus('Coach declined to answer.');
          },
          onError: (code, message, atOpen) => {
            // P7 — mirror the POST offline-code check on stream open.
            if (OFFLINE_CODES.has(code)) {
              setOfflineState(true);
              setTurns((t) => trimEmptyPending(t));
              flushAriaLive();
              setStreamStatus(COACH_OFFLINE_COPY);
              return;
            }
            if (atOpen) {
              // Mirrors the pre-extraction behaviour exactly: a non-offline
              // open failure is a hard error, not a turn-level refusal —
              // throwing here propagates to the catch below (toast + trim),
              // same as the original `throw new Error(...)` did.
              throw new Error(message);
            }
            setTurns((t) =>
              finalizeLastAssistant(t, { replaceText: message, refused: true, refusalReason: code }),
            );
            flushAriaLive();
            setStreamStatus('Coach stream error.');
          },
        },
      );

      if (result === 'aborted') {
        // P4 — finalize partial-text turns so EvidenceChips logic is
        // consistent on subsequent sends. Empty pending turns are dropped.
        setTurns((t) => finalizeOrTrimOnAbort(t));
      }
      // 'done' | 'refusal' | 'error' | 'ended-without-terminal': every state
      // change already happened synchronously inside the handlers above (or
      // the frame loop simply exhausted without a terminal frame, which the
      // original inline loop also left silently un-handled).
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
      // Task G6 fix round 1 (item 2) — a brief that arrived mid-send is
      // never dropped: resume following it now that `turns` is safe to
      // touch again.
      drainQueuedBrief();
    }
  }, [
    analysisId,
    cancelAriaLiveTimer,
    caps,
    clearInput,
    drainQueuedBrief,
    flushAriaLive,
    input,
    offlineState,
    qc,
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
    followMessage,
  };
}
