import type { IrType } from '../state';

// Per-type decay steepness (higher = faster decay). hall is the smooth baseline.
const STEEP: Record<IrType, number> = {
  room: 2.2,
  hall: 1.0,
  plate: 1.3,
  spring: 1.5,
  ambience: 3.2,
};

// Amplitude envelope (0..1) for a synthesized reverb IR, sampled at tSec seconds
// into a tail of length decaySec. e^(-6.9) ~ -60 dB, so a steepness-1 tail reaches
// ~silence at tSec = decaySec.
export function irEnvelope(type: IrType, tSec: number, decaySec: number): number {
  const span = Math.max(0.2, decaySec);
  const r = Math.min(1, Math.max(0, tSec / span)); // normalized progress 0..1
  let amp: number;
  if (type === 'plate') {
    // Denser, slightly delayed knee for a brighter sustained tail.
    amp = Math.exp(-6.9 * STEEP.plate * Math.pow(r, 1.2));
  } else {
    amp = Math.exp(-6.9 * STEEP[type] * r);
  }
  if (type === 'spring') {
    // Shallow periodic ripple ("boing").
    amp *= 1 + 0.25 * Math.sin(2 * Math.PI * 9 * r);
  }
  return Math.min(1, Math.max(0, amp));
}
