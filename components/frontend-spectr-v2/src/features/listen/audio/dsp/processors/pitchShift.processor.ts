// Phase-vocoder pitch shifter, replacing the earlier two-tap crossfading
// delay line (warbled beyond ~7 semitones, no formant preservation).
//
// ALGORITHM: constant-hop, frequency-domain bin remapping (the technique
// popularized as "smbPitchShift" — a public-domain, widely republished STFT
// pitch-shift method; this is our own implementation of the published
// technique, not a copy of any source). We do NOT time-stretch-then-resample.
// Both analysis hop Ha and synthesis hop Hs equal HOP — the STFT timeline
// never stretches — so no separate resampling stage is needed and output
// streams at the input's native rate with no timeline bookkeeping. Instead,
// per hop we:
//   1. STFT each channel (Hann analysis window, forward FFT).
//   2. From a REFERENCE channel's phase (channel 0 — see "stereo coherence"
//      below) estimate each bin's true instantaneous frequency via the
//      classic phase-vocoder phase-deviation trick.
//   3. Remap each source bin k's magnitude (and the reference channel's
//      instantaneous frequency, scaled by `ratio`) into target bin
//      round(k * ratio) — this is what actually shifts pitch: energy that
//      was at frequency f now sits at f * ratio.
//   4. Re-accumulate a running synthesis phase per target bin from the
//      remapped instantaneous frequency, inverse-FFT, Hann-window again, and
//      overlap-add.
// This trades a touch of accuracy for simplicity vs. stretch+resample (dense
// spectra can show minor extra "birdies" under large downward shifts, where
// several source bins alias onto the same target bin — see quality notes in
// the PR description) but needs no resampler and stays exactly in sync with
// the transport, which matters more for a live mixing tool than a purist's
// last few dB of transparency.
//
// FFT SIZE: 2048, a named constant (FFT_SIZE). This is the standard tradeoff
// point for a musical-signal phase vocoder — big enough for ~21 Hz frequency
// resolution (good separation of close low-end partials, e.g. a low bass
// note's harmonics) while keeping the startup latency (~46 ms at 44.1 kHz,
// see LATENCY below) inside the 100 ms budget. HOP = FFT_SIZE/4 (75%
// overlap, the standard "4x oversampling" phase-vocoder configuration —
// enough temporal resolution to track fast transients without the analysis
// windows aliasing against each other).
//
// STEREO COHERENCE: the instantaneous-frequency estimate and its resulting
// bin-remap + resynthesis PHASE are computed ONCE from channel 0 and reused,
// unmodified, for every channel — only the MAGNITUDE (and, with formant
// correction on, the spectral envelope) is per-channel. If each channel
// independently estimated its own phase, uncorrelated analysis noise would
// make left/right phase drift apart frame to frame, which is exactly what
// collapses (or randomly flutters) the stereo image on a phase vocoder. A
// single shared phase clock keeps both channels locked; the image survives
// via each channel's own magnitude/envelope, same as the old delay-line
// shifter effectively did (it also used one shared read-delay walk).
//
// LATENCY: bounded at FFT_SIZE samples (~46 ms @ 44.1 kHz, ~43 ms @ 48 kHz) —
// the input FIFO must fill once before the first analysis frame can be
// windowed; after that, one hop's worth of finalized output is produced for
// every hop's worth of new input, so steady state is real-time with no
// further buildup. This comfortably clears the 100 ms budget.
//
// FORMANT PRESERVATION (`formant` param, 0..1, k-rate): real-cepstrum
// spectral-envelope estimate per channel (log-magnitude -> IFFT -> low-
// quefrency lifter -> FFT back -> exp). The excitation (magnitude / envelope)
// is what actually gets bin-shifted; the ORIGINAL envelope is then
// reapplied at the shifted bin positions, so formants stay put while the
// harmonic content moves — the standard channel-vocoder formant-correction
// trick. `formant` blends linearly between the uncorrected (formant=0) and
// corrected (formant=1) magnitude per bin, so it can be dialed rather than
// hard-switched. See LIFTER_CUTOFF below for where this breaks down.
//
// Zero allocation in process(): every buffer used inside process()/doHop()
// is allocated once in the constructor and reused; only the constructor and
// the (once-only) ring/queue resize path allocate.
import { forwardFft, hannWindowPeriodic, inverseFft, wrapPhase } from '../fft';

// Must be a power of two. See file header for the size-vs-latency rationale.
const FFT_SIZE = 2048;
const OVERSAMPLE = 4; // 75% overlap — the classic phase-vocoder configuration.
const HOP = FFT_SIZE / OVERSAMPLE;
const NYQUIST_BIN = FFT_SIZE / 2; // bin index of the Nyquist frequency.
const MAX_CH = 2;
const EPS = 1e-9;

// Real-cepstrum lifter cutoff, in quefrency samples. Cepstrum coefficients
// below this index track the slowly-varying spectral envelope (formants);
// at/above it they track the periodic ripple from the fundamental and its
// harmonics, which we want to EXCLUDE from the envelope estimate. 50 samples
// corresponds to a source periodicity of sampleRate/50 (~880 Hz at 44.1 kHz)
// — comfortably above the low end of most musical fundamentals (bass/vocal),
// so their harmonic ripple is excluded while the formant envelope survives.
// Quality caveat (documented, not silently swallowed): a fundamental ABOVE
// that (e.g. a high vocal note or lead synth) has its harmonic spacing
// intrude into the lifter's envelope band, and the envelope estimate starts
// tracking pitch instead of timbre — formant correction gets progressively
// less accurate the higher the source pitch goes.
const LIFTER_CUTOFF = 50;

// Output FIFO capacity per channel: production happens in HOP-sized bursts,
// consumption in (usually 128-sample) render-quantum sized sips, so this only
// needs a little headroom over one hop; FFT_SIZE gives 4x that for margin.
const OUT_QUEUE_CAP = FFT_SIZE;

class PitchShiftProcessor extends AudioWorkletProcessor {
  // ---- windows (shared across channels) ----
  private readonly hann = hannWindowPeriodic(FFT_SIZE);
  private readonly olaNorm: number;

  // ---- input side: per-channel ring + shared hop counter ----
  private readonly inRing: Float64Array[] = [];
  private inWritePos = 0;
  private sinceHop = 0;

  // ---- FFT scratch (reused sequentially, one channel at a time) ----
  private readonly scratchRe = new Float64Array(FFT_SIZE);
  private readonly scratchIm = new Float64Array(FFT_SIZE);
  private readonly cepstrumRe = new Float64Array(FFT_SIZE);
  private readonly cepstrumIm = new Float64Array(FFT_SIZE);

  // ---- per-channel analysis results (bins 0..NYQUIST_BIN) ----
  private readonly anaMagn: Float64Array[] = [];
  private readonly envelope: Float64Array[] = [];
  private readonly residual: Float64Array[] = [];

  // ---- shared (channel-0-driven) phase-vocoder state, bins 0..NYQUIST_BIN ----
  private readonly lastPhase = new Float64Array(NYQUIST_BIN + 1);
  private readonly anaFreq = new Float64Array(NYQUIST_BIN + 1);
  private readonly synFreq = new Float64Array(NYQUIST_BIN + 1);
  private readonly sumPhase = new Float64Array(NYQUIST_BIN + 1);

  // ---- per-channel synthesis accumulators, bins 0..NYQUIST_BIN ----
  private readonly synMagn: Float64Array[] = [];
  private readonly synResidual: Float64Array[] = [];

  // ---- per-channel OLA ring + shared write pointer ----
  private readonly olaRing: Float64Array[] = [];
  private olaWritePos = 0;

  // ---- per-channel output FIFO (decouples HOP-sized production from the
  // render quantum's consumption rate) ----
  private readonly outQueue: Float64Array[] = [];
  private outQueueRead = 0;
  private outQueueWrite = 0;
  private outQueueAvail = 0;

  private active = false; // false while parked at unity ratio (passthrough)

  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      { name: 'formant', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    for (let ch = 0; ch < MAX_CH; ch += 1) {
      this.inRing.push(new Float64Array(FFT_SIZE));
      this.anaMagn.push(new Float64Array(NYQUIST_BIN + 1));
      this.envelope.push(new Float64Array(NYQUIST_BIN + 1));
      this.residual.push(new Float64Array(NYQUIST_BIN + 1));
      this.synMagn.push(new Float64Array(NYQUIST_BIN + 1));
      this.synResidual.push(new Float64Array(NYQUIST_BIN + 1));
      this.olaRing.push(new Float64Array(FFT_SIZE));
      this.outQueue.push(new Float64Array(OUT_QUEUE_CAP));
    }
    // Verify (rather than hardcode) the double-Hann OLA normalization
    // constant: simulate the steady-state overlap of OVERSAMPLE shifted
    // copies of hann^2 at hop spacing HOP, modulo FFT_SIZE (the same
    // wraparound the real OLA ring uses below). For a periodic Hann window
    // at 75% overlap this converges to the same value at every index; we
    // read index 0 as the constant. Doing this numerically (vs. trusting a
    // remembered closed-form constant) is self-checking and self-documenting.
    const acc = new Float64Array(FFT_SIZE);
    for (let s = 0; s < OVERSAMPLE; s += 1) {
      const shift = s * HOP;
      for (let n = 0; n < FFT_SIZE; n += 1) {
        acc[(n + shift) % FFT_SIZE] += this.hann[n] * this.hann[n];
      }
    }
    this.olaNorm = acc[0];
  }

  private resetVocoderState(): void {
    this.inWritePos = 0;
    this.sinceHop = 0;
    this.olaWritePos = 0;
    this.outQueueRead = 0;
    this.outQueueWrite = 0;
    this.outQueueAvail = 0;
    this.lastPhase.fill(0);
    this.anaFreq.fill(0);
    this.synFreq.fill(0);
    this.sumPhase.fill(0);
    for (let ch = 0; ch < MAX_CH; ch += 1) {
      this.inRing[ch].fill(0);
      this.anaMagn[ch].fill(0);
      this.envelope[ch].fill(0);
      this.residual[ch].fill(0);
      this.synMagn[ch].fill(0);
      this.synResidual[ch].fill(0);
      this.olaRing[ch].fill(0);
      this.outQueue[ch].fill(0);
    }
  }

  /** Real-cepstrum spectral envelope of `magn` (bins 0..NYQUIST_BIN) into `envOut`. */
  private computeEnvelope(magn: Float64Array, envOut: Float64Array): void {
    // Build the full symmetric log-magnitude spectrum (real cepstrum input).
    for (let k = 0; k <= NYQUIST_BIN; k += 1) {
      const lm = Math.log(Math.max(magn[k], EPS));
      this.cepstrumRe[k] = lm;
      this.cepstrumIm[k] = 0;
      if (k > 0 && k < NYQUIST_BIN) {
        this.cepstrumRe[FFT_SIZE - k] = lm;
        this.cepstrumIm[FFT_SIZE - k] = 0;
      }
    }
    // -> cepstrum (quefrency domain). A real symmetric spectrum's inverse FFT
    // is real (imaginary part cancels); we only read cepstrumRe onward.
    inverseFft(this.cepstrumRe, this.cepstrumIm);
    // Lifter: keep only the low-quefrency (slowly varying envelope) coefficients.
    for (let q = LIFTER_CUTOFF; q <= FFT_SIZE - LIFTER_CUTOFF; q += 1) {
      this.cepstrumRe[q] = 0;
      this.cepstrumIm[q] = 0;
    }
    // -> back to a smoothed log-magnitude envelope.
    forwardFft(this.cepstrumRe, this.cepstrumIm);
    for (let k = 0; k <= NYQUIST_BIN; k += 1) {
      envOut[k] = Math.exp(this.cepstrumRe[k]);
    }
  }

  /** One phase-vocoder hop: consumes HOP fresh samples already sitting at the
   * end of each channel's `inRing`, produces HOP fresh samples into each
   * channel's `outQueue`. */
  private doHop(ratio: number, formant: number, chCount: number): void {
    const freqPerBin = sampleRate / FFT_SIZE;
    const expct = (2 * Math.PI * HOP) / FFT_SIZE;

    for (let ch = 0; ch < chCount; ch += 1) {
      // Window the most recent FFT_SIZE samples (ring read starting at the
      // current write position wraps to "oldest..newest" order).
      const ring = this.inRing[ch];
      for (let n = 0; n < FFT_SIZE; n += 1) {
        const idx = (this.inWritePos + n) % FFT_SIZE;
        this.scratchRe[n] = ring[idx] * this.hann[n];
        this.scratchIm[n] = 0;
      }
      forwardFft(this.scratchRe, this.scratchIm);

      const magn = this.anaMagn[ch];
      for (let k = 0; k <= NYQUIST_BIN; k += 1) {
        magn[k] = Math.hypot(this.scratchRe[k], this.scratchIm[k]);
      }

      if (ch === 0) {
        // Reference channel drives the shared instantaneous-frequency
        // estimate (see "stereo coherence" in the file header).
        for (let k = 0; k <= NYQUIST_BIN; k += 1) {
          const phase = Math.atan2(this.scratchIm[k], this.scratchRe[k]);
          let dev = phase - this.lastPhase[k];
          this.lastPhase[k] = phase;
          dev -= k * expct; // remove the phase advance a stationary bin would have
          dev = wrapPhase(dev);
          // True instantaneous frequency (Hz) for this bin, per the standard
          // phase-vocoder deviation formula.
          this.anaFreq[k] = k * freqPerBin + (dev * OVERSAMPLE * freqPerBin) / (2 * Math.PI);
        }
      }

      if (formant > 0) {
        this.computeEnvelope(magn, this.envelope[ch]);
        const res = this.residual[ch];
        const env = this.envelope[ch];
        for (let k = 0; k <= NYQUIST_BIN; k += 1) {
          res[k] = magn[k] / Math.max(env[k], EPS);
        }
      }
    }

    // Remap: source bin k's content moves to target bin round(k * ratio).
    // gSynFreq is shared (computed once from the reference channel);
    // gSynMagn/gSynResidual are accumulated per channel from that channel's
    // own magnitude/residual — this is the per-channel part of the split.
    this.synFreq.fill(0);
    for (let ch = 0; ch < chCount; ch += 1) {
      this.synMagn[ch].fill(0);
      if (formant > 0) this.synResidual[ch].fill(0);
    }
    for (let k = 0; k <= NYQUIST_BIN; k += 1) {
      const idx = Math.round(k * ratio);
      if (idx < 0 || idx > NYQUIST_BIN) continue;
      this.synFreq[idx] = this.anaFreq[k] * ratio;
      for (let ch = 0; ch < chCount; ch += 1) {
        this.synMagn[ch][idx] += this.anaMagn[ch][k];
        if (formant > 0) this.synResidual[ch][idx] += this.residual[ch][k];
      }
    }

    // Shared resynthesis phase clock (see file header) — advance once for
    // both channels from the remapped shared frequency.
    for (let k = 0; k <= NYQUIST_BIN; k += 1) {
      let dev = this.synFreq[k] - k * freqPerBin;
      dev = (2 * Math.PI * dev) / (freqPerBin * OVERSAMPLE);
      dev += k * expct;
      this.sumPhase[k] += dev;
    }

    for (let ch = 0; ch < chCount; ch += 1) {
      const uncorrected = this.synMagn[ch];
      const corrected = formant > 0 ? this.synResidual[ch] : null;
      const env = formant > 0 ? this.envelope[ch] : null;
      for (let k = 0; k <= NYQUIST_BIN; k += 1) {
        let mag = uncorrected[k];
        if (corrected && env) {
          const correctedMag = corrected[k] * env[k];
          mag = uncorrected[k] * (1 - formant) + correctedMag * formant;
        }
        const phase = this.sumPhase[k];
        this.scratchRe[k] = mag * Math.cos(phase);
        this.scratchIm[k] = mag * Math.sin(phase);
      }
      // Hermitian-mirror the rest of the spectrum for a real inverse FFT.
      for (let k = 1; k < NYQUIST_BIN; k += 1) {
        this.scratchRe[FFT_SIZE - k] = this.scratchRe[k];
        this.scratchIm[FFT_SIZE - k] = -this.scratchIm[k];
      }
      this.scratchIm[0] = 0;
      this.scratchIm[NYQUIST_BIN] = 0;

      inverseFft(this.scratchRe, this.scratchIm);

      // Synthesis-window + overlap-add into the ring, then immediately emit
      // (and clear) the HOP samples that just became finalized — see file
      // header's ring-buffer reasoning: because HOP evenly divides FFT_SIZE,
      // ring position (olaWritePos + i) for i in [0, HOP) will not be touched
      // by any later frame until it wraps all the way around, so it's safe
      // to read it out and zero it right now.
      const ring2 = this.olaRing[ch];
      for (let n = 0; n < FFT_SIZE; n += 1) {
        const idx = (this.olaWritePos + n) % FFT_SIZE;
        ring2[idx] += (this.scratchRe[n] * this.hann[n]) / this.olaNorm;
      }
      // Every channel must land this hop at the SAME queue offset: the read
      // side uses one shared cursor for all channels, so advancing the write
      // cursor per channel would leave ch1 a hop ahead of ch0 in its own
      // queue and the right channel would read stale (silent) samples.
      const q = this.outQueue[ch];
      let w = this.outQueueWrite;
      for (let i = 0; i < HOP; i += 1) {
        const idx = (this.olaWritePos + i) % FFT_SIZE;
        q[w] = ring2[idx];
        ring2[idx] = 0;
        w = (w + 1) % OUT_QUEUE_CAP;
      }
    }
    this.outQueueWrite = (this.outQueueWrite + HOP) % OUT_QUEUE_CAP;
    this.outQueueAvail = Math.min(OUT_QUEUE_CAP, this.outQueueAvail + HOP);
    this.olaWritePos = (this.olaWritePos + HOP) % FFT_SIZE;
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
    const formant = parameters.formant[0];
    const frames = output[0].length;
    const chCount = Math.min(output.length, MAX_CH);

    // Unity ratio: true zero-latency passthrough, and reset the vocoder so
    // re-engaging always starts from clean state (mirrors the previous
    // delay-line shifter's `this.d = 0` reset on the same condition).
    if (Math.abs(ratio - 1) < 1e-4) {
      if (this.active) {
        this.resetVocoderState();
        this.active = false;
      }
      for (let ch = 0; ch < output.length; ch += 1) {
        const inCh = input[ch] ?? input[0];
        for (let i = 0; i < frames; i += 1) {
          output[ch][i] = inCh ? inCh[i] : 0;
        }
      }
      return true;
    }
    this.active = true;

    for (let i = 0; i < frames; i += 1) {
      for (let ch = 0; ch < chCount; ch += 1) {
        const inCh = input[ch] ?? input[0];
        this.inRing[ch][this.inWritePos] = inCh ? inCh[i] : 0;
      }
      this.inWritePos = (this.inWritePos + 1) % FFT_SIZE;
      this.sinceHop += 1;
      if (this.sinceHop >= HOP) {
        this.sinceHop -= HOP;
        this.doHop(ratio, formant, chCount);
      }

      for (let ch = 0; ch < chCount; ch += 1) {
        if (this.outQueueAvail > 0) {
          output[ch][i] = this.outQueue[ch][this.outQueueRead];
        } else {
          output[ch][i] = 0; // startup underrun: still filling the analysis FIFO
        }
      }
      if (this.outQueueAvail > 0) {
        this.outQueueRead = (this.outQueueRead + 1) % OUT_QUEUE_CAP;
        this.outQueueAvail -= 1;
      }
    }
    // mirror ch0 into any extra output channels
    for (let ch = chCount; ch < output.length; ch += 1) {
      output[ch].set(output[0].subarray(0, frames));
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchShiftProcessor);
