// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/analytics', () => ({ capture: vi.fn() }));
import { resetPublicPlansForTests } from '../../../lib/public-plans';
import { PricingPage } from '../PricingPage';
const body = (creditsEnabled: boolean | null) => JSON.stringify({
  proMonthlyCents: 100, proAnnualCents: 1000, creditPack5Cents: 500, creditPack10Cents: 900, currency: 'USD', creditsEnabled,
});
describe('PricingPage states', () => {
  beforeEach(() => { resetPublicPlansForTests(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('credits off: says so, offers analyze + demo, shows no plan grid', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body(false), { status: 200 }))));
    render(<PricingPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Free while we launch.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Analyze a track' }).getAttribute('href')).toBe('/analyze');
    expect(screen.getByRole('link', { name: 'Explore the demo' }).getAttribute('href')).toBe('/demo');
    expect(screen.queryByText('Honest billing. No asterisks.')).toBeNull();
    expect(document.body.textContent).not.toContain('*');
  });
  it('credits on: the existing plans page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body(true), { status: 200 }))));
    render(<PricingPage />);
    expect(await screen.findByText('Honest billing. No asterisks.')).toBeTruthy();
  });
  it('before the answer, and when it never comes: neutral page, no plan copy', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<PricingPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Pricing' })).toBeTruthy();
    expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
    expect(screen.queryByText('Honest billing. No asterisks.')).toBeNull();
  });
});
