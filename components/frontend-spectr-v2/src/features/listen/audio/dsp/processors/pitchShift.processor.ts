// Constant-tempo pitch shifter — a two-tap crossfading delay line (the classic
// granular/"delay-line" shifter). Audio is written into a ring buffer at the
// normal rate and read back at `ratio`; the read delay therefore drifts, and
// when it would run off the end of a grain it wraps. Two taps a half-grain
// apart, faded with a sin/cos pair, hide that wrap — so the pitch changes while
// playback speed does NOT (unlike playbackRate/detune, which couple the two).
//
// Quality note: this is a time-domain shifter, so large shifts add some warble
// and it does not preserve formants. It is clean through roughly +/-7 st, which
// covers the musical range the rack offers.
const BUF = 16384; // ring per channel (~370 ms @ 44.1k) — must exceed GRAIN
const GRAIN = 3072; // grain length (~70 ms) — long enough not to smear bass
const MAX_CH = 2;

class PitchShiftProcessor extends AudioWorkletProcessor {
  private buf: Float32Array[] = [];
  private w = 0; // write index
  private d = 0; // read delay in samples, walks within [0, GRAIN)

  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  /** Linear-interpolated read `pos` samples into the ring (pos may be negative). */
  private read(b: Float32Array, pos: number): number {
    let p = pos;
    while (p < 0) p += BUF;
    while (p >= BUF) p -= BUF;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const i1 = i0 + 1 >= BUF ? 0 : i0 + 1;
    return b[i0] * (1 - frac) + b[i1] * frac;
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const ratio = parameters.ratio[0];
    const frames = output[0].length;
    const chCount = Math.min(output.length, MAX_CH);
    for (let ch = 0; ch < chCount; ch += 1) {
      if (!this.buf[ch]) this.buf[ch] = new Float32Array(BUF);
    }

    // Unity ratio: true passthrough (no grain latency or warble when the shift
    // is parked at 0). Reset the walk so re-engaging starts from zero delay.
    if (Math.abs(ratio - 1) < 1e-4) {
      this.d = 0;
      for (let ch = 0; ch < output.length; ch += 1) {
        const inCh = input[ch] ?? input[0];
        const b = this.buf[Math.min(ch, chCount - 1)];
        for (let i = 0; i < frames; i += 1) {
          const s = inCh ? inCh[i] : 0;
          output[ch][i] = s;
          if (ch < chCount) b[(this.w + i) % BUF] = s; // keep the ring primed
        }
      }
      this.w = (this.w + frames) % BUF;
      return true;
    }

    const half = GRAIN * 0.5;
    for (let i = 0; i < frames; i += 1) {
      const dB = this.d >= half ? this.d - half : this.d + half;
      // sin() on both taps: equal-power crossfade (their squares sum to 1),
      // each tap silent exactly where its own grain wraps.
      const gA = Math.sin(Math.PI * (this.d / GRAIN));
      const gB = Math.sin(Math.PI * (dB / GRAIN));
      for (let ch = 0; ch < chCount; ch += 1) {
        const b = this.buf[ch];
        const inCh = input[ch] ?? input[0];
        b[this.w] = inCh ? inCh[i] : 0; // write BEFORE reading (delay 0 is valid)
        output[ch][i] = this.read(b, this.w - this.d) * gA + this.read(b, this.w - dB) * gB;
      }
      this.w = this.w + 1 >= BUF ? 0 : this.w + 1;
      // ratio > 1 (up) => read faster than write => delay shrinks
      this.d += 1 - ratio;
      if (this.d < 0) this.d += GRAIN;
      else if (this.d >= GRAIN) this.d -= GRAIN;
    }
    // mirror ch0 into any extra output channels
    for (let ch = chCount; ch < output.length; ch += 1) {
      output[ch].set(output[0].subarray(0, frames));
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchShiftProcessor);
