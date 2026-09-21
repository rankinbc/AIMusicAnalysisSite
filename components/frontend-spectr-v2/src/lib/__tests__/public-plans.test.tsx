// @vitest-environment jsdom
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlansResponse } from '../../api/types';
import { PricingLink } from '../../components/PricingLink';
import { loadPublicPlans, resetPublicPlansForTests, useCreditsEnabled } from '../public-plans';
const plans = (over: Partial<PlansResponse> = {}): PlansResponse => ({
  proMonthlyCents: 100, proAnnualCents: 1000, creditPack5Cents: 500, creditPack10Cents: 900, currency: 'USD', ...over,
});
const ok = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
describe('public plans', () => {
  beforeEach(() => { resetPublicPlansForTests(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('asks the server once per page load, however many callers', async () => {
    const f = vi.fn(ok(plans({ creditsEnabled: true })));
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([loadPublicPlans(), loadPublicPlans()]);
    expect(a).toEqual(b);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('never rejects: a network failure and a 500 both resolve null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await loadPublicPlans()).toBeNull();
    resetPublicPlansForTests();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))));
    expect(await loadPublicPlans()).toBeNull();
  });
  it.each([
    [{ creditsEnabled: true }, true],
    [{ creditsEnabled: false }, false],
    [{ creditsEnabled: null }, null],
    [{}, null], // an older BFF without the field is "unknown", not "on"
  ] as const)('useCreditsEnabled(%o) → %s', async (over, expected) => {
    vi.stubGlobal('fetch', vi.fn(ok(plans(over))));
    const { result } = renderHook(() => useCreditsEnabled());
    expect(result.current).toBeNull(); // hidden-by-default before the answer
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toBe(expected));
  });
  it('PricingLink renders nothing until the server says credits are on', async () => {
    vi.stubGlobal('fetch', vi.fn(ok(plans({ creditsEnabled: true }))));
    render(<PricingLink className="x" />);
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
    const link = await screen.findByRole('link', { name: 'Pricing' });
    expect(link.getAttribute('href')).toBe('/pricing');
  });
  it('PricingLink stays hidden when credits are off', async () => {
    const f = vi.fn(ok(plans({ creditsEnabled: false })));
    vi.stubGlobal('fetch', f);
    render(<PricingLink />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
  });
});
