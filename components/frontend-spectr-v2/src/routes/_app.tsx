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
import { getLastTraceId } from '../api/fetcher';
import { buildProblemReportMailto, jobIdFromPath, SUPPORT_EMAIL } from '../lib/report-problem';
import { matchShortcut } from '../lib/shortcuts';
import { useEntitlements } from '../api/hooks';
import { CommandPalette } from '../components/CommandPalette';
import { ShortcutSheet } from '../components/ShortcutSheet';
import { UnifiedUploadDialog } from '../components/UnifiedUploadDialog';
import { AppDunningNotice } from '../features/billing/AppDunningNotice';
import { GuestBanner } from '../features/demo/GuestBanner';
import { GuestUpgradeDialog } from '../features/demo/GuestUpgradeDialog';
import { onGuestUpgrade, type GuestUpgradeReason } from '../features/demo/guest-upgrade-bus';
import { useGuestState } from '../features/demo/useGuestState';
import { AppWorkerHealthNotice } from '../features/health/AppWorkerHealthNotice';
import { DevHealthDot } from '../features/health/DevHealthDot';
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

  // D10 — guest shell: quota state for the banner/"+ Upload" swap, and the
  // ONE upgrade dialog, opened by ANY guest_restricted 403 anywhere in the
  // app (via the MutationCache in api/mutation-error-toast.ts) or by a
  // proactive pre-request gate (e.g. UnifiedUploadDialog itself).
  const guest = useGuestState();
  // `message` stays a required-but-nullable field (not `message?:`) — the
  // bus callback always passes a value, possibly `undefined`, and
  // exactOptionalPropertyTypes rejects assigning `undefined` into an
  // optional field.
  const [upgrade, setUpgrade] = useState<{
    reason: GuestUpgradeReason;
    message: string | undefined;
  } | null>(null);
  useEffect(() => onGuestUpgrade((reason, message) => setUpgrade({ reason, message })), []);

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

  // Story 5.10 (UX-DR43) — global product shortcuts: ⌘K palette, ⌘U upload,
  // `?` sheet. Registered in the authed shell ONLY, so public/anon routes
  // carry no listener by construction. matchShortcut owns the decision
  // matrix (modifier, repeat/IME, editable-target suppression); one modal at
  // a time — a shortcut never opens a surface over another open one.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K closes the open palette even though focus sits in its (editable)
      // input — without this special case the toggle would be unreachable.
      if (
        paletteOpen &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key.toLowerCase() === 'k' || e.code === 'KeyK')
      ) {
        e.preventDefault();
        setPaletteOpen(false);
        return;
      }

      const action = matchShortcut(e);
      if (!action) return;

      // Review finding: page-local Radix dialogs (upload/compare/confirm/…)
      // are invisible to the shell's three open-flags — never stack a global
      // surface over ANY open modal. DOM probe because those dialogs own
      // their state locally.
      const shellSurfaceOpen = paletteOpen || sheetOpen || uploadOpen;
      const anyDialogOpen =
        shellSurfaceOpen ||
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
      // D10 — a guest with no uploads left gets no ⌘U surface at all: the
      // banner/"+ Upload" link already tells them where to go, and
      // UnifiedUploadDialog would just substitute the upgrade dialog anyway
      // (see its own guest.canUpload guard) — skip opening anything here.
      const uploadBlockedForGuest = guest.isGuest && !guest.canUpload;
      const allowed =
        (action === 'palette' && !anyDialogOpen) ||
        (action === 'upload' && !anyDialogOpen && !uploadBlockedForGuest) ||
        (action === 'sheet' && !anyDialogOpen);
      if (!allowed) return; // no preventDefault — the browser keeps its chord on a no-op

      e.preventDefault(); // Ctrl+U is view-source; ⌘K focuses browser UI in some builds
      if (action === 'palette') setPaletteOpen(true);
      else if (action === 'upload') setUploadOpen(true);
      else setSheetOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, sheetOpen, uploadOpen, guest.isGuest, guest.canUpload]);

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

  // Server-side credits_enabled kill switch: when off, everyone is premium and
  // the billing/usage/meter surfaces are meaningless — hide them. Missing
  // field (older payload, query still loading) ⇒ treat as enabled.
  const creditsOn = entitlements?.creditsEnabled !== false;

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
          {/* Story 12.5: the permanently-disabled Listen tab is GONE — Listen
              is per-version (library Play button / report "Open in Listen");
              a tooltip-only disabled tab read as broken. */}
          <Link to="/library" className={s.navTab} data-active={isLibraryActive}>
            Library
          </Link>
        </nav>

        <div className={s.navRight}>
          {/* Story 5.10: the ⌘K palette is BACK with real machinery (nav
              commands + client-side song search over the cached songs query)
              — see CommandPalette. The 12.5 removal note is satisfied. */}
          {/* Story 12.2 — dev-only aggregated-health dot. The conditional
              render keeps the /health/full query unmounted in prod builds. */}
          {import.meta.env.DEV && <DevHealthDot />}
          {/* D10 — a guest with no uploads left never sees a working "+
              Upload" entry point; it becomes the registration link instead. */}
          {guest.isGuest && !guest.canUpload ? (
            <Link to="/register" search={{ from: 'guest' }} className="btn primary sm">
              Create a free account
            </Link>
          ) : (
            <Link to="/library" className="btn primary sm">
              + Upload
            </Link>
          )}
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
                {creditsOn && (
                  <Link
                    to="/usage"
                    className={s.avatarMenuItem}
                    onClick={() => setMenuOpen(false)}
                  >
                    Usage
                  </Link>
                )}
                {creditsOn && entitlements && (
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
                {/* Billing stays reachable even with credits disabled — an
                    existing Stripe subscriber must always be able to manage or
                    cancel; the page itself hides the upsell surfaces. */}
                <Link
                  to="/billing"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Billing
                </Link>
                {/* Story 12.8 (AC2): prefilled problem report — page URL,
                    jobId when on a results route, last 500 traceId if any. */}
                <button
                  type="button"
                  className={s.avatarMenuItem}
                  onClick={() => {
                    setMenuOpen(false);
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
      {/* D10 — guest-shell banner; renders nothing for a real user. */}
      <GuestBanner />
      {/* Global analysis-worker outage notice — renders nothing while healthy. */}
      <AppWorkerHealthNotice className={s.workerHealthSlot} />
      {/* Story 12.1 — unverified-email notice (free tier only); renders
          nothing when verified, dismissed, or on paid tiers. */}
      <VerifyEmailBanner className={s.verifyEmailSlot} />
      <main className={s.main}>
        <Outlet />
      </main>
      {/* Story 5.10 — global keyboard surfaces. The upload dialog here is the
          ⌘U fallback (new-song mode, mirrors the library mount); the two
          page-local mounts keep their contextual songId/defaultGenre props. */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      <UnifiedUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      {/* D10 — the ONE guest upgrade dialog, driven by onGuestUpgrade. */}
      <GuestUpgradeDialog
        open={upgrade !== null}
        reason={upgrade?.reason ?? 'not_allowed'}
        {...(upgrade?.message !== undefined ? { message: upgrade.message } : {})}
        onOpenChange={(next) => {
          if (!next) setUpgrade(null);
        }}
      />
    </div>
  );
}
