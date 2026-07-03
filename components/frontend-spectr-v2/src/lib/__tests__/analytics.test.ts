// Story 10.3 — the analytics wrapper must be a safe no-op without a key
// (dev, CI, self-hosters): no throws, no posthog network calls.
import { describe, expect, it } from 'vitest';

import { capture, identifyUser, initAnalytics } from '../analytics';

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
    }).not.toThrow();
  });
});
