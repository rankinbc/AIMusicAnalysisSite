// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));
import type { PlansResponse } from '../../../api/types';
import { PricingPlansView } from '../PricingPlansView';

const plans: PlansResponse = {
  proMonthlyCents: 100, proAnnualCents: 1000, currency: 'USD', creditsEnabled: true,
  creditPacks: [{ credits: 11, cents: 200 }, { credits: 22, cents: 300 }, { credits: 33, cents: 400 }],
  costs: {
    analysis: 41, specialist: 42, coachMessage: 43, coachMix: 44,
    signupGrant: 45, proAnalysesMonthly: 46, proCoachMonthly: 47,
  },
};

describe('PricingPlansView (credit economy)', () => {
  afterEach(cleanup);
  const view = () => render(<PricingPlansView plans={plans} pending={null} onCheckout={() => {}} />);

  it('free card shows the sign-up grant and per-action costs from the server', () => {
    view();
    expect(screen.getByText('45 credits to start')).toBeTruthy();
    expect(screen.getByText(/Analysis 41 ◆ · specialist 42 ◆ · coach 43 ◆/)).toBeTruthy();
  });

  it('pro card shows the monthly allowances then credits', () => {
    view();
    expect(screen.getByText('46 analyses + 47 coach messages / month')).toBeTruthy();
    expect(screen.getByText('Then pay as you go with credits')).toBeTruthy();
  });

  it('credits card lists every pack and links to /usage, not disabled', () => {
    view();
    for (const c of ['11', '22', '33']) expect(screen.getAllByText(new RegExp(`^${c} credits`)).length).toBeGreaterThan(0);
    const cta = screen.getByTestId('pricing-credits-cta');
    expect(cta.getAttribute('href')).toBe('/usage');
    expect(cta.hasAttribute('disabled')).toBe(false);
    expect(document.body.textContent).not.toContain('Coming soon');
  });

  it('no server costs (older BFF): no invented numbers', () => {
    render(<PricingPlansView plans={{ ...plans, costs: null }} pending={null} onCheckout={() => {}} />);
    expect(screen.queryByText(/credits to start/)).toBeNull();
  });
});
