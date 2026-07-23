/* Wave-3 E6.6/E6.7 — the draft upsert's failure feedback: a deduped
 * (id: 'rack-draft-save') warning toast that replaces rather than stacks
 * across repeated debounced failures. Deliberately hook-level onError, not
 * meta.errorToast (the global handler has no dedupe). */
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
import { useUpsertRackDraft } from '../useRackPresets';

const fetcherMock = vi.mocked(fetcher);
const errorSpy = vi.mocked(toast.error);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useUpsertRackDraft failure feedback', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
    errorSpy.mockClear();
  });

  it('fires the warning toast with the dedupe id on failure', async () => {
    fetcherMock.mockRejectedValueOnce(new ApiError(500, undefined));
    const { result } = renderHook(() => useUpsertRackDraft('v1'), { wrapper });
    act(() => result.current.mutate({ chain: { order: [], modules: {}, masterBypass: false } }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(errorSpy).toHaveBeenCalledWith(
      'Draft not saving — your rack changes may not persist.',
      { id: 'rack-draft-save' },
    );
  });

  it('repeated debounced failures always pass the SAME id (replace, never stack)', async () => {
    fetcherMock.mockRejectedValue(new ApiError(500, undefined));
    const { result } = renderHook(() => useUpsertRackDraft('v1'), { wrapper });

    act(() => result.current.mutate({ chain: { order: [], modules: {}, masterBypass: false } }));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    act(() => result.current.mutate({ chain: { order: ['eq'], modules: {}, masterBypass: false } }));
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(2));

    for (const call of errorSpy.mock.calls) {
      expect(call[1]).toEqual({ id: 'rack-draft-save' });
    }
  });
});
