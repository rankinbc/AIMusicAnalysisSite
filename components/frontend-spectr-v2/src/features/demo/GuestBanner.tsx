import { Link } from '@tanstack/react-router';

import { useGuestState } from './useGuestState';
import s from './demo.module.css';

/**
 * D10 — persistent guest-shell banner, mounted once in `_app.tsx`. Renders
 * nothing for a real user (or before auth resolves).
 *
 * Copy is fixed by controller ruling (addendum c, 2026-09-21): every guest
 * sandbox expires in 24h regardless of when it started, so "24 hours" is
 * exact wording, not a derived-then-hardcoded value — there's no live
 * countdown here to keep in sync with `expiresAt`.
 */
export function GuestBanner() {
  const { isGuest } = useGuestState();
  if (!isGuest) return null;

  return (
    <div className={s.banner} role="status">
      <p className={s.bannerText}>
        You&apos;re using SPECTR as a guest — your work is kept for 24 hours.
      </p>
      <Link to="/register" search={{ from: 'guest' }} className={s.bannerLink}>
        Create a free account
      </Link>
    </div>
  );
}
