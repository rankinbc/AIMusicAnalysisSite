// "Drop" detector: fires a one-shot when the track energy collapses (a
// breakdown) and then slams back up (the drop). Fed the same low-band energy
// the beat detector produces. Purely relative to a slowly-decaying rolling
// peak, so it works regardless of the absolute level.
//
// State machine:
//   idle  --(energy falls below peak*quietRatio)-->  armed
//   armed --(energy rises above peak*slamRatio)-->   DROP! -> idle (refractory)
//   armed --(armWindow elapses with no slam)-->      idle (gave up)

export interface DropDetectorOptions {
  /** Arm when energy drops below peak * quietRatio. */
  quietRatio?: number;
  /** Fire when, once armed, energy exceeds peak * slamRatio. */
  slamRatio?: number;
  /** Ignore everything until the rolling peak exceeds this floor. */
  minPeak?: number;
  /** Min gap between drops (ms). */
  refractoryMs?: number;
  /** Disarm if no slam arrives within this window (ms). */
  armWindowMs?: number;
  /** Per-push multiplicative decay of the rolling peak (≈half-life). */
  peakDecay?: number;
}

export interface DropInfo {
  /** True on the single frame a drop is detected. */
  drop: boolean;
  /** Current state, exposed for UI/debug. */
  armed: boolean;
}

export interface DropDetector {
  push: (energy: number, nowMs: number) => DropInfo;
  reset: () => void;
}

const DEFAULTS: Required<DropDetectorOptions> = {
  quietRatio: 0.4,
  slamRatio: 0.7,
  minPeak: 0.04,
  refractoryMs: 4000,
  armWindowMs: 12000,
  peakDecay: 0.999,
};

export function createDropDetector(options: DropDetectorOptions = {}): DropDetector {
  const cfg = { ...DEFAULTS, ...options };
  let peak = 0;
  let armed = false;
  let armedAtMs = 0;
  let lastDropMs = -Infinity;

  return {
    push(energy, nowMs) {
      peak = Math.max(energy, peak * cfg.peakDecay);

      if (!armed) {
        if (peak > cfg.minPeak && energy < peak * cfg.quietRatio) {
          armed = true;
          armedAtMs = nowMs;
        }
        return { drop: false, armed };
      }

      // armed
      if (energy > peak * cfg.slamRatio && nowMs - lastDropMs >= cfg.refractoryMs) {
        armed = false;
        lastDropMs = nowMs;
        return { drop: true, armed: false };
      }
      if (nowMs - armedAtMs >= cfg.armWindowMs) {
        armed = false; // timed out waiting for the slam
      }
      return { drop: false, armed };
    },
    reset() {
      peak = 0;
      armed = false;
      armedAtMs = 0;
      lastDropMs = -Infinity;
    },
  };
}
