// Verify-before-sign-in (2026-10) — POST /auth/verify-email error → page state.
import { extractApiError } from '../../api/error-utils';
import { ApiError } from '../../api/fetcher';
import type { VerifyStatus } from './AuthFlowViews';

/** Server error code → page state. Anything unrecognised is the generic
 *  "invalid / expired / used" state, which offers a resend. */
export function verifyStatusForError(err: unknown): VerifyStatus {
  if (!(err instanceof ApiError)) return 'error';
  switch (extractApiError(err.body).code) {
    case 'guest_expired':
      return 'guest_expired';
    case 'email_taken':
      return 'email_taken';
    case 'account_banned':
      return 'banned';
    default:
      return 'error';
  }
}

/** POST /auth/login refused a pending (never-verified) account. */
export function isEmailUnverifiedError(err: unknown): boolean {
  return err instanceof ApiError && extractApiError(err.body).code === 'email_unverified';
}
