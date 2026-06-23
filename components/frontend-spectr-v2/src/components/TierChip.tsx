import s from './TierChip.module.css';

// Story 2.7 / UX-DR3 — small tier badge. Colors come from the pre-declared
// commerce tokens in tokens.css (--tier-free/pro/credits). Dumb + presentational.

export type Tier = 'free' | 'credits' | 'pro';

const LABEL: Record<Tier, string> = {
  free: 'Free',
  credits: 'Credits',
  pro: 'Pro',
};

export function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className={`${s.chip} ${s[tier]}`} data-tier={tier}>
      {LABEL[tier]}
    </span>
  );
}
