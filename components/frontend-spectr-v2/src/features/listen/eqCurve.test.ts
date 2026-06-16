import { describe, expect, it } from 'vitest';
import { bandX, dbToY, EQ_BANDS, smoothPath, yToDb } from './eqCurve';

describe('eqCurve geometry', () => {
  it('maps 0 dB to the vertical centre', () => {
    expect(dbToY(0, 300)).toBe(150);
  });

  it('maps the max gain to the top padding line', () => {
    expect(dbToY(15, 300, 18)).toBeCloseTo(18, 5);
  });

  it('round-trips dbToY/yToDb', () => {
    for (const db of [-12, -3, 0, 4.5, 11]) {
      expect(yToDb(dbToY(db, 300), 300)).toBeCloseTo(db, 5);
    }
  });

  it('clamps yToDb to the ± range', () => {
    expect(yToDb(-9999, 300)).toBe(15);
    expect(yToDb(9999, 300)).toBe(-15);
  });

  it('spreads bands evenly across the width', () => {
    const xs = EQ_BANDS.map((_, i) => bandX(i, 800));
    expect(xs[0]).toBeCloseTo(50, 5); // (0.5/8)*800
    expect(xs[EQ_BANDS.length - 1]).toBeCloseTo(750, 5); // (7.5/8)*800
  });

  it('returns an empty path for fewer than two points', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 0, y: 0 }])).toBe('');
  });

  it('builds a cubic path through multiple points', () => {
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 5 },
    ]);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('C ');
  });
});
