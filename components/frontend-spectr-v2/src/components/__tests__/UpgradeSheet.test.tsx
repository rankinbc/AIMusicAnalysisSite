import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Story 2.7 / UX-DR30. vitest env is `node`, so we flatten Radix Dialog to
// passthrough primitives and mock the data/checkout hooks, then assert the
// static markup. Mirrors the buy-credits-card.test.tsx pattern.

vi.mock('@radix-ui/react-dialog', () => {
  const Pass = ({ children }: { children?: unknown }) => children ?? null;
  return {
    Root: ({ children, open }: { children?: unknown; open?: boolean }) =>
      open ? children : null,
    Portal: Pass,
    Overlay: () => null,
    Content: Pass,
    Title: Pass,
    Description: Pass,
    Close: Pass,
  };
});

vi.mock('../../api/hooks', () => ({
  usePlans: () => ({
    data: {
      proMonthlyCents: 1299,
      proAnnualCents: 9900,
      creditPacks: [
        { credits: 500, cents: 700 },
        { credits: 1500, cents: 1800 },
        { credits: 5000, cents: 5500 },
      ],
      costs: { analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5, signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300 },
      currency: 'USD',
    },
  }),
}));

vi.mock('../../features/billing/useUpgradeCheckout', () => ({
  useUpgradeCheckout: () => ({ start: vi.fn(), pending: null }),
}));

import { UpgradeSheet } from '../UpgradeSheet';

function render() {
  return renderToStaticMarkup(
    <UpgradeSheet
      open
      onOpenChange={vi.fn()}
      analysesUsed={3}
      analysesLimit={3}
      gradeChips={[{ id: 'a', label: 'Night Drive', grade: 'B' }]}
    />,
  );
}

describe('UpgradeSheet (story 2.7 / UX-DR30)', () => {
  it('renders the cap-hit header with live counts', () => {
    expect(render()).toContain('3 of 3 free analyses used this month');
  });

  it('renders the verbatim trust line', () => {
    expect(render()).toContain(
      'Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio',
    );
  });

  it('offers the honest "wait for next month" exit', () => {
    expect(render()).toContain('wait for next month');
  });

  it('shows PRO + CREDITS prices via formatCents (no $ literals in source)', () => {
    const html = render();
    expect(html).toContain('$12.99/mo');
    expect(html).toContain('$99.00/yr');
    expect(html).toContain('500 credits · $7.00');
    expect(html).toContain('1,500 credits · $18.00');
    expect(html).toContain('5,000 credits · $55.00');
    expect(html).toContain('15 analyses / month');
    // annual savings: 1299*12 - 9900 = 5688
    expect(html).toContain('$56.88');
  });

  it('renders exactly one primary action (Subscribe)', () => {
    const html = render();
    const primaries = [...html.matchAll(/class="btn primary"/g)];
    expect(primaries.length).toBe(1);
    expect(html).toContain('Subscribe');
    expect(html).toContain('aria-label="Credit packs"');
  });

  it('renders the value-recap grade chip for the user climb', () => {
    expect(render()).toContain('Night Drive');
  });
});
