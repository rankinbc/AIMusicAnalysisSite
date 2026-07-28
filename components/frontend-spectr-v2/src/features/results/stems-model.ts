// Pure model helpers for the Stems tab (v4). Narrowing parsers over
// `phase4.stems` (jsonb `Record<string, unknown>` on the wire) — grouped mode
// (per_stem dict keyed by ROLE) and per_stem mode (per_stem_list rows keyed by
// file label) both normalize into StemEntry[].
//
// Band-key gotcha: per-stem `band_energy_db` uses `sub`; the TOP-LEVEL
// phase4.band_energy uses `sub_bass`. Do not share key lists.

import type { Phase5PerStemDelta } from '../../api/types';

export const STEM_BAND_KEYS = [
  'sub',
  'bass',
  'low_mid',
  'mid',
  'high_mid',
  'presence',
  'air',
] as const;

export const STEM_BAND_LABEL: Record<(typeof STEM_BAND_KEYS)[number], string> = {
  sub: 'Sub',
  bass: 'Bass',
  low_mid: 'Lo-mid',
  mid: 'Mid',
  high_mid: 'Hi-mid',
  presence: 'Pres',
  air: 'Air',
};

export interface StemMetrics {
  duration_s: number | null;
  peak_db: number | null;
  rms_db: number | null;
  lufs_integrated: number | null;
  dynamic_range_db: number | null;
  band_energy_db: Partial<Record<(typeof STEM_BAND_KEYS)[number], number>>;
  spectral_centroid_hz: number | null;
  dominant_frequencies_hz: number[];
  stereo_width: number | null;
  pan_estimate: number | null;
  is_mono: boolean | null;
}

export interface StemEntry {
  /** Row key — the role (grouped mode) or the file label (per_stem mode). */
  key: string;
  role: string;
  metrics: StemMetrics;
}

export interface StemClash {
  stem_a: string;
  stem_b: string;
  band: string;
  overlap_severity: number;
  severity_tier: string;
}

export interface StemBalanceFlag {
  role: string;
  metric: string;
  observed: number;
  expected_range: [number, number] | null;
  direction: string;
  severity_tier: string;
}

export interface StemsAnalysis {
  mode: 'grouped' | 'per_stem';
  entries: StemEntry[];
  clashes: StemClash[];
  balanceFlags: StemBalanceFlag[];
  /** per_stem mode only: clash pairs were capped (loudest stems kept). */
  truncated: boolean;
}

const ROLE_ORDER = [
  'kick',
  'bass',
  'drums',
  'snare',
  'hats',
  'vocals',
  'lead',
  'pad',
  'fx',
  'other',
];

function roleRank(role: string): number {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseMetrics(raw: Record<string, unknown>): StemMetrics {
  const bandsRaw = raw.band_energy_db;
  const bands: StemMetrics['band_energy_db'] = {};
  if (bandsRaw && typeof bandsRaw === 'object') {
    for (const k of STEM_BAND_KEYS) {
      const v = num((bandsRaw as Record<string, unknown>)[k]);
      if (v != null) bands[k] = v;
    }
  }
  const dom = Array.isArray(raw.dominant_frequencies_hz)
    ? raw.dominant_frequencies_hz.filter((x): x is number => typeof x === 'number')
    : [];
  return {
    duration_s: num(raw.duration_s),
    peak_db: num(raw.peak_db),
    rms_db: num(raw.rms_db),
    lufs_integrated: num(raw.lufs_integrated),
    dynamic_range_db: num(raw.dynamic_range_db),
    band_energy_db: bands,
    spectral_centroid_hz: num(raw.spectral_centroid_hz),
    dominant_frequencies_hz: dom,
    stereo_width: num(raw.stereo_width),
    pan_estimate: num(raw.pan_estimate),
    is_mono: typeof raw.is_mono === 'boolean' ? raw.is_mono : null,
  };
}

function parseClashes(raw: unknown): StemClash[] {
  if (!Array.isArray(raw)) return [];
  const out: StemClash[] = [];
  for (const c of raw) {
    if (c == null || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    if (typeof o.stem_a !== 'string' || typeof o.stem_b !== 'string') continue;
    out.push({
      stem_a: o.stem_a,
      stem_b: o.stem_b,
      band: typeof o.band === 'string' ? o.band : '',
      overlap_severity: num(o.overlap_severity) ?? 0,
      severity_tier: typeof o.severity_tier === 'string' ? o.severity_tier : 'info',
    });
  }
  return out;
}

function parseBalanceFlags(raw: unknown): StemBalanceFlag[] {
  if (!Array.isArray(raw)) return [];
  const out: StemBalanceFlag[] = [];
  for (const b of raw) {
    if (b == null || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    if (typeof o.role !== 'string' || typeof o.metric !== 'string') continue;
    const er = Array.isArray(o.expected_range) && o.expected_range.length === 2
      ? ([num(o.expected_range[0]) ?? 0, num(o.expected_range[1]) ?? 0] as [number, number])
      : null;
    out.push({
      role: o.role,
      metric: o.metric,
      observed: num(o.observed) ?? 0,
      expected_range: er,
      direction: typeof o.direction === 'string' ? o.direction : '',
      severity_tier: typeof o.severity_tier === 'string' ? o.severity_tier : 'info',
    });
  }
  return out;
}

/** `phase4.stems` (unknown) → normalized analysis, or null unless status==='ok'. */
export function parseStemsAnalysis(raw: unknown): StemsAnalysis | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.status !== 'ok') return null;

  if (o.mode === 'per_stem') {
    const list = Array.isArray(o.per_stem_list) ? o.per_stem_list : [];
    const entries: StemEntry[] = [];
    for (const row of list) {
      if (row == null || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const key = typeof r.id === 'string' ? r.id : null;
      if (!key) continue;
      entries.push({
        key,
        role: typeof r.role === 'string' ? r.role : 'other',
        metrics: parseMetrics(r),
      });
    }
    entries.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.key.localeCompare(b.key));
    return {
      mode: 'per_stem',
      entries,
      clashes: parseClashes(o.clash_matrix),
      balanceFlags: [],
      truncated: o.truncated === true,
    };
  }

  const perStem = o.per_stem;
  if (perStem == null || typeof perStem !== 'object') return null;
  const entries: StemEntry[] = Object.entries(perStem as Record<string, unknown>)
    .filter((pair): pair is [string, Record<string, unknown>] => {
      const v = pair[1];
      return v != null && typeof v === 'object';
    })
    .map(([role, m]) => ({ key: role, role, metrics: parseMetrics(m) }));
  entries.sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.role.localeCompare(b.role));
  return {
    mode: 'grouped',
    entries,
    clashes: parseClashes(o.clash_matrix),
    balanceFlags: parseBalanceFlags(o.balance_flags),
    truncated: false,
  };
}

/** Clashes involving one stem entry (by its key). */
export function clashesForStem(clashes: StemClash[], key: string): StemClash[] {
  return clashes.filter((c) => c.stem_a === key || c.stem_b === key);
}

/** phase5 flat delta list → Map keyed by role. */
export function deltasByRole(
  deltas: Phase5PerStemDelta[] | undefined,
): Map<string, Phase5PerStemDelta[]> {
  const out = new Map<string, Phase5PerStemDelta[]>();
  for (const d of deltas ?? []) {
    if (!d.role) continue;
    const arr = out.get(d.role) ?? [];
    arr.push(d);
    out.set(d.role, arr);
  }
  return out;
}

/** 0..1 intensity for a band-energy cell, normalized across ALL entries so the
 *  grid reads as one heat surface (dB values can be wildly offset per stem). */
export function bandIntensity(
  db: number | undefined,
  min: number,
  max: number,
): number {
  if (db == null || !Number.isFinite(db) || max <= min) return 0;
  return Math.max(0.04, Math.min(1, (db - min) / (max - min)));
}

/** [min,max] over every band cell in the analysis (for bandIntensity). */
export function bandRange(entries: StemEntry[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const e of entries) {
    for (const k of STEM_BAND_KEYS) {
      const v = e.metrics.band_energy_db[k];
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min === Infinity ? [0, 1] : [min, max];
}
