// @vitest-environment jsdom
// F1 — first-touch attribution rides the three account-creating calls
// (guest mint, register, guest convert) when a stash exists, and is absent
// (no key, and for /auth/demo no body at all) when it does not.
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/fetcher', async (orig) => ({
  ...(await orig<typeof import('../../api/fetcher')>()),
  fetcher: vi.fn(),
}));

import { fetcher, setAccessToken } from '../../api/fetcher';
import { ATTRIBUTION_KEY } from '../../lib/attribution';
import { AuthProvider, useAuth } from '../AuthContext';

const PENDING = { verificationRequired: true, email: 'me@example.com' };
const GUEST = {
  accessToken: 'tok',
  user: { id: 'g1', email: 'guest-g1@guest.spectr.invalid', displayName: 'Guest', tier: 'free', isGuest: true },
  demo: { songId: 's', versionId: 'v', jobId: 'j' },
  resumed: false,
};

const mount = () =>
  renderHook(() => useAuth(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    ),
  });

function stash() {
  window.localStorage.setItem(
    ATTRIBUTION_KEY,
    JSON.stringify({ source: 'youtube', campaign: 'launch', at: Date.now() }),
  );
}

const ATTRIBUTION = { source: 'youtube', campaign: 'launch' };

beforeEach(() => {
  vi.mocked(fetcher).mockReset();
  setAccessToken(null);
  // The boot refresh: nobody is signed in.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve(undefined) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('AuthContext — attribution on account-creating calls', () => {
  it('register sends the stashed attribution', async () => {
    stash();
    vi.mocked(fetcher).mockResolvedValue(PENDING);
    const { result } = mount();
    await act(async () => {
      await result.current.register('me@example.com', 'password123');
    });
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith({
      url: '/auth/register',
      method: 'POST',
      data: { email: 'me@example.com', password: 'password123', attribution: ATTRIBUTION },
    });
  });

  it('register sends no attribution key when there is no stash', async () => {
    vi.mocked(fetcher).mockResolvedValue(PENDING);
    const { result } = mount();
    await act(async () => {
      await result.current.register('me@example.com', 'password123');
    });
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith({
      url: '/auth/register',
      method: 'POST',
      data: { email: 'me@example.com', password: 'password123' },
    });
  });

  it('convertGuest sends the stashed attribution', async () => {
    stash();
    vi.mocked(fetcher).mockResolvedValue(PENDING);
    const { result } = mount();
    await act(async () => {
      await result.current.convertGuest('me@example.com', 'password123');
    });
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith({
      url: '/auth/guest/convert',
      method: 'POST',
      data: { email: 'me@example.com', password: 'password123', attribution: ATTRIBUTION },
    });
  });

  it('startDemo sends the stashed attribution as its body', async () => {
    stash();
    vi.mocked(fetcher).mockResolvedValue(GUEST);
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith({
      url: '/auth/demo',
      method: 'POST',
      data: { attribution: ATTRIBUTION },
    });
  });

  it('startDemo stays body-less when there is no stash', async () => {
    vi.mocked(fetcher).mockResolvedValue(GUEST);
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    expect(vi.mocked(fetcher)).toHaveBeenCalledWith({ url: '/auth/demo', method: 'POST' });
  });
});
