import { useEffect, useState } from 'react';

import { useEntitlements, useMeProfile } from '../api/hooks';
import {
  VERIFY_BANNER_DISMISS_KEY,
  VERIFY_GATE_EVENT,
  resendVerificationEmail,
} from './verify-email';
import s from './VerifyEmailBanner.module.css';

// Story 12.1 (AC3) — persistent, dismissible shell banner for unverified
// free-tier users: the story-4.5 gate blocks their SECOND analysis, so tell
// them before they hit it. Dismissal lives in localStorage; a verify-gated
// 403 anywhere re-shows it (verify-email.ts clears the key + fires the
// event). Hidden for pro/credits (the gate exempts them) and for verified
// users. Mirrors AppDunningNotice: renders nothing (incl. the padded slot)
// unless it actually applies.

function readDismissed(): boolean {
  try {
    return localStorage.getItem(VERIFY_BANNER_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

interface VerifyEmailBannerProps {
  /** Wrapper class for the layout gutter; only applied when the banner shows. */
  className?: string;
}

export function VerifyEmailBanner({ className }: VerifyEmailBannerProps) {
  const profile = useMeProfile();
  const entitlements = useEntitlements();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const onGateHit = () => setDismissed(false);
    window.addEventListener(VERIFY_GATE_EVENT, onGateHit);
    return () => window.removeEventListener(VERIFY_GATE_EVENT, onGateHit);
  }, []);

  // Only a POSITIVE unverified reading shows the banner — missing data
  // (loading, error, stale cache without the field) must never flash it.
  if (dismissed) return null;
  if (profile.data?.emailVerifiedAt !== null) return null;
  // Wait for entitlements before showing: an unverified pro/credits user is
  // gate-exempt, so showing the banner while `tier` is still undefined would
  // flash it at them until entitlements resolve.
  if (!entitlements.data) return null;
  const tier = entitlements.data.tier;
  if (tier === 'pro' || tier === 'credits') return null;

  const dismiss = () => {
    try {
      localStorage.setItem(VERIFY_BANNER_DISMISS_KEY, '1');
    } catch {
      /* private mode — session-only dismissal still works via state */
    }
    setDismissed(true);
  };

  const resend = async () => {
    setSending(true);
    try {
      await resendVerificationEmail();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={className}>
      <div className={s.banner} role="status" aria-label="Email not verified">
        <span className={s.dot} aria-hidden="true" />
        <p className={s.message}>
          Verify your email to unlock more analyses — check your inbox for the
          link.
        </p>
        <button
          type="button"
          className="btn sm"
          disabled={sending}
          onClick={() => {
            void resend();
          }}
        >
          {sending ? 'Sending…' : 'Resend email'}
        </button>
        <button
          type="button"
          className={s.dismiss}
          aria-label="Dismiss"
          title="Dismiss"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}
