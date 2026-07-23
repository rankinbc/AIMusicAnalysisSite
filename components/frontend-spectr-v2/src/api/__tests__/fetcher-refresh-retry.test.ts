import { afterEach, describe, expect, it, vi } from 'vitest';

// Audit wave 1 (E2.2/E2.3) — the 401 refresh-retry contract. Only
// credential-presenting endpoints (login/register/dev-login/refresh) are
// excluded; logout and /auth/me now refresh-retry like any other call.

import { ApiError, fetcher, getFreshAccessToken, setAccessToken } from '../fetcher';

const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const makeJwt = (expSecFromNow: number) =>
  `hdr.${b64url({ exp: Math.floor(Date.now() / 1000) + expSecFromNow })}.sig`;

/** fetch stub routed by URL: /api/auth/refresh gets `refresh`, all else walks
 *  `responses` in order. */
function stubFetch(opts: {
  responses: { status: number; body?: unknown }[];
  refresh?: { status: number; body?: unknown };
}) {
  let i = 0;
  const calls: string[] = [];
  const mock = vi.fn((url: string) => {
    calls.push(url);
    const r =
      url === '/api/auth/refresh'
        ? (opts.refresh ?? { status: 401 })
        : (opts.responses[Math.min(i++, opts.responses.length - 1)] ?? { status: 500 });
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
  vi.stubGlobal('fetch', mock);
  return { calls, mock };
}

const refreshOk = {
  status: 200,
  body: { accessToken: makeJwt(900), user: { id: 'u1', email: 'a@b.c' } },
};

describe('fetcher 401 refresh-retry contract (wave 1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('401 on /auth/me → refresh called, request retried, succeeds', async () => {
    setAccessToken(makeJwt(900));
    const { calls } = stubFetch({
      responses: [{ status: 401 }, { status: 200, body: { id: 'u1' } }],
      refresh: refreshOk,
    });
    const out = await fetcher<{ id: string }>({ url: '/auth/me', method: 'GET' });
    expect(out).toEqual({ id: 'u1' });
    expect(calls).toContain('/api/auth/refresh');
  });

  it('401 on /auth/logout → refresh called + retried (E2.2 regression)', async () => {
    setAccessToken(makeJwt(900));
    const { calls } = stubFetch({
      responses: [{ status: 401 }, { status: 204 }],
      refresh: refreshOk,
    });
    await fetcher<undefined>({ url: '/auth/logout', method: 'POST' });
    expect(calls).toContain('/api/auth/refresh');
    expect(calls.filter((u) => u === '/api/auth/logout')).toHaveLength(2);
  });

  it('401 on /auth/login → NOT retried, no refresh call', async () => {
    const { calls } = stubFetch({ responses: [{ status: 401, body: undefined }] });
    const err = await fetcher({ url: '/auth/login', method: 'POST', data: {} }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(calls).not.toContain('/api/auth/refresh');
  });

  it('getFreshAccessToken refreshes a near-expiry token once', async () => {
    setAccessToken(makeJwt(30)); // inside the default 120 s minTtl
    const { calls } = stubFetch({ responses: [], refresh: refreshOk });
    const token = await getFreshAccessToken();
    expect(calls.filter((u) => u === '/api/auth/refresh')).toHaveLength(1);
    expect(token).toBe(refreshOk.body.accessToken);
  });

  it('getFreshAccessToken leaves a long-lived token alone', async () => {
    const jwt = makeJwt(900);
    setAccessToken(jwt);
    const { calls } = stubFetch({ responses: [] });
    const token = await getFreshAccessToken();
    expect(calls).toHaveLength(0);
    expect(token).toBe(jwt);
  });

  it('getFreshAccessToken treats an undecodable token as stale', async () => {
    setAccessToken('not-a-jwt');
    const { calls } = stubFetch({ responses: [], refresh: refreshOk });
    await getFreshAccessToken();
    expect(calls.filter((u) => u === '/api/auth/refresh')).toHaveLength(1);
  });
});
