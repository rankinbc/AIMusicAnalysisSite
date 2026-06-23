import type { BillingSummaryResponse } from '../../api/types';
import s from './DunningBanner.module.css';

// Story 2.9 — amber dunning banner (UX-DR33). Renders ONLY while the
// subscription is in the `past_due` grace window; returns null otherwise,
// so callers can mount it unconditionally (billing page + app shell) with
// zero cost in the healthy path. Access itself is NOT gated here — Stripe
// keeps Pro entitled during dunning (EntitlementService); this is a
// notice + a path to the fix.

interface DunningBannerProps {
  summary: BillingSummaryResponse;
  /** Opens the Stripe Customer Portal (see useBillingPortal). */
  onUpdatePayment: () => void;
  /** True while the portal session is being created (disables the CTA). */
  pending?: boolean;
}

function formatRetryWeekday(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Format in UTC to match the canonical retry instant. Stripe's
  // next_payment_attempt lands at midnight UTC; formatting in the browser's
  // local zone would render the PREVIOUS weekday in negative-UTC-offset
  // locales (e.g. a Friday retry shows "Thursday" in US Pacific).
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(d);
}

export function DunningBanner({
  summary,
  onUpdatePayment,
  pending = false,
}: DunningBannerProps) {
  if (summary.status !== 'past_due') return null;

  const day = summary.retryAt ? formatRetryWeekday(summary.retryAt) : null;
  // Verbatim UX-DR33 grammar when we know the retry day; honest fallback
  // when Stripe hasn't reported a next attempt (e.g. retries exhausting).
  const message = day
    ? `Payment failed — retrying ${day} · update card`
    : 'Payment failed — update your card to keep Pro';

  return (
    <div className={s.banner} role="status" aria-label="Payment past due">
      <span className={s.dot} aria-hidden="true" />
      <p className={s.message}>{message}</p>
      <button
        type="button"
        className="btn sm"
        onClick={onUpdatePayment}
        disabled={pending}
      >
        {pending ? 'Opening…' : 'Update card'}
      </button>
    </div>
  );
}
