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
  // Task P4 widened this from the TRUST_PAGES union to `string` — the
  // engineering page (`/trust/how-its-built`) is a PublicFooter "Engineering"
  // link, not a TRUST_PAGES entry (see trust-pages.ts), so it was never a
  // member of that union.
  path: string;
  // Task P4: an eyebrow lets a non-pledge trust page (e.g. "Engineering")
  // replace the default "Trust" label without every existing caller changing.
  eyebrow?: string;
  title: string;
  metaDescription: string;
  // Task P4: optional — the engineering page has no single "effective date"
  // the way the pledge pages do, so the "Last updated" line only renders
  // when a caller supplies one.
  updated?: string;
  children: ReactNode;
}

export function TrustPage({ path, eyebrow, title, metaDescription, updated, children }: TrustPageProps) {
  usePageMeta(`${title} — SPECTR`, metaDescription);
  return (
    <div>
      <PublicChrome />
      <main className={s.shell}>
        <header className={s.header}>
          <span className="label">{eyebrow ?? 'Trust'}</span>
          <h1 className={s.title}>{title}</h1>
          {updated ? <p className={`mono ${s.updated}`}>Last updated {updated}</p> : null}
        </header>
        <article className={s.prose}>{children}</article>
        <PublicFooter currentPath={path} />
      </main>
    </div>
  );
}
