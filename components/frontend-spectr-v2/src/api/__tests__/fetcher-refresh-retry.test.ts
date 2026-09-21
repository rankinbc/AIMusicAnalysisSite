import { afterEach, describe, expect, it, vi } from 'vitest';

// Audit wave 1 (E2.2/E2.3) — the 401 refresh-retry contract. Only
// credential-presenting endpoints (login/register/dev-login/refresh) are
// excluded; logout and /auth/me now refresh-retry like any other call.

import {
  ApiError,
  bumpSessionGeneration,
  fetcher,
  getAccessToken,
  getFreshAccessToken,
  refreshSession,
  setAccessToken,
} from '../fetcher';

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
      // fetcher parses success bodies via text() (room PRP: empty 202 = void)
      text: () => Promise.resolve(r.body === undefined ? '' : JSON.stringify(r.body)),
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

  // D9 fix round 2 (item 1c) — pre-existing invariant, must survive the
  // superseded-refresh fix: N concurrent same-generation 401s still share
  // exactly one /api/auth/refresh call.
  it('two concurrent same-generation 401s share exactly one refresh request', async () => {
    setAccessToken(makeJwt(900));
    const { calls } = stubFetch({
      responses: [
        { status: 401 },
        { status: 401 },
        { status: 200, body: { id: 'a' } },
        { status: 200, body: { id: 'b' } },
      ],
      refresh: refreshOk,
    });
    const [a, b] = await Promise.all([
      fetcher<{ id: string }>({ url: '/auth/me', method: 'GET' }),
      fetcher<{ id: string }>({ url: '/auth/me', method: 'GET' }),
    ]);
    expect([a.id, b.id].sort()).toEqual(['a', 'b']);
    expect(calls.filter((u) => u === '/api/auth/refresh')).toHaveLength(1);
  });

  // D9 fix round 2 (item 1a) — REAL RED without the fix: refreshSession()
  // used to return the raw (possibly superseded) AuthResponse to every
  // awaiter, so a guest request whose retry raced a still-open, OLDER-
  // generation refresh (e.g. a lingering boot refresh) would be retried with
  // that OTHER session's bearer the moment it resolved. Genuinely
  // interleaved: the request 401s and starts its retry BEFORE the stale
  // refresh is resolved.
  it('a stale (older-generation) in-flight refresh never lends its token to a same-request retry', async () => {
    setAccessToken('guest-token');
    let settleOld: (r: { ok: boolean; status: number; json: () => Promise<unknown> }) => void =
      () => {};
    const oldRefresh = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>(
      (resolve) => {
        settleOld = resolve;
      },
    );
    let refreshCalls = 0;
    const protectedAuthHeaders: (string | null)[] = [];
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/protected') {
        const h = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? null;
        protectedAuthHeaders.push(h);
        const body = protectedAuthHeaders.length === 1 ? undefined : { ok: true };
        const status = protectedAuthHeaders.length === 1 ? 401 : 200;
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
        });
      }
      if (url === '/api/auth/refresh') {
        refreshCalls++;
        if (refreshCalls === 1) return oldRefresh;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ accessToken: 'guest-token-2', user: { id: 'g1', email: 'g@x.c' } }),
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', mock);

    // A generation-0 refresh is already open (e.g. a lingering boot
    // refresh) when the guest session begins.
    void refreshSession();
    bumpSessionGeneration();
    setAccessToken('guest-token');

    const reqPromise = fetcher<{ ok: boolean }>({ url: '/protected', method: 'GET' });

    // Let the request 401 and its retry's refreshSession() call reach the
    // point where it chains behind the still-open stale refresh.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The stale refresh finally resolves with a DIFFERENT session's token —
    // must never reach the retry.
    settleOld({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'real', user: { id: 'real-1', email: 'r@x.c' } }),
    });

    await reqPromise;
    expect(protectedAuthHeaders[1]).toBe('Bearer guest-token-2');
    expect(getAccessToken()).toBe('guest-token-2');
  });
});
