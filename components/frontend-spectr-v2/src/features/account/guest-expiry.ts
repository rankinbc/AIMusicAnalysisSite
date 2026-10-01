/**
 * Guest account menu note — "Create an account to keep your progress. It
 * will be deleted in X hours."
 *
 * `expiresAt` is GET /api/me/guest's `expiresAt`, i.e. `users.guest_expires_at`
 * — the SAME column the BFF's RetentionSweepScheduler purge predicate reads
 * (`IsGuest && (GuestExpiresAt == null || GuestExpiresAt < now)`), so the
 * hours shown are hours until the guest becomes purge-eligible. Rounded UP to
 * whole hours (never promise more time than is left).
 */
export const GUEST_EXPIRY_FALLBACK =
  'Create an account to keep your progress — guest data is deleted automatically.';

const HOUR_MS = 60 * 60 * 1000;

export function guestExpiryNote(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!expiresAt) return GUEST_EXPIRY_FALLBACK;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return GUEST_EXPIRY_FALLBACK;

  const remainingMs = expiryMs - nowMs;
  const prefix = 'Create an account to keep your progress. It will be deleted in';
  // Already past expiry (purge pending on the next sweep) reads the same as
  // "under an hour" — the data is going away imminently either way.
  if (remainingMs < HOUR_MS) return `${prefix} less than 1 hour.`;
  const hours = Math.ceil(remainingMs / HOUR_MS);
  return `${prefix} ${hours} ${hours === 1 ? 'hour' : 'hours'}.`;
}
