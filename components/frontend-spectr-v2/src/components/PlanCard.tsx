import type { ReactNode } from 'react';

import { TierChip, type Tier } from './TierChip';
import s from './PlanCard.module.css';

// Story 2.7 / UX-DR30 — one plan card, used twice inside the UpgradeSheet
// (PRO + CREDITS). Presentational: the price node (and any cadence toggle)
// is composed by the parent so this stays free of price literals (AR39).

interface PlanCardProps {
  tier: Tier;
  title: string;
  /** Price line + optional cadence toggle, composed by the parent. */
  priceNode: ReactNode;
  features: string[];
  /** Small reassurance line under the features (e.g. "never expire"). */
  footnote?: string;
  ctaLabel: string;
  onCta: () => void;
  ctaPending?: boolean;
  /** The recommended plan gets the accent border + primary CTA. */
  featured?: boolean;
}

export function PlanCard({
  tier,
  title,
  priceNode,
  features,
  footnote,
  ctaLabel,
  onCta,
  ctaPending = false,
  featured = false,
}: PlanCardProps) {
  return (
    <section className={`card ${s.card} ${featured ? s.featured : ''}`}>
      <header className={s.head}>
        <TierChip tier={tier} />
        <h3 className={s.title}>{title}</h3>
      </header>

      <div className={s.price}>{priceNode}</div>

      <ul className={s.features}>
        {features.map((f) => (
          <li key={f} className={s.feature}>
            {f}
          </li>
        ))}
      </ul>

      {footnote && <p className={s.footnote}>{footnote}</p>}

      <button
        type="button"
        className={`btn ${featured ? 'primary' : 'ghost'}`}
        onClick={onCta}
        disabled={ctaPending}
      >
        {ctaPending ? 'Opening…' : ctaLabel}
      </button>
    </section>
  );
}
