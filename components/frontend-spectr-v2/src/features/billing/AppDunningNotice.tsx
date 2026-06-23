import { useQuery } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { BillingSummaryResponse } from '../../api/types';
import { DunningBanner } from './DunningBanner';
import { useBillingPortal } from './useBillingPortal';

// Story 2.9 — app-wide dunning notice mounted in the authed shell so a
// past_due subscription is unmissable on every page, not just /billing.
// Shares the ['billing','me'] query key (+ 30s staleTime) with the billing
// page, so TanStack Query dedupes — no extra fetch. Renders nothing (incl.
// the padded slot) unless the subscription is actually in dunning.

interface AppDunningNoticeProps {
  /** Wrapper class for the layout gutter; only applied when the banner shows. */
  className?: string;
}

export function AppDunningNotice({ className }: AppDunningNoticeProps) {
  const portal = useBillingPortal();
  const { data } = useQuery<BillingSummaryResponse>({
    queryKey: ['billing', 'me'],
    queryFn: () =>
      fetcher<BillingSummaryResponse>({ url: '/billing/me', method: 'GET' }),
    staleTime: 30_000,
  });

  if (data?.status !== 'past_due') return null;

  return (
    <div className={className}>
      <DunningBanner
        summary={data}
        onUpdatePayment={portal.open}
        pending={portal.pending}
      />
    </div>
  );
}
