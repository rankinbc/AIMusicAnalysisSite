// What the queued fixes ADD UP TO — the merged chain, as a data model.
//
// The Actions list answers "what did the analysis find". It does not answer the
// question a producer actually carries to their DAW: *after all of this merges,
// what am I supposed to do?* Eighteen rows that collapse to four EQ bands and a
// trim read as eighteen jobs. This model runs the same weighted merge the
// Listen rack and the server's preset compiler run (`combineFixes`), then
// attributes each resulting device back to the fixes that fed it — so the short
// answer is the headline and the long list becomes its evidence.
//
// Pure + unit-tested; the panel is the renderer.
import { combineFixes, fixWeight } from '../listen-rack/combineFixes';
import { MODULE_DEFAULTS, RACK_MANIFEST, type EqBand, type ModuleState } from '../listen-rack/data';
import type { Move } from './move-model';
import type { VerdictDspOp } from '../../api/types';

/** One fix's contribution to a device. */
export interface ChainSource {
  moveId: string;
  title: string;
  /** What this one fix asked for, e.g. "−2.5 dB" or "300 Hz −3.0 dB". */
  ask: string;
}

export interface ChainDevice {
  moduleId: string;
  label: string;
  /** The merged setting, formatted for a human to type into their DAW. */
  summary: string;
  sources: ChainSource[];
}

export interface MergedChain {
  devices: ChainDevice[];
  /** Merge decisions worth showing (nets, binding trims, dropped bands). */
  decisions: string[];
  /** Fixes that fed the chain — the "18" in "18 fixes → 4 devices". */
  fixCount: number;
}

const MODULE_LABEL = new Map(RACK_MANIFEST.map((m) => [m.id, m.label]));

/** Op type → rack module. Mirrors combineFixes' switch and the worker's
 *  rack_schema.DSPTYPE_TO_MODULE. Unmappable ops return null (already flagged
 *  notApplicable upstream). */
export function moduleForOp(type: string): string | null {
  switch (type) {
    case 'peaking_eq':
    case 'high_shelf':
    case 'low_shelf':
    case 'high_pass':
    case 'low_pass':
      return 'eq';
    case 'gain':
      return 'trim';
    case 'compressor':
      return 'comp';
    case 'limiter':
      return 'limiter';
    case 'stereo_width':
      return 'ms';
    default:
      return null;
  }
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const db = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} dB`;

const hz = (v: number): string => (v >= 1000 ? `${Math.round(v / 100) / 10} kHz` : `${Math.round(v)} Hz`);

/** One fix's own request, for the nested source list. */
function askFor(op: VerdictDspOp): string {
  const p = op.params ?? {};
  switch (op.type) {
    case 'high_pass':
      return `high-pass ${hz(num(p.frequency_hz, 30))}`;
    case 'low_pass':
      return `low-pass ${hz(num(p.frequency_hz, 18000))}`;
    case 'peaking_eq':
    case 'high_shelf':
    case 'low_shelf':
      return `${hz(num(p.frequency_hz, 1000))} ${db(num(p.gain_db, 0))}`;
    case 'gain':
      return db(num(p.gain_db, 0));
    case 'limiter':
      return `${num(p.ceiling_db, -1)} dBTP ceiling`;
    case 'compressor':
      return `${num(p.ratio, 1)}:1 @ ${db(num(p.threshold_db, 0))}`;
    case 'stereo_width':
      return `width ${Math.round(num(p.width_pct, 100))}%`;
    default:
      return op.type;
  }
}

function eqSummary(state: ModuleState): string {
  const bands = (state.bands as EqBand[] | undefined) ?? [];
  const live = bands.filter((b) => b.enabled && (b.gainDb !== 0 || b.type === 'highpass' || b.type === 'lowpass'));
  if (live.length === 0) return '';
  return live
    .map((b) =>
      b.type === 'highpass'
        ? `HP ${hz(b.freq)}`
        : b.type === 'lowpass'
          ? `LP ${hz(b.freq)}`
          : `${hz(b.freq)} ${db(b.gainDb)}`,
    )
    .join(' · ');
}

/** The merged device setting in the words a producer would use. Empty string
 *  means "nothing actually changed" and the device is dropped from the view. */
function summarize(moduleId: string, state: ModuleState): string {
  switch (moduleId) {
    case 'eq':
      return eqSummary(state);
    case 'trim': {
      const g = num(state.gainDb, 0);
      return g === 0 ? '' : db(g);
    }
    case 'limiter':
      return `${num(state.ceilingDb, -1)} dBTP ceiling`;
    case 'comp':
      return `${num(state.ratio, 1)}:1 @ ${db(num(state.thresholdDb, 0))}`;
    case 'ms': {
      const parts = [`width ${Math.round(num(state.width, 1) * 100)}%`];
      const mono = num(state.monoMakerHz, 0);
      if (mono > 0) parts.push(`mono below ${hz(mono)}`);
      return parts.join(' · ');
    }
    default:
      return '';
  }
}

/** Merge decisions worth a producer's attention. combineFixes logs every step;
 *  the caps and slot-budget drops are noise next to the ones that changed what
 *  a number MEANS (a net, a binding trim, a lost band). */
function interestingDecisions(log: string[]): string[] {
  return log.filter(
    (l) =>
      l.includes('netted') ||
      l.includes('binding') ||
      l.includes('dropped') ||
      l.includes('summed') ||
      l.includes('disagree'),
  );
}

/**
 * Compile the queued moves into the chain they add up to, with per-device
 * attribution back to the source fixes. Moves with no rack-mappable ops
 * (per-element instructions, sidechain) contribute nothing and are the DAW
 * plan's business, not this panel's.
 */
export function buildMergedChain(moves: Move[]): MergedChain {
  const feeding = moves.filter((m) => m.ops.some((op) => moduleForOp(op.type) != null));
  if (feeding.length === 0) return { devices: [], decisions: [], fixCount: 0 };

  const { mod, changeLog } = combineFixes(
    feeding.map((m) => ({ ops: m.ops, weight: fixWeight(m) })),
  );

  const sourcesByModule = new Map<string, ChainSource[]>();
  for (const m of feeding) {
    for (const op of m.ops) {
      const moduleId = moduleForOp(op.type);
      if (moduleId == null) continue;
      const list = sourcesByModule.get(moduleId) ?? [];
      list.push({ moveId: m.id, title: m.title, ask: askFor(op) });
      sourcesByModule.set(moduleId, list);
    }
  }

  // Chain order, not discovery order — this reads as a signal path.
  const devices: ChainDevice[] = [];
  for (const manifest of RACK_MANIFEST) {
    const sources = sourcesByModule.get(manifest.id);
    if (!sources) continue;
    const state = mod[manifest.id];
    if (!state) continue;
    const summary = summarize(manifest.id, state);
    if (!summary) continue; // merged out to a no-op — don't claim a device
    devices.push({
      moduleId: manifest.id,
      label: MODULE_LABEL.get(manifest.id) ?? manifest.id,
      summary,
      sources,
    });
  }

  return {
    devices,
    decisions: interestingDecisions(changeLog),
    fixCount: feeding.length,
  };
}

/** Defaults are exported so tests can assert "unchanged module is not claimed". */
export const CHAIN_MODULE_DEFAULTS = MODULE_DEFAULTS;
