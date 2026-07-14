// Story 10.3 — PostHog (EU) behind a no-op-safe wrapper. Without
// VITE_POSTHOG_KEY every call is a silent no-op (dev, tests, self-hosters).
// Event set = the product-side KPI rows (PRD Measurable Outcomes); the
// DB/Stripe-derived rows are documented in the runbook mapping table, and
// Epic 6 owns the landing/funnel/k-factor events.
import posthog from 'posthog-js';

const KEY = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined;
let initialized = false;

export function initAnalytics(): void {
  if (!KEY || initialized) return;
  posthog.init(KEY, {
    api_host: 'https://eu.i.posthog.com',
    autocapture: false, // explicit events only — KPI table, not clickstream
    capture_pageview: true,
    persistence: 'localStorage',
  });
  initialized = true;
}

export function identifyUser(userId: string | null): void {
  if (!KEY || !initialized) return;
  if (userId) posthog.identify(userId);
  else posthog.reset();
}

type EventName =
  | 'upload_completed' // props: { als_attached, stems_attached, reference_attached }
  | 'report_viewed' // props: { job_id } — pairs with job timestamps for TTFI
  | 'coach_message_sent' // KPI: coach follow-up rate
  | 'verdict_feedback' // props: { feedback } — helpful/wrong/unclear
  // ── Story 6.5 — the acquisition funnel edges. PII-FREE props only
  //    (job_id is a random GUID; NEVER email/audio/token-as-identity). ──
  | 'landing_viewed' // top of funnel — the public landing page mounted
  | 'analyze_started' // props: { job_id } — anon upload dispatched (TTFI start)
  | 'analyze_completed' // props: { job_id } — anon report rendered (TTFI end)
  | 'report_claimed' // props: { job_id, source? } — device→user register-from-/analyze
  | 'pricing_viewed' // pricing page mounted
  | 'checkout_started' // props: { cadence } — Stripe checkout redirect initiated
  | 'resume_shown' // props: { status } — a returning-visitor resume card resolved
  | 'resume_clicked'; // props: { status } — resume card opened

export function capture(event: EventName, props?: Record<string, unknown>): void {
  if (!KEY || !initialized) return;
  posthog.capture(event, props);
}
