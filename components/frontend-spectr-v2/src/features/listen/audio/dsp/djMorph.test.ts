import { describe, expect, it } from 'vitest';
import { djMorph } from './djMorph';

describe('djMorph', () => {
  it('is fully open at center (lowpass @ 20000 Hz)', () => {
    expect(djMorph(0)).toEqual({ type: 'lowpass', freq: 20000 });
  });

  it('sweeps a lowpass down as morph goes negative', () => {
    expect(djMorph(-1)).toEqual({ type: 'lowpass', freq: 30 });
    const half = djMorph(-0.5);
    expect(half.type).toBe('lowpass');
    expect(half.freq).toBeGreaterThan(30);
    expect(half.freq).toBeLessThan(20000);
  });

  it('sweeps a highpass up as morph goes positive', () => {
    expect(djMorph(1)).toEqual({ type: 'highpass', freq: 18000 });
    const half = djMorph(0.5);
    expect(half.type).toBe('highpass');
    expect(half.freq).toBeCloseTo(600, 0); // 20 * (18000/20)^0.5 = 600
  });

  it('clamps morph to [-1, 1]', () => {
    expect(djMorph(-5)).toEqual(djMorph(-1));
    expect(djMorph(5)).toEqual(djMorph(1));
  });

  it('lowpass cutoff is monotonic in morph (more negative = lower)', () => {
    expect(djMorph(-0.8).freq).toBeLessThan(djMorph(-0.2).freq);
  });
});
