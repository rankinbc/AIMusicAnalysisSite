// @vitest-environment jsdom
// AuthContext.demo.test.tsx — the boot-refresh race, cache isolation, and the
// startDemo failure path leaving the session untouched.
//
// `refreshSession`/`setAccessToken`/`getAccessToken` are the REAL fetcher.ts
// implementations (not mocked) so the boot refresh genuinely exercises the
// module-level token side effect that item 1's race protects — only global
// `fetch` (the boot refresh's transport) and `fetcher` (used for POST
// /auth/demo, /auth/logout, …) are stubbed.
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/fetcher', async (orig) => ({
  ...(await orig<typeof import('../../api/fetcher')>()),
  fetcher: vi.fn(),
}));

import { ApiError, fetcher, getAccessToken, setAccessToken } from '../../api/fetcher';
import { AuthProvider, useAuth } from '../AuthContext';

const GUEST = {
  accessToken: 'tok',
  user: {
    id: 'g1',
    email: 'guest-g1@guest.spectr.invalid',
    displayName: 'Guest',
    tier: 'free',
    isGuest: true,
  },
  demo: { songId: 's', versionId: 'v', jobId: 'j' },
  resumed: false,
};

const REAL_USER_RESPONSE = {
  accessToken: 'real-user-token',
  user: { id: 'real-1', email: 'real@example.com', displayName: 'Real', tier: 'free' },
};

const USER_B_RESPONSE = {
  accessToken: 'b-token',
  user: { id: 'b1', email: 'b@example.com', displayName: 'B', tier: 'free' },
};

const mount = (qc = new QueryClient()) => ({
  qc,
  ...renderHook(() => useAuth(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={qc}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    ),
  }),
});

/** Stubs global `fetch` (the boot refresh's transport) with a promise the
 *  test controls the resolution of — genuinely interleaved, never a
 *  sequential await-both. */
function stubHeldOpenBootFetch() {
  let settle: (r: { ok: boolean; status: number; json: () => Promise<unknown> }) => void = () => {};
  const p = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((r) => {
    settle = r;
  });
  vi.stubGlobal('fetch', vi.fn(() => p));
  return {
    resolveNull: () => settle({ ok: false, status: 401, json: () => Promise.resolve(undefined) }),
    resolveRealUser: () =>
      settle({ ok: true, status: 200, json: () => Promise.resolve(REAL_USER_RESPONSE) }),
  };
}

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthContext — startDemo', () => {
  it('a boot refresh that resolves null AFTER startDemo cannot wipe the guest session', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockResolvedValue(GUEST);
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    await act(async () => {
      boot.resolveNull();
      await Promise.resolve();
    });
    expect(result.current.user?.isGuest).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  // Item 1 — REAL RED without the fix: the boot refresh's REAL implementation
  // unconditionally assigns the module `accessToken` and fires
  // `onTokenRefreshedCallback` the moment its fetch resolves, BEFORE
  // AuthContext.refresh() ever gets to compare its epoch. A stale boot
  // refresh that resolves 200 for a DIFFERENT real user after startDemo()
  // has already completed must not be able to install that user's token —
  // neither on the module (`getAccessToken()`) nor on the context.
  it('a boot refresh that resolves 200 for a different real user AFTER startDemo cannot install that token', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockResolvedValue(GUEST);
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    await act(async () => {
      boot.resolveRealUser();
      // Flush the doRefresh chain: fetch → r.json() → (skipped) assignment.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.user?.isGuest).toBe(true);
    expect(result.current.accessToken).toBe('tok');
    expect(getAccessToken()).toBe('tok');
  });

  it('switching user clears cached queries from the previous session', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/demo' ? Promise.resolve(GUEST) : Promise.resolve(undefined),
    );
    const { result, qc } = mount();
    boot.resolveNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.startDemo();
    });
    qc.setQueryData(['songs'], [1]);
    await act(async () => {
      await result.current.logout();
    });
    expect(qc.getQueryData(['songs'])).toBeUndefined();
  });

  // Item 2 — REAL RED without the fix: `prevUserId` is seeded with `null`,
  // which is indistinguishable from "signed out" — so the FIRST sign-in of
  // any browsing session (anon `null` → guest id) never clears the cache.
  it('the first sign-in of a browsing session clears anon-cached queries', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/demo' ? Promise.resolve(GUEST) : Promise.resolve(undefined),
    );
    const { result, qc } = mount();
    boot.resolveNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    qc.setQueryData(['anon-job'], [1]);
    await act(async () => {
      await result.current.startDemo();
    });
    expect(qc.getQueryData(['anon-job'])).toBeUndefined();
  });

  it('startDemo rejects with the server error and leaves the session untouched', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockRejectedValue(new ApiError(503, { error: { code: 'demo_unavailable' } }));
    const { result } = mount();
    boot.resolveNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await expect(result.current.startDemo()).rejects.toBeInstanceOf(ApiError);
    });
    expect(result.current.user).toBeNull();
  });

  // Item 3b — REAL RED without the fix: startDemo bumps the session
  // generation before the request and never recovers on failure, so a
  // legitimate boot refresh that was in flight is discarded for good even
  // though the demo never started.
  it('a failed startDemo recovers the real session from a boot refresh already in flight', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockRejectedValue(new ApiError(503, { error: { code: 'demo_capacity' } }));
    const { result } = mount();
    await act(async () => {
      await expect(result.current.startDemo()).rejects.toBeInstanceOf(ApiError);
    });
    await act(async () => {
      boot.resolveRealUser();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.user?.id).toBe('real-1'));
    expect(result.current.accessToken).toBe('real-user-token');
    expect(getAccessToken()).toBe('real-user-token');
  });

  // Item 2 — REAL RED without the fix: login (unlike startDemo/logout)
  // didn't bump the session generation, so a slow boot refresh resolving
  // 200 for the PREVIOUS cookie's user after a fast login passed the
  // generation check and applyAuth'd the old user over the fresh login.
  it('login supersedes a still-open boot refresh for a different (stale-cookie) user', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/login'
        ? Promise.resolve(USER_B_RESPONSE)
        : Promise.reject(new Error(`unexpected fetcher call: ${url}`)),
    );
    const { result } = mount();
    await act(async () => {
      await result.current.login('b@example.com', 'pw');
    });
    await act(async () => {
      boot.resolveRealUser();
      // Flush the doRefresh chain: fetch → r.json() → (skipped) assignment.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.user?.id).toBe('b1');
    expect(result.current.accessToken).toBe('b-token');
    expect(getAccessToken()).toBe('b-token');
  });

  // Item 4 — test gap: the earlier "first sign-in clears cached data" test
  // also passes with only startDemo's explicit `queryClient.clear()`. This
  // one exercises the passive `prevUserId` effect ALONE — login has no
  // explicit clear of its own, and neither does logout.
  it('the prevUserId effect alone clears the cache on login and on logout to null', async () => {
    const boot = stubHeldOpenBootFetch();
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) => {
      if (url === '/auth/login') return Promise.resolve(REAL_USER_RESPONSE);
      if (url === '/auth/logout') return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected fetcher call: ${url}`));
    });
    const { result, qc } = mount();
    boot.resolveNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();

    qc.setQueryData(['anon'], [1]);
    await act(async () => {
      await result.current.login('real@example.com', 'pw');
    });
    expect(result.current.user?.id).toBe('real-1');
    expect(qc.getQueryData(['anon'])).toBeUndefined();

    qc.setQueryData(['signed-in'], [1]);
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
    expect(qc.getQueryData(['signed-in'])).toBeUndefined();
  });
});
