export interface LimiterRtState {
  gain: number;
}

export interface LimiterParams {
  ceilingLin: number;
  releaseCoef: number; // release smoothing toward unity
}

// Peak limiter gain: if the lookahead peak would exceed the ceiling, drop gain
// immediately so peak*gain == ceiling; otherwise ease gain back toward 1.
export function stepLimiter(
  s: LimiterRtState,
  lookaheadPeak: number,
  p: LimiterParams,
): LimiterRtState {
  const target = lookaheadPeak > p.ceilingLin && lookaheadPeak > 0 ? p.ceilingLin / lookaheadPeak : 1;
  const gain = target < s.gain ? target : s.gain + (1 - s.gain) * p.releaseCoef;
  return { gain };
}
