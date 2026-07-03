// Story 4.3 — pure presentational pieces for the verify/forgot/reset pages.
// Kept renderable via renderToStaticMarkup (no hooks, no router imports) so
// vitest can assert every state without a DOM (project pure/container rule).
import type { FormEvent, ReactNode } from 'react';

import f from '../../styles/forms.module.css';
import s from '../../routes/_public/auth.module.css';

export type VerifyStatus = 'verifying' | 'success' | 'error' | 'missing';

export function VerifyEmailView(props: { status: VerifyStatus; loginLink: ReactNode }) {
  const { status, loginLink } = props;
  return (
    <div className={s.card} data-status={status}>
      <div className={s.header}>
        <h1 className={s.title}>Email verification</h1>
        {status === 'verifying' && <p className={s.subtitle}>Checking your link…</p>}
        {status === 'success' && (
          <p className={s.subtitle}>Verified. Your account is provably yours.</p>
        )}
        {status === 'error' && (
          <p className={s.subtitle}>
            This link is invalid, expired, or already used. Sign in and request a
            fresh one from your profile.
          </p>
        )}
        {status === 'missing' && (
          <p className={s.subtitle}>No verification token in this link.</p>
        )}
      </div>
      {status !== 'verifying' && <p className={s.footerLink}>{loginLink}</p>}
    </div>
  );
}

export function ForgotPasswordView(props: {
  email: string;
  sent: boolean;
  pending: boolean;
  error: string | null;
  onEmailChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  loginLink: ReactNode;
}) {
  const { email, sent, pending, error, onEmailChange, onSubmit, loginLink } = props;
  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>Reset password</h1>
        <p className={s.subtitle}>
          {sent
            ? 'If that address has an account, a reset link is on its way. It expires in 30 minutes.'
            : "Enter your account email and we'll send a reset link."}
        </p>
      </div>
      {!sent && (
        <form onSubmit={onSubmit} className={s.form}>
          <label className={f.label}>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              className={f.input}
            />
          </label>
          {error && <p className={f.error}>{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className={`${f.button} ${f.buttonPrimary} ${s.submit}`}
          >
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className={s.footerLink}>{loginLink}</p>
    </div>
  );
}

export function ResetPasswordView(props: {
  hasToken: boolean;
  password: string;
  done: boolean;
  pending: boolean;
  error: string | null;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  loginLink: ReactNode;
}) {
  const { hasToken, password, done, pending, error, onPasswordChange, onSubmit, loginLink } = props;
  return (
    <div className={s.card}>
      <div className={s.header}>
        <h1 className={s.title}>Choose a new password</h1>
        {done ? (
          <p className={s.subtitle}>
            Password updated. Every other session was signed out — sign in with
            the new password.
          </p>
        ) : hasToken ? (
          <p className={s.subtitle}>Minimum 8 characters.</p>
        ) : (
          <p className={s.subtitle}>No reset token in this link — request a new one.</p>
        )}
      </div>
      {!done && hasToken && (
        <form onSubmit={onSubmit} className={s.form}>
          <label className={f.label}>
            New password
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className={f.input}
            />
          </label>
          {error && <p className={f.error}>{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className={`${f.button} ${f.buttonPrimary} ${s.submit}`}
          >
            {pending ? 'Updating…' : 'Set new password'}
          </button>
        </form>
      )}
      <p className={s.footerLink}>{loginLink}</p>
    </div>
  );
}
