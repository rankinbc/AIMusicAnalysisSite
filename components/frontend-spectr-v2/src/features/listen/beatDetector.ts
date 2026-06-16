// Lightweight live onset/beat detector. Reads the 8-band energy snapshot that
// `useAudioGraph.readFrame()` already produces (BAND_EDGES_HZ = [20, 80, 250,
// 500, 1500, 4000, 8000, 12000, 20000]) — no extra FFT, no external lib. We
// watch the low/low-mid band energy (~80–500 Hz, where the kick + low-mid
// transients live) against a rolling average and fire a `beat` when the
// instantaneous energy jumps above the average by a margin, with a refractory
// window so one transient can't double-trigger.
//
// This is intentionally simple and frame-rate driven: the caller pushes one
// frame per rAF tick with a monotonic timestamp (performance.now()).

export interface BeatInfo {
  /** True on the frame a beat onset is detected (one-shot per onset). */
  beat: boolean;
  /** Smoothed 0..1 energy of the watched bands (useful for intensity macros). */
  energy: number;
}

export interface BeatDetectorOptions {
  /** Inclusive band index range to sum for the detection signal. */
  loBand?: number;
  hiBand?: number;
  /** How fast the rolling average tracks (0..1, higher = slower/steadier). */
  averageInertia?: number;
  /** Energy must exceed average * sensitivity to count as a beat. */
  sensitivity?: number;
  /** Minimum gap between beats in ms (refractory). 300ms ≈ 200 BPM ceiling. */
  refractoryMs?: number;
  /** Floor so near-silence never triggers on noise. */
  minEnergy?: number;
}

export interface BeatDetector {
  /** Push one frame's band averages + timestamp; returns this frame's verdict. */
  push: (bandAverages: ArrayLike<number>, nowMs: number) => BeatInfo;
  /** Reset rolling state (e.g. on seek or track change). */
  reset: () => void;
}

const DEFAULTS: Required<BeatDetectorOptions> = {
  loBand: 0,
  hiBand: 2,
  averageInertia: 0.92,
  sensitivity: 1.35,
  refractoryMs: 300,
  minEnergy: 0.02,
};

export function createBeatDetector(options: BeatDetectorOptions = {}): BeatDetector {
  const cfg = { ...DEFAULTS, ...options };
  let average = 0;
  let smoothedEnergy = 0;
  let lastBeatMs = -Infinity;

  return {
    push(bandAverages, nowMs) {
      // Sum the watched bands into one instantaneous energy value.
      let energy = 0;
      let count = 0;
      for (let i = cfg.loBand; i <= cfg.hiBand; i += 1) {
        const v = bandAverages[i];
        if (typeof v === 'number' && Number.isFinite(v)) {
          energy += v;
          count += 1;
        }
      }
      energy = count > 0 ? energy / count : 0;
      smoothedEnergy = smoothedEnergy * 0.6 + energy * 0.4;

      // Compare to the rolling average BEFORE folding this frame in, so a beat
      // is "louder than the recent past" rather than louder than itself.
      const isLoud = energy > cfg.minEnergy && energy > average * cfg.sensitivity;
      const refractoryOk = nowMs - lastBeatMs >= cfg.refractoryMs;
      const beat = isLoud && refractoryOk;
      if (beat) lastBeatMs = nowMs;

      // Update rolling average (exponential moving average).
      average = average * cfg.averageInertia + energy * (1 - cfg.averageInertia);

      return { beat, energy: smoothedEnergy };
    },
    reset() {
      average = 0;
      smoothedEnergy = 0;
      lastBeatMs = -Infinity;
    },
  };
}
