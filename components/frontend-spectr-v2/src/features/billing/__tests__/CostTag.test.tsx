// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CostTag, usePaidAction } from '../CostTag';

const open = vi.fn();
vi.mock('../BuyCreditsProvider', () => ({ useBuyCredits: () => ({ open }) }));
vi.mock('../../../api/hooks', () => ({
  usePlans: () => ({
    data: {
      creditsEnabled: true, creditPacks: [], currency: 'USD', proMonthlyCents: 1, proAnnualCents: 1,
      costs: { analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5, signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300 },
    },
  }),
  useEntitlements: () => ({ data: { tier: 'credits', creditBalance: 10, creditsEnabled: true } }),
}));

function Probe({ onRun }: { onRun: () => void }) {
  const { guard } = usePaidAction('specialist');
  return <button onClick={() => guard(onRun)}>go</button>;
}

describe('CostTag', () => {
  it('renders the price', () => {
    render(<CostTag action="coachMix" />);
    expect(screen.getByText('5 ◆')).toBeTruthy();
  });

  it('guard opens the buy sheet instead of running when unaffordable', () => {
    const run = vi.fn();
    render(<Probe onRun={run} />);
    screen.getByText('go').click();
    expect(run).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });
});
