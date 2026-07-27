import { describe, expect, it } from 'vitest';

import type { EqBand } from './data';
import { bandResponseDb, logFreqs, sumResponseDb } from './eqResponse';

const band = (over: Partial<EqBand>): EqBand =>
  ({ type: 'peaking', freq: 1000, gainDb: 0, q: 1.4, enabled: true, ...over });

describe('bandResponseDb', () => {
  it('peaking boost peaks at ~its gain at the center frequency', () => {
    const b = band({ gainDb: 6 });
    expect(bandResponseDb(b, 1000)).toBeCloseTo(6, 0);
    expect(Math.abs(bandResponseDb(b, 60))).toBeLessThan(0.7); // far away ≈ flat
  });

  it('a cut mirrors a boost', () => {
    expect(bandResponseDb(band({ gainDb: -6 }), 1000)).toBeCloseTo(-6, 0);
  });

  it('highpass attenuates below cutoff, passes above', () => {
    const hp = band({ type: 'highpass', freq: 100, q: 0.7 });
    expect(bandResponseDb(hp, 25)).toBeLessThan(-12);
    expect(Math.abs(bandResponseDb(hp, 4000))).toBeLessThan(0.5);
  });

  it('lowpass mirrors highpass', () => {
    const lp = band({ type: 'lowpass', freq: 5000, q: 0.7 });
    expect(bandResponseDb(lp, 18000)).toBeLessThan(-8);
    expect(Math.abs(bandResponseDb(lp, 200))).toBeLessThan(0.5);
  });

  it('shelves plateau past their corner', () => {
    const ls = band({ type: 'lowshelf', freq: 200, gainDb: 4 });
    expect(bandResponseDb(ls, 30)).toBeCloseTo(4, 0);
    expect(Math.abs(bandResponseDb(ls, 8000))).toBeLessThan(0.5);
    const hs = band({ type: 'highshelf', freq: 5000, gainDb: -4 });
    expect(bandResponseDb(hs, 15000)).toBeCloseTo(-4, 0);
  });

  it('disabled bands and 0 dB bells contribute nothing', () => {
    expect(bandResponseDb(band({ gainDb: 9, enabled: false }), 1000)).toBe(0);
    expect(bandResponseDb(band({ gainDb: 0 }), 1000)).toBe(0);
  });
});

describe('sumResponseDb', () => {
  it('sums serial bands in dB', () => {
    const bands = [band({ gainDb: 3 }), band({ gainDb: 2 })];
    const [db] = sumResponseDb(bands, [1000]);
    expect(db).toBeCloseTo(5, 0);
  });
});

describe('logFreqs', () => {
  it('spans the audible band, log-spaced', () => {
    const f = logFreqs(101);
    expect(f[0]).toBeCloseTo(20);
    expect(f[100]).toBeCloseTo(20000);
    expect(f[50]).toBeCloseTo(Math.sqrt(20 * 20000), 0); // geometric midpoint
  });
});
