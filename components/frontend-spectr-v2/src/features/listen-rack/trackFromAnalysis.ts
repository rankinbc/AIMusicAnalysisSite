/* Listen V3 — build a rack-page Track from the real version + analysis.
 *
 * Replaces the TRACK fixture (PORTING_NOTES §2) with selectors over the real
 * song/version + 7-phase analysis. Pure + unit-tested; the versioned route
 * fetches the data and calls this, the mock demo route keeps the fixture.
 */
import type { NoteDto, Phase1Data, Phase2Data, Phase7Data } from '../../api/types';
import type { Track, TrackNote, TrackSection } from './data';

export interface TrackSource {
  /** Song display name (from useSong). */
  name: string;
  phase1?: Phase1Data | undefined;
  phase2?: Phase2Data | undefined;
  phase7?: Phase7Data | undefined;
  notes?: NoteDto[] | undefined;
}

/** 0..1 ratios and 0..100 percentages both render as whole-percent. */
function asPercent(v: number | undefined): number {
  if (v == null) return 0;
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildTrack(src: TrackSource): Track {
  const p1 = src.phase1 ?? {};
  const p2 = src.phase2 ?? {};
  const p7 = src.phase7 ?? {};
  const notes = src.notes ?? [];

  const rms = p1.rms ?? 0;
  const truePeak = p1.true_peak_db ?? 0;
  // Crest factor as a dynamic-range proxy when both ends are known.
  const dynamicRange = p1.rms != null && (p1.peak_dbfs != null || p1.true_peak_db != null)
    ? Math.max(0, (p1.peak_dbfs ?? truePeak) - rms)
    : 0;

  const scores = p7.section_scores ?? [];
  const sections: TrackSection[] = scores.length
    ? scores.map((s) => ({
        t: s.section_type.toLowerCase(),
        l: titleCase(s.section_type),
        bars: Math.max(1, Math.round(s.bars)),
      }))
    : [];

  const trackNotes: TrackNote[] = notes.map((n) => ({
    id: n.id, t: n.tSeconds, text: n.text, pinned: n.pinned,
  }));

  return {
    name: src.name || '—',
    format: '',
    durationSec: Math.round(p1.duration_seconds ?? 0),
    bpm: Math.round(p1.bpm ?? p2.bpm ?? 0),
    key: p1.detected_key ?? '—',
    genre: { name: p2.genre ?? '—', confidence: asPercent(p2.confidence) },
    grade: p7.grade ?? '',
    // E6.2 — no phase1 means no completed analysis: every loudness/stereo
    // field below is a placeholder zero, not a measurement.
    analyzed: Boolean(src.phase1),
    loudness: {
      integrated: p1.lufs ?? 0,
      truePeak,
      dynamicRange,
      rms,
    },
    stereo: {
      width: asPercent(p1.stereo_width),
      correlation: p1.stereo_correlation ?? 0,
      monoCompat: p1.mono_compatibility ?? 0,
    },
    arrangement: { sections },
    notes: trackNotes,
  };
}
