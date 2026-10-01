import { useEffect, useState } from 'react';

import type { DegradationNoticeDto, VerdictsListResponse } from './types';

// Task P9 + product bug — the triage wait is a TIME budget, not a poll count.
// The old `dataUpdateCount < 25` (x 3 s = 75 s) gave up while a busy single
// worker was still triaging, so triageDone never flipped: no coach brief and
// no specialist auto-run until a reload. Now: 3 s polls for the first minute,
// 10 s after that, up to 10 minutes; then ReportView shows a timeout notice.

export const TRIAGE_FAST_POLL_MS = 3000;
export const TRIAGE_FAST_WINDOW_MS = 60_000;
export const TRIAGE_SLOW_POLL_MS = 10_000;
export const TRIAGE_TIMEOUT_MS = 600_000;

export const TRIAGE_TIMEOUT_NOTICE: DegradationNoticeDto = {
  reason: 'triage_timeout',
  detail: null,
  occurredAt: new Date(0).toISOString(),
};

export function isTriagePending(d: VerdictsListResponse | undefined): boolean {
  return d != null && d.routingPlan == null && d.degradation == null;
}

// When this page load first saw each job's triage pending. Module state on
// purpose: the poll callback (react-query refetchInterval) and the notice
// hook must agree on ONE start, and a reload starts a fresh budget.
const waitStart = new Map<string, number>();

function startOf(key: string, now: number): number {
  const s = waitStart.get(key);
  if (s !== undefined) return s;
  waitStart.set(key, now);
  return now;
}

/** The refetch delay for a job's verdicts while triage is pending (false =
 *  stop polling). */
export function triageRefetchMs(
  key: string,
  d: VerdictsListResponse | undefined,
  now: number = Date.now(),
): number | false {
  if (!isTriagePending(d)) return false;
  const elapsed = now - startOf(key, now);
  if (elapsed < TRIAGE_FAST_WINDOW_MS) return TRIAGE_FAST_POLL_MS;
  if (elapsed < TRIAGE_TIMEOUT_MS) return TRIAGE_SLOW_POLL_MS;
  return false;
}

/** True once triage has been pending for the whole budget (a TIMER — a
 *  structurally identical poll does not re-render ReportView). */
export function useTriageTimedOut(key: string, d: VerdictsListResponse | undefined): boolean {
  const pending = isTriagePending(d);
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return undefined;
    const remaining = startOf(key, Date.now()) + TRIAGE_TIMEOUT_MS - Date.now();
    const t = setTimeout(() => setTimedOutKey(key), Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [key, pending]);
  return pending && timedOutKey === key;
}

export function resetTriageWaitForTests(): void {
  waitStart.clear();
}
