// @vitest-environment jsdom
// AuthContext.demo.test.tsx — the boot-refresh race, cache isolation, and the
// startDemo failure path leaving the session untouched.
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/fetcher', async (orig) => ({
  ...(await orig<typeof import('../../api/fetcher')>()),
  fetcher: vi.fn(),
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
}));

import { ApiError, fetcher, refreshSession } from '../../api/fetcher';
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
  vi.mocked(refreshSession).mockReset();
});

describe('AuthContext — startDemo', () => {
  it('a boot refresh that resolves null AFTER startDemo cannot wipe the guest session', async () => {
    let settleBoot: (v: null) => void = () => {};
    vi.mocked(refreshSession).mockReturnValue(
      new Promise((r) => {
        settleBoot = r;
      }),
    );
    vi.mocked(fetcher).mockResolvedValue(GUEST);
    const { result } = mount();
    await act(async () => {
      await result.current.startDemo();
    });
    await act(async () => {
      settleBoot(null);
      await Promise.resolve();
    });
    expect(result.current.user?.isGuest).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('switching user clears cached queries from the previous session', async () => {
    vi.mocked(refreshSession).mockResolvedValue(null);
    vi.mocked(fetcher).mockImplementation(async ({ url }: { url: string }) =>
      url === '/auth/demo' ? GUEST : undefined,
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

  it('startDemo rejects with the server error and leaves the session untouched', async () => {
    vi.mocked(refreshSession).mockResolvedValue(null);
    vi.mocked(fetcher).mockRejectedValue(new ApiError(503, { error: { code: 'demo_unavailable' } }));
    const { result } = mount();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await expect(result.current.startDemo()).rejects.toBeInstanceOf(ApiError);
    });
    expect(result.current.user).toBeNull();
  });
});
