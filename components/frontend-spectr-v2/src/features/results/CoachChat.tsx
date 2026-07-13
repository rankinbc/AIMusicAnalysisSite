import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import { capture } from '../../lib/analytics';
import type {
  CoachCapsDto,
  CoachConversationDto,
  CreateCoachMessageResponse,
  VerdictDto,
} from '../../api/types';
import { Pill } from '../../ui/Pill';
import { TranceBot } from './TranceBot';
import { CoachCapChip } from './CoachCapChip';
import { CoachGateInline } from './CoachGateInline';
import { EvidenceChips } from './EvidenceChips';
import { deriveCoachSuggestions } from './coach-suggestion-templates';
import {
  parseFrame,
  extractErrorCode,
  extractErrorMessage,
} from './coach-stream-frames';
import {
  appendToLastAssistant,
  finalizeLastAssistant,
  finalizeOrTrimOnAbort,
  resolveUnlockAction,
  trimEmptyPending,
  type ChatTurn,
} from './coach-chat-helpers';
import s from './CoachChat.module.css';

// Story 1.8 / AC6 + Dev Note 10 — copy lives in three places: this constant,
// the BFF's CoachConversationEndpoints.cs:31-32, and the worker's
// coach_actor.py COACH_OFFLINE_BODY. Future edits start at the worker.
const COACH_OFFLINE_COPY =
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

// Aria-live throttle window: long enough that NVDA / VoiceOver don't
// stutter every token, short enough that the live region still feels
// responsive. 500 ms matches the spec dev note.
const ARIA_LIVE_THROTTLE_MS = 500;

interface CoachChatProps {
  trackName: string;
  analysisId: string;
  verdicts: VerdictDto[];
  /** Count of measurement keys surfaced from `analyses.final_json` —
   *  contributes to the grounding scope line ({n} measurements). */
  measurementsCount: number;
  /** Optional actions rendered top-right of the coach card (redesign: the
   *  Specialist Team + Generate Coach Mix buttons live here). */
  headerActions?: React.ReactNode;
  /** Story 12.5: unlock chips open the REAL upload dialogs (owner: ReportView).
   *  Optional so bare mounts stay valid; without it the chip routes to the
   *  song page copy instead of a stale "coming soon" toast. */
  onUnlockAction?: (intent: 'add_stems' | 'add_reference') => void;
}

export function CoachChat({
  trackName,
  analysisId,
  verdicts,
  measurementsCount,
  headerActions,
  onUnlockAction,
}: CoachChatProps) {
  const [input, setInput] = useState('');
  // teach-mode-coach: when on, the next question is sent as mode="teach" so the
  // coach teaches the relevant craft grounded in this track instead of a direct
  // Q&A answer.
  const [teachMode, setTeachMode] = useState(false);
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

  // Throttle aria-live updates to ARIA_LIVE_THROTTLE_MS. Tokens still land
  // in the visible transcript immediately via setTurns; the live-region
  // text is the throttled mirror — DELTA only (P9), not cumulative.
  const ariaLiveBufferRef = useRef<string>('');
  const ariaLiveLastFlushRef = useRef<number>(0);
  const ariaLiveTimerRef = useRef<number | null>(null);
  const [ariaLiveText, setAriaLiveText] = useState<string>('');

  const flushAriaLive = useCallback(() => {
    ariaLiveLastFlushRef.current = Date.now();
    if (ariaLiveTimerRef.current !== null) {
      window.clearTimeout(ariaLiveTimerRef.current);
      ariaLiveTimerRef.current = null;
    }
    setAriaLiveText(ariaLiveBufferRef.current);
    // P9 — reset buffer so the next flush announces only NEW tokens.
    ariaLiveBufferRef.current = '';
  }, []);

  const scheduleAriaLive = useCallback(
    (delta: string) => {
      ariaLiveBufferRef.current += delta;
      const since = Date.now() - ariaLiveLastFlushRef.current;
      if (since >= ARIA_LIVE_THROTTLE_MS) {
        flushAriaLive();
      } else if (ariaLiveTimerRef.current === null) {
        ariaLiveTimerRef.current = window.setTimeout(
          flushAriaLive,
          ARIA_LIVE_THROTTLE_MS - since,
        );
      }
    },
    [flushAriaLive],
  );

  // Code-review P1 — unmount cleanup: abort in-flight fetch + clear timer.
  // Without this, navigating away mid-stream leaks the SSE fetch and the
  // 500ms timer fires into a dead closure (memory pressure + the BFF
  // never receives the abort signal that triggers `coach:cancel:{id}`).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (ariaLiveTimerRef.current !== null) {
        window.clearTimeout(ariaLiveTimerRef.current);
        ariaLiveTimerRef.current = null;
      }
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

  const suggestions = useMemo(() => deriveCoachSuggestions(verdicts), [verdicts]);

  // Grounding scope inputs — purely derived.
  const shortid = useMemo(
    () => analysisId.replace(/-/g, '').slice(0, 8),
    [analysisId],
  );
  const openVerdictCount = useMemo(
    () =>
      verdicts.filter((v) => !v.userState?.dismissed && !v.userState?.applied)
        .length,
    [verdicts],
  );

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

  const handleUnlock = useCallback((intent: string) => {
    // Story 12.5: real destinations — the stale "coming with Epic 2 /
    // Phase E" toasts promised things that shipped long ago.
    if (intent === 'upgrade') {
      // Same idiom as CoachGateInline — /pricing is a _public route.
      window.location.assign('/pricing');
      return;
    }
    if (intent === 'add_stems' || intent === 'add_reference') {
      if (onUnlockAction) {
        onUnlockAction(intent);
        return;
      }
      // Bare mount without the dialog owner: honest pointer, no fake promise.
      toast.info(
        intent === 'add_reference'
          ? 'Add a reference from the song page to unlock this.'
          : 'Add stems from the song page to unlock this.',
      );
    }
  }, [onUnlockAction]);

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
    const turnMode: 'qa' | 'teach' = teachMode ? 'teach' : 'qa';
    sendingRef.current = true;
    setInput('');
    setTurns((t) => [
      ...t,
      { role: 'user', text: msg, mode: turnMode },
      { role: 'assistant', text: '', finalized: false, mode: turnMode },
    ]);
    setStreaming(true);
    setStreamStatus('Coach is responding…');
    ariaLiveBufferRef.current = '';
    ariaLiveLastFlushRef.current = 0;
    setAriaLiveText('');

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
      if (ariaLiveTimerRef.current !== null) {
        window.clearTimeout(ariaLiveTimerRef.current);
        ariaLiveTimerRef.current = null;
      }
    }
  }, [analysisId, caps, flushAriaLive, input, offlineState, scheduleAriaLive, streaming, teachMode]);

  return (
    <div className="coach-wrap">
      <div className="coach-hd">
        <TranceBot size={50} thinking={streaming} />
        <div className="ch-b">
          <div className="ch-k">
            <span className="led" />
            <span className="lab">Ask the Coach</span>
          </div>
          <div className="ch-name">Ask anything about this mix</div>
          <div className="ch-sub">
            I&rsquo;ve seen every metric on <strong>{trackName || 'this track'}</strong>, every
            specialist verdict, and how it compares to your genre&rsquo;s reference profile.
          </div>
        </div>
        {headerActions && <div className="coach-actions">{headerActions}</div>}
      </div>

      <div className="coach-body">
        {turns.length > 0 && (
          <div className="coach-thread">
            {turns.map((turn, i) => {
              const isAssistant = turn.role === 'assistant';
              const showStreamingPlaceholder =
                isAssistant && !turn.finalized && streaming && i === turns.length - 1 && !turn.text;
              const unlock = turn.refused ? resolveUnlockAction(turn.refusalReason) : null;
              return (
                <div key={i} className={`cmsg ${isAssistant ? 'bot' : 'user'}`}>
                  <span className="cm-role">{isAssistant ? 'Coach' : 'You'}</span>
                  {isAssistant && turn.mode === 'teach' && (
                    <span className="cm-teach-badge">
                      <Pill tone="violet">Teach</Pill>
                    </span>
                  )}
                  <div className="bub">
                    {turn.text || (showStreamingPlaceholder ? '…' : '')}
                    {isAssistant && turn.finalized && turn.evidence && turn.evidence.length > 0 && (
                      <EvidenceChips evidence={turn.evidence} />
                    )}
                    {isAssistant && turn.finalized && turn.refused && unlock && (
                      <div className={s.unlockRow}>
                        <button
                          type="button"
                          className={s.unlockBtn}
                          onClick={() => handleUnlock(unlock.intent)}
                          aria-label={`Unlock: ${unlock.label}`}
                        >
                          <Pill tone="violet">{unlock.label}</Pill>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {offlineState && (
          <section
            className={`card ${s.offlineCard}`}
            aria-labelledby="coach-offline-heading"
            style={{ margin: '14px 14px 0' }}
          >
            <div className={s.offlineHeader}>
              <span className="label" id="coach-offline-heading">
                Coach offline
              </span>
              <Pill tone="orange">unavailable</Pill>
            </div>
            <p className={s.offlineBody}>{COACH_OFFLINE_COPY}</p>
            <div className={s.offlineActions}>
              <button type="button" className="btn sm" onClick={handleRetry}>
                Retry
              </button>
            </div>
          </section>
        )}

        {caps?.capReached && !streaming ? (
          <div style={{ padding: '12px 14px 0' }}>
            <CoachGateInline />
          </div>
        ) : (
          <>
            <div className="coach-chips">
              {suggestions.map((q) => (
                <button key={q} type="button" onClick={() => setInput(q)} disabled={offlineState}>
                  {q}
                </button>
              ))}
            </div>

            <div className="coach-input">
              <button
                type="button"
                className="coach-teach"
                onClick={() => setTeachMode((v) => !v)}
                aria-pressed={teachMode}
                aria-label="Teach me mode — learn the craft using your track as the example"
                title="Teach me: the coach explains the craft using your track's measurements"
                disabled={offlineState}
              >
                🎓 {teachMode ? 'Teaching' : 'Teach'}
              </button>
              <input
                placeholder={
                  offlineState
                    ? 'Coach is offline'
                    : teachMode
                      ? 'Ask the coach to teach you something…'
                      : 'Ask the coach about this mix…'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !streaming) {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={offlineState}
                aria-label="Coach question input"
              />
              {streaming ? (
                <button type="button" className="send" onClick={handleStop} aria-label="Stop coach response">
                  ◼
                </button>
              ) : (
                <button
                  type="button"
                  className="send"
                  onClick={send}
                  disabled={!input.trim() || offlineState}
                >
                  Ask →
                </button>
              )}
            </div>
          </>
        )}

        <div className="coach-cap">
          <CoachCapChip used={caps?.used ?? 0} limit={caps?.limit ?? 3} />
        </div>
        <div className="coach-grounding" aria-label="Coach answers are grounded in this report only.">
          Answers grounded in analysis <code>#{shortid}</code> · {measurementsCount} measurements ·{' '}
          {openVerdictCount} verdicts
        </div>

        {/* SR-only live regions for stream-state + token mirror. */}
        <span className="sr-only" aria-live="polite">
          {streamStatus}
        </span>
        <span className="sr-only" aria-live="polite" aria-atomic="false" aria-relevant="additions">
          {ariaLiveText}
        </span>
      </div>
    </div>
  );
}
