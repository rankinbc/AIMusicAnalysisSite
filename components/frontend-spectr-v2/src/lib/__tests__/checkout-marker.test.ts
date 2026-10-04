// @vitest-environment jsdom
// F1 — purchase_completed fires once per checkout, never on a bare reload of
// /billing/success.
import { afterEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => vi.fn());
vi.mock('../analytics', () => ({ capture }));

import { capturePurchaseCompleted, markCheckoutPending } from '../checkout-marker';

afterEach(() => {
  capture.mockReset();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkout marker', () => {
  it('fires purchase_completed once for a marked checkout', () => {
    markCheckoutPending('credits');
    capturePurchaseCompleted('credits');
    capturePurchaseCompleted('credits'); // reload / second confirmer
    expect(capture.mock.calls).toEqual([['purchase_completed', { product: 'credits' }]]);
  });

  it('does nothing without a marker (a reload, or a direct visit to the success page)', () => {
    capturePurchaseCompleted('subscription');
    expect(capture).not.toHaveBeenCalled();
  });

  it('ignores and clears a marker older than two hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
    markCheckoutPending('subscription');
    vi.setSystemTime(new Date('2026-10-04T12:30:00Z'));
    capturePurchaseCompleted('subscription');
    expect(capture).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it('never throws on a malformed marker or blocked storage', () => {
    window.localStorage.setItem('spectr_checkout_pending', 'not json');
    expect(() => capturePurchaseCompleted('credits')).not.toThrow();
    expect(capture).not.toHaveBeenCalled();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markCheckoutPending('credits')).not.toThrow();
  });
});
