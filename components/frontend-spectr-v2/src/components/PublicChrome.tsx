/* Story 6.1 (UX-DR6) — the slim public chrome for funnel pages (landing,
 * pricing, trust). Brand + How it works + Pricing + Sign in + "Analyze
 * free" CTA. Sticky and transparent over the body atmosphere. NOT for auth
 * pages — those keep the narrow _public column.
 *
 * Auth-aware (review finding): a LOGGED-IN user reaches /pricing via the
 * coach upgrade chips and the billing CTA — showing them "Sign in" and a
 * register-bound "Analyze free" mid-upgrade is a dead end. When auth resolves
 * a user, the chrome swaps to "Open library". useOptionalAuth (not useAuth)
 * so static-render tests need no provider — they exercise the anon variant.
 *
 * Plain <a> navigation on purpose: funnel pages are entry points where a full
 * page load is fine, and plain anchors keep this component static-render
 * testable without a RouterProvider. */
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext } from 'react';

import { useOptionalAuth } from '../auth/AuthContext';
import { guestHasOwnUploads, guestStateQueryOptions } from '../features/demo/useGuestState';
import { SpectrLogo } from '../ui/SpectrLogo';
import { PricingLink } from './PricingLink';
import s from './PublicChrome.module.css';

export function PublicChrome() {
  // A guest gets the anonymous chrome (+ Library once they've uploaded).
  const user = useOptionalAuth()?.user;
  const authed = Boolean(user && !user.isGuest);
  return (
    <header className={s.chrome}>
      <a href="/" className={s.brand} aria-label="SPECTR — AI Music Analysis, home">
        <SpectrLogo />
      </a>
      <nav className={s.nav}>
        {/* Task P3 — secondary links; hidden below 480px (MANDATORY 390px
            one-row requirement) so the logo, Sign in and the primary CTA
            never clip or wrap. */}
        <a href="/trust/how-its-built" className={`${s.navLink} ${s.navOptional}`}>How it works</a>
        {/* Task P2 (D6) — hidden until the server says credits are on. */}
        <PricingLink className={`${s.navLink} ${s.navOptional}`} />
        {authed ? (
          <a href="/library" className="btn primary sm">Open library</a>
        ) : (
          <>
            {user?.isGuest && <GuestLibraryLink />}
            <a href="/login" className={s.navLink}>Sign in</a>
            {/* Story 6.3 — the anon instant-analysis funnel is live. */}
            <a href="/analyze" className="btn primary sm">Analyze free</a>
          </>
        )}
      </nav>
    </header>
  );
}

/** Owner ruling 2026-10-01 — a guest who has uploaded a track of their own
 *  (the seeded demo doesn't count) gets a Library link; same rule as the
 *  /library route guard. Renders nothing without a QueryClient (static
 *  renders of public pages mount no provider). */
function GuestLibraryLink() {
  return useContext(QueryClientContext) ? <GuestLibraryLinkInner /> : null;
}

function GuestLibraryLinkInner() {
  const { data } = useQuery(guestStateQueryOptions);
  if (!guestHasOwnUploads(data)) return null;
  return <a href="/library" className={s.navLink}>Library</a>;
}
