// @vitest-environment jsdom
// Owner ruling 2026-10-01 — a guest's every /pricing CTA goes to the guest
// sign-up screen, in both the credits-on and the credits-off states.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));

let isGuest = true;
vi.mock('../../../auth/AuthContext', () => ({
  useOptionalAuth: () => ({ user: { id: 'u1', email: 'g@x', isGuest } }),
}));

import { resetPublicPlansForTests } from '../../../lib/public-plans';
import { PricingPage } from '../PricingPage';

const SIGNUP = '/register?from=guest&next=%2Fpricing';
const body = (creditsEnabled: boolean) => JSON.stringify({
  proMonthlyCents: 100, proAnnualCents: 1000, creditPacks: [], currency: 'USD', creditsEnabled,
});

describe('PricingPage — guest viewer', () => {
  beforeEach(() => { resetPublicPlansForTests(); isGuest = true; });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('credits on: plan + credits CTAs are sign-up links, never a checkout call', async () => {
    const fetchMock = vi.fn<(url: unknown) => Promise<Response>>(() => Promise.resolve(new Response(body(true), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    render(<PricingPage />);
    await screen.findByText('Honest billing. No asterisks.');
    for (const id of ['pricing-monthly-cta', 'pricing-annual-cta', 'pricing-credits-cta']) {
      expect(screen.getByTestId(id).getAttribute('href')).toBe(SIGNUP);
    }
    // Only the public plans fetch — no /api/billing/checkout request.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('checkout'))).toBe(false);
  });

  it('credits off: the CTA row is the single sign-up CTA (no analyze/demo)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body(false), { status: 200 }))));
    render(<PricingPage />);
    await screen.findByRole('heading', { level: 1, name: 'Free while we launch.' });
    expect(screen.getByTestId('pricing-off-signup-cta').getAttribute('href')).toBe(SIGNUP);
    expect(screen.queryByTestId('pricing-off-analyze-cta')).toBeNull();
    expect(screen.queryByTestId('pricing-off-demo-cta')).toBeNull();
  });

  it('real user: CTAs unchanged', async () => {
    isGuest = false;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body(true), { status: 200 }))));
    render(<PricingPage />);
    await screen.findByText('Honest billing. No asterisks.');
    expect(screen.getByTestId('pricing-monthly-cta').tagName).toBe('BUTTON');
    expect(screen.getByTestId('pricing-credits-cta').getAttribute('href')).toBe('/usage');
  });
});
