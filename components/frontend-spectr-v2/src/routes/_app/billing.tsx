import { Link, createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { extractApiMessage } from '../../api/error-utils';
import { ApiError, fetcher } from '../../api/fetcher';
import type { BillingSummaryResponse } from '../../api/types';
import { CancelDialog } from '../../features/billing/CancelDialog';
import { DunningBanner } from '../../features/billing/DunningBanner';
import { formatCents } from '../../features/billing/format-price';
import { useBillingPortal } from '../../features/billing/useBillingPortal';
import { Pill } from '../../ui/Pill';
import s from './billingPage.module.css';

// Story 2.2 — /_app/billing self-service page. Three states based on
// (tier, cancelAtPeriodEnd):
//   free               → empty card with CTA back to /pricing
//   pro + active       → PlanCard (next charge + cadence toggle + cancel)
//   pro + cancelPending → CanceledCard (end date + resubscribe)
//
// All mutations route through fetcher<T> (story 2.1 review patch P6).
// TanStack Query cache key: ["billing", "me"].

export const Route = createFileRoute('/_app/billing')({
  component: BillingPage,
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(d);
}

function BillingPage() {
  const qc = useQueryClient();
  const portal = useBillingPortal();
  const { data, isLoading } = useQuery<BillingSummaryResponse>({
    queryKey: ['billing', 'me'],
    queryFn: () =>
      fetcher<BillingSummaryResponse>({ url: '/billing/me', method: 'GET' }),
    // Story 2.2 review-fix P28 — billing state only changes via explicit
    // user actions (cancel/resub/cadence/portal) or webhook arrival.
    // Without staleTime, every tab focus (especially after returning
    // from the Stripe Portal) refires `GET /billing/me` and flickers
    // the UI. 30s is short enough that webhook lag is bounded.
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <main className={s.shell}>
        <header className={s.header}>
          <span className="label">Billing</span>
          <h1 className={s.title}>Loading…</h1>
        </header>
      </main>
    );
  }

  return (
    <main className={s.shell}>
      <header className={s.header}>
        <span className="label">Billing</span>
        <h1 className={s.title}>Your subscription</h1>
      </header>

      {/* Story 2.9 — dunning notice sits above the plan card so the fix
          action (the portal) is right next to the warning. Renders null
          unless status === 'past_due'. */}
      <DunningBanner
        summary={data}
        onUpdatePayment={portal.open}
        pending={portal.pending}
      />

      {data.tier === 'free' && <FreeCard />}
      {data.tier === 'pro' && !data.cancelAtPeriodEnd && (
        <ActivePlanCard
          summary={data}
          onMutated={(next) =>
            qc.setQueryData(['billing', 'me'], next)
          }
        />
      )}
      {data.tier === 'pro' && data.cancelAtPeriodEnd && (
        <CanceledCard
          summary={data}
          onMutated={(next) =>
            qc.setQueryData(['billing', 'me'], next)
          }
        />
      )}
    </main>
  );
}

function FreeCard() {
  return (
    <section className={`card ${s.card}`}>
      <div className={s.cardHead}>
        <Pill>Free</Pill>
        <h2 className={s.cardTitle}>You don&rsquo;t have an active subscription</h2>
      </div>
      <p className={s.body}>
        Get Pro for unlimited analyses, the full coach, every specialist, and
        stems / .als / reference library.
      </p>
      <div className={s.actions}>
        <Link to="/pricing" className="btn primary">
          See plans
        </Link>
      </div>
    </section>
  );
}

interface ActivePlanCardProps {
  summary: BillingSummaryResponse;
  onMutated: (next: BillingSummaryResponse) => void;
}

function ActivePlanCard({ summary, onMutated }: ActivePlanCardProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'cadence' | null>(null);
  // Reuse the shared portal opener (same flow as DunningBanner) instead of an
  // inline copy — one place owns the host-validation + redirect.
  const portal = useBillingPortal();
  const busy = pendingAction !== null || portal.pending;

  const otherCadence =
    summary.cadence === 'monthly' ? 'annual' : 'monthly';

  const handleChangeCadence = async () => {
    if (busy) return;
    setPendingAction('cadence');
    try {
      const next = await fetcher<BillingSummaryResponse>({
        url: '/billing/change-cadence',
        method: 'POST',
        data: { cadence: otherCadence },
      });
      toast.success(`Switched to ${otherCadence}. Stripe applied prorations.`);
      onMutated(next);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? extractApiMessage(err.body) ?? 'Could not change cadence.'
          : 'Network error.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <>
      <section className={`card ${s.card}`}>
        <div className={s.cardHead}>
          <Pill tone="cyan">Pro</Pill>
          <h2 className={s.cardTitle}>
            Pro {summary.cadence === 'monthly' ? 'Monthly' : 'Annual'}
          </h2>
        </div>

        <dl className={s.rows}>
          <div className={s.row}>
            <dt className={s.rowLabel}>Status</dt>
            <dd className={s.rowValue}>{summary.status}</dd>
          </div>
          {summary.nextChargeAt &&
            typeof summary.nextChargeCents === 'number' &&
            summary.currency && (
              <div className={s.row}>
                <dt className={s.rowLabel}>Next charge</dt>
                <dd className={s.rowValue}>
                  {formatCents(summary.nextChargeCents, summary.currency)} on{' '}
                  {formatDate(summary.nextChargeAt)}
                </dd>
              </div>
            )}
        </dl>

        <div className={s.actions}>
          <button
            type="button"
            className="btn"
            onClick={handleChangeCadence}
            disabled={busy || summary.cadence === 'unknown'}
          >
            {pendingAction === 'cadence'
              ? 'Switching…'
              : `Switch to ${otherCadence}`}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void portal.open()}
            disabled={busy}
          >
            {portal.pending ? 'Opening…' : 'Manage payment & invoices →'}
          </button>
          <button
            type="button"
            className={`btn ${s.cancelBtn}`}
            onClick={() => setCancelOpen(true)}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </section>

      <CancelDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirmed={(next) => {
          onMutated(next);
          toast.success('Subscription will cancel at the end of the period.');
        }}
      />
    </>
  );
}

interface CanceledCardProps {
  summary: BillingSummaryResponse;
  onMutated: (next: BillingSummaryResponse) => void;
}

function CanceledCard({ summary, onMutated }: CanceledCardProps) {
  const [pending, setPending] = useState(false);

  const handleResubscribe = async () => {
    setPending(true);
    try {
      const next = await fetcher<BillingSummaryResponse>({
        url: '/billing/resubscribe',
        method: 'POST',
      });
      onMutated(next);
      toast.success('Welcome back to Pro.');
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? extractApiMessage(err.body) ?? 'Could not resubscribe.'
          : 'Network error.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={`card ${s.card}`}>
      <div className={s.cardHead}>
        <Pill tone="orange">Canceled</Pill>
        <h2 className={s.cardTitle}>
          Pro access ends {summary.currentPeriodEnd && formatDate(summary.currentPeriodEnd)}
        </h2>
      </div>
      <p className={s.body}>Everything you made stays accessible forever.</p>
      <div className={s.actions}>
        <button
          type="button"
          className="btn primary"
          onClick={handleResubscribe}
          disabled={pending}
        >
          {pending ? 'Reactivating…' : 'Resubscribe'}
        </button>
      </div>
    </section>
  );
}

