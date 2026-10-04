// Story 10.3 — PostHog (EU) behind a no-op-safe wrapper. Without
// VITE_POSTHOG_KEY nothing is even imported (dev, tests, self-hosters).
// Event set = the product-side KPI rows (PRD Measurable Outcomes); the
// DB/Stripe-derived rows are documented in the runbook mapping table, and
// Epic 6 owns the landing/funnel/k-factor events.
//
// P7 (bundle diet) — posthog-js (~220 KB raw) is a dynamic import made only
// when a key is present, so a keyless build never pays for it. Calls made
// before the SDK finishes loading are queued (bounded) and flushed in order
// once it arrives; an init failure (blocked storage, adblock) drops the
// queue silently rather than throwing.
import type { Attribution } from './attribution';
import { sendEvent } from './first-party-events';

type PostHog = typeof import('posthog-js').default;

const KEY = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined;
// F1b — the first-party sink (our own /api/events) is the primary analytics
// path and needs no key. Off under vitest so unit tests of the hundred
// components that call capture() never touch the network.
const FIRST_PARTY = import.meta.env.MODE !== 'test';
const MAX_QUEUE = 50;
let client: PostHog | null = null;
let loading = false;
let dead = false;
const queue: Array<(p: PostHog) => void> = [];

function run(fn: (p: PostHog) => void): void {
  if (!KEY || dead) return;
  if (client) fn(client);
  else if (queue.length < MAX_QUEUE) queue.push(fn);
}

export function initAnalytics(): void {
  if (!KEY || loading || client || dead) return;
  loading = true;
  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: 'https://eu.i.posthog.com',
        autocapture: false, // explicit events only — KPI table, not clickstream
        capture_pageview: true,
        persistence: 'localStorage',
      });
      client = posthog;
      for (const fn of queue.splice(0)) fn(posthog);
    })
    .catch(() => {
      dead = true;
      queue.length = 0;
    });
}

export function identifyUser(userId: string | null): void {
  run((p) => {
    if (userId) p.identify(userId);
    else p.reset();
  });
}

/** F1 — first-touch attribution as PostHog super properties, so every event
 *  carries the channel. `register_once`: a later visit never overwrites it. */
export function registerAttribution(a: Attribution): void {
  const props: Record<string, string> = {};
  if (a.source) props['spectr_source'] = a.source;
  if (a.medium) props['spectr_medium'] = a.medium;
  if (a.campaign) props['spectr_campaign'] = a.campaign;
  if (a.referrer) props['spectr_referrer'] = a.referrer;
  if (Object.keys(props).length === 0) return;
  run((p) => {
    p.register_once(props);
  });
}

type EventName =
  | 'page_viewed' // F1b — a route resolved with a new path (main.tsx); path rides the envelope
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
  | 'resume_clicked' // props: { status } — resume card opened
  // ── D9 (guest demo sandbox) — the /demo funnel. `demo_cta_clicked` is
  //    emitted by the linking surfaces (landing/pricing), not /demo itself. ──
  | 'demo_cta_clicked'
  | 'demo_started' // props: { resumed, surface }
  | 'demo_start_failed' // props: { code }
  | 'demo_signup_clicked' // props: { source }
  | 'demo_guest_restricted' // props: { reason }
  // Task P4 — the "How it's built" engineering page mounted.
  | 'engineering_viewed'
  // ── Task G5 — /analyze uploads land the visitor as a guest, no teaser. ──
  | 'guest_upload_started' // props: { job_id } — the guest's /analyze upload dispatched
  | 'guest_converted' // a guest submitted the register form (POST /auth/guest/convert)
  // ── Task G6 — the coach brief's account-creation CTA. ──
  | 'guest_signup_clicked' // the "Create free account" link under the brief was clicked
  | 'signup_cta_clicked' // props: { source } — a public-page "Sign up" button
  // ── F1 — the funnel edges that were missing. `signup_completed` fires on
  //    the "check your inbox" branch too (verify-before-sign-in makes that
  //    the normal outcome, so `guest_converted` almost never fires). ──
  | 'signup_completed' // props: { path: 'direct' | 'guest', pending }
  | 'email_verified' // props: { session } — the emailed link was consumed
  | 'purchase_completed'; // props: { product } — /billing/success confirmed (once per checkout)

export function capture(event: EventName, props?: Record<string, unknown>): void {
  if (FIRST_PARTY) sendEvent(event, props);
  run((p) => {
    p.capture(event, props);
  });
}
