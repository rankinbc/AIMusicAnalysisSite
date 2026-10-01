import { useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';

import { useAuth } from '../../auth/AuthContext';
import s from './demo.module.css';

/** CSS custom property (on <html>) holding the banner's on-screen height. */
const GUEST_BANNER_H_VAR = '--guest-banner-h';

/**
 * D10 — persistent guest-shell banner, mounted ONCE in the root route
 * (`routes/__root.tsx`) so it covers every page — the authed shell, the
 * public pages (landing, pricing, /analyze, /trust/*), the auth column and
 * the not-found/error screens. Renders nothing for a real user, a signed-out
 * visitor, or before auth resolves.
 *
 * It sits in normal flow (reserves its own space). The one surface that
 * would still hide it — the live analysis page, a full-viewport fixed layer
 * — starts below `--guest-banner-h`, which this component keeps equal to the
 * part of the banner currently on screen (0 once scrolled away, so an
 * overlay opened over a scrolled page leaves no gap).
 *
 * Copy is fixed by controller ruling (addendum c, 2026-09-21): every guest
 * sandbox expires in 24h regardless of when it started, so "24 hours" is
 * exact wording, not a derived-then-hardcoded value — there's no live
 * countdown here to keep in sync with `expiresAt`.
 */
export function GuestBanner() {
  // Guest-ness straight off AuthContext (the same source useGuestState
  // reads) — NOT useGuestState(): the banner needs no quota numbers, and
  // pulling TanStack Query's useQuery into the root route would grow the
  // shared entry chunk (~10 KB raw) for every visitor.
  const { user } = useAuth();
  const isGuest = user?.isGuest === true;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!isGuest || !el) return undefined;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const visible = Math.max(0, Math.round(el.getBoundingClientRect().bottom));
      root.style.setProperty(GUEST_BANNER_H_VAR, `${visible}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Wrapping at phone width changes the height without a window resize
    // (e.g. a font finishing loading) — watch the element itself too.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(el);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      root.style.removeProperty(GUEST_BANNER_H_VAR);
    };
  }, [isGuest]);

  if (!isGuest) return null;

  return (
    <div ref={ref} className={s.banner} role="status" data-testid="guest-banner">
      <p className={s.bannerText}>
        You&apos;re using SPECTR as a guest — your work is kept for 24 hours.
      </p>
      <Link to="/register" search={{ from: 'guest' }} className={s.bannerLink}>
        Create a free account
      </Link>
    </div>
  );
}
