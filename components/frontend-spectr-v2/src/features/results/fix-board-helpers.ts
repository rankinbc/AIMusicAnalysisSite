// Pure helpers shared by the dual-mode FixBoard (Findings/Actions) and its
// extracted detail panels. Kept out of the component files for react-refresh
// and unit-testability.

import type { VerdictDto } from '../../api/types';
import { severityLabel } from './helpers/severity';
import { SPECIALIST_CATALOG, specialistGroup, type SpecialistGroup } from './helpers/specialists';

export const SEV_ORDER = ['critical', 'severe', 'moderate', 'minor', 'win'] as const;
export type Sev = (typeof SEV_ORDER)[number];

// One of the 7 display groups: prefer the specialist's group, else infer from
// the category so rule-engine findings still slot in (mirrors FindingsTab).
export function groupForVerdict(v: VerdictDto): SpecialistGroup {
  const g = specialistGroup(v.specialist);
  if (g) return g;
  const c = `${v.category} ${v.specialist}`.toLowerCase();
  if (/lufs|loud|peak|clip|gain|stream/.test(c)) return 'Loudness';
  if (/stereo|width|mono|phase|spatial|surround/.test(c)) return 'Stereo';
  if (/section|arrange|structure|contrast/.test(c)) return 'Sections';
  if (/stem/.test(c)) return 'Stems';
  if (/dynamic|transient|density|humaniz/.test(c)) return 'Dynamics';
  if (/freq|spectr|band|low_end|low-end|tonal|mud|air|clarity|harmonic|balance/.test(c))
    return 'Spectrum';
  return 'Misc';
}

/** Color per finding group (prototype AR_GROUP_COLOR). */
export const GROUP_COLOR: Record<SpecialistGroup, string> = {
  Spectrum: '#00e5b0',
  Loudness: '#fb923c',
  Dynamics: '#a78bfa',
  Stereo: '#7aa2f7',
  Sections: '#c084fc',
  Stems: '#f472b6',
  Misc: '#60a5fa',
};

/** Plain-language description per group (chip tooltip). */
export const GROUP_DESC: Record<SpecialistGroup, string> = {
  Spectrum: 'Frequency balance — how energy is spread from sub bass to air, and whether any band is heavy or missing.',
  Loudness: 'Overall level — LUFS, peaks and headroom, and how the track meets streaming/club loudness targets.',
  Dynamics: 'Punch and movement — how much the level breathes vs how compressed/limited it is.',
  Stereo: 'The stereo image — width, left/right balance, and whether the track survives mono playback.',
  Sections: 'Arrangement-level checks — how intros, drops and breakdowns compare across the timeline.',
  Stems: 'Per-instrument buses — issues measured inside your uploaded stems, like two parts fighting for the same frequencies.',
  Misc: 'Everything else — overall scoring and summary checks.',
};

/** General per-group tips for note-only items (manual DAW moves, no chain). */
export const GROUP_TIP: Record<SpecialistGroup, string> = {
  Spectrum: 'Sweep a narrow EQ boost across the suspect range to find the exact spot, then cut there gently (wide Q, 1–3 dB). Re-check against a reference after each pass.',
  Loudness: 'Work the gain staging before the limiter: trim channel levels so the master peaks around −6 dBFS, then let the limiter do only the last 2–3 dB.',
  Dynamics: 'Ease off the heaviest compressor (slower attack, 2–3 dB less reduction) and automate levels instead — movement you ride by hand always sounds more alive.',
  Stereo: 'Keep everything below ~120 Hz mono, push width in pads/FX with mid-side EQ, and A/B the mono sum so nothing collapses on club systems.',
  Sections: 'Compare the energy of each section against the drop: mute busses per section until the arrangement breathes — contrast is what makes the drop land.',
  Stems: 'Solo the two stems together and carve complementary pockets: cut in one where the other lives, or sidechain the sustained part to the transient one.',
  Misc: 'Bounce a snapshot, take 20 minutes away, and A/B against two reference tracks at matched loudness — fresh ears find these faster than tools.',
};

export function sevTitle(sev: string): string {
  const label = severityLabel(sev);
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

export function specName(v: VerdictDto): string {
  const known = SPECIALIST_CATALOG.find((x) => x.slug === v.specialist);
  if (known) return known.label;
  return (v.category || 'Measured')
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Fallback why-it-matters copy when the verdict carries none (arDefaultWhy). */
export function defaultWhy(v: VerdictDto): string {
  if (v.severity === 'win')
    return 'This is working in your favor — keep it intact through any revisions.';
  return `${groupForVerdict(v)} issues shape how the track translates — streaming normalization, small speakers, and club systems all react to it. The earlier it’s addressed, the less it compounds through the rest of the mix.`;
}

/** The P-chip hover copy — full breakdown when persisted, score-only for
 *  legacy rows (nullable columns are NOT backfilled). */
export function priorityTip(v: VerdictDto): string {
  if (v.priorityBase != null && v.priorityCategoryWeight != null && v.priorityScopeMultiplier != null) {
    const scope = (v.scope ?? 'full_track').replace(/_/g, ' ');
    return `Priority ${v.priorityScore} on the raw ~20–300 scale: severity base ${v.priorityBase} × category weight ×${v.priorityCategoryWeight} × ${scope} scope ×${v.priorityScopeMultiplier}. Higher = worth fixing sooner; the list is sorted by it.`;
  }
  return `Priority ${v.priorityScore} on the raw ~20–300 scale. Higher = worth fixing sooner; the list is sorted by it.`;
}

export const TIER_CHIP_LABEL: Record<string, string> = {
  audio_only: 'audio only',
  stems: 'stems',
  project_midi: 'project + MIDI',
};

export function tierTip(tier: string): string {
  if (tier === 'stems') return 'What data this detection used — your uploaded stems, so it can point at specific instruments.';
  if (tier === 'project_midi') return 'What data this detection used — your project file, down to devices and MIDI.';
  return 'What data this detection used — just the bounced audio; uploading stems or your project can sharpen it.';
}

/** Source-tag tooltip copy (Measured vs AI). */
export function sourceTip(v: VerdictDto, spec: string | null): string {
  return v.source === 'llm_identifier'
    ? `Source: ${spec ? `${spec} specialist` : 'AI specialist'} — an AI read of the measurements, so treat it as a strong suggestion rather than a hard number.`
    : `Source: ${spec ? `${spec} · ` : ''}rule engine — measured directly from your audio by the analysis engine. A hard number, the same every time it runs.`;
}

/** Fix-target label for the device/scope filter: "Master" bucket or the raw
 *  target name. Null when the finding has no fix. */
export function deviceOf(scope: string | null): string | null {
  if (!scope) return null;
  return /^master/i.test(scope) ? 'Master' : scope;
}

// ── Filter state (FixBoardFilters) — kept here for react-refresh. ──
export interface FilterState {
  fixableOnly: boolean;
  groups: ReadonlySet<string>;
  devices: ReadonlySet<string>;
  minPriority: number;
}

export const EMPTY_FILTERS: FilterState = {
  fixableOnly: false,
  groups: new Set<string>(),
  devices: new Set<string>(),
  minPriority: 0,
};

export function countActiveFilters(f: FilterState): number {
  return (
    (f.fixableOnly ? 1 : 0) + f.groups.size + f.devices.size + (f.minPriority > 0 ? 1 : 0)
  );
}

/** Numeric param → display string (op racks, move steps). */
export function formatParam(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v === null || v === undefined) return '';
  return String(v);
}
