/* F1 — `purchase_completed` fires at most once per checkout.
 *
 * Every Stripe hand-off (pricing page, buy-credits card, the in-app upgrade
 * popup) drops a marker first; /billing/success consumes it when the purchase
 * is confirmed. Without the marker a reload of the success page — which
 * re-polls and re-confirms — would count the same purchase again.
 *
 * localStorage, not sessionStorage: the upgrade popup is a separate window,
 * and its /billing/success must see a marker the opener wrote. A 2 h TTL
 * keeps an abandoned checkout from crediting a much later, unrelated visit.
 * Best-effort analytics only — the Stripe webhook is the revenue record. */
import { capture } from './analytics';

export type CheckoutProduct = 'subscription' | 'credits';

const KEY = 'spectr_checkout_pending';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function markCheckoutPending(product: CheckoutProduct): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ product, at: Date.now() }));
  } catch { /* private mode — the event is simply not counted */ }
}

/** Call when /billing/success has CONFIRMED the purchase. */
export function capturePurchaseCompleted(product: CheckoutProduct): void {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    window.localStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { at?: unknown };
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) return;
    capture('purchase_completed', { product });
  } catch { /* malformed or storage blocked */ }
}
