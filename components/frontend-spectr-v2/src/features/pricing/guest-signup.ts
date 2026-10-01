/* Owner ruling 2026-10-01 — a GUEST (demo sandbox account) on /pricing never
 * starts checkout or wanders off to another funnel page: every CTA sends them
 * to the same guest → account conversion screen the banner / upgrade dialog
 * use (`/register?from=guest`, which converts the guest row in place via
 * POST /auth/guest/convert). `next=/pricing` brings the new account straight
 * back here, where the buttons now work for real. */
export const GUEST_SIGNUP_HREF = `/register?from=guest&next=${encodeURIComponent('/pricing')}`;
