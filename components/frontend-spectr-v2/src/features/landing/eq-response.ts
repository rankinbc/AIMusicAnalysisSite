// Frequency response of the hero's EQ fix, computed — not drawn by hand — from
// the same parameters SPECTR suggested (RBJ Audio-EQ-Cookbook biquads at
// 48 kHz). A 24 dB/oct high-pass is a 4th-order Butterworth: two cascaded
// 2nd-order sections with Q 0.541 and 1.307.

export type EqBand =
  | { n: number; type: 'high_pass'; freqHz: number; slopeDb: 12 | 24 }
  | { n: number; type: 'bell'; freqHz: number; gainDb: number; q: number };

const FS = 48_000;

interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

function highPass(f0: number, q: number): Biquad {
  const w0 = (2 * Math.PI * f0) / FS;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return { b: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2], a: [1 + alpha, -2 * cos, 1 - alpha] };
}

function peaking(f0: number, gainDb: number, q: number): Biquad {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f0) / FS;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return { b: [1 + alpha * A, -2 * cos, 1 - alpha * A], a: [1 + alpha / A, -2 * cos, 1 - alpha / A] };
}

/** |H(e^jw)| of one biquad at frequency f. */
function magnitude({ b, a }: Biquad, f: number): number {
  const w = (2 * Math.PI * f) / FS;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = b[0] + b[1] * c1 + b[2] * c2;
  const ni = -(b[1] * s1 + b[2] * s2);
  const dr = a[0] + a[1] * c1 + a[2] * c2;
  const di = -(a[1] * s1 + a[2] * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

function sections(band: EqBand): Biquad[] {
  if (band.type === 'bell') return [peaking(band.freqHz, band.gainDb, band.q)];
  return band.slopeDb === 24
    ? [highPass(band.freqHz, 0.5412), highPass(band.freqHz, 1.3066)]
    : [highPass(band.freqHz, Math.SQRT1_2)];
}

/** Combined response of all bands at f, in dB. */
export function responseDb(bands: readonly EqBand[], f: number): number {
  let mag = 1;
  for (const band of bands) for (const sec of sections(band)) mag *= magnitude(sec, f);
  return 20 * Math.log10(Math.max(mag, 1e-9));
}
