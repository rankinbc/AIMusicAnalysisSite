import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { clearPendingLoginEmail, peekPendingLoginEmail } from '../../auth/pending-login-email';
import { UnverifiedLoginNotice } from '../../features/auth/VerificationViews';
import { useResendVerification } from '../../features/auth/useResendVerification';
import { isEmailUnverifiedError } from '../../features/auth/verify-status';
import { optionalString } from '../../lib/search-params';
import f from '../../styles/forms.module.css';
import s from './auth.module.css';

// G5 fix1 item 3 — the form prefill for G5's guest-conversion fallback (a
// converted account with no session issued lands here to sign in normally
// with the password they just set) now comes off the in-memory
// pending-login-email relay, NEVER a `?email=` search param (which leaked
// into PostHog's captured page URL and browser history).
export const Route = createFileRoute('/_public/login')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    ...optionalString('next')(search),
  }),
  component: LoginPage,
});

const DEV_EMAIL = 'brankin92@yahoo.com';

export function LoginPage() {
  const { login, devLogin } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const { next } = Route.useSearch();
  const [email, setEmail] = useState(() => peekPendingLoginEmail() ?? '');
  // Consume it once mounted — split peek/clear (rather than one destructive
  // read) keeps this safe under StrictMode's double-invoked lazy `useState`
  // initializer above; a clear is idempotent under StrictMode's double-fired
  // effect too.
  useEffect(() => {
    clearPendingLoginEmail();
  }, []);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Verify-before-sign-in (2026-10): the address whose sign-in was refused
  // with 403 email_unverified (correct password, account still pending).
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const resend = useResendVerification();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnverifiedEmail(null);
    setPending(true);
    try {
      await login(email, password);
      // F8: the _app guard reads router context — invalidate so it sees the
      // fresh auth state BEFORE navigating, or the first click bounces back.
      await router.invalidate();
      await navigate({ to: next ?? '/library' });
    } catch (err) {
      if (isEmailUnverifiedError(err)) setUnverifiedEmail(email.trim());
      else setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setPending(false);
    }
  };

  // Development-only convenience: one click signs in as the dev account.
  const handleDevLogin = async () => {
    setError(null);
    setPending(true);
    try {
      await devLogin(DEV_EMAIL);
      await router.invalidate();
      await navigate({ to: next ?? '/library' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev sign-in failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>Sign in</h1>
        <p className={s.subtitle}>Welcome back.</p>
      </div>
      <form onSubmit={handleSubmit} className={s.form}>
        <label className={f.label}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={f.input}
          />
        </label>
        <label className={f.label}>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={f.input}
          />
        </label>
        {error && <p className={f.error}>{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className={`${f.button} ${f.buttonPrimary} ${s.submit}`}
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {unverifiedEmail && (
        <UnverifiedLoginNotice
          email={unverifiedEmail}
          resend={resend}
          onResend={() => void resend.send(unverifiedEmail)}
        />
      )}
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={handleDevLogin}
          disabled={pending}
          className={`${f.button} ${s.submit}`}
        >
          Dev sign-in ({DEV_EMAIL})
        </button>
      )}
      <p className={s.footerLink}>
        No account?
        <Link to="/register">Create one</Link>
      </p>
      <p className={s.footerLink}>
        Forgot your password?
        <Link to="/forgot-password">Reset it</Link>
      </p>
    </div>
  );
}
