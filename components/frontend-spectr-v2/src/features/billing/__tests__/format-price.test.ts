import { describe, expect, it } from 'vitest';

import { formatCents } from '../format-price';

// Story 2.1 — formatCents converts integer cents (architecture line 96
// "integer cents everywhere") into a localized display string. The
// no-price-literals lint forbids inline `$` characters outside config —
// these tests assert via numeric substring matches so they too stay
// lint-clean.

describe('formatCents', () => {
  it('formats 1299 USD as the canonical Pro monthly amount', () => {
    const s = formatCents(1299, 'USD');
    expect(s).toContain('12.99');
    expect(s).toContain('12');
  });

  it('formats 9900 USD as the canonical Pro annual amount', () => {
    const s = formatCents(9900, 'USD');
    expect(s).toContain('99.00');
  });

  it('handles zero gracefully', () => {
    const s = formatCents(0, 'USD');
    expect(s).toContain('0');
  });

  it('falls back when given a bogus currency code', () => {
    const s = formatCents(500, 'BOGUS_NOT_A_CURRENCY');
    // Fallback path preserves the value so a render never throws.
    expect(s).toContain('5.00');
  });

  it('rounds via Intl (no manual decimal arithmetic)', () => {
    // Cent-level precision survives the divide-by-100.
    expect(formatCents(1, 'USD')).toContain('0.01');
    expect(formatCents(50, 'USD')).toContain('0.50');
  });
});
