// @vitest-environment jsdom
// Task P9 + product bug: the verdicts poll gave up after 25 x 3 s = 75 s, so
// a triage slower than that (a busy single worker) never flipped triageDone
// — no brief, no specialist auto-run until a reload. The triage wait is now a
// TIME budget: 3 s polls for the first minute, then 10 s, up to 10 minutes,
// then a timeout notice.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerdictsListResponse } from '../types';
import {
  TRIAGE_TIMEOUT_MS,
  isTriagePending,
  resetTriageWaitForTests,
  triageRefetchMs,
  useTriageTimedOut,
} from '../verdict-polling';

const base = { verdicts: [], routingPlan: null, degradation: null } as unknown as VerdictsListResponse;
const planned = { ...base, routingPlan: { specialistsToRun: [] } } as unknown as VerdictsListResponse;

describe('triage wait is a time budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    resetTriageWaitForTests();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('pending = a loaded response with neither a plan nor a degradation', () => {
    expect(isTriagePending(undefined)).toBe(false);
    expect(isTriagePending(base)).toBe(true);
    expect(isTriagePending(planned)).toBe(false);
  });

  it('polls every 3 s for the first minute, then every 10 s, and stops at 10 minutes', () => {
    expect(triageRefetchMs('j1', base)).toBe(3000);
    vi.advanceTimersByTime(59_000);
    expect(triageRefetchMs('j1', base)).toBe(3000);
    vi.advanceTimersByTime(2_000);
    expect(triageRefetchMs('j1', base)).toBe(10_000);
    // well past the old 75 s cap — still polling
    vi.advanceTimersByTime(5 * 60_000);
    expect(triageRefetchMs('j1', base)).toBe(10_000);
    vi.advanceTimersByTime(TRIAGE_TIMEOUT_MS);
    expect(triageRefetchMs('j1', base)).toBe(false);
  });

  it('never polls for a landed plan, and a new job gets its own budget', () => {
    expect(triageRefetchMs('j1', planned)).toBe(false);
    triageRefetchMs('j1', base);
    vi.advanceTimersByTime(TRIAGE_TIMEOUT_MS + 1);
    expect(triageRefetchMs('j1', base)).toBe(false);
    expect(triageRefetchMs('j2', base)).toBe(3000);
  });

  it('the timeout notice flips exactly at the budget, not earlier', () => {
    const { result } = renderHook(() => useTriageTimedOut('j1', base));
    act(() => { vi.advanceTimersByTime(TRIAGE_TIMEOUT_MS - 1); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
  });

  it('a plan that lands clears the notice', () => {
    const { result, rerender } = renderHook(({ d }) => useTriageTimedOut('j1', d), { initialProps: { d: base } });
    act(() => { vi.advanceTimersByTime(TRIAGE_TIMEOUT_MS); });
    expect(result.current).toBe(true);
    rerender({ d: planned });
    expect(result.current).toBe(false);
  });
});

describe('useVerdicts keeps waiting for a slow triage', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('still polls 3 minutes in (the old 25-poll cap stopped at ~75 s)', async () => {
    vi.useFakeTimers();
    resetTriageWaitForTests();
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { useVerdicts } = await import('../hooks');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify(base), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useVerdicts('job-slow', { optimisticRunning: new Set(), enabled: true }), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(150_000); });
    const at150 = calls;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(calls).toBeGreaterThan(at150);
    qc.clear();
  });
});

describe('a specialist that never writes a verdict does not poll forever', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('the optimistic-running poll stops within the 10-minute budget', async () => {
    vi.useFakeTimers();
    resetTriageWaitForTests();
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { useVerdicts } = await import('../hooks');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify(planned), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const running = new Set(['low_end']);
    renderHook(() => useVerdicts('job-stuck', { optimisticRunning: running, enabled: true }), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60_000); });
    const after = calls;
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(calls).toBe(after);
    expect(after).toBeLessThan(150); // 3 s polls for 11 min would be ~220
    qc.clear();
  });
});
