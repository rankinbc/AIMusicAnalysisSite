/* D10 — the router's defaultNotFoundComponent. Any unknown URL lands here
 * instead of a router-default blank page: PublicChrome so the product stays
 * on screen, and two ways back in (home, or straight into the funnel). */
import { usePageMeta } from '../lib/usePageMeta';
import { PublicChrome } from './PublicChrome';
import s from './StatusScreen.module.css';

export function NotFoundScreen() {
  usePageMeta('Page not found — SPECTR');
  return (
    <>
      <PublicChrome />
      <main className={s.shell}>
        <span className="label">404</span>
        <h1 className={s.title}>This page doesn&rsquo;t exist.</h1>
        <p className={s.body}>The link may be old, or the address mistyped.</p>
        <div className={s.actions}>
          <a href="/" className="btn primary">Back to home</a>
          <a href="/analyze" className="btn ghost">Analyze a track</a>
        </div>
      </main>
    </>
  );
}
