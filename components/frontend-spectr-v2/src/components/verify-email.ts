// Story 12.1 — shared verify-email plumbing used by the upload dialog, the
// song-page retry path, and VerifyEmailBanner. All branching keys off the
// AR38 machine `code` (AC5), never message text.

import { toast } from 'sonner';

import { extractApiError } from '../api/error-utils';
import { ApiError, fetcher } from '../api/fetcher';

export const VERIFY_BANNER_DISMISS_KEY = 'spectr.verifyEmailBanner.dismissed';
export const VERIFY_GATE_EVENT = 'spectr:verify-gate-hit';

/** True when the error is the story-4.5 second-analysis verify gate. */
export function isVerifyGateError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    extractApiError(err.body).code === 'email_verification_required'
  );
}

/** Re-shows the banner (clears the dismissal) and lets a mounted banner know
 *  the gate was just hit. Called from dispatch catch-paths on a verify 403. */
export function notifyVerifyGateHit(): void {
  try {
    localStorage.removeItem(VERIFY_BANNER_DISMISS_KEY);
  } catch {
    /* storage unavailable (private mode) — event alone still re-shows */
  }
  window.dispatchEvent(new Event(VERIFY_GATE_EVENT));
}

// Debounce: one in-flight request at a time + a cooldown so button mashing
// (or toast-action double-clicks) can't burn the 3-per-15-min server limit.
const RESEND_COOLDOWN_MS = 30_000;
let resendInFlight = false;
let lastResendAt = 0;

/** POST /auth/resend-verification with success/failure toasts.
 *  Resolves true when a new email was (re)sent. */
export async function resendVerificationEmail(): Promise<boolean> {
  const now = Date.now();
  if (resendInFlight) return false;
  if (now - lastResendAt < RESEND_COOLDOWN_MS) {
    toast.info('Verification email already sent — check your inbox (and spam).');
    return false;
  }
  resendInFlight = true;
  try {
    await fetcher<void>({ url: '/auth/resend-verification', method: 'POST' });
    lastResendAt = Date.now();
    toast.success('Verification email sent — check your inbox.');
    return true;
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : 'Could not send the verification email.',
    );
    return false;
  } finally {
    resendInFlight = false;
  }
}

/** Verify-gate toast with a resend action (AC2). */
export function showVerifyGateToast(): void {
  notifyVerifyGateHit();
  toast.error('Verify your email to run another analysis.', {
    action: {
      label: 'Resend email',
      onClick: () => {
        void resendVerificationEmail();
      },
    },
  });
}

/** Shared dispatch-error handler for "retry analysis" style callers: the
 *  verify gate gets the actionable toast; everything else falls back to the
 *  server envelope message (fetcher already prefers it) or `fallback`. */
export function showAnalysisDispatchError(err: unknown, fallback: string): void {
  if (isVerifyGateError(err)) {
    showVerifyGateToast();
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}

/** Clears the resend debounce (cooldown + in-flight guard). Call on auth
 *  changes so one account's cooldown/in-flight state never suppresses the
 *  next user's resend on a shared tab (SPA logout → login without reload). */
export function resetVerifyResendState(): void {
  resendInFlight = false;
  lastResendAt = 0;
}

/** Test hook — reset module debounce state between vitest cases. */
export function __resetResendStateForTests(): void {
  resetVerifyResendState();
}
