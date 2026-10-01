import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { isVerificationPending } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { setPendingLoginEmail } from '../../auth/pending-login-email';
import { CheckInboxView } from '../../features/auth/VerificationViews';
import { useResendVerification } from '../../features/auth/useResendVerification';
import { capture } from '../../lib/analytics';
import { usePublicSignupBonus } from '../../lib/public-plans';
import { optionalString } from '../../lib/search-params';
import { safeNext } from './safe-next';
import f from '../../styles/forms.module.css';
import s from './auth.module.css';

// D10 (addendum h) / G5 (spec G-D4) — `?from=guest` marks a guest-conversion
// entry (the upgrade dialog / banner). A signed-in GUEST submitting this
// form upgrades the SAME account in place (AuthContext.convertGuest, POST
// /auth/guest/convert) instead of creating a second one; anyone else still
// registers normally.
//
// Verify-before-sign-in (2026-10): both paths normally answer "pending" —
// no session; this page swaps to "Check your inbox" and the emailed link
// signs the user in (a guest keeps their guest session meanwhile).
export const Route = createFileRoute('/_public/register')({
  validateSearch: (search: Record<string, unknown>): { next?: string; from?: string } => ({
    ...optionalString('next')(search),
    ...optionalString('from')(search),
  }),
  component: RegisterPage,
});

const MISMATCH = "Passwords don't match";

export function RegisterPage() {
  const { register, convertGuest, user, isLoading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const isGuest = user?.isGuest === true;
  const signupBonus = usePublicSignupBonus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // The mismatch message shows only once the user has left the confirm
  // field (or tried to submit) — never mid-typing.
  const [confirmTouched, setConfirmTouched] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const resend = useResendVerification({ startCoolingDown: true });

  const mismatch = confirm !== password;
  const showMismatch = confirmTouched && mismatch;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Final review: until the boot refresh settles we cannot know whether
    // this visitor is a guest (convert in place) or new (register) — a
    // submit now would create a SECOND account and strand the guest's work.
    if (isLoading) return;
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (mismatch) {
      setConfirmTouched(true);
      confirmRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      if (isGuest) {
        const res = await convertGuest(email, password);
        if (isVerificationPending(res)) {
          setPendingEmail(res.email);
          return;
        }
        // The DB conversion committed either way — only whether a session
        // came back with it differs (addendum, G-D4).
        capture('guest_converted');
        if ('sessionIssued' in res) {
          toast.info(res.message);
          // G5 fix1 item 3 — off-URL: a `?email=` search param lands in
          // PostHog's `$current_url` (capture_pageview: true) and in
          // browser history/referrers. Relay it in memory instead.
          setPendingLoginEmail(email);
          void navigate({ to: '/login' });
          return;
        }
      } else {
        const res = await register(email, password);
        if (isVerificationPending(res)) {
          setPendingEmail(res.email);
          return;
        }
      }
      const target = safeNext(next) ?? '/library';
      // window.location.assign so a `/pricing` redirect reaches the public
      // route (TanStack Router would otherwise need a typed entry for every
      // possible target) — and so the router's live context (auth, _app's
      // beforeLoad) is unambiguously fresh right after a conversion.
      window.location.assign(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setPending(false);
    }
  };

  if (pendingEmail) {
    const back = isGuest ? safeNext(next) : undefined;
    return (
      <CheckInboxView
        email={pendingEmail}
        isGuest={isGuest}
        resend={resend}
        onResend={() => void resend.send(pendingEmail)}
        onStartOver={() => {
          setPendingEmail(null);
          setPassword('');
          setConfirm('');
          setConfirmTouched(false);
          setError(null);
        }}
        backLink={back ? <a href={back}>Back to where you were</a> : undefined}
      />
    );
  }

  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>{isGuest ? 'Save your progress' : 'Create account'}</h1>
        <p className={s.subtitle}>
          {isGuest
            ? 'Create a free account and keep everything you have done here.'
            : 'Sign up for SPECTR.'}
        </p>
        {signupBonus !== null && (
          <p className={s.subtitle} data-testid="signup-bonus">
            You&apos;re receiving {signupBonus.toLocaleString()} free credits for signing up!
          </p>
        )}
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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={f.input}
          />
        </label>
        <label className={f.label}>
          Confirm password
          <input
            ref={confirmRef}
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setConfirmTouched(true)}
            aria-invalid={showMismatch}
            aria-describedby={showMismatch ? 'register-confirm-error' : undefined}
            className={f.input}
          />
        </label>
        {showMismatch && (
          <p id="register-confirm-error" className={f.error} role="alert">
            {MISMATCH}
          </p>
        )}
        {error && <p className={f.error}>{error}</p>}
        <button
          type="submit"
          disabled={pending || isLoading || showMismatch}
          className={`${f.button} ${f.buttonPrimary} ${s.submit}`}
        >
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className={s.footerLink}>
        Already have an account?
        <Link to="/login">Sign in</Link>
      </p>
      {/* Story 6.2 (AC2) — the trust commitments, one tap from the signup form. */}
      <p className={`mono ${s.trustLine}`}>
        <a href="/trust/no-training">No AI training on your audio</a>
        {' · '}
        <a href="/trust/results-forever">reports stay yours</a>
      </p>
    </div>
  );
}
