import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import type {
  CreateCoachMessageResponse,
  VerdictDto,
} from '../../api/types';
import { Pill } from '../../ui/Pill';
import { TranceBot } from './TranceBot';
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
}

const STRONG = [
  'Mix balance and frequency',
  'Loudness and streaming targets',
  'Specialist findings & priorities',
  'Genre-comparative analysis',
];

const WEAK = [
  'Subjective taste and vibe',
  'Mastering chain plugin specifics',
  'Real-time playback rendering',
  'Live arrangement experiments',
];

export function CoachChat({
  trackName,
  analysisId,
  verdicts,
  measurementsCount,
}: CoachChatProps) {
  const [input, setInput] = useState('');
  const [showCaps, setShowCaps] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [offlineState, setOfflineState] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>('');
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
    // Story 1.9 / Phase E will wire real navigation. Today the stems
    // upload route doesn't exist — surface intent via toast so the
    // affordance is visible but doesn't dead-link.
    if (intent === 'add_stems') {
      toast.info('Stems upload coming with Phase E — your gap is noted.');
    } else if (intent === 'add_reference') {
      toast.info('Reference upload coming with Phase E.');
    } else if (intent === 'upgrade') {
      toast.info('Upgrade flow coming with Epic 2.');
    }
  }, []);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sendingRef.current || streaming || offlineState) return;
    sendingRef.current = true;
    setInput('');
    setTurns((t) => [
      ...t,
      { role: 'user', text: msg },
      { role: 'assistant', text: '', finalized: false },
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
        body: JSON.stringify({ content: msg }),
        signal: ac.signal,
      });

      if (!postRes.ok) {
        const errBody = await postRes.json().catch(() => null as unknown);
        const code = extractErrorCode(errBody);
        if (code && OFFLINE_CODES.has(code)) {
          setOfflineState(true);
          setTurns((t) => trimEmptyPending(t));
          setStreamStatus(COACH_OFFLINE_COPY);
          return;
        }
        throw new Error(extractErrorMessage(errBody) ?? `HTTP ${postRes.status}`);
      }

      const created = (await postRes.json()) as CreateCoachMessageResponse;
      const messageId = created.pendingAssistantMessageId;

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
  }, [analysisId, flushAriaLive, input, offlineState, scheduleAriaLive, streaming]);

  return (
    <section className={s.coach}>
      <div className={s.body}>
        <div className={s.avatar}>
          <TranceBot size={72} thinking={streaming} />
        </div>
        <div className={s.text}>
          <div className={s.statusRow}>
            <span className="dot pulse-soft" aria-hidden="true" />
            <span className={s.statusLabel}>Ask the coach</span>
            {/* P17 — `·` separator matches UX-DR13 overline */}
            <span className={s.statusSep}>·</span>
            <span className={s.statusSub}>online · trained on your analysis</span>
          </div>
          <h3 className={s.title}>Ask anything about this mix</h3>
          <p className={s.subtitle}>
            I&rsquo;ve seen every metric on <strong>{trackName || 'this track'}</strong>, every
            specialist verdict, and how it compares to your genre&rsquo;s reference profile.
            Ask me what to fix first, what would push you up a grade, or why a specialist
            flagged what it did.{' '}
            <button
              type="button"
              className={s.capabilitiesLink}
              onClick={() => setShowCaps((v) => !v)}
            >
              {showCaps ? 'hide' : 'what can I ask?'}
            </button>
          </p>

          {showCaps && (
            <div className={s.capabilities}>
              <div className={s.capabilitiesCol}>
                <h4 style={{ color: 'var(--cyan)' }}>Strong here</h4>
                <ul className={s.capabilitiesList}>
                  {STRONG.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
              <div className={s.capabilitiesCol}>
                <h4 style={{ color: 'var(--orange)' }}>Falls flat here</h4>
                <ul className={s.capabilitiesList}>
                  {WEAK.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className={s.suggestions}>
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                className={s.suggestion}
                onClick={() => setInput(q)}
                disabled={offlineState}
              >
                {q}
              </button>
            ))}
          </div>

          <div className={s.inputRow}>
            <input
              className={`${s.input}${offlineState ? ` ${s.inputDisabled}` : ''}`}
              placeholder={offlineState ? 'Coach is offline' : 'Ask the coach…'}
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
              <button
                type="button"
                className="btn ghost"
                onClick={handleStop}
                aria-label="Stop coach response"
              >
                ◼ Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={send}
                disabled={!input.trim() || offlineState}
              >
                Ask →
              </button>
            )}
          </div>

          <p
            className={s.groundingScope}
            aria-label="Coach answers are grounded in this report only."
          >
            Answers grounded in analysis <code>#{shortid}</code> ·{' '}
            {measurementsCount} measurements · {openVerdictCount} verdicts
          </p>

          {offlineState && (
            <section
              className={`card ${s.offlineCard}`}
              aria-labelledby="coach-offline-heading"
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

          {turns.length > 0 && (
            <div className={s.transcript}>
              {turns.map((turn, i) => {
                const isAssistant = turn.role === 'assistant';
                const showStreamingPlaceholder =
                  isAssistant && !turn.finalized && streaming && i === turns.length - 1 && !turn.text;
                const unlock = turn.refused ? resolveUnlockAction(turn.refusalReason) : null;
                return (
                  <div
                    key={i}
                    className={isAssistant ? s.turnAssistant : s.turnUser}
                  >
                    <span className={s.turnLabel}>
                      {isAssistant ? 'Coach' : 'You'}
                    </span>
                    <p className={s.turnText}>
                      {turn.text || (showStreamingPlaceholder ? '…' : '')}
                    </p>
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
                );
              })}
            </div>
          )}

          {/* Single SR-only live region for stream-state + token mirror. The
              ariaLiveText additive region uses additions-only so VoiceOver
              announces only the throttled delta. The status string is
              announced as a whole when it changes (offline / done / cancelled). */}
          <span className="sr-only" aria-live="polite">
            {streamStatus}
          </span>
          <span
            className="sr-only"
            aria-live="polite"
            aria-atomic="false"
            aria-relevant="additions"
          >
            {ariaLiveText}
          </span>

          <p className={s.disclaimer}>
            Coach answers are scoped to this analysis. I won&rsquo;t mix the track for you, but I
            will tell you exactly which knob to turn and how far.
          </p>
        </div>
      </div>
    </section>
  );
}
