import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { useAuth } from '../../auth/AuthContext';
import { capture } from '../../lib/analytics';
import { optionalString } from '../../lib/search-params';
import f from '../../styles/forms.module.css';
import s from './auth.module.css';

// Story 2.1 review-fix P13 — accept `?next=/path` so that anonymous users
// bounced from the pricing page (or any other "must-be-authed" flow)
// return to the same page after registration. Sanitized: only same-origin
// path-relative values are accepted; absolute or scheme-bearing values
// are silently dropped to defeat open-redirect via `?next=http://evil.com`.

function safeNext(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Must start with a single `/` and not be a protocol-relative URL
  // (`//evil.com`). Reject anything containing `:` to drop scheme-based
  // attacks. Path may include `?` query, but no scheme/host.
  if (!raw.startsWith('/')) return undefined;
  if (raw.startsWith('//')) return undefined;
  if (raw.includes(':')) return undefined;
  return raw;
}

// D10 (addendum h) / G5 (spec G-D4) — `?from=guest` marks a guest-conversion
// entry (the upgrade dialog / banner). A signed-in GUEST submitting this
// form upgrades the SAME account in place (AuthContext.convertGuest, POST
// /auth/guest/convert) instead of creating a second one; anyone else still
// registers normally.
export const Route = createFileRoute('/_public/register')({
  validateSearch: (search: Record<string, unknown>): { next?: string; from?: string } => ({
    ...optionalString('next')(search),
    ...optionalString('from')(search),
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { register, convertGuest, user } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const isGuest = user?.isGuest === true;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setPending(true);
    try {
      if (isGuest) {
        const res = await convertGuest(email, password);
        // The DB conversion committed either way — only whether a session
        // came back with it differs (addendum, G-D4).
        capture('guest_converted');
        if ('sessionIssued' in res) {
          toast.info(res.message);
          void navigate({ to: '/login', search: { email } });
          return;
        }
      } else {
        await register(email, password);
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

  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>{isGuest ? 'Save your progress' : 'Create account'}</h1>
        <p className={s.subtitle}>
          {isGuest
            ? 'Create a free account and keep everything you have done here.'
            : 'Sign up for SPECTR.'}
        </p>
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
        {error && <p className={f.error}>{error}</p>}
        <button
          type="submit"
          disabled={pending}
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

