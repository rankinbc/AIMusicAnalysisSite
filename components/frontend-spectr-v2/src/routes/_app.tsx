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
import { BrandMark } from '../ui/BrandMark';
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
          <button type="button" className={s.navTab} data-active={false} disabled>
            Listen
          </button>
          <Link to="/library" className={s.navTab} data-active={isLibraryActive}>
            Library
          </Link>
          <button type="button" className={s.navTab} data-active={false} disabled>
            Discover
          </button>
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
          <button
            type="button"
            className={s.navIconBtn}
            title="Notifications"
            aria-label="Notifications"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 6a4 4 0 1 1 8 0v3l1 1H2l1-1V6z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path
                d="M5 11a2 2 0 0 0 4 0"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
                  to="/library"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Library
                </Link>
                <Link
                  to="/billing"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Billing
                </Link>
                <Link
                  to="/usage"
                  className={s.avatarMenuItem}
                  onClick={() => setMenuOpen(false)}
                >
                  Usage
                </Link>
                <button type="button" className={s.avatarMenuItem} onClick={handleLogout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
