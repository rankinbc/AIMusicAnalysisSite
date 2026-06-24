// Bipolar DJ-filter morph knob. morph 0 = fully open (transparent lowpass at the
// top of the audband); morph<0 sweeps a lowpass down; morph>0 sweeps a highpass
// up. Cutoff is log-mapped so the sweep feels even by ear.
function logMap(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return a * Math.pow(b / a, u);
}

export function djMorph(morph: number): { type: BiquadFilterType; freq: number } {
  const m = Math.min(1, Math.max(-1, morph));
  if (m <= 0) {
    // -m in 0..1: 0 -> 20000 (open), 1 -> 30 (closed-ish lowpass)
    return { type: 'lowpass', freq: logMap(20000, 30, -m) };
  }
  // m in 0..1: 0 -> 20 (open), 1 -> 18000 (closed-ish highpass)
  return { type: 'highpass', freq: logMap(20, 18000, m) };
}
