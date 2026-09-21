/* Story 6.2 (UX-DR26) — shared scaffold for the three trust pages so each
 * route file is content-only. PublicChrome + meta + title + prose + cross-links.
 * Plain <a> navigation (6-1 funnel idiom — static-render testable, full nav ok). */
import type { ReactNode } from 'react';

import { PublicChrome } from '../../components/PublicChrome';
import { PricingLink } from '../../components/PricingLink';
import { usePageMeta } from '../../lib/usePageMeta';
import s from './trust.module.css';

export const TRUST_PAGES = [
  { path: '/trust/no-training', label: 'No AI training' },
  { path: '/trust/results-forever', label: 'Results forever' },
  { path: '/trust/privacy', label: 'Privacy defaults' },
] as const;

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
        <footer className={s.footer}>
          {TRUST_PAGES.filter((p) => p.path !== path).map((p) => (
            <a key={p.path} href={p.path} className={s.footerLink}>{p.label}</a>
          ))}
          <PricingLink className={s.footerLink} />
        </footer>
      </main>
    </div>
  );
}
