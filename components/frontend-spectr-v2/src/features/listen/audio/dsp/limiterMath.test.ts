import { describe, expect, it } from 'vitest';
import { stepLimiter, type LimiterParams, type LimiterRtState } from './limiterMath';

const P: LimiterParams = { ceilingLin: 0.5, releaseCoef: 0.1 };
const start: LimiterRtState = { gain: 1 };

describe('stepLimiter', () => {
  it('reduces gain so peak * gain never exceeds the ceiling', () => {
    const s = stepLimiter(start, 1.0, P); // peak 1.0, ceiling 0.5
    expect(s.gain).toBeCloseTo(0.5, 6); // 0.5 / 1.0
    expect(1.0 * s.gain).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('snaps down instantly (attack is immediate)', () => {
    const s = stepLimiter({ gain: 1 }, 2.0, P); // 0.5/2.0 = 0.25
    expect(s.gain).toBeCloseTo(0.25, 6);
  });

  it('releases gradually back toward unity when the peak is under ceiling', () => {
    let s: LimiterRtState = { gain: 0.25 };
    s = stepLimiter(s, 0.1, P); // under ceiling -> release toward 1
    expect(s.gain).toBeGreaterThan(0.25);
    expect(s.gain).toBeLessThan(1);
  });

  it('handles a zero peak without dividing by zero', () => {
    const s = stepLimiter({ gain: 0.4 }, 0, P);
    expect(Number.isFinite(s.gain)).toBe(true);
    expect(s.gain).toBeGreaterThan(0.4); // releasing toward 1
  });
});
