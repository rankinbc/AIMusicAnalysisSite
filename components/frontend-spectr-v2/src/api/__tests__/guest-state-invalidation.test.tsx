// @vitest-environment jsdom
// D10 fix1 (item 2/3) — every mutation that changes a number `GET
// /api/me/guest` reports must invalidate that query (through the shared
// `invalidateGuestState` helper) in its onSuccess. A `staleTime: Infinity`
// query nobody writes to has shipped twice in this codebase already (see
// MEMORY.md never-stale-query-client-writes) — this is the regression test
// for the mutation side of that contract.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../fetcher';
import {
  useArchiveSong,
  useDeleteReference,
  useDeleteSong,
  useDeleteVersion,
  useGenerateFixRack,
  useReanalyzeVersion,
  useRestoreSong,
  useUploadReference,
} from '../hooks';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

function guestKeyInvalidated(spy: { mock: { calls: unknown[][] } }): boolean {
  return spy.mock.calls.some(
    (args) =>
      JSON.stringify((args[0] as { queryKey: unknown[] }).queryKey) ===
      JSON.stringify(['me', 'guest']),
  );
}

describe('D10 fix1 — mutations that change a guest counter invalidate me/guest', () => {
  beforeEach(() => {
    vi.mocked(fetcher).mockReset();
  });

  it('useReanalyzeVersion', async () => {
    vi.mocked(fetcher).mockResolvedValue({ jobId: 'j1' });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useReanalyzeVersion('v1'), { wrapper });
    act(() => result.current.mutate(undefined));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
  });

  it('useUploadReference', async () => {
    vi.mocked(fetcher).mockResolvedValue({ id: 'r1', title: 't' });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUploadReference(), { wrapper });
    act(() => result.current.mutate({ file: new File(['x'], 'a.wav') }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
  });

  it('useDeleteReference', async () => {
    vi.mocked(fetcher).mockResolvedValue(undefined);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useDeleteReference(), { wrapper });
    act(() => result.current.mutate('ref1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
  });

  it('useArchiveSong / useRestoreSong / useDeleteSong / useDeleteVersion', async () => {
    vi.mocked(fetcher).mockResolvedValue(undefined);
    const { wrapper, invalidateSpy } = makeWrapper();

    const archive = renderHook(() => useArchiveSong(), { wrapper });
    act(() => archive.result.current.mutate('song1'));
    await waitFor(() => expect(archive.result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
    invalidateSpy.mockClear();

    const restore = renderHook(() => useRestoreSong(), { wrapper });
    act(() => restore.result.current.mutate('song1'));
    await waitFor(() => expect(restore.result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
    invalidateSpy.mockClear();

    const del = renderHook(() => useDeleteSong(), { wrapper });
    act(() => del.result.current.mutate('song1'));
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
    invalidateSpy.mockClear();

    const delVersion = renderHook(() => useDeleteVersion(), { wrapper });
    act(() => delVersion.result.current.mutate('v1'));
    await waitFor(() => expect(delVersion.result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
  });

  it('useGenerateFixRack', async () => {
    vi.mocked(fetcher).mockResolvedValue({ status: 'queued' });
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useGenerateFixRack('job1'), { wrapper });
    act(() => result.current.mutate(undefined));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(guestKeyInvalidated(invalidateSpy)).toBe(true);
  });
});
