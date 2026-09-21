// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// D9 fix round 2 (item 1b) — the same generation-safe 401 retry contract as
// useFileUpload (E3.9): a stale, older-generation refresh must never lend
// its token to a stems-staging XHR retry (a guest upload written into a
// real account's version is the concrete failure mode this project is
// guarding against).

import { bumpSessionGeneration, refreshSession, setAccessToken } from '../../api/fetcher';
import { useStemStaging } from '../useStemStaging';

const b64url = (o: object) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const makeJwt = (expSecFromNow: number) =>
  `hdr.${b64url({ exp: Math.floor(Date.now() / 1000) + expSecFromNow })}.sig`;

class MockXhr {
  static instances: MockXhr[] = [];
  status = 0;
  responseText = '';
  withCredentials = false;
  headers: Record<string, string> = {};
  upload = { addEventListener: () => undefined };
  private listeners: Record<string, () => void> = {};
  open() {}
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  addEventListener(type: string, cb: () => void) {
    this.listeners[type] = cb;
  }
  send() {}
  abort() {}
  constructor() {
    MockXhr.instances.push(this);
  }
  respond(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.listeners['load']!();
  }
}

const freshJwt = makeJwt(900);
const rotatedJwt = makeJwt(1800);

describe('useStemStaging 401 retry (D9 fix round 2)', () => {
  beforeEach(() => {
    MockXhr.instances = [];
    setAccessToken(freshJwt); // long-lived → preflight skips the refresh
    vi.stubGlobal('XMLHttpRequest', MockXhr);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ accessToken: rotatedJwt, user: { id: 'u1', email: 'a@b.c' } }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('retries once after a 401 with the refreshed token', async () => {
    const { result } = renderHook(() => useStemStaging('v1'));
    const done = result.current.stage([new File(['x'], 'kick.wav')]);
    done.catch(() => undefined);

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    expect(MockXhr.instances[0]!.headers['Authorization']).toBe(`Bearer ${freshJwt}`);

    act(() => MockXhr.instances[0]!.respond(401, ''));
    await waitFor(() => expect(MockXhr.instances).toHaveLength(2));
    expect(MockXhr.instances[1]!.headers['Authorization']).toBe(`Bearer ${rotatedJwt}`);

    act(() => MockXhr.instances[1]!.respond(200, JSON.stringify({ proposals: [] })));
    await expect(done).resolves.toMatchObject({ proposals: [] });
  });

  // REAL RED without the fix: a stems-staging retry used to read
  // `.accessToken` straight off `refreshSession()`'s RESULT, so a still-open,
  // OLDER-generation refresh (e.g. a lingering boot refresh for a different,
  // real, user) that resolves AFTER the retry starts would hand this stems
  // upload that real user's bearer. Genuinely interleaved: the stale refresh
  // is held open and resolved only after the XHR has already 401'd and its
  // retry logic has reached refreshSession().
  it('a stale (older-generation) in-flight refresh never lends its token to the XHR retry', async () => {
    let settleOld: (r: { ok: boolean; status: number; json: () => Promise<unknown> }) => void =
      () => {};
    const oldRefresh = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>(
      (resolve) => {
        settleOld = resolve;
      },
    );
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url !== '/api/auth/refresh') throw new Error(`unexpected fetch ${url}`);
        refreshCalls++;
        if (refreshCalls === 1) return oldRefresh;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ accessToken: rotatedJwt, user: { id: 'g1', email: 'a@b.c' } }),
        });
      }),
    );

    // A generation-0 refresh (e.g. a lingering boot refresh for a different
    // user) is already open when the guest session begins.
    void refreshSession();
    bumpSessionGeneration();

    const { result } = renderHook(() => useStemStaging('v1'));
    const done = result.current.stage([new File(['x'], 'kick.wav')]);
    done.catch(() => undefined);

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    expect(MockXhr.instances[0]!.headers['Authorization']).toBe(`Bearer ${freshJwt}`);

    act(() => MockXhr.instances[0]!.respond(401, ''));

    // Let the retry's resolveRetryToken()/refreshSession() call reach the
    // point where it chains behind the still-open stale refresh.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale refresh finally resolves with a DIFFERENT (real) user's
    // token — must never reach the retry.
    act(() => {
      settleOld({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ accessToken: 'real', user: { id: 'real-1', email: 'r@x.c' } }),
      });
    });

    await waitFor(() => expect(MockXhr.instances).toHaveLength(2));
    expect(MockXhr.instances[1]!.headers['Authorization']).toBe(`Bearer ${rotatedJwt}`);

    act(() => MockXhr.instances[1]!.respond(200, JSON.stringify({ proposals: [] })));
    await expect(done).resolves.toMatchObject({ proposals: [] });
  });

  it('does not retry non-401 failures', async () => {
    const { result } = renderHook(() => useStemStaging('v1'));
    const done = result.current.stage([new File(['x'], 'kick.wav')]);
    done.catch(() => undefined);

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    act(() => MockXhr.instances[0]!.respond(500, '{}'));

    await expect(done).rejects.toThrow();
    expect(MockXhr.instances).toHaveLength(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('a second 401 (refresh did not help) fails without a third attempt', async () => {
    const { result } = renderHook(() => useStemStaging('v1'));
    const done = result.current.stage([new File(['x'], 'kick.wav')]);
    done.catch(() => undefined);

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    act(() => MockXhr.instances[0]!.respond(401, ''));
    await waitFor(() => expect(MockXhr.instances).toHaveLength(2));
    act(() => MockXhr.instances[1]!.respond(401, ''));

    await expect(done).rejects.toThrow();
    expect(MockXhr.instances).toHaveLength(2);
  });
});
