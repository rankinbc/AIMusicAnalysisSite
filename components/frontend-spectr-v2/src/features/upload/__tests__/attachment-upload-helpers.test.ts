/* Story 3.2 — presigned attachment upload helpers. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { putToPresignedUrl, uploadAttachmentPresigned } from '../attachment-upload-helpers';

vi.mock('../../../api/fetcher', () => ({
  fetcher: vi.fn(),
}));

import { fetcher } from '../../../api/fetcher';

class FakeXhr {
  static last: FakeXhr | null = null;
  static status = 200;
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
    queueMicrotask(() => this.listeners['load']?.());
  }
}

const withFakeXhr = () => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeXhr.status = 200;
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

  it('rejects on a non-2xx response', async () => {
    withFakeXhr();
    FakeXhr.status = 403;
    await expect(
      putToPresignedUrl('https://s3.test/k', new File([new Uint8Array(1)], 'x.wav')),
    ).rejects.toThrow('403');
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
});
