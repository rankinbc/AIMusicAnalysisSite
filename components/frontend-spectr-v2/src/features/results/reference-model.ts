import type { Phase1Data, Phase5Data, Phase6Data, Phase6Gap } from '../../api/types';

// Pure model for the Reference tab: maps the real phase-5 (uploaded reference)
// and phase-6 (genre gap analysis) payloads into the two-section, per-metric
// view the redesign renders. Kept out of the component so it fast-refreshes and
// is unit-testable. See ReferenceTab.tsx for the rendering.

/** The ONLY metrics with a real genre distribution — phase-6 profiles map just
 *  these three. Never draw a percentile/range bar for anything else. */
export const GENRE_METRIC_WHITELIST = ['bpm', 'stereo_width', 'stereo_correlation'] as const;

const GENRE_LABELS: Record<string, { label: string; unit: string }> = {
  bpm: { label: 'Tempo', unit: 'BPM' },
  stereo_width: { label: 'Stereo width', unit: '' },
  stereo_correlation: { label: 'Stereo correlation', unit: '' },
};

const DELTA_LABELS: Record<string, { label: string; unit: string; scale: number }> = {
  lufs: { label: 'Integrated loudness', unit: 'LUFS', scale: 6 },
  rms: { label: 'RMS level', unit: 'dB', scale: 6 },
  stereo_correlation: { label: 'Stereo correlation', unit: '', scale: 0.5 },
  band_sub_bass: { label: 'Sub-bass', unit: 'dB', scale: 6 },
  band_bass: { label: 'Bass', unit: 'dB', scale: 6 },
  band_low_mid: { label: 'Low mid', unit: 'dB', scale: 6 },
  band_mid: { label: 'Mid', unit: 'dB', scale: 6 },
  band_upper_mid: { label: 'Upper mid', unit: 'dB', scale: 6 },
  band_presence: { label: 'Presence', unit: 'dB', scale: 6 },
  band_air: { label: 'Air', unit: 'dB', scale: 6 },
};

export interface GenreGapMetric {
  key: string;
  label: string;
  unit: string;
  user: number;
  mean: number;
  pct: number;
  domMin: number;
  domMax: number;
  rangeLo: number;
  rangeHi: number;
  inRange: boolean;
  /** ◇ reference overlay — only when a reference is attached AND the metric has
   *  a reference value in phase5.deltas (in practice: stereo_correlation only). */
  ref: number | null;
  description?: string;
}

export interface GenreSection {
  /** Whether phase 6 produced a real placement — drives the honest "can't place you" state. */
  confident: boolean;
  percentile: number | null;
  inRange: number;
  total: number;
  metrics: GenreGapMetric[];
}

export interface RefDeltaRow {
  key: string;
  label: string;
  unit: string;
  user: number | null;
  ref: number | null;
  delta: number;
  /** Normalized signed magnitude in [-1, 1] for the diverging bar. */
  mag: number;
  warn: boolean;
}

export interface RefCheck {
  key: string;
  message: string;
  tone: string;
}

export interface RefStemDelta {
  role: string;
  metric: string;
  user: number | null;
  ref: number | null;
  delta: number | null;
  interpretation: string;
  tier: string;
  warn: boolean;
}

export interface ReferenceSection {
  attached: boolean;
  deltas: RefDeltaRow[];
  checks: RefCheck[];
  perStem: RefStemDelta[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isWarn = (severity: string | undefined) =>
  severity != null && severity !== 'ok' && severity !== 'minor';

/** The user's phase-1 value backing a phase-5 delta key (delta = user − ref). */
function userValueForDeltaKey(key: string, phase1: Phase1Data | undefined): number | null {
  if (!phase1) return null;
  if (key === 'lufs') return phase1.lufs ?? null;
  if (key === 'rms') return phase1.rms ?? null;
  if (key === 'stereo_correlation') return phase1.stereo_correlation ?? null;
  if (key.startsWith('band_')) {
    const band = key.slice('band_'.length) as keyof NonNullable<Phase1Data['bands']>;
    return phase1.bands?.[band] ?? null;
  }
  return null;
}

/** "Compared to your genre" — phase 6, whitelisted to the 3 placed metrics. The
 *  ◇ reference value is derived from phase 5 only where it genuinely exists. */
export function buildGenreSection(
  phase6: Phase6Data | undefined,
  phase5: Phase5Data | undefined,
): GenreSection {
  const percentile = phase6?.percentile != null ? Math.round(phase6.percentile) : null;
  const gaps = phase6?.gaps ?? {};
  const refAttached = phase5?.status === 'ok';

  const metrics: GenreGapMetric[] = [];
  for (const key of GENRE_METRIC_WHITELIST) {
    const gap: Phase6Gap | undefined = gaps[key];
    if (!gap) continue;
    const meta = GENRE_LABELS[key];
    const std = gap.genre_std || 0;
    const domMin = Math.min(gap.acceptable_range[0], gap.user_val, gap.genre_mean - 2 * std);
    const domMax = Math.max(gap.acceptable_range[1], gap.user_val, gap.genre_mean + 2 * std);
    // The only shared metric with a real reference value is stereo_correlation
    // (phase5.deltas has lufs/rms/stereo_correlation/band_* — not bpm/width).
    let ref: number | null = null;
    if (refAttached && key === 'stereo_correlation') {
      const d = phase5?.deltas?.stereo_correlation?.value;
      if (d != null) ref = gap.user_val - d;
    }
    metrics.push({
      key,
      label: meta.label,
      unit: meta.unit,
      user: gap.user_val,
      mean: gap.genre_mean,
      pct: Math.round(gap.percentile),
      domMin,
      domMax,
      rangeLo: gap.acceptable_range[0],
      rangeHi: gap.acceptable_range[1],
      inRange: gap.in_range,
      ref,
      description: gap.description,
    });
  }

  return {
    // A real percentile means we CAN place the mix (show the ring), even if no
    // per-metric gap rows are available. Absent percentile → honest can't-place.
    confident: percentile != null,
    percentile,
    inRange: metrics.filter((m) => m.inRange).length,
    total: metrics.length,
    metrics,
  };
}

/** "Compared to your reference" — phase 5. Deltas carry only the signed Δ +
 *  severity; the absolute "you" value comes from phase 1 and ref = you − Δ. */
export function buildReferenceSection(
  phase5: Phase5Data | undefined,
  phase1: Phase1Data | undefined,
): ReferenceSection {
  const attached = phase5?.status === 'ok' && phase5?.deltas != null;
  const deltas: RefDeltaRow[] = [];
  if (attached && phase5?.deltas) {
    for (const [key, d] of Object.entries(phase5.deltas)) {
      const meta = DELTA_LABELS[key] ?? { label: key.replace(/_/g, ' '), unit: '', scale: 6 };
      const delta = d.value ?? 0;
      const user = userValueForDeltaKey(key, phase1);
      const ref = user != null ? user - delta : null;
      deltas.push({
        key,
        label: meta.label,
        unit: meta.unit,
        user,
        ref,
        delta,
        mag: clamp(delta / meta.scale, -1, 1),
        warn: isWarn(d.severity),
      });
    }
  }

  const checks: RefCheck[] = phase5?.genre_context?.checks
    ? Object.entries(phase5.genre_context.checks).map(([key, c]) => ({
        key,
        message: c.message,
        tone: c.status,
      }))
    : [];

  const perStem: RefStemDelta[] = (phase5?.per_stem_reference_deltas ?? []).map((s) => ({
    role: s.role ?? '',
    metric: s.metric ?? '',
    user: s.user_value ?? null,
    ref: s.reference_value ?? null,
    delta: s.delta ?? null,
    interpretation: s.interpretation ?? '',
    tier: s.severity_tier ?? 'minor',
    warn: isWarn(s.severity_tier),
  }));

  return { attached: Boolean(attached), deltas, checks, perStem };
}
