import { describe, expect, it } from 'vitest';

import { isStripeHostedUrl } from '../stripe-url';

// Story 2.2 — origin-validation guard. UX-spec line 357 mandates
// Stripe-hosted only; this helper makes sure we refuse to redirect
// anywhere else.

describe('isStripeHostedUrl', () => {
  it('accepts canonical checkout host', () => {
    expect(isStripeHostedUrl('https://checkout.stripe.com/c/cs_test_xyz', 'checkout')).toBe(true);
  });

  it('accepts canonical portal host', () => {
    expect(isStripeHostedUrl('https://billing.stripe.com/p/session/abc', 'portal')).toBe(true);
  });

  it('rejects checkout host when caller asked for portal', () => {
    expect(isStripeHostedUrl('https://checkout.stripe.com/x', 'portal')).toBe(false);
  });

  it('rejects portal host when caller asked for checkout', () => {
    expect(isStripeHostedUrl('https://billing.stripe.com/x', 'checkout')).toBe(false);
  });

  it('rejects http (not https) even on a Stripe host', () => {
    expect(isStripeHostedUrl('http://checkout.stripe.com/x', 'checkout')).toBe(false);
  });

  it('rejects attacker-controlled hosts that look similar', () => {
    expect(isStripeHostedUrl('https://checkout.stripe.com.evil.com/x', 'checkout')).toBe(false);
    expect(isStripeHostedUrl('https://evil.com/checkout.stripe.com', 'checkout')).toBe(false);
  });

  it('rejects unparseable values', () => {
    expect(isStripeHostedUrl('not a url', 'checkout')).toBe(false);
    expect(isStripeHostedUrl('', 'portal')).toBe(false);
  });

  // Story 2.2 review-fix P25 — defence-in-depth: explicitly reject
  // scheme-relative URLs and dangerous schemes. Today both throw in
  // `new URL()` because there's no base URL (so we land in the catch),
  // but pin the behaviour so a future refactor that passes a base URL
  // doesn't silently flip these from safe to unsafe.
  it('rejects scheme-relative URLs', () => {
    expect(isStripeHostedUrl('//billing.stripe.com/x', 'portal')).toBe(false);
    expect(isStripeHostedUrl('//checkout.stripe.com/x', 'checkout')).toBe(false);
  });

  it('rejects javascript: and data: schemes', () => {
    expect(isStripeHostedUrl('javascript:alert(1)', 'portal')).toBe(false);
    expect(isStripeHostedUrl('data:text/html,<script>alert(1)</script>', 'portal')).toBe(false);
  });
});
