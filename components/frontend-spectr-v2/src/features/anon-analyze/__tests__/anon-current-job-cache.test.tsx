// @vitest-environment jsdom
/* A visitor who uploads, clicks away and comes back must land on THEIR
 * analysis — not on an empty drop zone.
 *
 * `useAnonCurrentJob` is `staleTime: Infinity` and `anonGet` maps 404 → null
 * RESOLVED data, so the first visit caches "this device has no job" and a
 * return visit inside gcTime is served that answer with no refetch. Nothing
 * wrote the key after an upload, so the page showed the drop zone while the
 * analysis ran (and a second upload then hit 409 anon_active_analysis). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { useAnonCurrentJob, useAnonUpload } from '../useAnonAnalysis';

class FakeXhr {
  static last: FakeXhr | null = null;
  upload = { addEventListener: () => {} };
  status = 0;
  responseText = '';
  private listeners: Record<string, () => void> = {};
  addEventListener(type: string, cb: () => void) { this.listeners[type] = cb; }
  open() {}
  send() { FakeXhr.last = this; }
  abort() {}
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.listeners['load']?.();
  }
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('anon current-job cache', () => {
  let serverJob: { jobId: string; status: string; dispatchedAt: string; grade: null } | null;

  beforeEach(() => {
    serverJob = null;
    FakeXhr.last = null;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('fetch', vi.fn(async () =>
      serverJob
        ? new Response(JSON.stringify(serverJob), { status: 200 })
        : new Response(null, { status: 404 }),
    ));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a return visit after an upload restores that job instead of the cached "no job"', async () => {
    const wrapper = makeWrapper();

    const firstVisit = renderHook(() => useAnonCurrentJob(true), { wrapper });
    await waitFor(() => expect(firstVisit.result.current.isSuccess).toBe(true));
    expect(firstVisit.result.current.data).toBeNull();
    firstVisit.unmount(); // the page disables this query while uploading

    const uploader = renderHook(() => useAnonUpload(), { wrapper });
    let done: Promise<{ jobId: string }> | undefined;
    act(() => { done = uploader.result.current.upload(new File(['x'], 'mix.wav')); });
    serverJob = { jobId: 'j1', status: 'processing', dispatchedAt: '2026-09-20T00:00:00Z', grade: null };
    await act(async () => { FakeXhr.last?.respond(200, '{"jobId":"j1"}'); await done; });
    uploader.unmount();

    const returnVisit = renderHook(() => useAnonCurrentJob(true), { wrapper });
    // Already on the very first render — no drop-zone flash while a refetch runs.
    expect(returnVisit.result.current.data?.jobId).toBe('j1');
    // …and the placeholder is replaced by the server's real row.
    await waitFor(() => expect(returnVisit.result.current.data?.status).toBe('processing'));
  });

  it('a failed upload leaves the cached answer alone', async () => {
    const wrapper = makeWrapper();
    const firstVisit = renderHook(() => useAnonCurrentJob(true), { wrapper });
    await waitFor(() => expect(firstVisit.result.current.isSuccess).toBe(true));
    firstVisit.unmount();

    const uploader = renderHook(() => useAnonUpload(), { wrapper });
    let done: Promise<unknown> | undefined;
    act(() => { done = uploader.result.current.upload(new File(['x'], 'mix.wav')).catch(() => 'rejected'); });
    await act(async () => { FakeXhr.last?.respond(415, '{"error":{"message":"Unsupported file."}}'); await done; });
    uploader.unmount();

    const returnVisit = renderHook(() => useAnonCurrentJob(true), { wrapper });
    expect(returnVisit.result.current.data).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1); // no refetch was forced
  });
});
