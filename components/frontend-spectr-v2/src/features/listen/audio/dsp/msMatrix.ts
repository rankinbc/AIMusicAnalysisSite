// Channel-matrix gains for the M/S width control. width=1 identity, width=0
// mono, width=2 exaggerated. midGain/sideGain are linear bus gains (default 1).
// Derivation: L_out = gM*M + gS*w*S, R_out = gM*M - gS*w*S, where M=(L+R)/2,
// S=(L-R)/2. Wired as:
//   L_out = L_in*midL + R_in*sideL ; R_out = L_in*midR + R_in*sideR
export function msGains(
  width: number,
  midGain = 1,
  sideGain = 1,
): { midL: number; midR: number; sideL: number; sideR: number } {
  const a = 0.5 * (midGain + sideGain * width);
  const b = 0.5 * (midGain - sideGain * width);
  return { midL: a, midR: b, sideL: b, sideR: a };
}
