// @vitest-environment jsdom
// DemoLauncher.test.tsx — waits for the boot refresh, resumes/starts a guest
// sandbox exactly once, routes by viewport width, and shows a calm fallback
// card (never a reason tied to server load) on failure.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../api/fetcher';
import type { DemoStartResponse } from '../../../api/types';

interface MockAuthState {
  isLoading: boolean;
  user: { id: string; isGuest?: boolean } | null;
  startDemo: () => Promise<DemoStartResponse>;
}

let auth: MockAuthState;
const navigateSpy = vi.fn();
const invalidate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate }),
}));

vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));

import { capture } from '../../../lib/analytics';

import { DemoLauncher } from '../DemoLauncher';

const GUEST: DemoStartResponse = {
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

const setWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
};

beforeEach(() => {
  navigateSpy.mockReset();
  invalidate.mockReset();
  invalidate.mockResolvedValue(undefined);
  vi.mocked(capture).mockReset();
  setWidth(1024);
});

describe('DemoLauncher', () => {
  it('waits for the boot refresh before starting', () => {
    const startDemo = vi.fn();
    auth = { isLoading: true, user: null, startDemo };
    render(<DemoLauncher />);
    expect(startDemo).not.toHaveBeenCalled();
  });

  it('starts the demo once, invalidates the router, then navigates', async () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn().mockResolvedValue(GUEST) };
    setWidth(1440);
    render(<DemoLauncher />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/listen-rack/$versionId',
          params: { versionId: 'v' },
          replace: true,
        }),
      ),
    );
    // toHaveBeenCalledBefore is a jest-extended matcher not installed in this
    // project's vitest setup (no jest-extended dependency) — invocation-order
    // comparison is the equivalent available assertion.
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      navigateSpy.mock.invocationCallOrder[0],
    );
    expect(auth.startDemo).toHaveBeenCalledTimes(1); // StrictMode-safe
    expect(capture).toHaveBeenCalledWith('demo_started', { resumed: false, surface: 'listen' });
  });

  it('a signed-in real user goes to the library instead', async () => {
    const startDemo = vi.fn();
    auth = { isLoading: false, user: { id: 'u', isGuest: false }, startDemo };
    render(<DemoLauncher />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '/library' })),
    );
    expect(startDemo).not.toHaveBeenCalled();
  });

  it('a failed start shows the fallback card and never says why the demo is off', async () => {
    auth = {
      isLoading: false,
      user: null,
      startDemo: vi.fn().mockRejectedValue(new ApiError(503, { error: { code: 'demo_capacity' } })),
    };
    render(<DemoLauncher />);
    expect(await screen.findByText(/taking a break/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /analyze your own track/i }).getAttribute('href')).toBe(
      '/analyze',
    );
    expect(screen.queryByText(/busy|too many/i)).toBeNull();
    expect(capture).toHaveBeenCalledWith('demo_start_failed', { code: 'demo_capacity' });
  });
});
