import { describe, expect, it } from 'vitest';
import { irEnvelope } from './irSynth';

const TYPES = ['room', 'hall', 'plate', 'spring', 'ambience'] as const;

describe('irEnvelope', () => {
  it('starts at full amplitude (t=0) for every type', () => {
    for (const t of TYPES) {
      expect(irEnvelope(t, 0, 2)).toBeCloseTo(1, 5);
    }
  });

  it('stays within [0, 1] across the tail', () => {
    for (const t of TYPES) {
      for (let i = 0; i <= 10; i += 1) {
        const v = irEnvelope(t, (i / 10) * 2, 2);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('decays toward silence by the end of the decay window (hall)', () => {
    expect(irEnvelope('hall', 2, 2)).toBeLessThan(0.01);
  });

  it('room decays faster than hall at the same point', () => {
    expect(irEnvelope('room', 1, 2)).toBeLessThan(irEnvelope('hall', 1, 2));
  });

  it('is monotonically decreasing for hall (no ripple)', () => {
    expect(irEnvelope('hall', 0.5, 2)).toBeGreaterThan(irEnvelope('hall', 1.5, 2));
  });
});
