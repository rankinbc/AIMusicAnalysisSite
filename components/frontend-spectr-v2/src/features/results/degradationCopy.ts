// Story 1.4 / FR16 / UX-DR17: user-facing copy for the rule-based-findings
// banner. Extracted from DegradationBanner.tsx so it can be unit-tested
// without violating the react-refresh/only-export-components lint.

import type { DegradationReason } from '../../api/types';

export const DEGRADATION_COPY: Record<
  DegradationReason,
  { headline: string; body: string }
> = {
  tier_budget: {
    headline: 'Rule-based findings only',
    body: 'Your monthly AI credits are spent. The findings below come from the deterministic rule engine — your analysis is unaffected.',
  },
  global_budget: {
    headline: 'Rule-based findings only',
    body: 'AI generation is paused for everyone. The findings below come from the deterministic rule engine — try again later for full coverage.',
  },
  circuit_breaker: {
    headline: 'Rule-based findings only',
    body: 'The AI provider is unavailable. The findings below come from the deterministic rule engine — your measured analysis is unaffected.',
  },
};
