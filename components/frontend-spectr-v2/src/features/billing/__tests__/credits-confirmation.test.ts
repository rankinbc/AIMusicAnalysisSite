import { describe, expect, it } from 'vitest';

import type { CreditLedgerEntryDto } from '../../../api/types';
import {
  PURCHASE_RECENCY_WINDOW_MS,
  checkoutCreditsLanded,
  creditsConfirmed,
  hasRecentPurchaseEntry,
} from '../credits-confirmation';

// Audit wave-3 (E8.4/E8.5) — the per-kind "did the credits purchase actually
// land" predicates, extracted pure so both the /billing/success poll and the
// popup-checkout poll are testable without timers (mirrors the story-2.1
// billing-success-state.test.ts pattern).

const NOW = Date.parse('2026-07-23T12:00:00Z');

function entry(over: Partial<CreditLedgerEntryDto> = {}): CreditLedgerEntryDto {
  return {
    id: 'e1',
    amount: 5,
    reason: 'purchase',
    reference: 'pi_1',
    createdAt: new Date(NOW - 60_000).toISOString(), // 1 min ago
    ...over,
  };
}

describe('hasRecentPurchaseEntry', () => {
  it('true for a purchase inside the 15-minute window', () => {
    expect(hasRecentPurchaseEntry({ entries: [entry()] }, NOW)).toBe(true);
  });

  it('false for an OLD purchase (outside the window)', () => {
    const old = entry({ createdAt: new Date(NOW - PURCHASE_RECENCY_WINDOW_MS - 1000).toISOString() });
    expect(hasRecentPurchaseEntry({ entries: [old] }, NOW)).toBe(false);
  });

  it('false when the newest entry is not a purchase (e.g. a spend after an old buy)', () => {
    const spend = entry({ reason: 'spend', amount: -1 });
    expect(hasRecentPurchaseEntry({ entries: [spend, entry()] }, NOW)).toBe(false);
  });

  it('false for an empty ledger', () => {
    expect(hasRecentPurchaseEntry({ entries: [] }, NOW)).toBe(false);
  });
});

describe('creditsConfirmed (/billing/success — E8.4)', () => {
  it('confirms when the balance rises past the first-poll baseline', () => {
    expect(creditsConfirmed({ balance: 5, entries: [] }, 0, NOW)).toBe(true);
  });

  it('does NOT confirm while the balance sits at the baseline with no fresh purchase', () => {
    expect(creditsConfirmed({ balance: 3, entries: [] }, 3, NOW)).toBe(false);
  });

  it('confirms via the recency fallback when the webhook landed before the first poll', () => {
    // baseline captured AFTER the webhook → balance never "rises"; the fresh
    // purchase row is the only signal.
    expect(creditsConfirmed({ balance: 5, entries: [entry()] }, 5, NOW)).toBe(true);
  });
});

describe('checkoutCreditsLanded (popup poll — the E8.5 regression)', () => {
  it('a PRO user buying credits does NOT land on the first poll — balance must rise', () => {
    // Old predicate (tier !== 'free') fired instantly for a pro user before
    // any payment. With a baseline, an unchanged balance is NOT landed —
    // even with an old purchase row in the ledger.
    const oldPurchase = entry({ createdAt: new Date(NOW - PURCHASE_RECENCY_WINDOW_MS - 1000).toISOString() });
    expect(checkoutCreditsLanded({ balance: 3, entries: [oldPurchase] }, 3, NOW)).toBe(false);
    // A RECENT unrelated purchase row must not shortcut the delta either —
    // with a baseline, the delta is the ONLY signal.
    expect(checkoutCreditsLanded({ balance: 3, entries: [entry()] }, 3, NOW)).toBe(false);
  });

  it('lands once the balance rises past the baseline', () => {
    expect(checkoutCreditsLanded({ balance: 8, entries: [entry()] }, 3, NOW)).toBe(true);
  });

  it('falls back to the recent-purchase heuristic only when the baseline fetch failed', () => {
    expect(checkoutCreditsLanded({ balance: 5, entries: [entry()] }, null, NOW)).toBe(true);
    const old = entry({ createdAt: new Date(NOW - PURCHASE_RECENCY_WINDOW_MS - 1000).toISOString() });
    expect(checkoutCreditsLanded({ balance: 5, entries: [old] }, null, NOW)).toBe(false);
  });
});
