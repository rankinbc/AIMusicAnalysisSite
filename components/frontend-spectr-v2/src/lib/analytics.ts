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
type PostHog = typeof import('posthog-js').default;

const KEY = import.meta.env['VITE_POSTHOG_KEY'] as string | undefined;
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
  run((p) => {
    p.capture(event, props);
  });
}
