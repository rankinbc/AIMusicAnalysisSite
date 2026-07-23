// @vitest-environment jsdom
/* Wave-3 Tasks 1+2 — integration: a mutation that opted in via meta.errorToast
 * fires exactly ONE global toast through the app's MutationCache (server copy
 * preferred), and a call-site-handled mutation with NO meta fires ZERO global
 * toasts (the opt-in rule that prevents double-toasting). */
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
import { createMutationCache } from '../../../api/mutation-error-toast';
import { useCreateSuggestion, useRejectSuggestion } from '../useSuggestions';

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

  it('reject → 403 → exactly one toast carrying the server message', async () => {
    fetcherMock.mockRejectedValueOnce(
      new ApiError(403, { error: { code: 'forbidden', message: 'Only the owner can reject.' } }),
    );
    const { result } = renderHook(() => useRejectSuggestion('v1'), { wrapper });
    act(() => result.current.mutate('sg-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Only the owner can reject.');
  });

  it('reject → network failure → the meta fallback copy', async () => {
    fetcherMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useRejectSuggestion('v1'), { wrapper });
    act(() => result.current.mutate('sg-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Could not reject the suggestion.');
  });

  it('call-site-handled useCreateSuggestion (no meta) fires ZERO global toasts', async () => {
    fetcherMock.mockRejectedValueOnce(new ApiError(403, { error: 'nope' }));
    const callSiteOnError = vi.fn();
    const { result } = renderHook(() => useCreateSuggestion('v1'), { wrapper });
    act(() =>
      result.current.mutate(
        { chain: { order: [], modules: {}, masterBypass: false } },
        { onError: callSiteOnError },
      ),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(callSiteOnError).toHaveBeenCalledTimes(1); // the call site still hears it
    expect(errorSpy).not.toHaveBeenCalled(); // the global handler stays silent
  });
});
