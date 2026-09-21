/* Story 6.2 (UX-DR26) — shared scaffold for the three trust pages so each
 * route file is content-only. PublicChrome + meta + title + prose + cross-links.
 * Plain <a> navigation (6-1 funnel idiom — static-render testable, full nav ok). */
import type { ReactNode } from 'react';

import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import { usePageMeta } from '../../lib/usePageMeta';
import { TRUST_PAGES } from './trust-pages';
import s from './trust.module.css';

// Re-exported for backward compatibility (task P3 moved the source of truth
// to trust-pages.ts so PublicFooter can import it too).
export { TRUST_PAGES };

interface TrustPageProps {
  path: (typeof TRUST_PAGES)[number]['path'];
  title: string;
  metaDescription: string;
  updated: string;
  children: ReactNode;
}

export function TrustPage({ path, title, metaDescription, updated, children }: TrustPageProps) {
  usePageMeta(`${title} — SPECTR`, metaDescription);
  return (
    <div>
      <PublicChrome />
      <main className={s.shell}>
        <header className={s.header}>
          <span className="label">Trust</span>
          <h1 className={s.title}>{title}</h1>
          <p className={`mono ${s.updated}`}>Last updated {updated}</p>
        </header>
        <article className={s.prose}>{children}</article>
        <PublicFooter currentPath={path} />
      </main>
    </div>
  );
}
