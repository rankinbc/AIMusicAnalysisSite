import type { Phase1LoudnessSeries, Phase1Segment } from '../../api/types';

// Pure geometry helpers for the new Track Analysis panels — kept out of the
// components so they fast-refresh and are unit-testable.

export interface TimelinePoint {
  x: number;
  y: number;
}

/** Map a loudness window series to polyline points in a [0..width] × [0..height]
 *  box. Y is inverted (louder = higher on screen). Returns [] when the series is
 *  missing, too short, or length-mismatched (degrade to no chart). */
export function timelinePoints(
  series: Phase1LoudnessSeries | undefined,
  width: number,
  height: number,
  floor = -40,
  ceil = 0,
): TimelinePoint[] {
  const t = series?.t;
  const l = series?.lufs;
  if (!t || !l || t.length < 2 || t.length !== l.length) return [];
  const tMax = t[t.length - 1] || 1;
  const span = Math.max(0.0001, ceil - floor);
  return t.map((ti, i) => {
    const lv = Math.max(floor, Math.min(ceil, l[i]));
    return { x: (ti / tMax) * width, y: height - ((lv - floor) / span) * height };
  });
}

export function pointsToPolyline(pts: TimelinePoint[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export interface SegmentBand {
  label: string;
  leftPct: number;
  widthPct: number;
}

/** Structure segments → proportional bands over [0..100]% given total duration.
 *  Empty when structure is unavailable (allin1 not run) — callers degrade cleanly. */
export function segmentBands(
  segments: Phase1Segment[] | undefined,
  durationSec: number | undefined,
): SegmentBand[] {
  if (!segments || segments.length === 0 || !durationSec || durationSec <= 0) return [];
  return segments
    .filter((s) => s.end > s.start)
    .map((s) => ({
      label: s.label,
      leftPct: Math.max(0, Math.min(100, (s.start / durationSec) * 100)),
      widthPct: Math.max(0, Math.min(100, ((s.end - s.start) / durationSec) * 100)),
    }));
}
