// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));
import type { PlansResponse } from '../../../api/types';
import { resetPublicPlansForTests } from '../../../lib/public-plans';
import { ALWAYS_FREE } from '../always-free';
import { CreditCostsSection } from '../CreditCostsSection';
import { packReach, packReachLabel, usesFor } from '../credit-math';
import { PricingPage } from '../PricingPage';

// Deliberately odd numbers (none equal a production default) so any value
// that renders must have come from this fixture, not a literal in the code.
const costs = {
  analysis: 37, specialist: 11, coachMessage: 7, coachMix: 13,
  signupGrant: 999, proAnalysesMonthly: 23, proCoachMonthly: 211,
};
const plans: PlansResponse = {
  proMonthlyCents: 123, proAnnualCents: 4567, currency: 'USD', creditsEnabled: true,
  signupBonusCredits: 321,
  creditPacks: [{ credits: 370, cents: 250 }, { credits: 1000, cents: 900 }],
  costs,
};

describe('credit-math', () => {
  it('floors whole uses from server prices', () => {
    expect(usesFor(370, 37)).toBe(10);
    expect(usesFor(1000, 37)).toBe(27);
    expect(packReach(1000, costs)).toEqual({ analyses: 27, coachMessages: 142 });
  });
  it('a free (0) or nonsense cost has no meaningful count', () => {
    expect(usesFor(500, 0)).toBeNull();
    expect(usesFor(500, Number.NaN)).toBeNull();
    expect(usesFor(-5, 10)).toBeNull();
    expect(packReachLabel(500, { ...costs, analysis: 0, coachMessage: 0 })).toBeNull();
  });
  it('labels with singular/plural and drops free actions', () => {
    expect(packReachLabel(370, costs)).toBe('≈ 10 analyses or 52 coach messages');
    expect(packReachLabel(40, costs)).toBe('≈ 1 analysis or 5 coach messages');
    expect(packReachLabel(370, { ...costs, coachMessage: 0 })).toBe('≈ 10 analyses');
  });
});

describe('CreditCostsSection', () => {
  afterEach(cleanup);

  it('shows every paid action with its server cost', () => {
    render(<CreditCostsSection plans={plans} />);
    const expectCost = (key: string, name: string, n: number) => {
      const row = screen.getByTestId(`credit-cost-${key}`);
      expect(within(row).getByText(name)).toBeTruthy();
      expect(within(row).getByText(`${n} ◆`)).toBeTruthy();
    };
    expectCost('analysis', 'Full analysis', 37);
    expectCost('specialist', 'Extra AI specialist', 11);
    expectCost('coachMessage', 'Coach message', 7);
    expectCost('coachMix', 'Coach Mix', 13);
  });

  it('nothing hardcoded: no production default appears with these fixtures', () => {
    render(<CreditCostsSection plans={plans} />);
    const text = screen.getByTestId('credit-costs').textContent ?? '';
    for (const def of ['100 ◆', '15 ◆', '5 ◆', '500 credits', '300 coach', '15 analyses']) {
      expect(text).not.toContain(def);
    }
  });

  it('lists the always-free actions', () => {
    render(<CreditCostsSection plans={plans} />);
    const free = screen.getByTestId('credit-costs-free');
    for (const f of ALWAYS_FREE) expect(within(free).getByText(f.name)).toBeTruthy();
    expect(ALWAYS_FREE.map((f) => f.name)).toEqual([
      'Retry after a failure', 'Per-phase re-run', 'Reference analysis', 'Coach brief', 'Auto-run specialists',
    ]);
    expect(within(free).getAllByText('Free')).toHaveLength(ALWAYS_FREE.length);
  });

  it('signup line uses the granted bonus from the API', () => {
    render(<CreditCostsSection plans={plans} />);
    expect(screen.getByTestId('credit-costs-signup').textContent).toContain('321 free credits');
  });

  it('no signup bonus from the API: no signup line', () => {
    render(<CreditCostsSection plans={{ ...plans, signupBonusCredits: null }} />);
    expect(screen.queryByTestId('credit-costs-signup')).toBeNull();
  });

  it('Pro block states monthly allowances and the overflow rule', () => {
    render(<CreditCostsSection plans={plans} />);
    const pro = screen.getByTestId('credit-costs-pro').textContent ?? '';
    expect(pro).toContain('23 analyses and 211 coach messages every month');
    expect(pro).toContain('$1.23/mo');
    expect(pro).toContain('$45.67/yr');
    expect(pro).toContain('same prices');
  });

  it('packs show price and how far they go, computed from server costs', () => {
    render(<CreditCostsSection plans={plans} />);
    const packs = screen.getByTestId('credit-costs-packs');
    expect(within(packs).getByText('370 credits · $2.50')).toBeTruthy();
    expect(within(packs).getByText('≈ 10 analyses or 52 coach messages')).toBeTruthy();
    expect(within(packs).getByText('1000 credits · $9.00')).toBeTruthy();
    expect(within(packs).getByText('≈ 27 analyses or 142 coach messages')).toBeTruthy();
  });

  it('older BFF without costs: renders nothing', () => {
    const { container } = render(<CreditCostsSection plans={{ ...plans, costs: null }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('PricingPage — costs section across load states', () => {
  beforeEach(() => { resetPublicPlansForTests(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const respond = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));

  it('loading: no costs section yet', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(<PricingPage />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByTestId('credit-costs')).toBeNull();
  });

  it('error: no costs section, no numbers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))));
    render(<PricingPage />);
    expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
    expect(screen.queryByTestId('credit-costs')).toBeNull();
    expect(document.body.textContent).not.toContain('◆');
  });

  it('credits on: the section renders the fetched values', async () => {
    respond(plans);
    render(<PricingPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'What things cost' })).toBeTruthy();
    expect(within(screen.getByTestId('credit-cost-analysis')).getByText('37 ◆')).toBeTruthy();
  });

  it('credits off (kill switch): no costs section', async () => {
    respond({ ...plans, creditsEnabled: false });
    render(<PricingPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Free while we launch.' })).toBeTruthy();
    expect(screen.queryByTestId('credit-costs')).toBeNull();
  });
});
