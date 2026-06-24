import { describe, expect, it } from 'vitest';
import { quantizeSample } from './quantize';

describe('quantizeSample', () => {
  it('is near-transparent at 16 bits', () => {
    for (const x of [-1, -0.3, 0, 0.42, 0.97, 1]) {
      expect(quantizeSample(x, 16)).toBeCloseTo(x, 3);
    }
  });

  it('1 bit collapses to round(x) in {-1, 0, 1}', () => {
    expect(quantizeSample(0.9, 1)).toBe(1);
    expect(quantizeSample(0.4, 1)).toBe(0);
    expect(quantizeSample(-0.9, 1)).toBe(-1);
  });

  it('stays within [-1, 1] for in-range input', () => {
    for (const bits of [1, 2, 4, 8, 16]) {
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const y = quantizeSample(x, bits);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps bitDepth to [1, 16]', () => {
    expect(quantizeSample(0.42, 0)).toBe(quantizeSample(0.42, 1));
    expect(quantizeSample(0.42, 99)).toBe(quantizeSample(0.42, 16));
  });

  it('is non-decreasing in x (a staircase, never inverts)', () => {
    let prev = -Infinity;
    for (let x = -1; x <= 1; x += 0.01) {
      const y = quantizeSample(x, 4);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
});
