// Story 2.2 — shared validator for redirecting to Stripe-hosted URLs.
// UX-spec line 357 mandates "Stripe-hosted only" — even with a clean BFF
// path, defence-in-depth means we never redirect to an arbitrary URL
// from a response body. The Stripe SDK only ever returns its own hosts;
// any other value is a bug or a compromise.

export type StripeUrlKind = 'checkout' | 'portal';

const ALLOWED_HOSTS: Record<StripeUrlKind, string> = {
  checkout: 'checkout.stripe.com',
  portal: 'billing.stripe.com',
};

export function isStripeHostedUrl(raw: string, kind: StripeUrlKind): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === ALLOWED_HOSTS[kind];
  } catch {
    return false;
  }
}
