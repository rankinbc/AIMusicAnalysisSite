// Verify-before-sign-in (2026-10) — pure presentational pieces for the
// "Check your inbox" screen (register), the "Verify your email first"
// notice (login) and the verify-link page. No hooks, no router imports:
// renderable via renderToStaticMarkup so vitest can pin every state.
import type { FormEvent, ReactNode } from 'react';

import f from '../../styles/forms.module.css';
import s from '../../routes/_public/auth.module.css';
import v from './verification.module.css';
import type { ResendState } from './useResendVerification';

type ResendView = Pick<ResendState, 'pending' | 'cooldown' | 'sent' | 'error'>;

export function ResendButton(props: {
  resend: ResendView;
  onResend: () => void;
  label?: string;
  primary?: boolean;
}) {
  const { resend, onResend, label = 'Resend verification email', primary = false } = props;
  const text = resend.pending
    ? 'Sending…'
    : resend.cooldown > 0
      ? `Resend available in ${resend.cooldown}s`
      : label;
  return (
    <>
      <button
        type="button"
        onClick={onResend}
        disabled={resend.pending || resend.cooldown > 0}
        className={`${f.button} ${primary ? f.buttonPrimary : ''} ${s.submit}`}
      >
        {text}
      </button>
      {/* Generic on purpose: the server answers the same way whether or not
          the address has a pending account (no enumeration). */}
      <p className={v.status} role="status" aria-live="polite">
        {resend.error
          ? resend.error
          : resend.sent
            ? 'If that address has an account waiting for verification, a new link is on its way.'
            : ''}
      </p>
    </>
  );
}

/** Register → "Check your inbox". */
export function CheckInboxView(props: {
  email: string;
  isGuest: boolean;
  resend: ResendView;
  onResend: () => void;
  onStartOver: () => void;
  /** Guest only: back to the session they were in. */
  backLink?: ReactNode;
}) {
  const { email, isGuest, resend, onResend, onStartOver, backLink } = props;
  return (
    <div className={s.card} data-state="check-inbox">
      <div className={s.header}>
        <h1 className={s.title}>Check your inbox</h1>
        <p className={s.subtitle}>One click and you&apos;re in.</p>
      </div>
      <p className={v.body}>
        We sent a verification link to <span className={v.email}>{email}</span>. Clicking it
        confirms your email and signs you in. The link expires in 24 hours.
      </p>
      {isGuest && (
        <p className={v.body}>
          Your guest session keeps working until then — everything you&apos;ve done here moves
          to your account when you click the link.
        </p>
      )}
      <p className={v.body}>Nothing there? Check spam, or send a new link.</p>
      <ResendButton resend={resend} onResend={onResend} />
      <p className={s.footerLink}>
        Wrong email?
        <button type="button" className={v.linkButton} onClick={onStartOver}>
          Start over
        </button>
      </p>
      {backLink && <p className={s.footerLink}>{backLink}</p>}
    </div>
  );
}

/** Login → the account exists but its email isn't verified yet. */
export function UnverifiedLoginNotice(props: {
  email: string;
  resend: ResendView;
  onResend: () => void;
}) {
  const { email, resend, onResend } = props;
  return (
    <div className={v.notice} role="alert" data-state="email-unverified">
      <p className={v.noticeTitle}>Verify your email first</p>
      <p className={v.body}>
        Click the link we emailed to <span className={v.email}>{email}</span> — it signs you in.
        Can&apos;t find it? Send a new one.
      </p>
      <ResendButton resend={resend} onResend={onResend} />
    </div>
  );
}

/** Verify page failure → ask for the address and resend. */
export function ResendByEmailForm(props: {
  email: string;
  onEmailChange: (value: string) => void;
  resend: ResendView;
  onSubmit: (e: FormEvent) => void;
}) {
  const { email, onEmailChange, resend, onSubmit } = props;
  return (
    <form onSubmit={onSubmit} className={s.form} aria-label="Send a new verification link">
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
      <button
        type="submit"
        disabled={resend.pending || resend.cooldown > 0}
        className={`${f.button} ${f.buttonPrimary} ${s.submit}`}
      >
        {resend.pending
          ? 'Sending…'
          : resend.cooldown > 0
            ? `Resend available in ${resend.cooldown}s`
            : 'Send a new link'}
      </button>
      <p className={v.status} role="status" aria-live="polite">
        {resend.error
          ? resend.error
          : resend.sent
            ? 'If that address has an account waiting for verification, a new link is on its way.'
            : ''}
      </p>
    </form>
  );
}
