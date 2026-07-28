// Fix DSP chain → Listen rack patch. MIRROR of the backend's per-op mapping in
// `components/worker/app/solve_lib/preset_compiler.py` (snake_case → camelCase).
// If you change a mapping here, change it there too (and vice-versa) — they are
// intentionally duplicated because per-fix apply needs live rack state for EQ
// band-slot allocation, which the whole-rack backend compile does not expose.
import type { VerdictDspOp } from '../../api/types';
import { MODULE_DEFAULTS, type EqBand, type ModuleState } from './data';

export interface FixPatch {
  /** Non-EQ module patches, keyed by rack module id (limiter, comp, ms, trim…). */
  modules: Record<string, Partial<ModuleState>>;
  /** EQ bands this fix wants; slot allocation happens in composeRack. */
  eqBands: EqBand[];
  /** Ops not expressible as a master-rack module (sidechain, per-stem, unknown). */
  leftover: VerdictDspOp[];
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function fixToRackPatch(ops: VerdictDspOp[]): FixPatch {
  const modules: Record<string, Partial<ModuleState>> = {};
  const eqBands: EqBand[] = [];
  const leftover: VerdictDspOp[] = [];

  for (const op of ops) {
    const p = op.params ?? {};
    switch (op.type) {
      case 'peaking_eq':
        eqBands.push({ type: 'peaking', freq: num(p.frequency_hz, 1000), gainDb: num(p.gain_db, 0), q: num(p.q, 1), enabled: true });
        break;
      case 'high_shelf':
        eqBands.push({ type: 'highshelf', freq: num(p.frequency_hz, 10000), gainDb: num(p.gain_db, 0), q: num(p.q, 0.7), enabled: true });
        break;
      case 'low_shelf':
        eqBands.push({ type: 'lowshelf', freq: num(p.frequency_hz, 80), gainDb: num(p.gain_db, 0), q: num(p.q, 0.7), enabled: true });
        break;
      case 'high_pass':
        eqBands.push({ type: 'highpass', freq: num(p.frequency_hz, 30), gainDb: 0, q: num(p.q, 0.7), enabled: true });
        break;
      case 'low_pass':
        eqBands.push({ type: 'lowpass', freq: num(p.frequency_hz, 18000), gainDb: 0, q: num(p.q, 0.7), enabled: true });
        break;
      case 'limiter':
        modules.limiter = { enabled: true, ceilingDb: num(p.ceiling_db, -1), releaseMs: num(p.release_ms, 50), lookaheadMs: num(p.lookahead_ms, 5) };
        break;
      case 'compressor':
        modules.comp = { enabled: true, thresholdDb: num(p.threshold_db, 0), ratio: num(p.ratio, 1), attackMs: num(p.attack_ms, 3), releaseMs: num(p.release_ms, 250), kneeDb: num(p.knee_db, 30), makeupDb: num(p.makeup_gain_db, 0) };
        break;
      case 'gain':
        modules.trim = { enabled: true, gainDb: num(p.gain_db, 0) };
        break;
      case 'stereo_width':
        modules.ms = { enabled: true, width: num(p.width_pct, 100) / 100, monoMakerHz: num(p.mono_below_hz, 0) };
        break;
      default:
        leftover.push(op);
    }
  }
  return { modules, eqBands, leftover };
}

export function isApplyable(ops: VerdictDspOp[]): boolean {
  const patch = fixToRackPatch(ops);
  return Object.keys(patch.modules).length > 0 || patch.eqBands.length > 0;
}

function freshDefaults(): Record<string, ModuleState> {
  return JSON.parse(JSON.stringify(MODULE_DEFAULTS)) as Record<string, ModuleState>;
}

/** Story 12.4: merge a carried chain's modules onto the LIVE module map.
 *  Only modules the carried chain ENABLES are merged — a compiled analysis
 *  chain enumerates every module (disabled ones at defaults), and spreading
 *  those would wipe manual knob moves, making "overlay" a lie (review
 *  finding). `pitch` is never written (separate BufferSource lane; clobbering
 *  it spuriously enters/exits pitch mode). Used by the ?fixPreset= carry-over
 *  apply on the Listen page. */
export function overlayChain(
  live: Record<string, ModuleState>,
  carried: Partial<Record<string, ModuleState>>,
): Record<string, ModuleState> {
  const next = JSON.parse(JSON.stringify(live)) as Record<string, ModuleState>;
  for (const id of Object.keys(carried)) {
    if (id === 'pitch') continue;
    const mod = carried[id];
    if (!mod?.enabled) continue; // disabled entries must not clobber live tweaks
    next[id] = { ...next[id], ...(mod as ModuleState) };
  }
  return next;
}

/** Recompose a full rack from `base` + each applied fix's ops, in order.
 *  EQ bands from all fixes are allocated to sequential slots (slot i for the
 *  i-th band); overflow past the 8 slots stacks onto the last slot.
 *
 *  NOTE: live multi-fix merging moved to `combineFixes.ts` (weighted,
 *  order-independent — 2026-07-27). This last-writer-wins overlay remains for
 *  the neutral-defaults case and single-chain carry-over only; don't reach for
 *  it to combine several fixes.
 *
 *  Story 12.4: `base` defaults to neutral MODULE_DEFAULTS (the historical
 *  behavior), but callers applying fixes onto a LIVE rack pass the current
 *  module map so manual knob moves survive. `pitch` is never written — it is
 *  not an insert effect (separate BufferSource lane) and clobbering it
 *  spuriously enters/exits pitch mode. */
export function composeRack(
  appliedOps: VerdictDspOp[][],
  liveBase?: Record<string, ModuleState>,
): Record<string, ModuleState> {
  const base = liveBase
    ? (JSON.parse(JSON.stringify(liveBase)) as Record<string, ModuleState>)
    : freshDefaults();
  const collectedEq: EqBand[] = [];

  for (const ops of appliedOps) {
    const patch = fixToRackPatch(ops);
    for (const id of Object.keys(patch.modules)) {
      if (id === 'pitch') continue; // never touch the pitch lane (12.4 AC4)
      base[id] = { ...base[id], ...patch.modules[id] } as ModuleState;
    }
    collectedEq.push(...patch.eqBands);
  }

  if (collectedEq.length > 0) {
    // A live base restored from a drifted server chain may lack eq/bands —
    // fall back to the default 8 slots instead of throwing (review finding).
    const baseBands = Array.isArray(base.eq?.bands) && (base.eq.bands as EqBand[]).length > 0
      ? (base.eq.bands as EqBand[])
      : (freshDefaults().eq.bands as EqBand[]);
    const bands = baseBands.map((b) => ({ ...b }));
    collectedEq.forEach((band, i) => {
      bands[Math.min(i, bands.length - 1)] = { ...band };
    });
    base.eq = { ...base.eq, bands, enabled: true };
  }
  return base;
}
