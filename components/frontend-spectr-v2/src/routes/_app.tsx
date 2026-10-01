import { useEffect, useState } from 'react';
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';

import { useAuth } from '../auth/AuthContext';
import { matchShortcut } from '../lib/shortcuts';
import { useEntitlements } from '../api/hooks';
import { CommandPalette } from '../components/CommandPalette';
import { ShortcutSheet } from '../components/ShortcutSheet';
import { UnifiedUploadDialog } from '../components/UnifiedUploadDialog';
import { AccountMenu } from '../features/account/AccountMenu';
import { AppDunningNotice } from '../features/billing/AppDunningNotice';
import { GuestShell } from '../features/demo/GuestShell';
import { useGuestState } from '../features/demo/useGuestState';
import { AppWorkerHealthNotice } from '../features/health/AppWorkerHealthNotice';
import { BuyCreditsProvider } from '../features/billing/BuyCreditsProvider';
import { CreditBalanceChip } from '../features/billing/CreditBalanceChip';
import { DevHealthDot } from '../features/health/DevHealthDot';
import { SpectrLogo } from '../ui/SpectrLogo';
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

  // D10 — guest shell: quota state for the banner/"+ Upload" swap / ⌘U gate.
  // The banner + the ONE upgrade dialog + its bus subscription (opened by
  // ANY guest_restricted 403 anywhere in the app, via the MutationCache in
  // api/mutation-error-toast.ts, or by a proactive pre-request gate like
  // UnifiedUploadDialog itself) live in GuestShell (D10 fix1 item 5) — this
  // second useGuestState() call shares the same ['me','guest'] query, no
  // extra fetch.
  const guest = useGuestState();

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
    await logout();
    void navigate({ to: '/login' });
  };

  const pathname = location.pathname;
  const isLibraryActive = pathname === '/library' || pathname.startsWith('/songs');
  const isReportActive =
    pathname === '/reports' || pathname.includes('/results/');

  // Server-side credits_enabled kill switch: when off, everyone is premium and
  // the billing/usage/meter surfaces are meaningless — hide them. Missing
  // field (older payload, query still loading) ⇒ treat as enabled.
  const creditsOn = entitlements?.creditsEnabled !== false;

  return (
    <BuyCreditsProvider>
    <div className={s.shell}>
      <header className={s.topnav}>
        <Link to={guest.isGuest ? '/' : '/library'} className={s.brand} aria-label={guest.isGuest ? 'SPECTR — home' : 'SPECTR — your library'}>
          <SpectrLogo />
        </Link>

        {/* Owner ruling 2026-10-01: guests (demo + guest upload) get no
            Report/Library tabs — they live on their one track's pages. */}
        {!guest.isGuest && (
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
        )}

        <div className={s.navRight}>
          {creditsOn && !guest.isGuest && <CreditBalanceChip />}
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
              <span className={s.ctaLong}>Create a free account</span>
              <span className={s.ctaShort}>Sign up</span>
            </Link>
          ) : (
            <Link to="/library" className="btn primary sm">
              + Upload
            </Link>
          )}
          <AccountMenu
            email={user?.email}
            isGuest={guest.isGuest}
            guestExpiresAt={guest.state?.expiresAt}
            creditsOn={creditsOn}
            entitlements={entitlements}
            onSignOut={handleLogout}
          />
        </div>
      </header>
      {/* Story 2.9 — app-wide dunning notice. Suppressed on /billing, which
          renders its own DunningBanner next to the fix actions. Renders
          nothing unless the subscription is past_due. */}
      {pathname !== '/billing' && (
        <AppDunningNotice className={s.dunningSlot} />
      )}
      {/* D10 — guest-shell banner + ONE upgrade dialog; renders nothing for
          a real user (GuestShell). */}
      <GuestShell />
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
    </div>
    </BuyCreditsProvider>
  );
}
