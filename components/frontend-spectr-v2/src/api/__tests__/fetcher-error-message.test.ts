import { afterEach, describe, expect, it, vi } from 'vitest';

// Story 12.1 (AC2/AC5) — ApiError message derivation: fetcher prefers the
// AR38 envelope `error.message`; "HTTP {status}" is the fallback ONLY when
// no envelope message exists. The body is preserved either way so callers
// can still key off `error.code`.

import { ApiError, fetcher } from '../fetcher';

function stubFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe('fetcher ApiError message derivation (story 12.1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the envelope message over "HTTP {status}"', async () => {
    stubFetchOnce(403, {
      error: {
        code: 'email_verification_required',
        message: 'Verify your email to run another analysis.',
      },
    });
    const err = await fetcher({ url: '/versions/x/analyze', method: 'POST' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.message).toBe('Verify your email to run another analysis.');
    expect(apiErr.status).toBe(403);
    // Body survives for code-keyed branching.
    expect((apiErr.body as { error: { code: string } }).error.code).toBe(
      'email_verification_required',
    );
  });

  it('falls back to HTTP {status} for non-envelope bodies', async () => {
    stubFetchOnce(500, { detail: 'something broke' });
    const err = await fetcher({ url: '/songs', method: 'GET' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('HTTP 500');
  });

  it('falls back to HTTP {status} when the body is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('not json')),
      }),
    );
    const err = await fetcher({ url: '/songs', method: 'GET' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('HTTP 502');
  });
});
