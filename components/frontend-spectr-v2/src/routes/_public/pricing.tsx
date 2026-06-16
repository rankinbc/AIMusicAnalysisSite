import { Link, createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { getAccessToken } from '../../api/fetcher';
import type {
  CreateCheckoutSessionResponse,
  PlansResponse,
} from '../../api/types';
import { Pill } from '../../ui/Pill';
import { formatCents } from '../../features/billing/format-price';
import s from './pricing.module.css';

// Story 2.1 / UX-DR + UX-spec line 318 — public pricing route. Display
// values come from GET /api/billing/plans so the no-price-literals lint
// (AR39) stays clean. Two CTAs on the Pro card: Monthly + Annual; both
// POST /api/billing/checkout/subscription and redirect to the hosted
// Stripe Checkout URL (UX-spec line 137 + line 357 — Stripe-hosted only).

export const Route = createFileRoute('/_public/pricing')({
  component: PricingPage,
});

function PricingPage() {
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [pending, setPending] = useState<'monthly' | 'annual' | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/billing/plans', { signal: ac.signal });
        if (res.ok) setPlans((await res.json()) as PlansResponse);
      } catch {
        /* best-effort — pricing page can still render with skeleton */
      }
    })();
    return () => ac.abort();
  }, []);

  const startCheckout = async (cadence: 'monthly' | 'annual') => {
    setPending(cadence);
    const token = getAccessToken();
    if (!token) {
      // Anonymous users hit /pricing too; bounce them to register first.
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
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        if (body?.error?.code === 'stripe_not_configured') {
          toast.error(
            'Stripe is not configured in this environment. Set the keys to test checkout.',
          );
        } else {
          toast.error(body?.error?.message ?? 'Could not start checkout.');
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

  return (
    <main className={s.shell}>
      <header className={s.header}>
        <span className="label">Plans &amp; pricing</span>
        <h1 className={s.title}>Honest billing. No asterisks.</h1>
        <p className={s.subtitle}>
          Pay monthly, annually, or per-release with credits.
          Reports stay yours forever — even after you cancel.
        </p>
      </header>

      <section className={s.grid}>
        <article className={`card ${s.planCard}`}>
          <div className={s.planHead}>
            <Pill>Free</Pill>
            <h2 className={s.planName}>Free</h2>
          </div>
          <p className={s.planLine}>3 analyses per month</p>
          <p className={s.planLine}>Core report + verdicts</p>
          <p className={s.planLine}>Limited coach follow-ups</p>
          <button type="button" className="btn ghost" disabled>
            Current plan
          </button>
        </article>

        <article className={`card ${s.planCard} ${s.planFeatured}`}>
          <div className={s.planHead}>
            <Pill tone="cyan">Pro</Pill>
            <h2 className={s.planName}>Pro</h2>
          </div>
          <p className={s.planLine}>Unlimited analyses</p>
          <p className={s.planLine}>Full coach + all specialists</p>
          <p className={s.planLine}>Stems + .als + reference library</p>
          <p className={s.planLine}>Tax calculated at checkout.</p>
          <div className={s.cadenceRow}>
            <button
              type="button"
              className="btn primary"
              disabled={pending !== null}
              onClick={() => startCheckout('monthly')}
            >
              {pending === 'monthly'
                ? 'Starting…'
                : plans
                  ? `Monthly ${formatCents(plans.proMonthlyCents, plans.currency)}`
                  : 'Monthly'}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={pending !== null}
              onClick={() => startCheckout('annual')}
            >
              {pending === 'annual'
                ? 'Starting…'
                : plans
                  ? `Annual ${formatCents(plans.proAnnualCents, plans.currency)}`
                  : 'Annual'}
            </button>
          </div>
        </article>

        <article className={`card ${s.planCard}`}>
          <div className={s.planHead}>
            <Pill tone="violet">Credits</Pill>
            <h2 className={s.planName}>Credits</h2>
          </div>
          <p className={s.planLine}>Pay per release cycle</p>
          <p className={s.planLine}>Packs of 5 or 10 — never expire</p>
          <button type="button" className="btn ghost" disabled>
            Coming soon
          </button>
        </article>
      </section>

      <footer className={s.footer}>
        <p className={s.fineprint}>
          Cancel anytime in two clicks. Your reports remain accessible after
          cancellation.
        </p>
        <p className={s.fineprint}>
          <Link to="/login">Sign in</Link> if you already have an account.
        </p>
      </footer>
    </main>
  );
}
