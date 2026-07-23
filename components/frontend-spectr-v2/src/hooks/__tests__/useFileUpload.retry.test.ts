// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// E3.9 — XHR uploads join the 401 contract: preflight-fresh token, then retry
// ONCE on 401 after a silent refresh; non-401 failures never retry.

import { setAccessToken } from '../../api/fetcher';
import { useFileUpload } from '../useFileUpload';

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

describe('useFileUpload 401 retry (E3.9)', () => {
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
    const { result } = renderHook(() => useFileUpload());
    const done = result.current.upload(new File(['x'], 'a.wav'));
    done.catch(() => undefined); // avoid unhandled rejection noise on failure paths

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    expect(MockXhr.instances[0]!.headers['Authorization']).toBe(`Bearer ${freshJwt}`);

    act(() => MockXhr.instances[0]!.respond(401, ''));
    await waitFor(() => expect(MockXhr.instances).toHaveLength(2));
    expect(MockXhr.instances[1]!.headers['Authorization']).toBe(`Bearer ${rotatedJwt}`);

    act(() => MockXhr.instances[1]!.respond(200, JSON.stringify({ versionId: 'v1' })));
    await expect(done).resolves.toMatchObject({ versionId: 'v1' });
  });

  it('does not retry non-401 failures', async () => {
    const { result } = renderHook(() => useFileUpload());
    const done = result.current.upload(new File(['x'], 'a.wav'));
    done.catch(() => undefined);

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    act(() => MockXhr.instances[0]!.respond(500, '{}'));

    await expect(done).rejects.toThrow();
    expect(MockXhr.instances).toHaveLength(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('a second 401 (refresh did not help) fails without a third attempt', async () => {
    const { result } = renderHook(() => useFileUpload());
    const done = result.current.upload(new File(['x'], 'a.wav'));
    done.catch(() => undefined);

    await waitFor(() => expect(MockXhr.instances).toHaveLength(1));
    act(() => MockXhr.instances[0]!.respond(401, ''));
    await waitFor(() => expect(MockXhr.instances).toHaveLength(2));
    act(() => MockXhr.instances[1]!.respond(401, ''));

    await expect(done).rejects.toThrow();
    expect(MockXhr.instances).toHaveLength(2);
  });
});
