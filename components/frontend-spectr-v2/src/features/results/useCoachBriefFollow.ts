import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { getAccessToken } from '../../api/fetcher';
import type { CoachCapsDto, CoachConversationDto } from '../../api/types';
import { readCoachStream } from './coach-stream-reader';
import {
  appendToTurnMatching,
  finalizeTurnMatching,
  isBriefTurn,
  mapMessagesToTurns,
  type ChatTurn,
} from './coach-chat-helpers';

// Task G6 fix round 1 (item 1 + 2) — extracted from useCoachSession.ts to
// keep that file under the CLAUDE.md ~500-line ceiling. Owns the opening
// brief's live-follow + bounded-poll-fallback machinery: `followMessage`
// replaces the old invalidateQueries → signal-query → refetch-once
// indirection (CoachChat.tsx no longer mounts a signal query at all —
// `useCoachBrief` calls `followMessage` directly with the brief's
// `messageId`). Shares `sendingRef`/`abortRef`/the turn setters with
// useCoachSession.ts's `send()` — the brief stream and a live reply never
// run concurrently (both gate on `streaming`/`sendingRef`), so reusing the
// SAME abortRef is safe and gives the brief the same Stop-button + unmount
// abort behaviour a normal reply gets for free.

const MAX_BRIEF_POLL_ATTEMPTS = 40;
const BRIEF_POLL_INTERVAL_MS = 3000;

function buildAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchConversationDto(
  analysisId: string,
  signal: AbortSignal,
): Promise<CoachConversationDto | null> {
  try {
    const res = await fetch(`/api/coach/${analysisId}/conversation`, { headers: buildAuthHeaders(), signal });
    if (!res.ok) return null;
    return (await res.json()) as CoachConversationDto;
  } catch {
    return null; // best-effort — callers already treat a null as "try again later"
  }
}

export interface UseCoachBriefFollowArgs {
  analysisId: string;
  sendingRef: MutableRefObject<boolean>;
  abortRef: MutableRefObject<AbortController | null>;
  setTurns: Dispatch<SetStateAction<ChatTurn[]>>;
  setCaps: Dispatch<SetStateAction<CoachCapsDto | null>>;
  setStreaming: Dispatch<SetStateAction<boolean>>;
  setStreamStatus: Dispatch<SetStateAction<string>>;
}

export function useCoachBriefFollow({
  analysisId,
  sendingRef,
  abortRef,
  setTurns,
  setCaps,
  setStreaming,
  setStreamStatus,
}: UseCoachBriefFollowArgs) {
  // Item 2 — a brief `messageId` that arrived while a send was in flight.
  // Never dropped: send()'s `finally` calls `drainQueuedBrief` once
  // `sendingRef` clears, instead of `followMessage` clobbering the live
  // send's turns mid-stream.
  const queuedBriefIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // A new report view cancels any pending poll/queue from the old one.
  useEffect(() => {
    queuedBriefIdRef.current = null;
    clearPollTimer();
  }, [analysisId, clearPollTimer]);

  useEffect(() => () => clearPollTimer(), [clearPollTimer]);

  // Fix wave FW3 — one controller per mount: unmount aborts any in-flight
  // ensure-fetch / poll fetch, and tells an `aborted` stream result apart
  // from a user Stop.
  const lifeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    lifeRef.current = ac;
    return () => ac.abort();
  }, []);
  const lifeSignal = useCallback(() => {
    if (!lifeRef.current) lifeRef.current = new AbortController();
    return lifeRef.current.signal;
  }, []);

  // Bounded fallback for the opening brief: fetch the conversation, apply
  // it (unless a send is mid-flight — never replace `turns` wholesale
  // while one streams), and stop once the brief row is terminal. `attempt`
  // starts at 1 for a genuine retry loop (up to MAX_BRIEF_POLL_ATTEMPTS,
  // 3s apart ⇒ exactly 2 minutes) or is passed as MAX_BRIEF_POLL_ATTEMPTS
  // for a single reconciliation fetch — `closingLine` is read-time-only
  // (never on the SSE wire, see CoachConversationEndpoints.cs), so a
  // normal `done`/`refusal` frame alone can't render CoachBriefCta.
  const pollUntilTerminal = useCallback(
    (messageId: string, requestAnalysisId: string, attempt: number) => {
      (async () => {
        if (requestAnalysisId !== analysisId) return; // navigated away — stop
        const signal = lifeSignal();
        if (signal.aborted) return; // unmounted — stop
        const dto = await fetchConversationDto(requestAnalysisId, signal);
        if (requestAnalysisId !== analysisId || signal.aborted) return;
        let isTerminal = false;
        if (dto && !sendingRef.current) {
          setCaps(dto.caps);
          setTurns(mapMessagesToTurns(dto.messages));
          const row = dto.messages.find((m) => m.id === messageId);
          isTerminal = row != null && row.status !== 'pending';
        }
        if (isTerminal || attempt >= MAX_BRIEF_POLL_ATTEMPTS) return;
        pollTimerRef.current = setTimeout(() => {
          pollUntilTerminal(messageId, requestAnalysisId, attempt + 1);
        }, BRIEF_POLL_INTERVAL_MS);
      })();
    },
    [analysisId, lifeSignal, sendingRef, setCaps, setTurns],
  );

  const followMessage = useCallback(
    (messageId: string) => {
      if (sendingRef.current) {
        queuedBriefIdRef.current = messageId;
        return;
      }
      const requestAnalysisId = analysisId;

      (async () => {
        // Mount-time hydration ran before the brief existed, so `turns`
        // won't have it yet — one GET /conversation (never more) to seed
        // it before opening the stream.
        const life = lifeSignal();
        const dto = await fetchConversationDto(requestAnalysisId, life);
        if (requestAnalysisId !== analysisId || life.aborted) return;
        if (sendingRef.current) {
          // A send started while this fetch was in flight — don't clobber
          // it with a wholesale turns replace; resume after it settles.
          queuedBriefIdRef.current = messageId;
          return;
        }
        if (dto) {
          setCaps(dto.caps);
          // The BFF's stream ALWAYS replays from an empty accumulator, even
          // for an already-terminal row (WriteTerminalFromRow emits one
          // token frame carrying the FULL content, then the terminal
          // frame — CoachConversationEndpoints.cs). So the brief turn must
          // start empty/unfinalized here regardless of what this fetch
          // reports, or the stream's replay would double-append on top of
          // content this fetch already copied in (briefly — the
          // post-stream reconciliation fetch below would self-heal it a
          // beat later, but a transient duplicate flash is worth avoiding
          // outright). The stream is the sole source of truth for
          // text/finalized from this point; `closingLine` (read-time-only,
          // never on the wire) is picked up by that reconciliation fetch.
          setTurns(() =>
            mapMessagesToTurns(dto.messages).map((t) =>
              isBriefTurn(t) ? { ...t, text: '', finalized: false, closingLine: null } : t,
            ),
          );
        }

        const ac = new AbortController();
        abortRef.current = ac;
        const authHeaders = buildAuthHeaders();
        setStreaming(true);
        setStreamStatus('Coach is responding…');

        // Final-review fix — a network drop mid-body makes the reader throw
        // (not an AbortError). Treat it like a stream that ended without a
        // terminal frame: unlock the composer and poll the row instead of
        // leaving `streaming` stuck true with a half-written brief.
        const result = await readCoachStream(
          `/api/coach/${requestAnalysisId}/messages/${messageId}/stream`,
          authHeaders,
          ac.signal,
          {
            onToken: (text) => setTurns((t) => appendToTurnMatching(t, isBriefTurn, text)),
            onDone: (evidence) =>
              setTurns((t) => finalizeTurnMatching(t, isBriefTurn, { evidence })),
            onRefusal: (reason, body) =>
              setTurns((t) =>
                finalizeTurnMatching(t, isBriefTurn, {
                  replaceText: body,
                  refused: true,
                  refusalReason: reason,
                }),
              ),
            onError: (code, message, atOpen) => {
              // A failed OPEN (non-2xx / no body) is not a turn-level
              // refusal — the row may still be mid-generation server-side.
              // Fall back to the poll below instead of showing an error.
              if (atOpen) return;
              setTurns((t) =>
                finalizeTurnMatching(t, isBriefTurn, {
                  replaceText: message,
                  refused: true,
                  refusalReason: code,
                }),
              );
            },
          },
        ).catch(() => 'ended-without-terminal' as const);

        setStreaming(false);
        abortRef.current = null;
        if (requestAnalysisId !== analysisId) return;

        if (result === 'aborted') {
          if (life.aborted) return; // unmounted — apply nothing
          // Fix wave FW3 — a user Stop only detaches this view: the server
          // never cancels a brief (the row is authoritative), so reconcile
          // by polling until it is terminal instead of leaving an
          // unfinished bubble with no closing line until a reload.
          setStreamStatus('The coach is finishing the brief…');
          pollUntilTerminal(messageId, requestAnalysisId, 1);
          return;
        }
        if (result === 'done' || result === 'refusal' || result === 'error') {
          setStreamStatus(
            result === 'done'
              ? 'Coach finished responding.'
              : result === 'refusal'
                ? 'Coach declined to answer.'
                : 'Coach stream error.',
          );
          pollUntilTerminal(messageId, requestAnalysisId, MAX_BRIEF_POLL_ATTEMPTS);
          return;
        }
        // 'open-failed' | 'ended-without-terminal' — the worker hasn't
        // finished (or the open failed transiently); poll instead of
        // leaving an empty bubble forever.
        pollUntilTerminal(messageId, requestAnalysisId, 1);
      })();
    },
    [analysisId, abortRef, lifeSignal, pollUntilTerminal, sendingRef, setCaps, setStreamStatus, setStreaming, setTurns],
  );

  // Item 2 — called from send()'s `finally`, after `sendingRef.current`
  // clears, so a brief that arrived mid-send is never dropped.
  const drainQueuedBrief = useCallback(() => {
    const id = queuedBriefIdRef.current;
    if (id) {
      queuedBriefIdRef.current = null;
      followMessage(id);
    }
  }, [followMessage]);

  return { followMessage, drainQueuedBrief };
}
