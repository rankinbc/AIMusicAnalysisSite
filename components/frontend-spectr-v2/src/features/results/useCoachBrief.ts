import { useEffect, useRef, useState } from 'react';

import { getAccessToken } from '../../api/fetcher';

// Task G6 — the coach opens each report with a once-per-conversation brief
// (BFF: POST /api/coach/{analysisId}/brief, idempotent — see the endpoint's
// {status, messageId} contract). This hook owns ONLY the trigger: deciding
// when it is safe to ask, firing the POST at most once per analysisId
// (StrictMode-safe via a ref latch), and backing off a bounded schedule on a
// 409 `brief_not_ready`. It NEVER opens the per-message SSE stream itself
// (G-D2) — that stays useCoachSession's job (`followMessage`). Task G6 fix
// round 1 (item 1): the old invalidateQueries → signal-query → refetch-once
// indirection is gone. Whenever the POST resolves to `created`/`retried`/
// `exists` (never `skipped`), this hook hands the messageId straight to the
// caller's `onMessageId` callback (CoachChat wires it to
// useCoachSession's `followMessage`), which opens the stream and applies
// frames live instead of waiting for a reload.

export interface ShouldRequestBriefArgs {
  triageDone: boolean;
  specialistsSuggested: number;
  specialistsRan: number;
  conversationLoaded: boolean;
  hasBrief: boolean;
  alreadyRequested: boolean;
}

/** Pure gate, independently testable. */
export function shouldRequestBrief(a: ShouldRequestBriefArgs): boolean {
  if (a.alreadyRequested || a.hasBrief) return false;
  if (!a.triageDone || !a.conversationLoaded) return false;
  if (a.specialistsSuggested > 0 && a.specialistsRan < a.specialistsSuggested) return false;
  return true;
}

// Bounded backoff for 409 brief_not_ready: 5s, 10s, 20s, 40s, 45s — sums to
// 120s (~2 minutes), then the hook goes silent for the rest of the report
// view. Never a tight loop; never unbounded.
const BACKOFF_MS = [5000, 10000, 20000, 40000, 45000];

interface Latch {
  analysisId: string | null;
  requested: boolean;
  settled: boolean;
  attempt: number;
}

export interface UseCoachBriefArgs {
  analysisId: string | null;
  triageDone: boolean;
  specialistsSuggested: number;
  specialistsRan: number;
  conversationLoaded: boolean;
  hasBrief: boolean;
  /** Task G6 fix round 1 (item 1) — called with the brief's assistant
   *  `messageId` whenever the POST resolves to `created`/`retried`/`exists`
   *  (never for `skipped`). The caller (CoachChat, via
   *  useCoachSession's `followMessage`) opens that message's SSE stream and
   *  shows it live instead of waiting for a reload. */
  onMessageId: (messageId: string) => void;
}

export function useCoachBrief({
  analysisId,
  triageDone,
  specialistsSuggested,
  specialistsRan,
  conversationLoaded,
  hasBrief,
  onMessageId,
}: UseCoachBriefArgs): void {
  const latchRef = useRef<Latch>({ analysisId: null, requested: false, settled: false, attempt: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0);

  // A new report view resets the latch and cancels any pending backoff.
  useEffect(() => {
    if (latchRef.current.analysisId !== analysisId) {
      latchRef.current = { analysisId, requested: false, settled: false, attempt: 0 };
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [analysisId]);

  useEffect(() => {
    if (!analysisId) return;
    const latch = latchRef.current;
    const alreadyRequested = latch.requested || latch.settled;
    if (
      !shouldRequestBrief({
        triageDone,
        specialistsSuggested,
        specialistsRan,
        conversationLoaded,
        hasBrief,
        alreadyRequested,
      })
    ) {
      return;
    }
    // Set synchronously (before the await below) so React StrictMode's
    // mount→cleanup→mount double-invoke never issues a second POST — the
    // second invocation's gate check sees `requested: true` immediately.
    latch.requested = true;
    const requestAnalysisId = analysisId;

    (async () => {
      try {
        const token = getAccessToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`/api/coach/${requestAnalysisId}/brief`, { method: 'POST', headers });
        // The report may have changed while this was in flight; a stale
        // response must never touch a different analysis's latch/query.
        if (latchRef.current.analysisId !== requestAnalysisId) return;

        if (res.status === 409) {
          const attempt = latch.attempt;
          if (attempt >= BACKOFF_MS.length) {
            latch.settled = true; // backoff budget exhausted — stop silently
            return;
          }
          latch.attempt = attempt + 1;
          latch.requested = false; // re-arm for the next attempt
          timerRef.current = setTimeout(() => {
            if (latchRef.current.analysisId === requestAnalysisId) setTick((t) => t + 1);
          }, BACKOFF_MS[attempt]);
          return;
        }

        if (!res.ok) {
          latch.settled = true; // a failure is silent — the chat simply has no brief
          return;
        }

        const body = (await res.json().catch(() => null)) as
          | { status?: string; messageId?: string | null }
          | null;
        latch.settled = true;
        if (body?.status === 'skipped') return; // e.g. the seeded demo report — never retry
        if (body?.messageId) onMessageId(body.messageId);
      } catch {
        latch.settled = true; // network failure — silent, no retry
      }
    })();
  }, [
    analysisId,
    triageDone,
    specialistsSuggested,
    specialistsRan,
    conversationLoaded,
    hasBrief,
    onMessageId,
    tick,
  ]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
}
