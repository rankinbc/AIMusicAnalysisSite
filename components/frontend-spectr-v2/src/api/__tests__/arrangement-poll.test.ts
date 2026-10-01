// Bug B — the arrangement step stuck on "running": structure detection
// settles minutes after the analysis completes (allin1 ran 8 min on CPU here,
// then hit its memory limit → 'unavailable'), and the old 10-minute poll cap
// gave up first. The results query must keep polling while phase 7 is
// pending and stop as soon as it settles.
import { describe, expect, it } from 'vitest';

import {
  ARRANGEMENT_FAST_POLL_MS,
  ARRANGEMENT_MAX_POLLS,
  ARRANGEMENT_SLOW_POLL_MS,
  arrangementPollInterval,
} from '../hooks';
import { ApiError } from '../fetcher';
import type { JobResultsDto } from '../types';

const results = (arrangement_status: string) =>
  ({ finalJson: { phases: [{ phase: 7, status: 'ok', data: { arrangement_status } }] } }) as unknown as JobResultsDto;

const q = (data: JobResultsDto | undefined, dataUpdateCount = 1, error: unknown = null, errorUpdateCount = 0) => ({
  state: { data, error, dataUpdateCount, errorUpdateCount },
});

describe('arrangementPollInterval', () => {
  it('polls while the arrangement is pending — fast first, then relaxed', () => {
    expect(arrangementPollInterval(q(results('pending'), 1))).toBe(ARRANGEMENT_FAST_POLL_MS);
    expect(arrangementPollInterval(q(results('pending'), 40))).toBe(ARRANGEMENT_SLOW_POLL_MS);
  });

  it('keeps polling well past the old 10-minute cap (75 × 8 s)', () => {
    expect(arrangementPollInterval(q(results('pending'), 76))).not.toBe(false);
    const totalMs = 30 * ARRANGEMENT_FAST_POLL_MS + (ARRANGEMENT_MAX_POLLS - 30) * ARRANGEMENT_SLOW_POLL_MS;
    expect(totalMs).toBeGreaterThan(30 * 60_000);
  });

  it('stops once it settles: unavailable, failed or scored', () => {
    expect(arrangementPollInterval(q(results('unavailable')))).toBe(false);
    expect(arrangementPollInterval(q(results('failed')))).toBe(false);
    expect(arrangementPollInterval(q(results('scored')))).toBe(false);
  });

  it('stops at the backstop, on 404 and after repeated errors', () => {
    expect(arrangementPollInterval(q(results('pending'), ARRANGEMENT_MAX_POLLS))).toBe(false);
    expect(arrangementPollInterval(q(undefined, 0, new ApiError(404, null), 1))).toBe(false);
    expect(arrangementPollInterval(q(results('pending'), 3, new Error('x'), 3))).toBe(false);
  });
});
