// @vitest-environment jsdom
/* Story 6.5 — assert the funnel edges CALL capture() (analytics is mocked, so
 * real PostHog is never hit). Covers the pure/render-reachable edges; the
 * AnalyzePage upload/claim transitions are async-network and are covered by
 * the anon-funnel Playwright spec + the wiring being straight-line. */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const capture = vi.fn();
vi.mock('../../../lib/analytics', () => ({ capture: (...a: unknown[]) => capture(...a) }));

import { ResumeCard } from '../ResumeCard';
import type { ResumeInfo } from '../useAnonAnalysis';

function resume(over: Partial<ResumeInfo> = {}): ResumeInfo {
  return { jobId: 'j1', status: 'complete', dispatchedAt: new Date().toISOString(), grade: 'C', ...over };
}

describe('funnel events (story 6.5)', () => {
  afterEach(() => capture.mockClear());

  it('landing mount fires landing_viewed', async () => {
    const { LandingPage } = await import('../../landing/LandingPage');
    render(<LandingPage />);
    expect(capture).toHaveBeenCalledWith('landing_viewed');
  });

  it('pricing mount fires pricing_viewed', async () => {
    const { PricingPage } = await import('../../../routes/pricing');
    render(<PricingPage />);
    expect(capture).toHaveBeenCalledWith('pricing_viewed');
  });

  it('resume card "Open" click invokes onOpen (→ resume_clicked in the slot)', () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(
      <ResumeCard resume={resume()} onOpen={onOpen} onDismiss={() => {}} />,
    );
    getByTestId('resume-open').click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
