/* Story 6.1 (UX-DR6) — the slim public chrome for funnel pages (landing,
 * pricing, trust). Brand + Pricing + Sign in + "Analyze free" CTA. Sticky and
 * transparent over the body atmosphere. NOT for auth pages — those keep the
 * narrow _public column.
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
import { useOptionalAuth } from '../auth/AuthContext';
import s from './PublicChrome.module.css';

export function PublicChrome() {
  const authed = Boolean(useOptionalAuth()?.user);
  return (
    <header className={s.chrome}>
      <a href="/" className={s.brand}>
        SPEC<span className={s.brandAccent}>TR</span>
      </a>
      <nav className={s.nav}>
        <a href="/pricing" className={s.navLink}>Pricing</a>
        {authed ? (
          <a href="/library" className="btn primary sm">Open library</a>
        ) : (
          <>
            <a href="/login" className={s.navLink}>Sign in</a>
            {/* Story 6.3 — the anon instant-analysis funnel is live. */}
            <a href="/analyze" className="btn primary sm">Analyze free</a>
          </>
        )}
      </nav>
    </header>
  );
}
