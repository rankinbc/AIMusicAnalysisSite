import { useState } from 'react';
import { toast } from 'sonner';

import { extractApiMessage } from '../../api/error-utils';
import { ApiError, fetcher } from '../../api/fetcher';
import type { CreatePortalSessionResponse } from '../../api/types';
import { isStripeHostedUrl } from './stripe-url';

// Story 2.9 — shared Stripe Customer Portal opener. Mirrors the inline
// flow in ActivePlanCard (billing.tsx) so the DunningBanner's "Update card"
// CTA and the billing page reach the same hosted portal. A full-page
// `assign` is safe here — there is no in-memory state to preserve (unlike
// the 2.7 upload resume). The URL is validated against the canonical
// Stripe billing host before navigation.
export function useBillingPortal() {
  const [pending, setPending] = useState(false);

  const open = async () => {
    if (pending) return;
    setPending(true);
    try {
      const session = await fetcher<CreatePortalSessionResponse>({
        url: '/billing/portal',
        method: 'POST',
      });
      if (!isStripeHostedUrl(session.url, 'portal')) {
        toast.error('Refusing to redirect: URL is not a Stripe billing host.');
        return;
      }
      window.location.assign(session.url);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? extractApiMessage(err.body) ?? 'Could not open the portal.'
          : 'Network error.',
      );
    } finally {
      setPending(false);
    }
  };

  return { open, pending };
}
