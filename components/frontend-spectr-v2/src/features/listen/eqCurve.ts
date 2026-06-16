// Pure geometry for the EQ-curve overlay drawn over the spectrum on the eq
// stage. Kept framework-free so the math is unit-testable in isolation.

export const EQ_BANDS = ['60', '150', '400', '1k', '2.4k', '6k', '12k', '16k'] as const;

/** ± gain range (dB) the curve spans top-to-bottom. */
export const EQ_DB_MAX = 15;

/** Vertical padding (px) kept clear at the top/bottom so handles don't clip. */
export const EQ_PAD = 18;

/** Horizontal centre of band `i` for a box `w` px wide. */
export function bandX(i: number, w: number): number {
  return ((i + 0.5) / EQ_BANDS.length) * w;
}

/** Map a gain (dB) to a y pixel in a box `h` px tall (0 dB = centre). */
export function dbToY(db: number, h: number, pad = EQ_PAD): number {
  const mid = h / 2;
  return mid - (db / EQ_DB_MAX) * (mid - pad);
}

/** Inverse of {@link dbToY}, clamped to the ± range. */
export function yToDb(y: number, h: number, pad = EQ_PAD): number {
  const mid = h / 2;
  const db = ((mid - y) / (mid - pad)) * EQ_DB_MAX;
  return Math.max(-EQ_DB_MAX, Math.min(EQ_DB_MAX, db));
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Smooth Catmull-Rom path (expressed as cubic béziers) through `pts`.
 * Returns '' for fewer than two points.
 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${round(pts[0].x)} ${round(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
