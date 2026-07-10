// @vitest-environment jsdom
/* Story 12.3 — init-stage fallback vs complete-stage error surfacing.
 *
 * The safety line: an init failure means zero bytes moved, so any 501/5xx/
 * network error may fall back to the legacy proxy upload. A failure AFTER
 * parts were PUT (complete stage) must surface as an error — a silent proxy
 * re-upload could push 250 MB twice and double-create versions.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { legacyUpload } = vi.hoisted(() => ({ legacyUpload: vi.fn() }));

vi.mock('../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

vi.mock('../useFileUpload', () => ({
  useFileUpload: () => ({
    upload: legacyUpload,
    cancel: vi.fn(),
    isUploading: false,
    progress: 0,
    error: null,
  }),
}));

import { ApiError, fetcher } from '../../api/fetcher';
import { useMixUpload } from '../useMixUpload';

// Minimal XHR fake for the single part PUT (returns an ETag like R2/MinIO).
class FakeXhr {
  static failPut = false;
  upload = { addEventListener: () => {} };
  private listeners: Record<string, () => void> = {};
  status = 200;
  open() {}
  addEventListener(ev: string, cb: () => void) {
    this.listeners[ev] = cb;
  }
  getResponseHeader(name: string) {
    return name === 'ETag' ? '"etag-1"' : null;
  }
  send() {
    queueMicrotask(() => this.listeners[FakeXhr.failPut ? 'error' : 'load']?.());
  }
  abort() {}
}

const initResponse = {
  jobId: 'j-1',
  key: 'audio/u/j-1/source.wav',
  uploadId: 'up-1',
  partSizeBytes: 16 * 1024 * 1024,
  parts: [{ partNumber: 1, url: 'https://s3.test/part1' }],
};

const legacyResult = { songId: 's-legacy', versionId: 'v-legacy', jobId: null };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeXhr.failPut = false;
});

describe('useMixUpload fallback semantics', () => {
  it('falls back to the legacy proxy when /uploads/init answers 503 storage_unreachable', async () => {
    vi.mocked(fetcher).mockRejectedValueOnce(
      new ApiError(503, { error: { code: 'storage_unreachable' } }),
    );
    legacyUpload.mockResolvedValueOnce(legacyResult);

    const { result } = renderHook(() => useMixUpload());
    const file = new File([new Uint8Array(4)], 'track.wav');
    let res: unknown;
    await act(async () => {
      res = await result.current.upload(file);
    });

    expect(res).toBe(legacyResult);
    expect(legacyUpload).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('falls back on a network failure from init (TypeError)', async () => {
    vi.mocked(fetcher).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    legacyUpload.mockResolvedValueOnce(legacyResult);

    const { result } = renderHook(() => useMixUpload());
    let res: unknown;
    await act(async () => {
      res = await result.current.upload(new File([new Uint8Array(4)], 'track.wav'));
    });

    expect(res).toBe(legacyResult);
    expect(legacyUpload).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back on a 4xx from init (entitlement/verify gates propagate)', async () => {
    const gate = new ApiError(409, { error: { code: 'entitlement_exhausted' } });
    vi.mocked(fetcher).mockRejectedValueOnce(gate);

    const { result } = renderHook(() => useMixUpload());
    await act(async () => {
      await expect(
        result.current.upload(new File([new Uint8Array(4)], 'track.wav')),
      ).rejects.toBe(gate);
    });

    expect(legacyUpload).not.toHaveBeenCalled();
  });

  it('does NOT fall back when /uploads/complete fails after parts were PUT', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
    const completeErr = new ApiError(503, { error: { code: 'storage_unreachable' } });
    const abortCalls: string[] = [];
    vi.mocked(fetcher).mockImplementation((cfg: { url: string }) => {
      if (cfg.url === '/uploads/init') return Promise.resolve(initResponse);
      if (cfg.url === '/uploads/complete') return Promise.reject(completeErr);
      if (cfg.url === '/uploads/abort') {
        abortCalls.push(cfg.url);
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected ${cfg.url}`));
    });

    const { result } = renderHook(() => useMixUpload());
    await act(async () => {
      await expect(
        result.current.upload(new File([new Uint8Array(4)], 'track.wav')),
      ).rejects.toBe(completeErr);
    });

    expect(legacyUpload).not.toHaveBeenCalled(); // never silently re-upload
    expect(abortCalls).toHaveLength(1); // best-effort server-side abort
    expect(result.current.error).not.toBeNull();
  });

  it('caches fallback for the session: second upload goes straight to legacy', async () => {
    vi.mocked(fetcher).mockRejectedValueOnce(
      new ApiError(503, { error: { code: 'storage_unreachable' } }),
    );
    legacyUpload.mockResolvedValue(legacyResult);

    const { result } = renderHook(() => useMixUpload());
    await act(async () => {
      await result.current.upload(new File([new Uint8Array(4)], 'a.wav'));
      await result.current.upload(new File([new Uint8Array(4)], 'b.wav'));
    });

    expect(legacyUpload).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1); // init probed once
  });
});
