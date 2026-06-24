export interface GateRtState {
  env: number; // detector level follower
  gain: number; // current gate gain
  hold: number; // remaining hold samples
}

export interface GateParams {
  thresholdLin: number;
  floorLin: number;
  attackCoef: number; // rising gain smoothing (toward 1)
  releaseCoef: number; // falling gain smoothing (toward floor)
  holdSamples: number;
}

// Detector release per sample: the level follower rises instantly, falls slowly,
// so brief dips don't chatter the gate.
const ENV_DECAY = 0.05;

export function stepGate(s: GateRtState, x: number, p: GateParams): GateRtState {
  const a = Math.abs(x);
  const env = a > s.env ? a : a + (s.env - a) * ENV_DECAY;

  let hold = s.hold;
  let target: number;
  if (env >= p.thresholdLin) {
    hold = p.holdSamples;
    target = 1;
  } else if (hold > 0) {
    hold = hold - 1;
    target = 1;
  } else {
    target = p.floorLin;
  }

  const coef = target > s.gain ? p.attackCoef : p.releaseCoef;
  const gain = s.gain + (target - s.gain) * coef;
  return { env, gain, hold };
}
