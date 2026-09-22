// @vitest-environment jsdom
// Task G6 — the coach brief trigger. `shouldRequestBrief` is the pure gate;
// `useCoachBrief` fires POST /api/coach/{analysisId}/brief AT MOST ONCE per
// report view (StrictMode-safe via a ref latch), backs off a bounded,
// capped schedule on 409 `brief_not_ready`. It must NEVER open the
// per-message SSE stream itself (G-D2/G-D3 — that stays the sole job of
// useCoachSession's `followMessage`, reused for the brief too). Fix round 1
// (item 1) — on success it hands the messageId to `onMessageId` instead of
// invalidating a query key; these tests were adapted for that (the trigger
// bound itself — the actual thing under test — is unchanged).
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldRequestBrief, useCoachBrief } from '../useCoachBrief';

describe('shouldRequestBrief', () => {
  const base = {
    triageDone: true,
    specialistsSuggested: 2,
    specialistsRan: 2,
    conversationLoaded: true,
    hasBrief: false,
    alreadyRequested: false,
  };

  it('is false until triage is done and the conversation has loaded', () => {
    expect(shouldRequestBrief({ ...base, triageDone: false })).toBe(false);
    expect(shouldRequestBrief({ ...base, conversationLoaded: false })).toBe(false);
  });

  it('is false while fewer specialists have run than were suggested', () => {
    expect(shouldRequestBrief({ ...base, specialistsRan: 1, specialistsSuggested: 2 })).toBe(false);
  });

  it('is true once every suggested specialist has run', () => {
    expect(shouldRequestBrief({ ...base, specialistsRan: 2, specialistsSuggested: 2 })).toBe(true);
  });

  it('is true when no specialists were suggested at all', () => {
    expect(shouldRequestBrief({ ...base, specialistsSuggested: 0, specialistsRan: 0 })).toBe(true);
  });

  it('is false when the conversation already has a brief', () => {
    expect(shouldRequestBrief({ ...base, hasBrief: true })).toBe(false);
  });

  it('is false when a request has already been made', () => {
    expect(shouldRequestBrief({ ...base, alreadyRequested: true })).toBe(false);
  });
});

const readyArgs = {
  triageDone: true,
  specialistsSuggested: 0,
  specialistsRan: 0,
  conversationLoaded: true,
  hasBrief: false,
};

describe('useCoachBrief', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fires the brief POST exactly once and hands the messageId to onMessageId', async () => {
    const fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> = vi.fn(() =>
      Promise.resolve({ ok: true, status: 202, json: async () => ({ status: 'created', messageId: 'm1' }) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    await act(async () => {
      renderHook(() => useCoachBrief({ analysisId: 'a1', ...readyArgs, onMessageId }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/coach/a1/brief');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(onMessageId).toHaveBeenCalledWith('m1');
    // G-D2 — never opens the per-message stream itself.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/stream'))).toBe(false);
  });

  it('never fires when analysisId is null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    await act(async () => {
      renderHook(() => useCoachBrief({ analysisId: null, ...readyArgs, onMessageId }));
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onMessageId).not.toHaveBeenCalled();
  });

  it('does not fire again across re-renders once requested', async () => {
    const fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'exists', messageId: 'm1' }) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    const { rerender } = renderHook(
      (props: typeof readyArgs) => useCoachBrief({ analysisId: 'a1', ...props, onMessageId }),
      { initialProps: readyArgs },
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender({ ...readyArgs, specialistsRan: 1 });
    rerender({ ...readyArgs, specialistsRan: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is StrictMode double-mount safe — still exactly one POST', async () => {
    const fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'exists', messageId: 'm1' }) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    await act(async () => {
      renderHook(() => useCoachBrief({ analysisId: 'a1', ...readyArgs, onMessageId }), {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-arms after a bounded backoff on 409 brief_not_ready, then stops', async () => {
    vi.useFakeTimers();
    const fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({ error: { code: 'brief_not_ready' } }),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    renderHook(() => useCoachBrief({ analysisId: 'a1', ...readyArgs, onMessageId }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The bounded schedule: 5s, 10s, 20s, 40s, 45s — one more 409 each step,
    // then the budget (~2 min total) is exhausted and it goes silent.
    const schedule = [5000, 10000, 20000, 40000, 45000];
    for (let i = 0; i < schedule.length; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(schedule[i]);
      });
      expect(fetchMock).toHaveBeenCalledTimes(i + 2); // +1 for the initial call
    }
    const callsAfterBudget = fetchMock.mock.calls.length;

    // Advancing well past the budget adds no further calls — it stopped.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterBudget);
    expect(onMessageId).not.toHaveBeenCalled();
  });

  it('never retries once the server answers skipped (the seeded demo report)', async () => {
    vi.useFakeTimers();
    const fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>> = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'skipped', messageId: null } as unknown) } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    renderHook(() => useCoachBrief({ analysisId: 'a1', ...readyArgs, onMessageId }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onMessageId).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the conversation already carries a brief message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onMessageId = vi.fn();

    renderHook(() => useCoachBrief({ analysisId: 'a1', ...readyArgs, hasBrief: true, onMessageId }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
