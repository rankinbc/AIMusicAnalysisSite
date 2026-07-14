/* Story 6.1 (UX-DR6) — the slim public chrome for funnel pages (landing,
 * pricing, trust). Brand + Pricing + Sign in + "Analyze free" CTA. Sticky and
 * transparent over the body atmosphere. NOT for auth pages — those keep the
 * narrow _public column.
 *
 * Plain <a> navigation on purpose: funnel pages are entry points where a full
 * page load is fine, and plain anchors keep this component static-render
 * testable without a RouterProvider (the FeedView idiom). */
import s from './PublicChrome.module.css';

export function PublicChrome() {
  return (
    <header className={s.chrome}>
      <a href="/" className={s.brand}>
        SPEC<span className={s.brandAccent}>TR</span>
      </a>
      <nav className={s.nav}>
        <a href="/pricing" className={s.navLink}>Pricing</a>
        <a href="/login" className={s.navLink}>Sign in</a>
        {/* CTA targets /register until story 6.3 ships /analyze — retarget then. */}
        <a href="/register" className="btn primary sm">Analyze free</a>
      </nav>
    </header>
  );
}
