import { describe, expect, it } from 'vitest';

import { refitGainBands, DEFAULT_TOLERANCE_DB } from './eqRefit';
import { bandResponseDb, logFreqs } from './eqResponse';
import type { EqBand } from './data';

const peak = (freq: number, gainDb: number, q = 1): EqBand => ({
  type: 'peaking', freq, gainDb, q, enabled: true,
});

const GRID = logFreqs(200); // finer than the fitter's own grid — no free pass

function curve(bands: EqBand[]): number[] {
  return GRID.map((f) => bands.reduce((db, b) => db + bandResponseDb(b, f), 0));
}

function worstGap(a: EqBand[], b: EqBand[]): number {
  const ca = curve(a);
  const cb = curve(b);
  return Math.max(...ca.map((v, i) => Math.abs(v - cb[i]!)));
}

describe('refitGainBands', () => {
  it('matches the worker refit band for band', () => {
    // Parity pin against components/worker/app/solve_lib/eq_refit.py. If this
    // fails, the rack the user auditions and the plan they apply have diverged
    // — one mirror changed without the other. Same assertion lives in
    // tests/solve/test_eq_refit.py.
    const out = refitGainBands([
      peak(30, -2.5, 1.1), peak(40, -2.0, 1.2), peak(55, -1.5, 1.0),
      peak(110, -2.2, 1.3), peak(180, -1.8, 1.1), peak(300, -2.6, 1.2),
      peak(350, -1.4, 1.4),
    ]);
    expect([out.before, out.after]).toEqual([7, 3]);
    expect(out.maxDeviationDb).toBeCloseTo(0.284, 2);
    expect(out.bands.map((b) => [b.freq, b.gainDb, b.q])).toEqual([
      [36.6, -4.55, 0.83],
      [162.1, -3.61, 0.54],
      [328, -2.62, 1.75],
    ]);
  });

  it('collapses a crowded low end to far fewer bands at the same curve', () => {
    // The shape the merge actually produces on a bass-heavy master: seven
    // clusters spread across two octaves that are really a few broad moves.
    const original = [
      peak(30, -2.5, 1.1), peak(40, -2.0, 1.2), peak(55, -1.5, 1.0),
      peak(110, -2.2, 1.3), peak(180, -1.8, 1.1), peak(300, -2.6, 1.2),
      peak(350, -1.4, 1.4),
    ];
    const out = refitGainBands(original);

    expect(out.after).toBeLessThan(out.before);
    expect(out.maxDeviationDb).toBeLessThanOrEqual(DEFAULT_TOLERANCE_DB);
    // Verified independently on a finer grid than the fitter optimised against.
    expect(worstGap(original, out.bands)).toBeLessThanOrEqual(DEFAULT_TOLERANCE_DB * 1.5);
  });

  it('recognises two overlapping cuts as one move', () => {
    const original = [peak(300, -2, 1), peak(330, -2, 1)];
    const out = refitGainBands(original);
    expect(out.after).toBe(1);
    expect(out.bands[0]!.freq).toBeGreaterThan(280);
    expect(out.bands[0]!.freq).toBeLessThan(360);
  });

  it('never merges genuinely separate problems', () => {
    // A low cut and an air boost are two instructions; no single band does both.
    const original = [peak(80, -4, 1.2), peak(9000, 3, 0.8)];
    const out = refitGainBands(original);
    expect(out.after).toBe(2);
    expect(worstGap(original, out.bands)).toBeLessThanOrEqual(DEFAULT_TOLERANCE_DB * 1.5);
  });

  it('passes high/low-pass filters through untouched', () => {
    const hp: EqBand = { type: 'highpass', freq: 30, gainDb: 0, q: 0.7, enabled: true };
    const out = refitGainBands([hp, peak(300, -2, 1), peak(330, -2, 1)]);
    expect(out.bands[0]).toEqual(hp);
    expect(out.bands.filter((b) => b.type === 'peaking')).toHaveLength(1);
  });

  it('returns the input unchanged when there is nothing to gain', () => {
    const one = [peak(300, -3, 1)];
    expect(refitGainBands(one).bands).toEqual(one);
    expect(refitGainBands([]).bands).toEqual([]);
  });

  it('respects the do-no-harm gain budget', () => {
    const original = [peak(200, -5, 0.8), peak(240, -5, 0.8), peak(280, -5, 0.8)];
    const out = refitGainBands(original);
    for (const b of out.bands) {
      expect(b.gainDb).toBeGreaterThanOrEqual(-9);
      expect(b.gainDb).toBeLessThanOrEqual(6);
    }
  });

  it('is deterministic', () => {
    const original = [peak(30, -2.5, 1.1), peak(40, -2, 1.2), peak(55, -1.5, 1)];
    expect(refitGainBands(original)).toEqual(refitGainBands(original));
  });
});
