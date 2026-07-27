// Hand-rolled iterative radix-2 Cooley-Tukey FFT. The phase-vocoder pitch
// shifter (`processors/pitchShift.processor.ts`) needs a forward+inverse
// complex FFT on the audio thread and the project forbids adding an npm
// dependency for it, so it lives here as a small, pure, unit-testable module
// (no AudioContext / AudioWorklet globals — plain arrays in, arrays out).
//
// `re`/`im` are transformed IN PLACE (the worklet pre-allocates its scratch
// arrays once and reuses them every hop — no allocation on the audio thread).
// Length MUST be a power of two; callers are trusted (this fires every ~12ms
// on the audio thread, so we skip a defensive check here).
//
// Trig is recomputed per butterfly via Math.cos/sin rather than carried
// through a twiddle-factor recurrence (w *= wIncrement). A recurrence is
// cheaper but its rounding error compounds over the log2(N) stages/bins; at
// N=2048 (11 stages) the extra transcendental calls are still negligible
// next to one 2048-point transform's total cost, so we take the accuracy.
export function fftInPlace(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length;

  // Bit-reversal permutation (standard iterative in-place FFT precondition).
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  // Iterative Danielle-Lanczos butterflies, stage by stage (len = 2,4,8,...,n).
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    // Forward: e^{-i*2*pi*k/len}. Inverse: e^{+i*2*pi*k/len} (sign flip only —
    // the 1/n scaling below is what actually makes it the inverse transform).
    const angBase = (invert ? 2 : -2) * Math.PI / len;
    for (let block = 0; block < n; block += len) {
      for (let k = 0; k < half; k += 1) {
        const ang = angBase * k;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const i0 = block + k;
        const i1 = i0 + half;
        const vr = re[i1] * wr - im[i1] * wi;
        const vi = re[i1] * wi + im[i1] * wr;
        const ur = re[i0];
        const ui = im[i0];
        re[i0] = ur + vr;
        im[i0] = ui + vi;
        re[i1] = ur - vr;
        im[i1] = ui - vi;
      }
    }
  }

  if (invert) {
    for (let i = 0; i < n; i += 1) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function forwardFft(re: Float64Array, im: Float64Array): void {
  fftInPlace(re, im, false);
}

export function inverseFft(re: Float64Array, im: Float64Array): void {
  fftInPlace(re, im, true);
}

// Periodic (DFT-symmetric) Hann window: w[n] = 0.5 - 0.5*cos(2*pi*n/N), n=0..N-1.
// "Periodic" (denominator N, not N-1) is the correct variant for OLA resynthesis
// — the N-1 "symmetric" variant used for FIR filter design double-counts the
// endpoint when frames overlap and add.
export function hannWindowPeriodic(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return w;
}

// Wrap a phase (radians) into (-pi, pi]. Used by the phase-vocoder's
// instantaneous-frequency estimate (phase deviation must be wrapped before
// it's treated as a frequency correction, or a wrap-around at +/-pi reads as
// a huge bogus frequency jump).
export function wrapPhase(x: number): number {
  return x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
}
