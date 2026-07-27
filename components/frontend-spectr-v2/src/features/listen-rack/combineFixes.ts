// Weighted fix combiner — N selected fixes → ONE rack, order-independently.
//
// Replaces composeRack's click-order overlay for multi-fix merges. The formula
// (agreed 2026-07-27): every fix contributes with weight = impact × confidence;
// moves merge only where they genuinely overlap.
//   EQ      cluster gain moves by log-frequency (≤ half an octave apart merges;
//           farther apart ALWAYS coexist). Per cluster: weighted-geometric-mean
//           frequency; same-direction gains SUM (capped +6/−9 dB); opposite
//           directions NET via weighted mean; Q widens to span the cluster.
//           High/low-pass cutoffs merge among themselves the same way. Past the
//           rack's 8 bands, highest total weight wins; losers are logged, never
//           silently dropped.
//   trim    gains sum, clamped ±24 dB (cumulative gain-staging budget).
//   comp    weighted mean per param; ratio capped at 4:1.
//   ms      width weighted mean, clamped 50–120%; monoMakerHz = max (safest).
//   limiter SAFETY param — lowest ceiling wins, never an average.
// Budgets mirror the worker's coach_mix/interactions.py so the manual queue and
// the server Coach Mix converge on the same do-no-harm math.
import type { VerdictDspOp } from '../../api/types';
import { MODULE_DEFAULTS, type EqBand, type ModuleState } from './data';

export interface WeightedFix {
  ops: VerdictDspOp[];
  /** Relative pull in merges — impact × confidence. Missing/invalid → 1. */
  weight?: number | undefined;
}

export interface CombineOutcome {
  mod: Record<string, ModuleState>;
  /** Human-readable merge decisions (nets, caps, drops) for the Plan panel. */
  changeLog: string[];
}

// Do-no-harm budgets — keep in sync with worker/app/coach_mix/interactions.py.
const EQ_MAX_BOOST_DB = 6;
const EQ_MAX_CUT_DB = 9;
const MAX_CUMULATIVE_GAIN_DB = 24;
const COMP_RATIO_CAP = 4;
const WIDTH_BOUNDS: [number, number] = [0.5, 1.2];
/** Moves farther apart than this never merge — they're different problems. */
const CLUSTER_HALF_OCTAVES = 0.5;
const RACK_EQ_SLOTS = 8;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface WeightedVal { v: number; w: number; }

function wmean(entries: WeightedVal[]): number {
  const tw = entries.reduce((s, e) => s + e.w, 0);
  if (tw <= 0) return entries.reduce((s, e) => s + e.v, 0) / (entries.length || 1);
  return entries.reduce((s, e) => s + e.v * e.w, 0) / tw;
}

/** Weighted geometric mean — frequency lives on a log scale. */
function wgeomean(entries: WeightedVal[]): number {
  const tw = entries.reduce((s, e) => s + e.w, 0);
  if (tw <= 0) return Math.exp(entries.reduce((s, e) => s + Math.log(e.v), 0) / (entries.length || 1));
  return Math.exp(entries.reduce((s, e) => s + Math.log(e.v) * e.w, 0) / tw);
}

const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`) + 'Hz';
const fmtDb = (g: number) => `${g >= 0 ? '+' : ''}${g.toFixed(1)}dB`;

// ── EQ gain moves (peaking + shelves) ──────────────────────────────────────
interface EqMove { kind: 'peaking' | 'lowshelf' | 'highshelf'; freq: number; gain: number; q: number; w: number; }
interface MergedBand { band: EqBand; weight: number; }

function clusterGainMoves(moves: EqMove[], log: string[]): MergedBand[] {
  if (moves.length === 0) return [];
  const sorted = [...moves].sort((a, b) => a.freq - b.freq || a.gain - b.gain);
  const clusters: EqMove[][] = [];
  const maxRatio = Math.pow(2, CLUSTER_HALF_OCTAVES);
  for (const m of sorted) {
    const cur = clusters[clusters.length - 1];
    const anchor = cur?.[0]; // gap measured from the cluster's first (lowest) move
    if (anchor && m.freq / anchor.freq <= maxRatio) cur.push(m);
    else clusters.push([m]);
  }
  return clusters.map((c) => {
    const totalW = c.reduce((s, m) => s + m.w, 0);
    const freq = wgeomean(c.map((m) => ({ v: m.freq, w: m.w })));
    const sameDir = c.every((m) => m.gain >= 0) || c.every((m) => m.gain <= 0);
    let gain: number;
    if (sameDir) {
      const summed = c.reduce((s, m) => s + m.gain, 0);
      gain = clamp(summed, -EQ_MAX_CUT_DB, EQ_MAX_BOOST_DB);
      if (c.length > 1) {
        log.push(`eq @${fmtHz(freq)}: summed ${c.length} same-direction moves → ${fmtDb(gain)}`
          + (gain !== summed ? ` (capped from ${fmtDb(summed)})` : ''));
      }
    } else {
      gain = clamp(wmean(c.map((m) => ({ v: m.gain, w: m.w }))), -EQ_MAX_CUT_DB, EQ_MAX_BOOST_DB);
      log.push(`eq @${fmtHz(freq)}: netted ${c.map((m) => fmtDb(m.gain)).join(' vs ')} → ${fmtDb(gain)} (weights arbitrated)`);
    }
    const fmin = c[0].freq;
    const fmax = c[c.length - 1].freq;
    // One merged band must cover every original target: widen Q to the cluster's
    // span instead of leaving a narrow notch between the sources.
    const q = fmax > fmin
      ? clamp(freq / (fmax - fmin), 0.4, 4)
      : clamp(wmean(c.map((m) => ({ v: m.q, w: m.w }))), 0.3, 12);
    const kind = c.reduce((best, m) => (m.w > best.w ? m : best), c[0]).kind;
    return {
      band: { type: kind, freq: Math.round(freq * 10) / 10, gainDb: Math.round(gain * 100) / 100, q: Math.round(q * 100) / 100, enabled: true },
      weight: totalW,
    };
  });
}

function mergeFilters(kind: 'highpass' | 'lowpass', entries: { freq: number; q: number; w: number }[], log: string[]): MergedBand | null {
  if (entries.length === 0) return null;
  const freq = wgeomean(entries.map((e) => ({ v: e.freq, w: e.w })));
  const q = clamp(wmean(entries.map((e) => ({ v: e.q, w: e.w }))), 0.3, 4);
  if (entries.length > 1) {
    log.push(`eq ${kind} merged ${entries.length} cutoffs → ${fmtHz(freq)}`);
  }
  return {
    band: { type: kind, freq: Math.round(freq * 10) / 10, gainDb: 0, q: Math.round(q * 100) / 100, enabled: true },
    weight: entries.reduce((s, e) => s + e.w, 0),
  };
}

// ── main ───────────────────────────────────────────────────────────────────
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Merge the checked fixes' ops into one rack module map, weighted. `base` is
 *  the fix-free baseline (live rack snapshot) — untouched modules and the
 *  pitch lane are never written, same contract as composeRack. */
export function combineFixes(
  fixes: WeightedFix[],
  liveBase?: Record<string, ModuleState>,
): CombineOutcome {
  const base = JSON.parse(JSON.stringify(liveBase ?? MODULE_DEFAULTS)) as Record<string, ModuleState>;
  const log: string[] = [];

  const gainMoves: EqMove[] = [];
  const hp: { freq: number; q: number; w: number }[] = [];
  const lp: { freq: number; q: number; w: number }[] = [];
  const trims: WeightedVal[] = [];
  const comps: { p: Record<string, unknown>; w: number }[] = [];
  const limiters: { p: Record<string, unknown>; w: number }[] = [];
  const widths: { p: Record<string, unknown>; w: number }[] = [];

  for (const f of fixes) {
    const w = typeof f.weight === 'number' && Number.isFinite(f.weight) && f.weight > 0 ? f.weight : 1;
    for (const op of f.ops) {
      const p = op.params ?? {};
      switch (op.type) {
        case 'peaking_eq':
          gainMoves.push({ kind: 'peaking', freq: clamp(num(p.frequency_hz, 1000), 20, 22000), gain: num(p.gain_db, 0), q: num(p.q, 1), w });
          break;
        case 'high_shelf':
          gainMoves.push({ kind: 'highshelf', freq: clamp(num(p.frequency_hz, 10000), 20, 22000), gain: num(p.gain_db, 0), q: num(p.q, 0.7), w });
          break;
        case 'low_shelf':
          gainMoves.push({ kind: 'lowshelf', freq: clamp(num(p.frequency_hz, 80), 20, 22000), gain: num(p.gain_db, 0), q: num(p.q, 0.7), w });
          break;
        case 'high_pass':
          hp.push({ freq: clamp(num(p.frequency_hz, 30), 20, 22000), q: num(p.q, 0.7), w });
          break;
        case 'low_pass':
          lp.push({ freq: clamp(num(p.frequency_hz, 18000), 20, 22000), q: num(p.q, 0.7), w });
          break;
        case 'gain':
          trims.push({ v: num(p.gain_db, 0), w });
          break;
        case 'compressor':
          comps.push({ p, w });
          break;
        case 'limiter':
          limiters.push({ p, w });
          break;
        case 'stereo_width':
          widths.push({ p, w });
          break;
        default:
          break; // unmappable op — already flagged notApplicable upstream
      }
    }
  }

  // EQ: filters + clustered gain moves compete for the 8 slots by total weight.
  let bands: MergedBand[] = [
    mergeFilters('highpass', hp, log),
    mergeFilters('lowpass', lp, log),
    ...clusterGainMoves(gainMoves, log),
  ].filter((b): b is MergedBand => b != null);
  if (bands.length > RACK_EQ_SLOTS) {
    const ranked = [...bands].sort((a, b) => b.weight - a.weight || a.band.freq - b.band.freq);
    for (const lost of ranked.slice(RACK_EQ_SLOTS)) {
      log.push(`eq @${fmtHz(lost.band.freq)} ${fmtDb(lost.band.gainDb)} dropped — rack has ${RACK_EQ_SLOTS} bands (lowest weight lost)`);
    }
    bands = ranked.slice(0, RACK_EQ_SLOTS);
  }
  if (bands.length > 0) {
    const defaults = JSON.parse(JSON.stringify(MODULE_DEFAULTS.eq.bands)) as EqBand[];
    const baseBands = Array.isArray(base.eq?.bands) && (base.eq.bands as EqBand[]).length > 0
      ? (base.eq.bands as EqBand[]).map((b) => ({ ...b }))
      : defaults;
    bands.sort((a, b) => a.band.freq - b.band.freq);
    bands.forEach((b, i) => {
      baseBands[Math.min(i, baseBands.length - 1)] = { ...b.band };
    });
    base.eq = { ...base.eq, bands: baseBands, enabled: true };
  }

  if (trims.length > 0) {
    const summed = trims.reduce((s, t) => s + t.v, 0);
    const gainDb = clamp(summed, -MAX_CUMULATIVE_GAIN_DB, MAX_CUMULATIVE_GAIN_DB);
    if (trims.length > 1) {
      log.push(`trim: summed ${trims.length} gain moves → ${fmtDb(gainDb)}`
        + (gainDb !== summed ? ` (capped from ${fmtDb(summed)})` : ''));
    }
    base.trim = { ...base.trim, enabled: true, gainDb: Math.round(gainDb * 100) / 100 };
  }

  if (comps.length > 0) {
    const pick = (key: string, fallback: number) =>
      wmean(comps.map((c) => ({ v: num(c.p[key], fallback), w: c.w })));
    const ratio = Math.min(pick('ratio', 1), COMP_RATIO_CAP);
    base.comp = {
      ...base.comp,
      enabled: true,
      thresholdDb: Math.round(pick('threshold_db', 0) * 10) / 10,
      ratio: Math.round(ratio * 100) / 100,
      attackMs: Math.round(pick('attack_ms', 3) * 10) / 10,
      releaseMs: Math.round(pick('release_ms', 250)),
      kneeDb: Math.round(pick('knee_db', 30) * 10) / 10,
      makeupDb: Math.round(pick('makeup_gain_db', 0) * 10) / 10,
    };
    if (comps.length > 1) log.push(`comp: weighted-averaged ${comps.length} settings (ratio capped at ${COMP_RATIO_CAP}:1)`);
  }

  if (limiters.length > 0) {
    // Safety param: the lowest ceiling always wins — never averaged.
    const ceiling = Math.min(...limiters.map((l) => num(l.p.ceiling_db, -1)));
    base.limiter = {
      ...base.limiter,
      enabled: true,
      ceilingDb: Math.round(clamp(ceiling, -6, 0) * 100) / 100,
      releaseMs: Math.round(wmean(limiters.map((l) => ({ v: num(l.p.release_ms, 50), w: l.w })))),
      lookaheadMs: Math.round(wmean(limiters.map((l) => ({ v: num(l.p.lookahead_ms, 5), w: l.w }))) * 10) / 10,
    };
    if (limiters.length > 1) log.push(`limiter: kept lowest ceiling ${fmtDb(ceiling)} of ${limiters.length} fixes (safety)`);
  }

  if (widths.length > 0) {
    const width = clamp(
      wmean(widths.map((s) => ({ v: num(s.p.width_pct, 100) / 100, w: s.w }))),
      WIDTH_BOUNDS[0], WIDTH_BOUNDS[1],
    );
    const monos = widths.map((s) => num(s.p.mono_below_hz, 0)).filter((v) => v > 0);
    base.ms = { ...base.ms, enabled: true, width: Math.round(width * 100) / 100 };
    if (monos.length > 0) base.ms.monoMakerHz = Math.max(...monos); // most conservative
    if (widths.length > 1) log.push(`stereo width: weighted-averaged ${widths.length} settings → ${Math.round(width * 100)}%`);
  }

  return { mod: base, changeLog: log };
}

/** Merge weight for a fix — impact (priority, 0–100) × confidence (0–1).
 *  Old persisted rows without either field fall back to a neutral middle. */
export function fixWeight(f: { impact?: number | undefined; confidence?: number | undefined }): number {
  const impact = typeof f.impact === 'number' && Number.isFinite(f.impact) ? clamp(f.impact, 1, 100) : 50;
  const conf = typeof f.confidence === 'number' && Number.isFinite(f.confidence) ? clamp(f.confidence, 0.05, 1) : 0.75;
  return impact * conf;
}
