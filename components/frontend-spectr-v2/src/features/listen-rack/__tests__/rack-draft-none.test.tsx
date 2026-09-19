/* "No draft yet" is the NORMAL first visit to the Listen page: the server
 * answers 204 and `fetcher` resolves `undefined`. TanStack Query v5 rejects
 * `undefined` query data ("Query data cannot be undefined"), which used to put
 * the draft query into `isError` → resolveDraftRestore said 'pause' → an error
 * toast on every first visit and autosave never armed. "No draft" must be a
 * SUCCESS carrying `null`. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { ApiError, fetcher } from '../../../api/fetcher';
import { resolveDraftRestore, useRackDraft } from '../useRackPresets';

const fetcherMock = vi.mocked(fetcher);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRackDraft — no draft yet (204)', () => {
  beforeEach(() => fetcherMock.mockReset());

  it('resolves to null (success), so the page restores-nothing and arms autosave', async () => {
    fetcherMock.mockResolvedValueOnce(undefined); // what fetcher returns for a 204
    const { result } = renderHook(() => useRackDraft('v1'), { wrapper });
    await waitFor(() => expect(result.current.isFetched).toBe(true));

    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeNull();
    expect(
      resolveDraftRestore({
        draftRestored: false, realAudio: true, carryPhase: 'none',
        isError: result.current.isError, isFetched: result.current.isFetched,
      }),
    ).toBe('restore');
  });

  it('still passes a saved draft through untouched', async () => {
    const draft = { chain: { order: ['eq'], modules: {}, masterBypass: false } };
    fetcherMock.mockResolvedValueOnce(draft);
    const { result } = renderHook(() => useRackDraft('v1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(draft);
  });

  it('a real failure still pauses autosave', async () => {
    fetcherMock.mockRejectedValueOnce(new ApiError(500, undefined));
    const { result } = renderHook(() => useRackDraft('v1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      resolveDraftRestore({
        draftRestored: false, realAudio: true, carryPhase: 'none', isError: true, isFetched: true,
      }),
    ).toBe('pause');
  });
});
