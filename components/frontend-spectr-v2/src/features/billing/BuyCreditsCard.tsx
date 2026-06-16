import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { extractApiMessage } from '../../api/error-utils';
import { ApiError, fetcher } from '../../api/fetcher';
import type {
  CreateCheckoutSessionResponse,
  PlansResponse,
} from '../../api/types';
import { formatCents } from './format-price';
import { isStripeHostedUrl } from './stripe-url';
import s from './BuyCreditsCard.module.css';

// Story 2.3 / UX-DR32 — pack selector (5 or 10) + Stripe-hosted
// redirect. Prices source from GET /api/billing/plans so AR39 lint
// stays clean (no $ literals in components). Segmented-button pack
// selector mirrors story 2.2's cadence toggle — Radix RadioGroup
// would add a dep this codebase doesn't have today.

type PackSize = 5 | 10;

export function BuyCreditsCard() {
  const { data: plans, isLoading: plansLoading } = useQuery<PlansResponse>({
    queryKey: ['billing', 'plans'],
    queryFn: () =>
      fetcher<PlansResponse>({ url: '/billing/plans', method: 'GET' }),
    // Plans are quasi-static config; cache for the session.
    staleTime: 5 * 60_000,
  });

  const [selectedPack, setSelectedPack] = useState<PackSize>(5);
  const [pending, setPending] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const handleBuy = async () => {
    if (pending) return;
    setPending(true);
    setConfigError(null);
    try {
      const session = await fetcher<CreateCheckoutSessionResponse>({
        url: '/billing/checkout/credits',
        method: 'POST',
        data: { packSize: selectedPack },
      });
      if (!isStripeHostedUrl(session.url, 'checkout')) {
        toast.error(
          'Refusing to redirect: URL is not a Stripe checkout host.',
        );
        return;
      }
      window.location.assign(session.url);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: { code?: string; message?: string } };
        if (body?.error?.code === 'stripe_not_configured') {
          // Inline notice (not a toast) — same UX precedent as the
          // pricing page when Stripe creds are absent in dev.
          setConfigError('Stripe is not configured in this environment.');
          return;
        }
        toast.error(
          extractApiMessage(err.body) ?? 'Could not start checkout.',
        );
      } else {
        toast.error('Network error.');
      }
    } finally {
      setPending(false);
    }
  };

  if (plansLoading || !plans) {
    return (
      <section className={`card ${s.card}`}>
        <h2 className={s.title}>Buy credits</h2>
        <p className={s.body}>Loading prices…</p>
      </section>
    );
  }

  const pack5Label = `5 credits · ${formatCents(plans.creditPack5Cents, plans.currency)}`;
  const pack10Label = `10 credits · ${formatCents(plans.creditPack10Cents, plans.currency)}`;

  return (
    <section className={`card ${s.card}`}>
      <h2 className={s.title}>Buy credits</h2>
      <p className={s.body}>
        Credits never expire. One credit = one full analysis. Pay through
        Stripe — your card details never touch our servers.
      </p>

      <div
        role="radiogroup"
        aria-label="Credit pack size"
        className={s.packs}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selectedPack === 5}
          data-value="5"
          className={`${s.packOption} ${selectedPack === 5 ? s.packSelected : ''}`}
          onClick={() => setSelectedPack(5)}
        >
          <span className={s.radio} aria-hidden="true">
            {selectedPack === 5 && <span className={s.radioDot} />}
          </span>
          <span className={s.packLabel}>{pack5Label}</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={selectedPack === 10}
          data-value="10"
          className={`${s.packOption} ${selectedPack === 10 ? s.packSelected : ''}`}
          onClick={() => setSelectedPack(10)}
        >
          <span className={s.radio} aria-hidden="true">
            {selectedPack === 10 && <span className={s.radioDot} />}
          </span>
          <span className={s.packLabel}>{pack10Label}</span>
        </button>
      </div>

      <div className={s.actions}>
        <button
          type="button"
          className="btn primary"
          onClick={handleBuy}
          disabled={pending}
        >
          {pending ? 'Opening…' : `Buy ${selectedPack} credits`}
        </button>
      </div>

      {configError !== null && (
        <p className={s.configError} role="status">
          {configError}
        </p>
      )}
    </section>
  );
}
