import type { CreditsResponse } from '../../api/types';

// Audit wave-3 (E8.4/E8.5) — pure predicates deciding when a credits purchase
// has actually LANDED, from a GET /billing/credits snapshot. Two callers, two
// contracts:
//   - /billing/success (E8.4): baseline is captured from the FIRST poll, so
//     "balance rose" OR "the webhook landed before we ever polled" (a fresh
//     purchase ledger row) both count.
//   - useUpgradeCheckout (E8.5): the baseline is fetched BEFORE checkout
//     opens; when it exists the balance delta is the ONLY signal (a pro user
//     with an older purchase row must NOT false-positive on the first poll —
//     the E8.5 regression). The recency heuristic is only the fallback for a
//     failed baseline fetch.

/** The webhook-landed-before-first-poll window. A confirmation page heuristic —
 *  wide enough for slow webhooks, narrow enough not to claim last hour's pack. */
export const PURCHASE_RECENCY_WINDOW_MS = 15 * 60_000;

/** True when the newest ledger entry is a purchase created inside the recency
 *  window. The ledger is served newest-first (DESC). */
export function hasRecentPurchaseEntry(
  resp: Pick<CreditsResponse, 'entries'>,
  nowMs: number = Date.now(),
): boolean {
  const newest = resp.entries[0];
  if (!newest || newest.reason !== 'purchase') return false;
  const created = new Date(newest.createdAt).getTime();
  return Number.isFinite(created) && nowMs - created <= PURCHASE_RECENCY_WINDOW_MS;
}

/** /billing/success?product=credits — balance-delta primary, recency fallback
 *  covers the webhook-landed-before-first-poll case (OR semantics). */
export function creditsConfirmed(
  resp: Pick<CreditsResponse, 'balance' | 'entries'>,
  baselineBalance: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (baselineBalance != null && resp.balance > baselineBalance) return true;
  return hasRecentPurchaseEntry(resp, nowMs);
}

/** Popup-checkout poll — with a pre-checkout baseline the delta is the ONLY
 *  signal; without one (baseline fetch failed) fall back to recency. */
export function checkoutCreditsLanded(
  resp: Pick<CreditsResponse, 'balance' | 'entries'>,
  baselineBalance: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (baselineBalance != null) return resp.balance > baselineBalance;
  return hasRecentPurchaseEntry(resp, nowMs);
}
