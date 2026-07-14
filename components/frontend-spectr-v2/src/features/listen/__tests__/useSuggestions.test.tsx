// @vitest-environment jsdom
/* Story 11.12 (AC3) — the submit payload contract: fork-to-suggest posts the
 * draft chain to the EXISTING endpoint via useCreateSuggestion, body = { chain }
 * in the { order, modules, masterBypass } wire shape. The stay-forked-on-error
 * behavior is page logic (submitSuggestion's onError deliberately skips
 * endSuggesting) — here we pin the request and the error propagation. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../../../api/fetcher';
import { chainFromSnapshot } from '../../listen-rack/suggest-draft';
import { useCreateSuggestion } from '../useSuggestions';

const fetcherMock = vi.mocked(fetcher);

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCreateSuggestion (story 11.12 submit payload)', () => {
  it('POSTs the draft chain to /versions/{id}/suggestions in the wire shape', async () => {
    fetcherMock.mockResolvedValueOnce({ id: 'sg-new' });
    const snap = {
      order: ['eq', 'trim'],
      mod: {
        eq: { enabled: true, bands: [] },
        trim: { enabled: true, gainDb: -1.5 },
      },
      masterBypass: false,
    };
    const { result } = renderHook(() => useCreateSuggestion('v1'), { wrapper });
    act(() => { result.current.mutate({ chain: chainFromSnapshot(snap) }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetcherMock).toHaveBeenCalledWith({
      url: '/versions/v1/suggestions',
      method: 'POST',
      data: {
        chain: {
          order: ['eq', 'trim'],
          modules: { eq: { enabled: true, bands: [] }, trim: { enabled: true, gainDb: -1.5 } },
          masterBypass: false,
        },
      },
    });
  });

  it('surfaces the error to the caller (page keeps the fork open on failure)', async () => {
    fetcherMock.mockRejectedValueOnce(new Error("Suggestions aren't allowed here."));
    const { result } = renderHook(() => useCreateSuggestion('v1'), { wrapper });
    act(() => { result.current.mutate({ chain: { order: [], modules: {}, masterBypass: false } }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("aren't allowed");
  });
});
