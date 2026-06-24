import type { SatCurve } from '../state';

// Per-curve waveshaper transfer function over x in [-1, 1]. Each shape is odd
// in x at a fixed drive `d` (shape(-x) = -shape(x)); even harmonics come from
// the asymmetry param (per-half drive in makeSatCurve), not from these shapes.
// d 0 => near-linear, d 1 => strong saturation.
function shape(curve: SatCurve, x: number, d: number): number {
  switch (curve) {
    case 'tanh': {
      const k = 1 + d * 4;
      return Math.tanh(k * x) / Math.tanh(k);
    }
    case 'arctan': {
      const k = 1 + d * 4;
      return Math.atan(k * x) / Math.atan(k);
    }
    case 'softclip': {
      const k = 1 + d * 2;
      const t = Math.max(-1, Math.min(1, k * x));
      return 1.5 * t - 0.5 * t * t * t;
    }
    case 'hardclip': {
      const k = 1 + d * 9;
      return Math.max(-1, Math.min(1, k * x));
    }
    case 'sinefold': {
      const k = 1 + d * 4;
      return Math.sin((k * Math.PI * x) / 2);
    }
    case 'tube': {
      const k = 1 + d * 4;
      const num = (k * x) / (1 + Math.abs(k * x));
      return num / (k / (1 + k));
    }
    default: {
      const exhaustive: never = curve;
      return exhaustive;
    }
  }
}

// 1024-sample waveshaper curve. `asymmetry` (-1..1) scales drive differently on
// the positive vs negative half, generating even harmonics (and DC, which the
// saturator unit removes with a post highpass). asymmetry 0 => odd-symmetric.
// Back-compat: makeSatCurve(drive) === makeSatCurve(drive, 'tanh', 0).
export function makeSatCurve(
  drive: number,
  curve: SatCurve = 'tanh',
  asymmetry = 0,
): Float32Array {
  const n = 1024;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    const d = Math.max(0, drive * (x >= 0 ? 1 + asymmetry : 1 - asymmetry));
    out[i] = shape(curve, x, d);
  }
  return out;
}
