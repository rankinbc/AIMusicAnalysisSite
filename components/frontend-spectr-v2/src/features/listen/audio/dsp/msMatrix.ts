// Channel-matrix gains for the M/S width control. width=1 identity, width=0
// mono, width=2 exaggerated. Wired as:
//   L_out = L_in*midL + R_in*sideL ; R_out = L_in*midR + R_in*sideR
export function msGains(width: number): {
  midL: number;
  midR: number;
  sideL: number;
  sideR: number;
} {
  return {
    midL: 0.5 + 0.5 * width,
    midR: 0.5 - 0.5 * width,
    sideL: 0.5 - 0.5 * width,
    sideR: 0.5 + 0.5 * width,
  };
}
