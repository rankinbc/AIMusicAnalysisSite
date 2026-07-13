// Story 12.8 (AC2) — the problem-report prefill contract.
import { describe, expect, it } from 'vitest';
import { buildProblemReportMailto, jobIdFromPath } from '../report-problem';

describe('jobIdFromPath', () => {
  it('extracts the jobId from a results route', () => {
    expect(jobIdFromPath('/songs/abc/results/0b0e9436-1111-2222-3333-444455556666'))
      .toBe('0b0e9436-1111-2222-3333-444455556666');
  });
  it('returns null off the results route', () => {
    expect(jobIdFromPath('/library')).toBeNull();
    expect(jobIdFromPath('/songs/abc')).toBeNull();
  });
});

describe('buildProblemReportMailto', () => {
  it('carries url, jobId and traceId in an encoded body', () => {
    const href = buildProblemReportMailto({
      email: 'support@example.com',
      url: 'https://app/songs/a/results/b?tab=coach',
      jobId: 'job-123',
      traceId: 'trace-456',
    });
    expect(href.startsWith('mailto:support@example.com?subject=')).toBe(true);
    const body = decodeURIComponent(href.split('&body=')[1]!);
    expect(body).toContain('page: https://app/songs/a/results/b?tab=coach');
    expect(body).toContain('job: job-123');
    expect(body).toContain('trace: trace-456');
  });

  it('omits absent context lines', () => {
    const body = decodeURIComponent(
      buildProblemReportMailto({ email: 'x@y.z', url: 'https://app/library' }).split('&body=')[1]!,
    );
    expect(body).not.toContain('job:');
    expect(body).not.toContain('trace:');
  });
});
