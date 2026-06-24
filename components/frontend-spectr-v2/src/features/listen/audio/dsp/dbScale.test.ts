import { describe, expect, it } from 'vitest';
import { dbToLin, msToCoef } from './dbScale';

describe('dbToLin', () => {
  it('0 dB is unity', () => {
    expect(dbToLin(0)).toBeCloseTo(1, 10);
  });
  it('-6 dB is ~0.501, -20 dB is 0.1', () => {
    expect(dbToLin(-6)).toBeCloseTo(0.50119, 4);
    expect(dbToLin(-20)).toBeCloseTo(0.1, 10);
  });
});

describe('msToCoef', () => {
  it('ms <= 0 is instantaneous (coef 1)', () => {
    expect(msToCoef(0, 48000)).toBe(1);
    expect(msToCoef(-5, 48000)).toBe(1);
  });
  it('is in (0,1) and smaller for longer time constants', () => {
    const fast = msToCoef(1, 48000);
    const slow = msToCoef(100, 48000);
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeLessThan(1);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(fast); // longer ms => smaller coef => slower
  });
});
