// @vitest-environment jsdom
// Verify-before-sign-in (2026-10) — register "Check your inbox", confirm
// password, the sign-up bonus line, login's email_unverified state, and the
// verify-link page. `fetcher` is mocked (the resend endpoint); AuthContext,
// router and public-plans are stubbed per test.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../api/fetcher';

vi.mock('../../../api/fetcher', async (orig) => ({
  ...(await orig<typeof import('../../../api/fetcher')>()),
  fetcher: vi.fn(),
}));

const navigateSpy = vi.fn();
const routerInvalidate = vi.fn();
let searchParams: Record<string, string | undefined> = {};

vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFileRoute: () => (opts: any) => ({ ...opts, useSearch: () => searchParams }),
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate: routerInvalidate }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to }: any) => <a href={String(to)}>{children}</a>,
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

let signupBonus: number | null = null;
vi.mock('../../../lib/public-plans', async (orig) => ({
  ...(await orig<typeof import('../../../lib/public-plans')>()),
  usePublicSignupBonus: () => signupBonus,
}));

interface MockAuth {
  register: ReturnType<typeof vi.fn>;
  convertGuest: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  devLogin: ReturnType<typeof vi.fn>;
  verifyEmail: ReturnType<typeof vi.fn>;
  user: { isGuest?: boolean } | null;
  isLoading: boolean;
}
let auth: MockAuth;
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));

import { fetcher } from '../../../api/fetcher';
import { signupBonusFrom } from '../../../lib/public-plans';
import { LoginPage } from '../login';
import { RegisterPage } from '../register';
import { VerifyEmailPage } from '../verify-email';

const fetcherMock = vi.mocked(fetcher);

const unverifiedError = () =>
  new ApiError(403, { error: { code: 'email_unverified', message: 'Verify your email to sign in.' } });

beforeEach(() => {
  fetcherMock.mockReset();
  navigateSpy.mockReset();
  routerInvalidate.mockReset();
  routerInvalidate.mockResolvedValue(undefined);
  searchParams = {};
  signupBonus = null;
  auth = {
    register: vi.fn(),
    convertGuest: vi.fn(),
    login: vi.fn(),
    devLogin: vi.fn(),
    verifyEmail: vi.fn(),
    user: null,
    isLoading: false,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fillRegister(email: string, password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

describe('register — confirm password', () => {
  it('matching passwords submit', async () => {
    auth.register.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'password123');
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(auth.register).toHaveBeenCalledWith('me@example.com', 'password123'));
  });

  it('a mismatch is reported on blur, linked via aria-describedby, and blocks submit', () => {
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'password124');
    const confirm = screen.getByLabelText('Confirm password');
    // Not shown mid-typing.
    expect(screen.queryByText("Passwords don't match")).toBeNull();
    fireEvent.blur(confirm);
    const msg = screen.getByText("Passwords don't match");
    expect(confirm.getAttribute('aria-describedby')).toBe(msg.id);
    expect(confirm.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(confirm.closest('form')!);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('a mismatch at submit (never blurred) shows the error and focuses the confirm field', () => {
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'nope12345');
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
    expect(screen.getByText("Passwords don't match")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Confirm password'));
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('the error clears once the passwords match again', () => {
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'password124');
    fireEvent.blur(screen.getByLabelText('Confirm password'));
    expect(screen.getByText("Passwords don't match")).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    expect(screen.queryByText("Passwords don't match")).toBeNull();
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-describedby')).toBeNull();
    expect((screen.getByRole('button', { name: /create account/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('register — check your inbox', () => {
  it('a pending registration shows the address, a cooling-down resend, and start over', async () => {
    auth.register.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'password123');
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await screen.findByText('Check your inbox');
    expect(screen.getByText('me@example.com')).toBeTruthy();
    // The first email just went out — resend starts on cooldown.
    const resend = screen.getByRole('button', { name: /resend available in/i }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /start over/i }));
    expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy();
  });

  it('resend posts to the anonymous endpoint once the cooldown has passed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.register.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    fetcherMock.mockResolvedValue(undefined);
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'password123');
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await screen.findByText('Check your inbox');

    // One tick per second: each tick re-renders and arms the next timer.
    for (let i = 0; i < 31; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() =>
      expect(fetcherMock).toHaveBeenCalledWith({
        url: '/auth/verify-email/resend',
        method: 'POST',
        data: { email: 'me@example.com' },
      }),
    );
    expect(await screen.findByText(/a new link is on its way/i)).toBeTruthy();
  });

  it('a guest sign-up also lands on check-your-inbox and keeps the guest session', async () => {
    auth.user = { isGuest: true };
    auth.convertGuest.mockResolvedValue({ verificationRequired: true, email: 'me@example.com' });
    render(<RegisterPage />);
    fillRegister('me@example.com', 'password123', 'password123');
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await screen.findByText('Check your inbox');
    expect(screen.getByText(/guest session keeps working/i)).toBeTruthy();
    expect(auth.register).not.toHaveBeenCalled();
  });
});

describe('register — sign-up bonus line', () => {
  it('shows the server amount when credits are on', () => {
    signupBonus = 500;
    render(<RegisterPage />);
    expect(screen.getByText("You're receiving 500 free credits for signing up!")).toBeTruthy();
  });

  it('shows nothing about credits when they are off', () => {
    signupBonus = null;
    render(<RegisterPage />);
    expect(screen.queryByText(/credits/i)).toBeNull();
  });

  it('signupBonusFrom only yields a number when credits are on and the bonus is positive', () => {
    const base = { proMonthlyCents: 0, proAnnualCents: 0, creditPacks: [], currency: 'usd' };
    expect(signupBonusFrom({ ...base, creditsEnabled: true, signupBonusCredits: 750 })).toBe(750);
    expect(signupBonusFrom({ ...base, creditsEnabled: false, signupBonusCredits: 750 })).toBeNull();
    expect(signupBonusFrom({ ...base, creditsEnabled: null, signupBonusCredits: 750 })).toBeNull();
    expect(signupBonusFrom({ ...base, creditsEnabled: true, signupBonusCredits: 0 })).toBeNull();
    expect(signupBonusFrom({ ...base, creditsEnabled: true })).toBeNull();
    expect(signupBonusFrom(null)).toBeNull();
  });
});

describe('login — email_unverified', () => {
  it('shows "Verify your email first" with a resend action instead of a generic error', async () => {
    auth.login.mockRejectedValue(unverifiedError());
    fetcherMock.mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Verify your email first');
    expect(navigateSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() =>
      expect(fetcherMock).toHaveBeenCalledWith({
        url: '/auth/verify-email/resend',
        method: 'POST',
        data: { email: 'me@example.com' },
      }),
    );
  });

  it('bad credentials still show the plain error (no verify notice)', async () => {
    auth.login.mockRejectedValue(
      new ApiError(401, { error: { code: 'invalid_credentials', message: 'Wrong email or password.' } }, 'Wrong email or password.'),
    );
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Wrong email or password.');
    expect(screen.queryByText('Verify your email first')).toBeNull();
  });
});

describe('verify-email page', () => {
  it('a valid link signs in and lands in the library', async () => {
    searchParams = { token: 'tok-123' };
    auth.verifyEmail.mockResolvedValue({
      accessToken: 'a',
      user: { id: 'u', email: 'me@example.com', displayName: 'me', tier: 'free', isGuest: false },
      converted: false,
    });
    render(<VerifyEmailPage />);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith({ to: '/library' }));
    expect(auth.verifyEmail).toHaveBeenCalledWith('tok-123');
    expect(routerInvalidate).toHaveBeenCalled();
  });

  it('a dead link offers a resend form', async () => {
    searchParams = { token: 'dead' };
    auth.verifyEmail.mockRejectedValue(
      new ApiError(400, { error: { code: 'invalid_token', message: 'invalid' } }),
    );
    fetcherMock.mockResolvedValue(undefined);
    render(<VerifyEmailPage />);
    await screen.findByText(/invalid, expired, or already used/i);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    await waitFor(() =>
      expect(fetcherMock).toHaveBeenCalledWith({
        url: '/auth/verify-email/resend',
        method: 'POST',
        data: { email: 'me@example.com' },
      }),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a guest whose sandbox expired is pointed at a fresh sign-up', async () => {
    searchParams = { token: 'late' };
    auth.verifyEmail.mockRejectedValue(
      new ApiError(410, { error: { code: 'guest_expired', message: 'expired' } }),
    );
    render(<VerifyEmailPage />);
    await screen.findByText(/guest session ended/i);
    expect(screen.getByText('Create an account')).toBeTruthy();
  });

  it('verified without a session asks the user to sign in', async () => {
    searchParams = { token: 'ok' };
    auth.verifyEmail.mockResolvedValue(null);
    render(<VerifyEmailPage />);
    await screen.findByText(/Sign in with your email and password/i);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
