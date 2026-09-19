// @vitest-environment jsdom
/* Wave-3 Tasks 1+2 — integration: a mutation that opted in via meta.errorToast
 * fires exactly ONE global toast through the app's MutationCache (server copy
 * preferred), and a call-site-handled mutation with NO meta fires ZERO global
 * toasts (the opt-in rule that prevents double-toasting). Vehicle hooks are
 * arbitrary — any mutation wired through the shared `fetcher` demonstrates the
 * same MutationCache behavior; useDeleteRackPreset (meta.errorToast) and
 * useCreateNote (no meta, call-site-handled) stand in here. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { toast } from 'sonner';

import { ApiError, fetcher } from '../../../api/fetcher';
import { useCreateNote } from '../../../api/hooks';
import { createMutationCache } from '../../../api/mutation-error-toast';
import { useDeleteRackPreset } from '../../listen-rack/useRackPresets';

const fetcherMock = vi.mocked(fetcher);
const errorSpy = vi.mocked(toast.error);

// Same MutationCache wiring as main.tsx — the thing under test.
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: createMutationCache(),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('meta.errorToast through the global MutationCache', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    errorSpy.mockClear();
  });

  it('delete-preset → 403 → exactly one toast carrying the server message', async () => {
    fetcherMock.mockRejectedValueOnce(
      new ApiError(403, { error: { code: 'forbidden', message: 'Only the owner can delete.' } }),
    );
    const { result } = renderHook(() => useDeleteRackPreset('v1'), { wrapper });
    act(() => result.current.mutate('preset-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Only the owner can delete.');
  });

  it('delete-preset → network failure → the meta fallback copy', async () => {
    fetcherMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useDeleteRackPreset('v1'), { wrapper });
    act(() => result.current.mutate('preset-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Could not delete the preset.');
  });

  it('call-site-handled useCreateNote (no meta) fires ZERO global toasts', async () => {
    fetcherMock.mockRejectedValueOnce(new ApiError(403, { error: 'nope' }));
    const callSiteOnError = vi.fn();
    const { result } = renderHook(() => useCreateNote('v1'), { wrapper });
    act(() =>
      result.current.mutate(
        { tSeconds: 0, text: 'hi', pinned: false },
        { onError: callSiteOnError },
      ),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(callSiteOnError).toHaveBeenCalledTimes(1); // the call site still hears it
    expect(errorSpy).not.toHaveBeenCalled(); // the global handler stays silent
  });
});
