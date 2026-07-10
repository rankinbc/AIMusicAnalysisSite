/* Story 3.2 — presigned attachment upload helpers. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { putToPresignedUrl, uploadAttachmentPresigned } from '../attachment-upload-helpers';
import { PresignedPutError, shouldFallBackToProxy } from '../presigned-fallback';

// Keep ApiError real (12.3: shouldFallBackToProxy relies on instanceof).
vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { ApiError, fetcher } from '../../../api/fetcher';

class FakeXhr {
  static last: FakeXhr | null = null;
  static status = 200;
  // Which XHR event send() fires — 'load' (default), 'error' (network), 'abort'.
  static fireEvent: 'load' | 'error' | 'abort' = 'load';
  method = '';
  url = '';
  sent: unknown = null;
  headers: Record<string, string> = {};
  upload = { addEventListener: () => {} };
  private listeners: Record<string, () => void> = {};

  constructor() {
    FakeXhr.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }

  addEventListener(ev: string, cb: () => void) {
    this.listeners[ev] = cb;
  }

  get status() {
    return FakeXhr.status;
  }

  send(body: unknown) {
    this.sent = body;
    queueMicrotask(() => this.listeners[FakeXhr.fireEvent]?.());
  }
}

const withFakeXhr = () => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeXhr.status = 200;
  FakeXhr.fireEvent = 'load';
  FakeXhr.last = null;
});

describe('putToPresignedUrl', () => {
  it('PUTs the raw file bytes with NO extra headers (presign footgun #1)', async () => {
    withFakeXhr();
    const file = new File([new Uint8Array(8)], 'kick.wav');
    await putToPresignedUrl('https://s3.test/k?sig=1', file);
    expect(FakeXhr.last!.method).toBe('PUT');
    expect(FakeXhr.last!.url).toBe('https://s3.test/k?sig=1');
    expect(FakeXhr.last!.sent).toBe(file);
    expect(Object.keys(FakeXhr.last!.headers)).toHaveLength(0);
  });

  it('rejects a non-2xx with a fallback-eligible PresignedPutError', async () => {
    withFakeXhr();
    FakeXhr.status = 403;
    const err = await putToPresignedUrl(
      'https://s3.test/k',
      new File([new Uint8Array(1)], 'x.wav'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PresignedPutError);
    expect(String(err)).toContain('403');
    expect(shouldFallBackToProxy(err)).toBe(true);
  });

  it('rejects a network error with a fallback-eligible PresignedPutError (12.3: down MinIO surfaces at the PUT, not init)', async () => {
    withFakeXhr();
    FakeXhr.fireEvent = 'error';
    const err = await putToPresignedUrl(
      'https://s3.test/k',
      new File([new Uint8Array(1)], 'x.wav'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PresignedPutError);
    expect(shouldFallBackToProxy(err)).toBe(true);
  });

  it('rejects an abort with a plain Error that does NOT fall back (user cancel, not a storage outage)', async () => {
    withFakeXhr();
    FakeXhr.fireEvent = 'abort';
    const err = await putToPresignedUrl(
      'https://s3.test/k',
      new File([new Uint8Array(1)], 'x.wav'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PresignedPutError);
    expect(shouldFallBackToProxy(err)).toBe(false);
  });
});

describe('uploadAttachmentPresigned', () => {
  it('inits with kind/versionId then PUTs to the returned url and returns the init', async () => {
    withFakeXhr();
    vi.mocked(fetcher).mockResolvedValueOnce({
      key: 'stems/j/x.wav',
      url: 'https://s3.test/stems/j/x.wav?sig=1',
      stemId: 'x',
      referenceId: null,
    });
    const file = new File([new Uint8Array(4)], 'Kick.wav');
    const res = await uploadAttachmentPresigned({ file, kind: 'stem', versionId: 'v-1' });
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith({
      url: '/uploads/attachments/init',
      method: 'POST',
      data: { kind: 'stem', versionId: 'v-1', fileName: 'Kick.wav', fileSize: 4 },
    });
    expect(FakeXhr.last!.url).toContain('stems/j/x.wav');
    expect(res.key).toBe('stems/j/x.wav');
    expect(res.stemId).toBe('x');
  });

  it('propagates the init error (the 501 fallback contract)', async () => {
    withFakeXhr();
    const err = new Error('presigned_unavailable');
    vi.mocked(fetcher).mockRejectedValueOnce(err);
    await expect(
      uploadAttachmentPresigned({ file: new File([], 'p.als'), kind: 'als', versionId: 'v-1' }),
    ).rejects.toBe(err);
    expect(FakeXhr.last).toBeNull(); // no PUT attempted
  });

  it('propagates 12.3 fallback-eligible init errors and the shared predicate agrees', async () => {
    withFakeXhr();
    const err = new ApiError(503, { error: { code: 'storage_unreachable' } });
    vi.mocked(fetcher).mockRejectedValueOnce(err);
    await expect(
      uploadAttachmentPresigned({ file: new File([], 'p.als'), kind: 'als', versionId: 'v-1' }),
    ).rejects.toBe(err);
    expect(FakeXhr.last).toBeNull(); // zero bytes moved — safe to fall back
    expect(shouldFallBackToProxy(err)).toBe(true);
    // The gates the callers must NOT proxy-bypass:
    expect(shouldFallBackToProxy(new ApiError(409, null))).toBe(false);
    expect(shouldFallBackToProxy(new ApiError(403, null))).toBe(false);
  });
});
