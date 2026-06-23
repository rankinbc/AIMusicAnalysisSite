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
