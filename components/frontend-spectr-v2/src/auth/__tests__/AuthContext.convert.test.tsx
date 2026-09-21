// @vitest-environment jsdom
// AuthContext.convert.test.tsx — task G5 (spec G-D4, controller addendum
// 2026-09-21). `convertGuest` sits NEXT TO `register` (not inside it) —
// register.tsx is the one that decides which to call, off `user?.isGuest`
// (see analyze-guest-upload.test.tsx's page-level coverage for that branch).
// This file exercises convertGuest itself: both `/auth/guest/convert`
// response shapes, and that the query cache survives a conversion (same
// user id) the way every OTHER user-id transition does NOT (D9).
//
// Mount helper copied from AuthContext.demo.test.tsx (the D9 suite) —
// `fetcher` is mocked; `refreshSession`/`setAccessToken`/`getAccessToken`
// are the real fetcher.ts implementations.
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/fetcher', async (orig) => ({
  ...(await orig<typeof import('../../api/fetcher')>()),
  fetcher: vi.fn(),
}));

import { fetcher, getAccessToken, setAccessToken } from '../../api/fetcher';
import { AuthProvider, useAuth } from '../AuthContext';

const GUEST = {
  accessToken: 'guest-tok',
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

// Same user id as GUEST — a real in-place upgrade, not a different account.
const CONVERTED = {
  accessToken: 'real-tok',
  user: { id: 'g1', email: 'me@example.com', displayName: 'me', tier: 'free', isGuest: false },
};

const FALLBACK = {
  sessionIssued: false as const,
  message: 'Your account is ready — please sign in with your new password.',
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

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
  setAccessToken(null);
});

describe('AuthContext — convertGuest', () => {
  it('posts to /auth/guest/convert and applies the rotated session for the SAME user id', async () => {
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/demo' ? Promise.resolve(GUEST) : Promise.resolve(CONVERTED),
    );
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    expect(result.current.user?.id).toBe('g1');

    await act(async () => {
      await result.current.convertGuest('me@example.com', 'password123');
    });

    expect(vi.mocked(fetcher)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/auth/guest/convert',
        method: 'POST',
        data: { email: 'me@example.com', password: 'password123' },
      }),
    );
    expect(result.current.user?.id).toBe('g1');
    expect(result.current.user?.isGuest).toBe(false);
    expect(result.current.accessToken).toBe('real-tok');
    expect(getAccessToken()).toBe('real-tok');
  });

  it('does NOT clear the query cache on conversion — same user id as the guest', async () => {
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/demo' ? Promise.resolve(GUEST) : Promise.resolve(CONVERTED),
    );
    const { result, qc } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    qc.setQueryData(['songs'], [1]);

    await act(async () => {
      await result.current.convertGuest('me@example.com', 'password123');
    });

    expect(qc.getQueryData(['songs'])).toEqual([1]);
  });

  // D9's rule (prevUserId effect) still applies to every OTHER transition —
  // this isn't convertGuest's own logic, but it's the contrast that makes
  // the "does NOT clear" assertion above meaningful rather than accidental.
  it('a genuinely different user (logout) still clears the cache', async () => {
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/demo' ? Promise.resolve(GUEST) : Promise.resolve(undefined),
    );
    const { result, qc } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    qc.setQueryData(['songs'], [1]);
    await act(async () => {
      await result.current.logout();
    });
    expect(qc.getQueryData(['songs'])).toBeUndefined();
  });

  it('sessionIssued:false — no session applied, in-memory token cleared, resolves (not throws)', async () => {
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/demo' ? Promise.resolve(GUEST) : Promise.resolve(FALLBACK),
    );
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });

    let res: unknown;
    await act(async () => {
      res = await result.current.convertGuest('me@example.com', 'password123');
    });

    expect(res).toEqual(FALLBACK);
    expect(result.current.user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('when nobody is signed in, register() still posts /auth/register (unchanged)', async () => {
    vi.mocked(fetcher).mockImplementation(({ url }: { url: string }) =>
      url === '/auth/register'
        ? Promise.resolve({
            accessToken: 'new-tok',
            user: { id: 'u1', email: 'a@b.c', displayName: null, tier: 'free' },
          })
        : Promise.reject(new Error(`unexpected fetcher call: ${url}`)),
    );
    const { result } = mount();
    await act(async () => {
      await result.current.register('a@b.c', 'password123');
    });
    expect(result.current.user?.id).toBe('u1');
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/auth/register' }),
    );
  });
});
