/* Task P3 (public-surfaces-polish) — the ONE product footer for every public
 * page (landing, pricing on/off, trust pages). Replaces three ad-hoc
 * footers. Four labeled nav groups (Product / Engineering / Trust /
 * Account) + a copyright line — no personal byline, no repo link. Same
 * static-render-testable idiom as PublicChrome: useOptionalAuth returns
 * null outside AuthProvider, and every link is a plain <a>. */
import { useOptionalAuth } from '../auth/AuthContext';
import { TRUST_PAGES } from '../features/trust/trust-pages';
import { PricingLink } from './PricingLink';
import s from './PublicFooter.module.css';

export function PublicFooter({ currentPath }: { currentPath?: string } = {}) {
  const authed = Boolean(useOptionalAuth()?.user);
  return (
    <footer className={s.footer}>
      <div className={s.grid}>
        <nav aria-label="Product" className={s.group}>
          <span className="label">Product</span>
          <a href="/analyze" className={s.link}>Analyze a track</a>
          <a href="/demo" className={s.link}>Explore the demo</a>
          <PricingLink className={s.link} />
        </nav>

        <nav aria-label="Engineering" className={s.group}>
          <span className="label">Engineering</span>
          <a href="/trust/how-its-built" className={s.link}>How it&rsquo;s built</a>
        </nav>

        <nav aria-label="Trust" className={s.group}>
          <span className="label">Trust</span>
          {TRUST_PAGES.map((p) => (
            <a
              key={p.path}
              href={p.path}
              className={s.link}
              aria-current={p.path === currentPath ? 'page' : undefined}
            >
              {p.label}
            </a>
          ))}
        </nav>

        <nav aria-label="Account" className={s.group}>
          <span className="label">Account</span>
          {authed ? (
            <a href="/library" className={s.link}>Open library</a>
          ) : (
            <>
              <a href="/login" className={s.link}>Sign in</a>
              <a href="/register" className={s.link}>Create account</a>
            </>
          )}
        </nav>
      </div>

      <p className={`mono ${s.copyright}`}>© {new Date().getFullYear()} SPECTR</p>
    </footer>
  );
}
