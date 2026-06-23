// Equal-gain dry/wet split. amount is the wet fraction (0 = bypass, 1 = full
// effect). Used by every EffectUnit's bypass + mix control.
export function wetDryGains(amount: number): { dry: number; wet: number } {
  const a = Math.max(0, Math.min(1, amount));
  return { dry: 1 - a, wet: a };
}
