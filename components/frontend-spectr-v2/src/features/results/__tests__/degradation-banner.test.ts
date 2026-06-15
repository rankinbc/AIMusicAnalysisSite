import { describe, expect, it } from 'vitest';

import type { DegradationReason } from '../../../api/types';
import { DEGRADATION_COPY } from '../degradationCopy';

// Story 1.4 / FR16 / UX-DR17: the copy contract is part of the user-visible
// guarantee — every degradation reason the BFF can send must have user-facing
// text that names "rule-based findings only" so the user understands what
// they're seeing.

describe('DEGRADATION_COPY', () => {
  const REASONS: DegradationReason[] = ['tier_budget', 'global_budget', 'circuit_breaker'];

  it.each(REASONS)('has a non-empty headline + body for reason %s', (reason) => {
    const copy = DEGRADATION_COPY[reason];
    expect(copy).toBeDefined();
    expect(copy.headline.trim().length).toBeGreaterThan(0);
    expect(copy.body.trim().length).toBeGreaterThan(0);
  });

  it.each(REASONS)('headline names "rule-based findings only" for reason %s', (reason) => {
    expect(DEGRADATION_COPY[reason].headline.toLowerCase()).toContain('rule-based');
  });

  it('tier_budget body mentions monthly credits — sets the right billing mental model', () => {
    expect(DEGRADATION_COPY.tier_budget.body.toLowerCase()).toMatch(/monthly|credits|spent/);
  });

  it('circuit_breaker body says provider is unavailable, not "down forever"', () => {
    const body = DEGRADATION_COPY.circuit_breaker.body.toLowerCase();
    expect(body).toContain('unavailable');
    // Reassures the user that the analysis itself is fine.
    expect(body).toMatch(/unaffected|fine|intact/);
  });
});
