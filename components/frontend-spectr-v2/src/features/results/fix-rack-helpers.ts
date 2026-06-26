import { RACK_MANIFEST } from '../listen-rack/data';

// Pure helpers for the Fix Rack panel — kept out of the component file so it can
// fast-refresh (react-refresh/only-export-components).

export interface ModuleState {
  enabled?: boolean;
  [k: string]: unknown;
}
export interface RackChain {
  order: string[];
  modules: Record<string, ModuleState>;
  masterBypass?: boolean;
}

/** Narrow the opaque FixRackDto.chain to a RackChain, or null if malformed. */
export function readFixChain(chain: unknown): RackChain | null {
  if (!chain || typeof chain !== 'object') return null;
  const c = chain as Record<string, unknown>;
  if (!Array.isArray(c.order) || typeof c.modules !== 'object' || c.modules === null) return null;
  return {
    order: c.order.filter((x): x is string => typeof x === 'string'),
    modules: c.modules as Record<string, ModuleState>,
    masterBypass: Boolean(c.masterBypass),
  };
}

/** Module ids that are enabled in the chain, in signal-chain order. */
export function enabledModuleIds(chain: unknown): string[] {
  const c = readFixChain(chain);
  if (!c) return [];
  return c.order.filter((id) => c.modules[id]?.enabled === true);
}

export const MANIFEST = new Map(RACK_MANIFEST.map((m) => [m.id, m]));

/** Display rows for one enabled module (eq is shown as its enabled bands). */
export function moduleParams(id: string, state: ModuleState): { label: string; val: string }[] {
  const man = MANIFEST.get(id);
  if (id === 'eq') {
    const bands = Array.isArray(state.bands) ? (state.bands as Record<string, unknown>[]) : [];
    return bands
      .filter((b) => b.enabled === true)
      .map((b) => ({
        label: String(b.type ?? 'band'),
        val: `${Math.round(Number(b.freq))} Hz · ${Number(b.gainDb) > 0 ? '+' : ''}${Number(b.gainDb).toFixed(1)} dB`,
      }));
  }
  const out: { label: string; val: string }[] = [];
  for (const p of man?.params ?? []) {
    if (p.key === 'enabled' || !(p.key in state)) continue;
    const v = state[p.key];
    if (typeof v !== 'number') continue;
    const unit = p.unit && p.unit !== 'none' && p.unit !== 'ratio' && p.unit !== 'percent' ? ` ${p.unit}` : '';
    out.push({ label: p.label, val: `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}` });
  }
  return out;
}
