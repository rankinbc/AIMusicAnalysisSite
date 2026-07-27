import { describe, expect, it } from 'vitest';
import { fftInPlace, forwardFft, hannWindowPeriodic, inverseFft, wrapPhase } from './fft';

describe('fftInPlace round-trip', () => {
  it('forward then inverse recovers a known real signal within tolerance', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const original = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      // A mix of a few partials so it isn't accidentally a single-bin case.
      const x = Math.sin((2 * Math.PI * 3 * i) / n) + 0.5 * Math.cos((2 * Math.PI * 7 * i) / n) + 0.25;
      original[i] = x;
      re[i] = x;
      im[i] = 0;
    }

    forwardFft(re, im);
    inverseFft(re, im);

    for (let i = 0; i < n; i += 1) {
      expect(re[i]).toBeCloseTo(original[i], 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });

  it('round-trips a non-power-of-obvious, higher N (2048, the worklet size)', () => {
    const n = 2048;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const original = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = Math.sin((2 * Math.PI * 40 * i) / n) - 0.2 * Math.sin((2 * Math.PI * 400 * i) / n);
      original[i] = x;
      re[i] = x;
    }

    forwardFft(re, im);
    inverseFft(re, im);

    let maxErr = 0;
    for (let i = 0; i < n; i += 1) {
      maxErr = Math.max(maxErr, Math.abs(re[i] - original[i]), Math.abs(im[i]));
    }
    expect(maxErr).toBeLessThan(1e-8);
  });
});

describe('fftInPlace single-bin sinusoid', () => {
  it('a pure sinusoid at bin k0 lands its energy at bins k0 and n-k0', () => {
    const n = 128;
    const k0 = 5;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      re[i] = Math.cos((2 * Math.PI * k0 * i) / n);
    }

    forwardFft(re, im);

    const mag = new Float64Array(n);
    for (let i = 0; i < n; i += 1) mag[i] = Math.hypot(re[i], im[i]);

    // A real cosine at bin k0 splits its energy evenly between k0 and n-k0
    // (Hermitian symmetry of a real signal's spectrum).
    expect(mag[k0]).toBeGreaterThan(n / 2 - 1);
    expect(mag[n - k0]).toBeGreaterThan(n / 2 - 1);

    for (let i = 0; i < n; i += 1) {
      if (i === k0 || i === n - k0) continue;
      expect(mag[i]).toBeLessThan(1e-6);
    }
  });

  it('leaves a zero signal at zero (degenerate case, sanity check)', () => {
    const n = 32;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    forwardFft(re, im);
    for (let i = 0; i < n; i += 1) {
      expect(re[i]).toBe(0);
      expect(im[i]).toBe(0);
    }
  });
});

describe('fftInPlace invert flag matches forwardFft/inverseFft wrappers', () => {
  it('fftInPlace(..., false) === forwardFft and (..., true) === inverseFft', () => {
    const n = 32;
    const reA = new Float64Array(n);
    const imA = new Float64Array(n);
    const reB = new Float64Array(n);
    const imB = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      reA[i] = reB[i] = Math.sin(i);
    }
    forwardFft(reA, imA);
    fftInPlace(reB, imB, false);
    for (let i = 0; i < n; i += 1) {
      expect(reA[i]).toBeCloseTo(reB[i], 12);
      expect(imA[i]).toBeCloseTo(imB[i], 12);
    }
  });
});

describe('hannWindowPeriodic', () => {
  it('starts at (near) zero, peaks at the center, is not symmetric to N-1 (periodic variant)', () => {
    const n = 16;
    const w = hannWindowPeriodic(n);
    expect(w[0]).toBeCloseTo(0, 12);
    // Periodic Hann's last sample is NOT zero (that's the whole point — it
    // would double-count the endpoint on overlap-add otherwise).
    expect(w[n - 1]).toBeGreaterThan(0);
    expect(w[n / 2]).toBeGreaterThan(w[1]);
  });

  it('is bounded in [0, 1]', () => {
    const w = hannWindowPeriodic(64);
    for (const v of w) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('wrapPhase', () => {
  it('is a no-op inside (-pi, pi]', () => {
    // Math.PI itself is the ambiguous half-way boundary (round-half-up puts it
    // at -pi) — test values strictly inside the open interval instead.
    for (const x of [0, 1, -1, Math.PI - 0.001, -Math.PI + 0.001]) {
      expect(wrapPhase(x)).toBeCloseTo(x, 9);
    }
  });

  it('wraps values outside the range back in, preserving angle modulo 2*pi', () => {
    const cases = [Math.PI + 0.1, -Math.PI - 0.1, 5 * Math.PI, -3 * Math.PI];
    for (const x of cases) {
      const w = wrapPhase(x);
      expect(w).toBeGreaterThan(-Math.PI - 1e-9);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-9);
      const diff = (x - w) / (2 * Math.PI);
      expect(diff).toBeCloseTo(Math.round(diff), 9);
    }
  });
});
