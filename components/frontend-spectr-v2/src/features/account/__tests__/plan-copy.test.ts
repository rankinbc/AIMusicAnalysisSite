import { describe, expect, it } from 'vitest';

import { planCardCopy } from '../plan-copy';

// Audit wave-3 (E8.6) — /profile shows the REAL tier. The per-tier Account
// card copy is pure so it's testable without the route harness; the route
// renders the chip only when the tier is known (never guesses "Free").

describe('planCardCopy (audit wave-3 E8.6)', () => {
  it('free: existing copy + a See-plans link to /pricing', () => {
    const c = planCardCopy('free');
    expect(c.name).toBe('Free plan');
    expect(c.description).toContain('Unlimited library size');
    expect(c.link).toEqual({ to: '/pricing', label: 'See plans' });
  });

  it('pro: pro copy + Manage-subscription link to /billing', () => {
    const c = planCardCopy('pro');
    expect(c.name).toBe('Pro plan');
    expect(c.description).toContain('Unlimited analyses');
    expect(c.description).toContain('every specialist');
    expect(c.link).toEqual({ to: '/billing', label: 'Manage subscription' });
  });

  it('credits: pay-as-you-go copy + link to /usage', () => {
    const c = planCardCopy('credits');
    expect(c.name).toBe('Credits');
    expect(c.description).toContain('Pay as you go');
    expect(c.link?.to).toBe('/usage');
  });

  it('unknown tier: honest "unavailable" — no name, no link, never "Free"', () => {
    const c = planCardCopy(null);
    expect(c.name).toBeNull();
    expect(c.description).toBe('Plan info unavailable.');
    expect(c.link).toBeNull();
  });
});
