/* Task P2 (public-surfaces-polish D7) — /pricing tells the truth in all
 * four states. routes/pricing.tsx is now a thin shell that imports this.
 * State shape mirrors what loadPublicPlans() can hand back: 'loading' until
 * it settles, 'failed' when it resolved null (network error, non-2xx, or a
 * response the server never sent creditsEnabled on), or the PlansResponse
 * itself once it arrives — the view then branches on creditsEnabled. */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { parseErrorBody } from '../../api/error-utils';
import { getAccessToken } from '../../api/fetcher';
import type { CreateCheckoutSessionResponse, PlansResponse } from '../../api/types';
import { capture } from '../../lib/analytics';
import { loadPublicPlans } from '../../lib/public-plans';
import { usePageMeta } from '../../lib/usePageMeta';
import { PricingLoadingView } from './PricingLoadingView';
import { PricingOffView } from './PricingOffView';
import { PricingPlansView } from './PricingPlansView';

type PricingState = 'loading' | 'failed' | PlansResponse;

// Exported for the 6.1 static-render tests (renders the loading state —
// effects don't run under renderToStaticMarkup, so no fetch fires).
export function PricingPage() {
  const [state, setState] = useState<PricingState>('loading');
  const [pending, setPending] = useState<'monthly' | 'annual' | null>(null);

  // Story 6.5 — pricing view (once per mount; no-op without a PostHog key).
  useEffect(() => { capture('pricing_viewed'); }, []);

  useEffect(() => {
    let alive = true;
    void loadPublicPlans().then((p) => {
      if (!alive) return;
      setState(p ?? 'failed');
    });
    return () => { alive = false; };
  }, []);

  const startCheckout = async (cadence: 'monthly' | 'annual') => {
    setPending(cadence);
    const token = getAccessToken();
    if (!token) {
      // Anonymous users hit /pricing too; bounce them to register first.
      // No checkout_started here — no Stripe redirect happens, so counting it
      // would inflate the free→paid edge with anon click-throughs (review).
      toast.info('Create an account to subscribe.');
      window.location.assign(`/register?next=${encodeURIComponent('/pricing')}`);
      setPending(null);
      return;
    }
    try {
      const res = await fetch('/api/billing/checkout/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cadence }),
      });
      if (!res.ok) {
        const parsed = parseErrorBody(await res.json().catch(() => null));
        if (parsed.code === 'stripe_not_configured') {
          toast.error(
            'Stripe is not configured in this environment. Set the keys to test checkout.',
          );
        } else {
          toast.error(parsed.message ?? 'Could not start checkout.');
        }
        return;
      }
      const data = (await res.json()) as CreateCheckoutSessionResponse;
      // review-fix P7 — origin validation. UX-spec line 357 mandates
      // Stripe-hosted only; if the BFF response somehow contained a
      // non-Stripe URL (compromise, MITM, or a future bug), we must
      // refuse to redirect rather than send the user to an attacker's
      // page. Stripe Checkout URLs are always on checkout.stripe.com.
      if (!isStripeCheckoutUrl(data.url)) {
        toast.error('Refusing to redirect: checkout URL is not a Stripe host.');
        return;
      }
      // 6.5 — fire ONLY when a real validated Stripe redirect is imminent.
      capture('checkout_started', { cadence });
      window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPending(null);
    }
  };

  function isStripeCheckoutUrl(raw: string): boolean {
    try {
      const u = new URL(raw);
      return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com';
    } catch {
      return false;
    }
  }

  usePageMeta(
    'Pricing — SPECTR',
    'Free, Pro, and per-release credits. Honest billing, no asterisks — reports stay yours forever, even after you cancel.',
  );

  if (state === 'loading') return <PricingLoadingView failed={false} />;
  if (state === 'failed') return <PricingLoadingView failed={true} />;
  if (state.creditsEnabled === true) {
    return <PricingPlansView plans={state} pending={pending} onCheckout={startCheckout} />;
  }
  if (state.creditsEnabled === false) return <PricingOffView />;
  // creditsEnabled missing/null on an otherwise-successful response — unknown.
  return <PricingLoadingView failed={true} />;
}
