// @vitest-environment jsdom
// DemoLauncher.test.tsx — waits for the boot refresh, resumes/starts a guest
// sandbox exactly once, routes by viewport width, and shows a calm fallback
// card (never a reason tied to server load) on failure.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// This suite's role-based a11y queries (item 4b) match generically across
// the whole document — without explicit cleanup, an earlier test's render
// stays mounted and `getByRole('status'|'alert')` finds multiple elements.
afterEach(() => {
  cleanup();
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
          to: '/songs/$songId/results/$jobId',
          params: { songId: 's', jobId: 'j' },
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
    expect(capture).toHaveBeenCalledWith('demo_started', { resumed: false, surface: 'report' });
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

  // Item 4a — a stalled POST must not leave "Setting up your demo…" forever.
  it('times out after 15s and shows the failure card with code "timeout"', async () => {
    vi.useFakeTimers();
    try {
      auth = { isLoading: false, user: null, startDemo: vi.fn(() => new Promise<DemoStartResponse>(() => {})) };
      render(<DemoLauncher />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(screen.getByText(/taking a break/i)).toBeTruthy();
      expect(capture).toHaveBeenCalledWith('demo_start_failed', { code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  // Fix round 2, item 3 — REAL RED without the fix: startDemo() keeps
  // running after the 15s bound rejects and shows the failure card. If it
  // later succeeds, the guest session it applies would otherwise be
  // stranded behind a card telling the visitor the demo is unavailable —
  // this must instead route exactly like the normal path (invalidate, then
  // navigate) and record `late: true`.
  it('a late success after the timeout navigates instead of leaving the failure card', async () => {
    vi.useFakeTimers();
    try {
      let resolveStart: (res: DemoStartResponse) => void = () => {};
      const startDemo = vi.fn(
        () => new Promise<DemoStartResponse>((resolve) => (resolveStart = resolve)),
      );
      auth = { isLoading: false, user: null, startDemo };
      render(<DemoLauncher />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(screen.getByText(/taking a break/i)).toBeTruthy();
      expect(navigateSpy).not.toHaveBeenCalled();

      await act(async () => {
        resolveStart(GUEST);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(navigateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/songs/$songId/results/$jobId',
          params: { songId: 's', jobId: 'j' },
          replace: true,
        }),
      );
      expect(capture).toHaveBeenCalledWith('demo_started', {
        resumed: false,
        surface: 'report',
        late: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // Item 4b — accessibility: the progress line is a polite status region;
  // the failure card is an alert whose heading takes focus when it replaces
  // the progress line.
  it('the progress line is a polite status region', () => {
    auth = { isLoading: false, user: null, startDemo: vi.fn(() => new Promise<DemoStartResponse>(() => {})) };
    render(<DemoLauncher />);
    expect(screen.getByRole('status').textContent).toMatch(/setting up your demo/i);
  });

  it('the failure card is an alert and moves focus to its heading', async () => {
    auth = {
      isLoading: false,
      user: null,
      startDemo: vi.fn().mockRejectedValue(new ApiError(503, { error: { code: 'demo_capacity' } })),
    };
    render(<DemoLauncher />);
    const alert = await screen.findByRole('alert');
    const heading = screen.getByRole('heading', { name: /taking a break/i });
    expect(alert.contains(heading)).toBe(true);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  // Item 4c — the "starts once" test needs real teeth: StrictMode
  // double-invokes the mount effect, and a later re-render (any parent
  // re-render would hand DemoLauncher a fresh `auth`/`startDemo` reference
  // the same way) must not start a second demo either. Only `startedRef`
  // prevents both. Proven once by temporarily deleting the `startedRef`
  // guard locally and re-running this test — it fails (startDemo called
  // twice) — then restoring the guard, at which point it passes again; see
  // the fix-round report for the transcript.
  it('never starts the demo twice — StrictMode double-invoke + a later re-render', async () => {
    const startDemo = vi.fn().mockResolvedValue(GUEST);
    auth = { isLoading: false, user: null, startDemo };
    setWidth(1440);
    const { rerender } = render(
      <StrictMode>
        <DemoLauncher />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/songs/$songId/results/$jobId' }),
      ),
    );
    // A fresh auth object (same startDemo fn, new reference) — simulates an
    // ordinary parent re-render, not a session change.
    auth = { ...auth };
    rerender(
      <StrictMode>
        <DemoLauncher />
      </StrictMode>,
    );
    expect(startDemo).toHaveBeenCalledTimes(1);
  });
});
