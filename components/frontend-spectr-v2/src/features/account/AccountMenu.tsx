import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';

import { getLastTraceId } from '../../api/fetcher';
import type { EntitlementsDto } from '../../api/types';
import { UsageMeter } from '../../components/UsageMeter';
import { buildProblemReportMailto, jobIdFromPath, SUPPORT_EMAIL } from '../../lib/report-problem';
import { guestExpiryNote } from './guest-expiry';
import { MysteryAvatar } from './MysteryAvatar';
import s from './AccountMenu.module.css';

export interface AccountMenuProps {
  email: string | undefined;
  /** `user.isGuest` from AuthContext — never re-derived here. */
  isGuest: boolean;
  /** GET /api/me/guest `expiresAt` (= users.guest_expires_at, the purge
   *  column). undefined while loading / unknown → fallback copy. */
  guestExpiresAt?: string | null | undefined;
  creditsOn: boolean;
  entitlements: EntitlementsDto | undefined;
  onSignOut: () => void | Promise<void>;
}

/**
 * Top-right account avatar + dropdown (extracted from routes/_app.tsx).
 *
 * Owner ruling 2026-10-01 — GUESTS get a stripped menu: a mystery-person
 * avatar, a plain "Guest" header (no synthetic guest-…@guest.spectr.invalid
 * address), a primary "Create account" CTA into the existing guest→account
 * conversion (/register?from=guest → POST /auth/guest/convert) with the
 * time-to-purge note, the analyses meter, Billing, and Sign out. Profile,
 * Usage and "Report a problem" are registered-only. Registered users'
 * menu is unchanged.
 */
export function AccountMenu({
  email,
  isGuest,
  guestExpiresAt,
  creditsOn,
  entitlements,
  onSignOut,
}: AccountMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const close = () => setMenuOpen(false);
  const avatarChar = (email ?? '?').trim().charAt(0).toUpperCase() || '?';

  const meter =
    creditsOn && entitlements ? (
      <div className={s.avatarMenuMeter}>
        {/* Credits is balance-funded, not unlimited — show the
            remaining balance instead of the false "Unlimited". */}
        {entitlements.tier === 'credits' ? (
          <UsageMeter
            variant="nav"
            label="Credits"
            used={entitlements.analysesUsed}
            limit={null}
            valueText={`${entitlements.analysesRemaining ?? 0} left`}
          />
        ) : (
          <UsageMeter
            variant="nav"
            label="Analyses"
            used={entitlements.analysesUsed}
            limit={entitlements.analysesLimit}
          />
        )}
      </div>
    ) : null;

  // Billing stays reachable even with credits disabled — an existing Stripe
  // subscriber must always be able to manage or cancel; the page itself hides
  // the upsell surfaces. (Owner 2026-10-01: guests keep it too.)
  const billing = (
    <Link to="/billing" className={s.avatarMenuItem} onClick={close}>
      Billing
    </Link>
  );

  const signOut = (
    <>
      <div className={s.avatarMenuDivider} />
      <button
        type="button"
        className={s.avatarMenuItem}
        onClick={() => {
          close();
          void onSignOut();
        }}
      >
        Sign out
      </button>
    </>
  );

  return (
    <div ref={menuRef} className={s.navAvatarWrap}>
      <button
        type="button"
        className={isGuest ? `${s.navAvatar} ${s.navAvatarGuest}` : s.navAvatar}
        onClick={() => setMenuOpen((v) => !v)}
        title="Account menu"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {isGuest ? <MysteryAvatar /> : avatarChar}
      </button>
      {menuOpen && (
        <div className={s.avatarMenu} role="menu">
          {isGuest ? (
            <>
              <div className={s.avatarMenuHeader}>
                <div className={s.avatarMenuName}>Guest</div>
              </div>
              <div className={s.guestCta}>
                <Link
                  to="/register"
                  search={{ from: 'guest' }}
                  className={`btn primary sm ${s.guestCtaButton}`}
                  onClick={close}
                >
                  Create account
                </Link>
                <p className={s.guestNote}>{guestExpiryNote(guestExpiresAt)}</p>
              </div>
              {meter}
              {billing}
              {signOut}
            </>
          ) : (
            <>
              <div className={s.avatarMenuHeader}>
                <div className={`label ${s.avatarMenuLabel}`}>Signed in as</div>
                <div className={s.avatarMenuEmail}>{email}</div>
              </div>
              <Link to="/profile" className={s.avatarMenuItem} onClick={close}>
                Profile
              </Link>
              {creditsOn && (
                <Link to="/usage" className={s.avatarMenuItem} onClick={close}>
                  Usage
                </Link>
              )}
              {meter}
              {billing}
              {/* Story 12.8 (AC2): prefilled problem report — page URL,
                  jobId when on a results route, last 500 traceId if any. */}
              <button
                type="button"
                className={s.avatarMenuItem}
                onClick={() => {
                  close();
                  window.location.href = buildProblemReportMailto({
                    email: SUPPORT_EMAIL,
                    url: window.location.href,
                    jobId: jobIdFromPath(window.location.pathname),
                    traceId: getLastTraceId(),
                  });
                }}
              >
                Report a problem
              </button>
              {signOut}
            </>
          )}
        </div>
      )}
    </div>
  );
}
