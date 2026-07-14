// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { ResumeCard } from '../ResumeCard';
import { dismissResume, isResumeDismissed } from '../resume-dismissed';
import type { ResumeInfo } from '../useAnonAnalysis';

function resume(over: Partial<ResumeInfo> = {}): ResumeInfo {
  return {
    jobId: 'job-1',
    status: 'complete',
    // Old enough to read as a stable relative label ("today" for a fresh Date).
    dispatchedAt: new Date().toISOString(),
    grade: 'D',
    ...over,
  };
}

describe('ResumeCard (story 6.4 AC1/2)', () => {
  it('completed report: shows the grade chip, "report from {day}", and Open CTA to /analyze', () => {
    const html = renderToStaticMarkup(<ResumeCard resume={resume()} onDismiss={() => {}} />);
    expect(html).toContain('data-testid="resume-card"');
    expect(html).toContain('Your report from today is ready.');
    expect(html).toContain('Grade: D'); // GradePill aria-label
    expect(html).toContain('Open report');
    expect(html).toContain('href="/analyze"');
    expect(html).toContain('aria-label="Dismiss"');
  });

  it('still-running job: invites resuming progress, no grade chip', () => {
    const html = renderToStaticMarkup(
      <ResumeCard resume={resume({ status: 'processing', grade: null })} onDismiss={() => {}} />,
    );
    expect(html).toContain('still being analyzed');
    expect(html).toContain('Resume');
    expect(html).not.toContain('Grade:');
  });

  it('failed job: renders nothing', () => {
    const html = renderToStaticMarkup(
      <ResumeCard resume={resume({ status: 'failed' })} onDismiss={() => {}} />,
    );
    expect(html).toBe('');
  });

  it('unknown/future status: renders nothing (allowlist, not exclusion)', () => {
    const html = renderToStaticMarkup(
      <ResumeCard resume={resume({ status: 'some_future_state', grade: null })} onDismiss={() => {}} />,
    );
    expect(html).toBe('');
  });
});

describe('resume-dismissed (story 6.4 AC3)', () => {
  afterEach(() => window.localStorage.clear());

  it('remembers a dismissed jobId', () => {
    expect(isResumeDismissed('j1')).toBe(false);
    dismissResume('j1');
    expect(isResumeDismissed('j1')).toBe(true);
    expect(isResumeDismissed('j2')).toBe(false);
  });

  it('tolerates corrupt storage without throwing', () => {
    window.localStorage.setItem('spectr.resumeDismissed', '{not json');
    expect(isResumeDismissed('j1')).toBe(false);
    dismissResume('j1'); // overwrites the corrupt value
    expect(isResumeDismissed('j1')).toBe(true);
  });
});
