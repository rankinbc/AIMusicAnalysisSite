import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { extractApiMessage } from '../../api/error-utils';
import { ApiError, fetcher } from '../../api/fetcher';
import type { CreateCheckoutSessionResponse, EntitlementsDto } from '../../api/types';
import { isStripeHostedUrl } from './stripe-url';

// Story 2.7 / D1 (popup + poll) — drives Stripe Checkout WITHOUT a top-level
// navigation, so the caller's in-memory upload File survives (UX-DR30 "work
// never lost"). The popup is opened synchronously inside the click gesture
// (otherwise browsers block it), then pointed at the hosted Stripe URL once
// the BFF returns the session. We poll /me/entitlements until the user can
// analyze again (tier flips to pro/credits, or analyses free up), then fire
// `onUpgraded` so the caller can resume the original action.

export type CheckoutKind =
  | { type: 'subscription'; cadence: 'monthly' | 'annual' }
  | { type: 'credits'; packSize: 5 | 10 };

type PendingLabel = 'monthly' | 'annual' | 'credits' | null;

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 12; // ~60s, matching story 2.1's tier-flip wait

export function useUpgradeCheckout(onUpgraded?: () => void) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingLabel>(null);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);
  const onUpgradedRef = useRef(onUpgraded);

  useEffect(() => {
    onUpgradedRef.current = onUpgraded;
  }, [onUpgraded]);

  useEffect(
    () => () => {
      cancelled.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const poll = useCallback(() => {
    let attempts = 0;
    const tick = async () => {
      if (cancelled.current) return;
      attempts += 1;
      try {
        const ent = await fetcher<EntitlementsDto>({ url: '/me/entitlements', method: 'GET' });
        if (cancelled.current) return;
        const canAnalyze = ent.tier !== 'free' || (ent.analysesRemaining ?? 1) > 0;
        if (canAnalyze) {
          void qc.invalidateQueries({ queryKey: ['me', 'entitlements'] });
          void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
          setPending(null);
          onUpgradedRef.current?.();
          return;
        }
      } catch {
        /* transient — keep polling until the budget is spent */
      }
      if (attempts >= MAX_POLLS) {
        toast.info('Payment received — your plan may take a moment to update. Refresh if needed.');
        setPending(null);
        return;
      }
      timer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    timer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }, [qc]);

  const start = useCallback(
    async (kind: CheckoutKind) => {
      if (pending) return;
      // Synchronous open inside the gesture → not popup-blocked.
      const popup = window.open('', 'spectr-checkout', 'width=480,height=760');
      setPending(kind.type === 'credits' ? 'credits' : kind.cadence);
      try {
        const session = await fetcher<CreateCheckoutSessionResponse>(
          kind.type === 'subscription'
            ? {
                url: '/billing/checkout/subscription',
                method: 'POST',
                data: { cadence: kind.cadence },
              }
            : {
                url: '/billing/checkout/credits',
                method: 'POST',
                data: { packSize: kind.packSize },
              },
        );
        if (!isStripeHostedUrl(session.url, 'checkout')) {
          popup?.close();
          toast.error('Refusing to redirect: URL is not a Stripe checkout host.');
          setPending(null);
          return;
        }
        if (popup && !popup.closed) {
          popup.location.href = session.url;
        } else {
          // Popup blocked: fall back to full-page redirect. The in-memory File
          // is then lost, but checkout still completes (degraded resume).
          window.location.assign(session.url);
          return;
        }
        poll();
      } catch (err) {
        popup?.close();
        if (err instanceof ApiError) {
          const body = err.body as { error?: { code?: string } } | undefined;
          if (body?.error?.code === 'stripe_not_configured') {
            toast.error('Stripe is not configured in this environment.');
          } else {
            toast.error(extractApiMessage(err.body) ?? 'Could not start checkout.');
          }
        } else {
          toast.error('Network error.');
        }
        setPending(null);
      }
    },
    [pending, poll],
  );

  return { start, pending };
}
