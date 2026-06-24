export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

// One-pole smoothing coefficient for a `ms` time constant at sample rate `sr`.
// Used as: value += (target - value) * coef.  ms <= 0 => 1 (instantaneous).
export function msToCoef(ms: number, sr: number): number {
  if (ms <= 0) return 1;
  return 1 - Math.exp(-1 / ((ms / 1000) * sr));
}
