import type { Tier } from '../../components/TierChip';

// Audit wave-3 (E8.6) — the /profile Account-card copy per REAL tier. The
// tier MUST come from EntitlementsDto.tier (free/credits/pro) — never from
// useAuth().user.tier, which can't express 'credits' (types.ts AuthedUser).
// null = entitlements not loaded / failed → say so, never guess "Free".

export interface PlanCardCopy {
  name: string | null;
  description: string;
  link: { to: '/pricing' | '/billing' | '/usage'; label: string } | null;
}

export function planCardCopy(tier: Tier | null): PlanCardCopy {
  switch (tier) {
    case 'free':
      return {
        name: 'Free plan',
        description:
          'Unlimited library size · on-demand AI specialists · single producer workspace',
        link: { to: '/pricing', label: 'See plans' },
      };
    case 'pro':
      return {
        name: 'Pro plan',
        description: 'Unlimited analyses, full coach, every specialist.',
        link: { to: '/billing', label: 'Manage subscription' },
      };
    case 'credits':
      return {
        name: 'Credits',
        description: 'Pay as you go — buy more or check your balance on Usage.',
        link: { to: '/usage', label: 'Go to Usage' },
      };
    default:
      return { name: null, description: 'Plan info unavailable.', link: null };
  }
}
