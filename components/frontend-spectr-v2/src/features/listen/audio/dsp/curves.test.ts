import { describe, expect, it } from 'vitest';
import { makeSatCurve } from './curves';

describe('makeSatCurve', () => {
  it('returns a 1024-sample curve spanning -1..1 at the ends', () => {
    const c = makeSatCurve(0);
    expect(c).toHaveLength(1024);
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[1023]).toBeCloseTo(1, 5);
  });

  it('is near-linear at drive 0 (midpoint ~= 0)', () => {
    const c = makeSatCurve(0);
    expect(c[512]).toBeCloseTo(0, 2);
  });

  it('compresses toward the rails as drive rises', () => {
    const low = makeSatCurve(0);
    const high = makeSatCurve(1);
    const idx = 700; // x > 0
    expect(high[idx]).toBeGreaterThan(low[idx]);
  });
});

const CURVES = ['tanh', 'softclip', 'hardclip', 'arctan', 'sinefold', 'tube'] as const;

describe('makeSatCurve — all curve shapes', () => {
  it.each(CURVES)('%s: 1024 samples bounded to [-1,1], ~0 at center', (curve) => {
    const c = makeSatCurve(0.6, curve, 0);
    expect(c).toHaveLength(1024);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
    // 511/512 straddle x=0; their mean cancels to ~0 for an odd curve.
    expect((c[511] + c[512]) / 2).toBeCloseTo(0, 5);
  });

  it.each(CURVES)('%s: odd-symmetric when asymmetry is 0', (curve) => {
    const c = makeSatCurve(0.7, curve, 0);
    for (const i of [100, 300, 480]) {
      expect(c[i] + c[1023 - i]).toBeCloseTo(0, 4);
    }
  });

  it('asymmetry breaks odd symmetry (tanh)', () => {
    const c = makeSatCurve(0.7, 'tanh', 0.6);
    expect(c[800] + c[1023 - 800]).not.toBeCloseTo(0, 2);
  });

  it('back-compat: makeSatCurve(d) equals makeSatCurve(d, tanh, 0)', () => {
    expect(Array.from(makeSatCurve(0.5))).toEqual(Array.from(makeSatCurve(0.5, 'tanh', 0)));
  });

  it('drive steepens the curve at the center (tanh)', () => {
    const slope = (c: Float32Array) => c[512] - c[511];
    expect(slope(makeSatCurve(0.9, 'tanh', 0))).toBeGreaterThan(
      slope(makeSatCurve(0.1, 'tanh', 0)),
    );
  });
});
