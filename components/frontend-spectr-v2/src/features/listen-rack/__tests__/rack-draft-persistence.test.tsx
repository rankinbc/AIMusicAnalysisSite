/* The rack draft must survive the two ways a user actually leaves the page.
 *
 * 1. Client-side round trip. The draft query is `staleTime: Infinity`, so a
 *    return visit inside gcTime is served from cache with NO refetch. Nothing
 *    used to write that cache after a save, so the page restored the FIRST
 *    visit's draft over the saved one — and the next autosave then persisted
 *    that stale rack (reproduced live 2026-09-20: module switched on, PUT 200,
 *    back → Open in Listen → module off; a full reload showed it on).
 * 2. Leaving inside the 1.2 s debounce. The effect cleanup cancelled the
 *    pending save, so the last change was never sent at all. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../../../api/fetcher';
import type { Chain } from '../chain';
import { useRackDraft, useRackDraftAutosave, useUpsertRackDraft } from '../useRackPresets';

const fetcherMock = vi.mocked(fetcher);

const CHAIN_A: Chain = { order: ['eq'], modules: { eq: { enabled: false } }, masterBypass: false };
const CHAIN_B: Chain = { order: ['eq'], modules: { eq: { enabled: true } }, masterBypass: false };

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

const puts = () =>
  fetcherMock.mock.calls.map(([cfg]) => cfg).filter((cfg) => cfg.method === 'PUT');

describe('rack draft — a return visit restores what was saved', () => {
  // Braces matter: `mockReset()` returns the mock, and vitest CALLS a function
  // returned from a hook as its teardown — i.e. `fetcher()` with no config.
  beforeEach(() => { fetcherMock.mockReset(); });

  it('serves the saved chain to the next mount, without waiting on the PUT', async () => {
    fetcherMock.mockImplementation(({ method }: { method: string }) => {
      if (method === 'GET') return Promise.resolve({ songVersionId: 'v1', chain: CHAIN_A, updatedAt: 't0' });
      return new Promise(() => {}); // the PUT is still in flight when the user comes back
    });
    const { wrapper } = makeWrapper();

    const first = renderHook(() => useRackDraft('v1'), { wrapper });
    await waitFor(() => expect(first.result.current.data?.chain).toEqual(CHAIN_A));
    const save = renderHook(() => useUpsertRackDraft('v1'), { wrapper });
    act(() => save.result.current.mutate({ chain: CHAIN_B }));
    first.unmount();
    save.unmount();

    const second = renderHook(() => useRackDraft('v1'), { wrapper });
    await waitFor(() => expect(second.result.current.data?.chain).toEqual(CHAIN_B));
  });
});

describe('rack draft autosave — leaving inside the debounce window', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    fetcherMock.mockResolvedValue({ songVersionId: 'v1', chain: CHAIN_B, updatedAt: 't1' });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('sends the pending change when the page unmounts', async () => {
    const { wrapper } = makeWrapper();
    const hook = renderHook(({ chain }) => useRackDraftAutosave('v1', chain, true), {
      wrapper, initialProps: { chain: CHAIN_A },
    });
    hook.rerender({ chain: CHAIN_B });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); // still inside the 1.2 s debounce
    expect(puts()).toHaveLength(0);

    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(puts()).toHaveLength(1);
    expect(puts()[0]?.data).toEqual({ chain: CHAIN_B });
  });

  it('sends it with keepalive on pagehide, and the debounce does not send it twice', async () => {
    const { wrapper } = makeWrapper();
    const hook = renderHook(({ chain }) => useRackDraftAutosave('v1', chain, true), {
      wrapper, initialProps: { chain: CHAIN_A },
    });
    hook.rerender({ chain: CHAIN_B });

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(puts()).toHaveLength(1);
    expect(puts()[0]).toMatchObject({ data: { chain: CHAIN_B }, keepalive: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(puts()).toHaveLength(1);
  });

  it('sends nothing on unmount when there is no unsaved change', async () => {
    const { wrapper } = makeWrapper();
    const hook = renderHook(({ chain }) => useRackDraftAutosave('v1', chain, true), {
      wrapper, initialProps: { chain: CHAIN_A },
    });
    hook.rerender({ chain: CHAIN_B });
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); }); // the debounce already saved it
    expect(puts()).toHaveLength(1);

    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(puts()).toHaveLength(1);
  });
});
