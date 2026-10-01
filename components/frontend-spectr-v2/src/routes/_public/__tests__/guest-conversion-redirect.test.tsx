// @vitest-environment jsdom
// guest-conversion-redirect.test.tsx — task G5 fix1 items 3 + 6.
// Item 3: the just-converted guest's email must reach /login WITHOUT ever
// touching the URL (PostHog captures `$current_url` incl. query string, and
// the address would land in browser history/referrers). Item 6: safeNext
// must reject a backslash (browsers normalize `/\evil.example` to a
// protocol-relative URL), not just `//` and `:`.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPendingLoginEmail,
  peekPendingLoginEmail,
  setPendingLoginEmail,
} from '../../../auth/pending-login-email';
import { safeNext } from '../safe-next';

describe('safeNext (item 6)', () => {
  it('accepts a normal same-origin path', () => {
    expect(safeNext('/library')).toBe('/library');
  });

  it('rejects a protocol-relative //', () => {
    expect(safeNext('//evil.com')).toBeUndefined();
  });

  it('rejects a scheme via :', () => {
    expect(safeNext('http://evil.com')).toBeUndefined();
  });

  it('rejects a backslash — browsers normalize /\\evil.example to a protocol-relative URL', () => {
    expect(safeNext('/\\evil.example')).toBeUndefined();
  });

  it('rejects a doubled backslash', () => {
    expect(safeNext('/\\\\evil.example')).toBeUndefined();
  });

  it('rejects a percent-encoded backslash (decoded once before checking)', () => {
    expect(safeNext('/%5Cevil.example')).toBeUndefined();
  });

  it('rejects a control character', () => {
    expect(safeNext('/library\u0000')).toBeUndefined();
  });

  it('rejects a value that does not start with a single /', () => {
    expect(safeNext('library')).toBeUndefined();
  });
});

describe('pending-login-email relay (item 3)', () => {
  beforeEach(() => clearPendingLoginEmail());

  it('peek is non-destructive; clear removes it', () => {
    setPendingLoginEmail('a@b.c');
    expect(peekPendingLoginEmail()).toBe('a@b.c');
    expect(peekPendingLoginEmail()).toBe('a@b.c');
    clearPendingLoginEmail();
    expect(peekPendingLoginEmail()).toBeUndefined();
  });
});

// ── the pages ─────────────────────────────────────────────────────────────

const navigateSpy = vi.fn();
const routerInvalidate = vi.fn().mockResolvedValue(undefined);
const toastInfo = vi.fn();

interface MockAuthState {
  register: ReturnType<typeof vi.fn>;
  convertGuest: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  devLogin: ReturnType<typeof vi.fn>;
  user: { isGuest?: boolean } | null;
  isLoading?: boolean;
}
let authState: MockAuthState;

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('sonner', () => ({ toast: { info: (...a: unknown[]) => toastInfo(...a), error: vi.fn() } }));

vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFileRoute: () => (opts: any) => ({ ...opts, useSearch: () => ({}) }),
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate: routerInvalidate }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Link: ({ children, to }: any) => <a href={String(to)}>{children}</a>,
}));

import { RegisterPage } from '../register';
import { LoginPage } from '../login';

beforeEach(() => {
  navigateSpy.mockReset();
  routerInvalidate.mockReset();
  routerInvalidate.mockResolvedValue(undefined);
  toastInfo.mockReset();
  clearPendingLoginEmail();
});

afterEach(cleanup);

describe('register.tsx — guest conversion fallback routes off-URL (item 3)', () => {
  it('relays the email off-URL and navigates to /login with NO email in the search object', async () => {
    const convertGuest = vi
      .fn()
      .mockResolvedValue({ sessionIssued: false, message: 'Your account is ready — sign in.' });
    authState = { register: vi.fn(), convertGuest, login: vi.fn(), devLogin: vi.fn(), user: { isGuest: true } };
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/login' });
    // The exact assertion the brief calls for: the navigate call carries no
    // `search`/`email` at all — the relay module carried it instead.
    expect(peekPendingLoginEmail()).toBe('me@example.com');
  });
});

describe('register.tsx — no submit while the session is still loading (final review)', () => {
  it('does not create a second account for a guest whose session has not hydrated yet', () => {
    const register = vi.fn();
    authState = { register, convertGuest: vi.fn(), login: vi.fn(), devLogin: vi.fn(), user: null, isLoading: true };
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(register).not.toHaveBeenCalled();
  });
});

describe('login.tsx — prefills from the relay, never from the URL (item 3)', () => {
  it('prefills the email input from the relay module and consumes it', async () => {
    setPendingLoginEmail('me@example.com');
    render(<LoginPage />);
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('me@example.com');
    await waitFor(() => expect(peekPendingLoginEmail()).toBeUndefined());
  });

  it('with nothing relayed, the email input starts empty (no ?email= search field exists anymore)', () => {
    render(<LoginPage />);
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('');
  });
});
