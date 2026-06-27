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

/** Recompute a full rack from neutral defaults + each applied fix's ops, in
 *  order. EQ bands from all fixes are allocated to sequential slots (slot i for
 *  the i-th band); overflow past the 8 slots stacks onto the last slot. */
export function composeRack(appliedOps: VerdictDspOp[][]): Record<string, ModuleState> {
  const base = freshDefaults();
  const collectedEq: EqBand[] = [];

  for (const ops of appliedOps) {
    const patch = fixToRackPatch(ops);
    for (const id of Object.keys(patch.modules)) {
      base[id] = { ...base[id], ...patch.modules[id] } as ModuleState;
    }
    collectedEq.push(...patch.eqBands);
  }

  if (collectedEq.length > 0) {
    const bands = (base.eq.bands as EqBand[]).map((b) => ({ ...b }));
    collectedEq.forEach((band, i) => {
      bands[Math.min(i, bands.length - 1)] = { ...band };
    });
    base.eq = { ...base.eq, bands, enabled: true };
  }
  return base;
}
