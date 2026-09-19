// The BFF sends `latestResult.score` as a float on a 0–100 scale; the app shows
// scores as whole numbers (fmtScore). The song console must do the same, and a
// delta must agree with the two numbers printed next to it.
import { describe, expect, it } from 'vitest';

import type { VersionDto } from '../../../api/types';
import { METRICS, displayScore, metricDelta, trendSummary } from '../song-helpers';

function version(n: number, score: number | null): VersionDto {
  return {
    id: `v${n}`,
    versionNumber: n,
    latestResult: score == null ? null : { score },
  } as unknown as VersionDto;
}

describe('song console — score display', () => {
  it('displayScore rounds a float score to a whole number', () => {
    expect(displayScore(5.249299605687459)).toBe(5);
    expect(displayScore(41.5)).toBe(42);
    expect(displayScore(null)).toBeNull();
    expect(displayScore(undefined)).toBeNull();
  });

  it('trendSummary reports the change between the DISPLAYED scores, never a raw float', () => {
    expect(trendSummary([version(1, 41.2), version(2, 47.9)])).toBe('+7 pts · v1→v2');
    expect(trendSummary([version(1, 60.4), version(2, 52.6)])).toBe('-7 pts · v1→v2');
    // 4.56 → 5.25 both display as "5": the summary must not claim +0.6869… or +1.
    expect(trendSummary([version(1, 4.562394817670186), version(2, 5.249299605687459)])).toBe(
      '±0 pts · v1→v2',
    );
    expect(trendSummary([version(1, 50)])).toBe('');
  });

  it('metricDelta agrees with the two values it prints', () => {
    const mix = METRICS.find((m) => m.dec === 0);
    if (!mix) throw new Error('expected a whole-number metric in METRICS');
    const d = metricDelta(5.249299605687459, 4.562394817670186, mix);
    expect(d.aStr.startsWith('5')).toBe(true);
    expect(d.bStr.startsWith('5')).toBe(true);
    expect(d.deltaStr).toBe('±0');

    const oneDec = METRICS.find((m) => m.dec === 1);
    if (!oneDec) throw new Error('expected a one-decimal metric in METRICS');
    // -11.94 and -10.76 print as -11.9 / -10.8 → the delta must read -1.1, not -1.2.
    expect(metricDelta(-11.94, -10.76, oneDec).deltaStr).toBe('-1.1');
  });
});
