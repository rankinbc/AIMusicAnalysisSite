// Auto-color: derive a hue from the spectral centroid so the palette tracks the
// music — bassy material reads warm (orange/red), bright material reads cool
// (cyan/blue). Pure + testable; the page loop calls these and writes the
// resulting CSS color to --viz-bar / --viz-bg.

/**
 * Spectral centroid as a 0..1 fraction of the bin range (0 = all low energy,
 * 1 = all high). Returns 0.5 (neutral) for a silent/empty frame so the color
 * doesn't lurch on silence.
 */
export function spectralCentroidNorm(bins: ArrayLike<number>): number {
  const n = bins.length;
  if (n === 0) return 0.5;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const m = bins[i];
    if (m > 0) {
      weighted += i * m;
      total += m;
    }
  }
  if (total <= 0) return 0.5;
  return weighted / total / (n - 1 || 1);
}

const HUE_WARM = 30; // orange (bass)
const HUE_COOL = 230; // blue (bright)

/** Map a 0..1 centroid to a hue in degrees. Low → warm, high → cool. */
export function hueFromCentroid(norm: number): number {
  const t = Math.max(0, Math.min(1, norm));
  // The centroid rarely reaches the extremes, so bias it up a bit for range.
  const boosted = Math.pow(t, 0.6);
  return HUE_WARM + boosted * (HUE_COOL - HUE_WARM);
}

/** Bar color (vivid) for a hue. */
export function barColorForHue(hue: number): string {
  return `hsl(${Math.round(hue)}, 82%, 60%)`;
}

/** Backdrop color (very dark, same hue) for a hue. */
export function bgColorForHue(hue: number): string {
  return `hsl(${Math.round(hue)}, 38%, 7%)`;
}
