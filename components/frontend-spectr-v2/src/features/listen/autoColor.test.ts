import { describe, expect, it } from 'vitest';
import {
  barColorForHue,
  bgColorForHue,
  hueFromCentroid,
  spectralCentroidNorm,
} from './autoColor';

describe('spectralCentroidNorm', () => {
  it('expected use: energy concentrated low gives a low centroid', () => {
    const bins = new Float32Array(64);
    for (let i = 0; i < 8; i += 1) bins[i] = 1;
    expect(spectralCentroidNorm(bins)).toBeLessThan(0.25);
  });

  it('energy concentrated high gives a high centroid', () => {
    const bins = new Float32Array(64);
    for (let i = 56; i < 64; i += 1) bins[i] = 1;
    expect(spectralCentroidNorm(bins)).toBeGreaterThan(0.8);
  });

  it('edge: silent/empty frames return the neutral 0.5', () => {
    expect(spectralCentroidNorm(new Float32Array(64))).toBe(0.5);
    expect(spectralCentroidNorm(new Float32Array(0))).toBe(0.5);
  });
});

describe('hueFromCentroid', () => {
  it('bass is warm, bright is cool, monotonic between', () => {
    const low = hueFromCentroid(0);
    const high = hueFromCentroid(1);
    expect(low).toBeLessThan(hueFromCentroid(0.5));
    expect(hueFromCentroid(0.5)).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(30);
    expect(high).toBeLessThanOrEqual(230);
  });

  it('clamps out-of-range input', () => {
    expect(hueFromCentroid(-1)).toBe(hueFromCentroid(0));
    expect(hueFromCentroid(2)).toBe(hueFromCentroid(1));
  });
});

describe('color formatters', () => {
  it('produce valid hsl strings', () => {
    expect(barColorForHue(120)).toBe('hsl(120, 82%, 60%)');
    expect(bgColorForHue(120)).toBe('hsl(120, 38%, 7%)');
  });
});
