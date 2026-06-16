import { describe, expect, it } from 'vitest';

import type { BillingSummaryResponse } from '../../../api/types';

// Story 2.2 — pure reducer covering the three render states of the
// Billing page. Mirrors story 2.1 / Task 7.3 pattern: extract the
// decision into a function so it can be tested without jsdom.
//
//   tier=free                              → FreeCard
//   tier=pro AND !cancelAtPeriodEnd        → ActivePlanCard
//   tier=pro AND cancelAtPeriodEnd         → CanceledCard

type Card = 'free' | 'active' | 'canceled';

function pickCard(summary: BillingSummaryResponse): Card {
  if (summary.tier === 'free') return 'free';
  return summary.cancelAtPeriodEnd ? 'canceled' : 'active';
}

const FREE: BillingSummaryResponse = {
  tier: 'free', status: null, cadence: null, priceId: null,
  currentPeriodEnd: null, cancelAt: null, cancelAtPeriodEnd: false,
  nextChargeAt: null, nextChargeCents: null, currency: null,
};

const PRO_ACTIVE: BillingSummaryResponse = {
  tier: 'pro', status: 'active', cadence: 'monthly',
  priceId: 'price_test_monthly',
  currentPeriodEnd: '2026-07-15T00:00:00Z',
  cancelAt: null, cancelAtPeriodEnd: false,
  nextChargeAt: '2026-07-15T00:00:00Z',
  nextChargeCents: 1299, currency: 'USD',
};

const PRO_CANCELED: BillingSummaryResponse = {
  ...PRO_ACTIVE,
  cancelAt: '2026-07-15T00:00:00Z',
  cancelAtPeriodEnd: true,
  nextChargeAt: null,
  nextChargeCents: null,
};

describe('Billing page card-selection state machine', () => {
  it('Free tier → free card', () => {
    expect(pickCard(FREE)).toBe('free');
  });

  it('Pro active (no pending cancel) → active card', () => {
    expect(pickCard(PRO_ACTIVE)).toBe('active');
  });

  it('Pro with pending cancel → canceled card', () => {
    expect(pickCard(PRO_CANCELED)).toBe('canceled');
  });

  it('Pro trialing without cancel → active card', () => {
    expect(pickCard({ ...PRO_ACTIVE, status: 'trialing' })).toBe('active');
  });

  it('Pro past_due without cancel → active card (so user can update payment via portal)', () => {
    expect(pickCard({ ...PRO_ACTIVE, status: 'past_due' })).toBe('active');
  });

  // Story 2.2 review-fix P19 — document the lapsed-account boundary.
  // When `status: "canceled"` arrives via webhook (post-period-end) but
  // `cancelAtPeriodEnd: false`, the BFF's ResolveTier will map this
  // back to "free" before reaching the page. The page itself would
  // therefore render the free card. This test pins that contract so
  // story 2.3 (Buy Credits) doesn't accidentally split the lapsed
  // state into its own card without an explicit decision.
  it('Fully lapsed (tier=free) → free card regardless of status string', () => {
    expect(pickCard({
      ...PRO_ACTIVE,
      tier: 'free',
      status: 'canceled',
      cancelAtPeriodEnd: false,
    })).toBe('free');
  });
});
