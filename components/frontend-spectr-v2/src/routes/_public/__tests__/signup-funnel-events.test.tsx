// @vitest-environment jsdom
// F1 — the sign-up funnel edges. Verify-before-sign-in makes "check your
// inbox" the NORMAL outcome of both sign-up paths, so `signup_completed` must
// fire on the pending branch; `email_verified` fires when the link is consumed.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/analytics', () => ({ capture }));

vi.mock('../../../api/fetcher', async (orig) => ({
  ...(await orig<typeof import('../../../api/fetcher')>()),
  fetcher: vi.fn(),
}));

const navigateSpy = vi.fn();
let searchParams: Record<string, string | undefined> = {};
vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFileRoute: () => (opts: any) => ({ ...opts, useSearch: () => searchParams }),
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate: vi.fn().mockResolvedValue(undefined) }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to }: any) => <a href={String(to)}>{children}</a>,
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

vi.mock('../../../lib/public-plans', async (orig) => ({
  ...(await orig<typeof import('../../../lib/public-plans')>()),
  usePublicSignupBonus: () => null,
}));

interface MockAuth {
  register: ReturnType<typeof vi.fn>;
  convertGuest: ReturnType<typeof vi.fn>;
  verifyEmail: ReturnType<typeof vi.fn>;
  user: { isGuest?: boolean } | null;
  isLoading: boolean;
}
let auth: MockAuth;
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));

import { ApiError } from '../../../api/fetcher';
import { RegisterPage } from '../register';
import { VerifyEmailPage } from '../verify-email';

beforeEach(() => {
  capture.mockReset();
  navigateSpy.mockReset();
  searchParams = {};
  auth = {
    register: vi.fn(),
    convertGuest: vi.fn(),
    verifyEmail: vi.fn(),
    user: null,
    isLoading: false,
  };
});

afterEach(cleanup);

function submitRegister() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
}

describe('signup_completed', () => {
  it('fires for a direct sign-up that lands on "check your inbox"', async () => {
    auth.register.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    render(<RegisterPage />);
    submitRegister();
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('signup_completed', { path: 'direct', pending: true }),
    );
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('fires for a guest conversion that lands on "check your inbox"', async () => {
    auth.user = { isGuest: true };
    auth.convertGuest.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    render(<RegisterPage />);
    submitRegister();
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('signup_completed', { path: 'guest', pending: true }),
    );
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('does not fire when registration is rejected', async () => {
    auth.register.mockRejectedValue(new Error('Email already registered.'));
    render(<RegisterPage />);
    submitRegister();
    await screen.findByText('Email already registered.');
    expect(capture).not.toHaveBeenCalled();
  });

  it('carries no email or other user-entered text', async () => {
    auth.register.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    render(<RegisterPage />);
    submitRegister();
    await waitFor(() => expect(capture).toHaveBeenCalled());
    expect(JSON.stringify(capture.mock.calls)).not.toContain('example.com');
  });
});

describe('email_verified', () => {
  it('fires once when the link signs the user in', async () => {
    searchParams = { token: 'tok-123' };
    auth.verifyEmail.mockResolvedValue({
      accessToken: 'a',
      user: { id: 'u', email: 'me@example.com', displayName: 'me', tier: 'free', isGuest: false },
      converted: false,
    });
    render(<VerifyEmailPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/library' }));
    expect(capture.mock.calls).toEqual([['email_verified', { session: true }]]);
  });

  it('fires with session:false when verified without a session', async () => {
    searchParams = { token: 'ok' };
    auth.verifyEmail.mockResolvedValue(null);
    render(<VerifyEmailPage />);
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('email_verified', { session: false }),
    );
  });

  it('does not fire for a dead link', async () => {
    searchParams = { token: 'dead' };
    auth.verifyEmail.mockRejectedValue(
      new ApiError(400, { error: { code: 'invalid_token', message: 'invalid' } }),
    );
    render(<VerifyEmailPage />);
    await screen.findByText(/invalid, expired, or already used/i);
    expect(capture).not.toHaveBeenCalled();
  });
});
