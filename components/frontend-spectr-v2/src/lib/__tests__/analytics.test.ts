// Story 10.3 — the analytics wrapper must be a safe no-op without a key
// (dev, CI, self-hosters): no throws, no posthog network calls.
import { describe, expect, it } from 'vitest';

import { capture, identifyUser, initAnalytics, registerAttribution } from '../analytics';

describe('analytics (no VITE_POSTHOG_KEY)', () => {
  it('every call no-ops without throwing', () => {
    expect(() => {
      initAnalytics();
      identifyUser('user-1');
      identifyUser(null);
      capture('report_viewed', { job_id: 'j1' });
      capture('upload_completed');
      capture('coach_message_sent');
      capture('verdict_feedback', { feedback: 'helpful' });
      // Story 6.5 — the funnel events are equally no-op-safe without a key.
      capture('landing_viewed');
      capture('analyze_started', { job_id: 'j1' });
      capture('analyze_completed', { job_id: 'j1' });
      capture('report_claimed', { job_id: 'j1', source: 'campaign-abc' });
      capture('pricing_viewed');
      capture('checkout_started', { cadence: 'monthly' });
      capture('resume_shown', { status: 'complete' });
      capture('resume_clicked', { status: 'complete' });
      // F1 — the sign-up / purchase edges and the attribution super props.
      capture('signup_completed', { path: 'direct', pending: true });
      capture('email_verified', { session: true });
      capture('purchase_completed', { product: 'credits' });
      registerAttribution({ source: 'youtube', medium: 'video' });
      registerAttribution({});
    }).not.toThrow();
  });
});
