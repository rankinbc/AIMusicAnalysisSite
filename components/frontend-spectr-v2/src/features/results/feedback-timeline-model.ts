// Pure helpers for the Notes tab timeline (v4). Numeric seconds only — never
// parse "m:ss" strings (the wire carries numbers; prototype anti-pattern).

import type { NoteDto } from '../../api/types';

export interface TimelineMarker {
  t: number;
  label: string;
  detail: string;
}

export function mmss(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Timestamped owner notes → timeline markers. */
export function noteMarkers(notes: NoteDto[]): TimelineMarker[] {
  return notes
    .filter((n) => n.tSeconds > 0)
    .map((n) => ({ t: n.tSeconds, label: 'Note', detail: n.text }))
    .sort((a, b) => a.t - b.t);
}

/** 0..100 left-position percentage for a marker. */
export function markerPct(t: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.max(0, Math.min(100, (t / durationSec) * 100));
}
