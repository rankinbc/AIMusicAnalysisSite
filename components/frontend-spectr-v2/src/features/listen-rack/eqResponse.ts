// EQ frequency-response math for the curve editor — mirrors what the Web Audio
// BiquadFilterNode chain actually does (RBJ cookbook coefficients; shelves use
// the spec's fixed S=1 so the drawn curve matches the audible one; hp/lp Q is
// interpreted in dB per the Web Audio spec, converted to linear here).
import type { EqBand } from './data';

const FS = 44100;

interface Coeffs { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number; }

function coeffs(band: EqBand): Coeffs | null {
  const f0 = Math.max(10, Math.min(FS / 2 - 1, band.freq));
  const w0 = (2 * Math.PI * f0) / FS;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const A = Math.pow(10, band.gainDb / 40);
  switch (band.type) {
    case 'peaking': {
      const q = Math.max(0.05, band.q);
      const alpha = sinw / (2 * q);
      return {
        b0: 1 + alpha * A, b1: -2 * cosw, b2: 1 - alpha * A,
        a0: 1 + alpha / A, a1: -2 * cosw, a2: 1 - alpha / A,
      };
    }
    case 'lowshelf': {
      const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2); // S=1
      const s = 2 * Math.sqrt(A) * alpha;
      return {
        b0: A * (A + 1 - (A - 1) * cosw + s),
        b1: 2 * A * (A - 1 - (A + 1) * cosw),
        b2: A * (A + 1 - (A - 1) * cosw - s),
        a0: A + 1 + (A - 1) * cosw + s,
        a1: -2 * (A - 1 + (A + 1) * cosw),
        a2: A + 1 + (A - 1) * cosw - s,
      };
    }
    case 'highshelf': {
      const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2); // S=1
      const s = 2 * Math.sqrt(A) * alpha;
      return {
        b0: A * (A + 1 + (A - 1) * cosw + s),
        b1: -2 * A * (A - 1 + (A + 1) * cosw),
        b2: A * (A + 1 + (A - 1) * cosw - s),
        a0: A + 1 - (A - 1) * cosw + s,
        a1: 2 * (A - 1 - (A + 1) * cosw),
        a2: A + 1 - (A - 1) * cosw - s,
      };
    }
    case 'highpass': {
      const q = Math.pow(10, band.q / 20); // Web Audio hp/lp Q is in dB
      const alpha = sinw / (2 * Math.max(0.05, q));
      return {
        b0: (1 + cosw) / 2, b1: -(1 + cosw), b2: (1 + cosw) / 2,
        a0: 1 + alpha, a1: -2 * cosw, a2: 1 - alpha,
      };
    }
    case 'lowpass': {
      const q = Math.pow(10, band.q / 20);
      const alpha = sinw / (2 * Math.max(0.05, q));
      return {
        b0: (1 - cosw) / 2, b1: 1 - cosw, b2: (1 - cosw) / 2,
        a0: 1 + alpha, a1: -2 * cosw, a2: 1 - alpha,
      };
    }
    default:
      return null;
  }
}

/** One band's magnitude response (dB) at frequency `f` — 0 when disabled. */
export function bandResponseDb(band: EqBand, f: number): number {
  if (!band.enabled) return 0;
  // A 0 dB peaking/shelf is exactly flat — skip the math (and its edge cases).
  if (band.gainDb === 0 && band.type !== 'highpass' && band.type !== 'lowpass') return 0;
  const c = coeffs(band);
  if (!c) return 0;
  const w = (2 * Math.PI * Math.max(1, Math.min(FS / 2 - 1, f))) / FS;
  const cw = Math.cos(w);
  const c2w = Math.cos(2 * w);
  const num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2
    + 2 * (c.b0 * c.b1 + c.b1 * c.b2) * cw + 2 * c.b0 * c.b2 * c2w;
  const den = c.a0 * c.a0 + c.a1 * c.a1 + c.a2 * c.a2
    + 2 * (c.a0 * c.a1 + c.a1 * c.a2) * cw + 2 * c.a0 * c.a2 * c2w;
  if (den <= 0 || num < 0) return 0;
  return 10 * Math.log10(num / den);
}

/** Summed response (dB) of the whole serial chain at each of `freqs`. */
export function sumResponseDb(bands: EqBand[], freqs: number[]): number[] {
  return freqs.map((f) => bands.reduce((db, b) => db + bandResponseDb(b, f), 0));
}

/** N log-spaced frequencies across the audible band (curve sample points). */
export function logFreqs(n: number, lo = 20, hi = 20000): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(lo * Math.pow(hi / lo, i / (n - 1)));
  }
  return out;
}
