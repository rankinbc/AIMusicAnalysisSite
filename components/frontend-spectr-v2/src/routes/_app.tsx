import { useEffect, useRef, useState } from 'react';
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';

import { useAuth } from '../auth/AuthContext';
import { useEntitlements } from '../api/hooks';
import { AppDunningNotice } from '../features/billing/AppDunningNotice';
import { AppWorkerHealthNotice } from '../features/health/AppWorkerHealthNotice';
import { DevHealthDot } from '../features/health/DevHealthDot';
import { NotificationBell } from '../features/notifications/NotificationCenter';
import { BrandMark } from '../ui/BrandMark';
import { UsageMeter } from '../components/UsageMeter';
import { VerifyEmailBanner } from '../components/VerifyEmailBanner';
import s from './_app/_appLayout.module.css';

// Authenticated layout. beforeLoad guards on auth — anonymous users get
// bounced to /login. The guard short-circuits during the silent-refresh
// boot (isLoading=true) so we don't flash-redirect mid-load.
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (context.auth.isLoading) return;
    if (!context.auth.user) {
      throw redirect({
        to: '/login',
        search: { next: location.pathname },
      });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { user, isLoading, logout } = useAuth();
  // Story 2.8 — passive analyses meter in the account menu (UX-DR31). Cached
  // (staleTime 30s); fetch is cheap and shared across product routes.
  const { data: entitlements } = useEntitlements();
  const navigate = useNavigate();
  const location = useLocation();
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

  if (isLoading) {
    return (
      <div className={s.loading}>
        <p className="mono">Loading…</p>
      </div>
    );
  }

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    void navigate({ to: '/login' });
  };

  const pathname = location.pathname;
  const isLibraryActive = pathname === '/library' || pathname.startsWith('/songs');
  const isReportActive =
    pathname === '/reports' || pathname.includes('/results/');

  const avatarChar = (user?.email ?? '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className={s.shell}>
      <header className={s.topnav}>
        <Link to="/library" className={s.brand}>
          <BrandMark size={22} glow />
          <div className={s.brandText}>
            <span>SPECTR</span>
            <span className={s.brandCaption}>AI Music Analysis</span>
          </div>
        </Link>

        <nav className={s.navTabs}>
          <Link to="/reports" className={s.navTab} data-active={isReportActive}>
            Report
          </Link>
          <button
            type="button"
            className={s.navTab}
            data-active={false}
            disabled
            title="Open a track from your library to start listening"
          >
            Listen
          </button>
          <Link to="/library" className={s.navTab} data-active={isLibraryActive}>
            Library
          </Link>
          {/* Story 11.10 — followed-users activity feed. */}
          <Link to="/feed" className={s.navTab} data-active={pathname === '/feed'}>
            Feed
          </Link>
        </nav>

        <div className={s.navRight}>
          <div className={s.navSearch}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input placeholder="Search your tracks, notes, fixes…" />
            <span className={s.navSearchKbd}>⌘K</span>
          </div>
          {/* Story 12.2 — dev-only aggregated-health dot. The conditional
              render keeps the /health/full query unmounted in prod builds. */}
          {import.meta.env.DEV && <DevHealthDot />}
          {/* Story 11.7 — live bell (was a decorative placeholder). */}
          <NotificationBell className={s.navIconBtn} />
          <Link to="/library" className="btn primary sm">
            + Upload
          </Link>
          <div ref={menuRef} className={s.navAvatarWrap}>
            <button
              type="button"
              className={s.navAvatar}
              onClick={() => setMenuOpen((v) => !v)}
              title="Account menu"
            >
              {avatarChar}
            </button>
            {menuOpen && (
              <div className={s.avatarMenu} role="menu">
                <div className={s.avatarMenuHeader}>
                  <div className="label" style={{ marginBottom: 4 }}>
                    Signed in as
                  </div>
                  <div className={s.avatarMenuEmail}>{user?.email}</div>
                </div>
                <Link
                  to="/profile"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Profile
                </Link>
                <Link
                  to="/usage"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Usage
                </Link>
                {entitlements && (
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
                )}
                <Link
                  to="/billing"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Billing
                </Link>
                <div className={s.avatarMenuDivider} />
                <button type="button" className={s.avatarMenuItem} onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* Story 2.9 — app-wide dunning notice. Suppressed on /billing, which
          renders its own DunningBanner next to the fix actions. Renders
          nothing unless the subscription is past_due. */}
      {pathname !== '/billing' && (
        <AppDunningNotice className={s.dunningSlot} />
      )}
      {/* Global analysis-worker outage notice — renders nothing while healthy. */}
      <AppWorkerHealthNotice className={s.workerHealthSlot} />
      {/* Story 12.1 — unverified-email notice (free tier only); renders
          nothing when verified, dismissed, or on paid tiers. */}
      <VerifyEmailBanner className={s.verifyEmailSlot} />
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
