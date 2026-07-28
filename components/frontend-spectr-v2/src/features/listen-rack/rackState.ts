/* SPECTR · Listen rack redesign — rack state hooks (non-component module).
 *
 * SWAP BOUNDARY (see PORTING_NOTES.md):
 *   useRackState → real audio-graph store when a graph is supplied (Phase 2),
 *     keeping the SAME return shape so the renderers don't change.
 *   useGainReduction → reads readEffectMeter(id) for comp/gate/limiter when a
 *     graph is present; synthetic fallback on the mock route.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { EffectId } from '../listen/audio/EffectUnit';
import {
  DEFAULT_ORDER, MODULE_DEFAULTS, type EqBand, type ModuleState, type ParamValue, type RackPatch,
} from './data';
import {
  isInsertEffect, pushCoach, pushEnabled, pushEqBands, pushFullRack, pushModuleState, pushParam,
  type RackGraphBindings,
} from './rackBindings';

export interface RackPreset {
  id: string;
  name: string;
  by: string;
  order: string[];
  mod: Record<string, ModuleState>;
  n: number;
}

export interface RackState {
  mod: Record<string, ModuleState>;
  order: string[];
  setOrder: (next: string[]) => void;
  masterBypass: boolean;
  setMasterBypass: (v: boolean) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  showBind: boolean;
  setShowBind: (v: boolean) => void;
  setParam: (id: string, key: string, val: ParamValue) => void;
  setEnabled: (id: string, on: boolean) => void;
  setEqBands: (bands: EqBand[]) => void;
  reset: () => void;
  /** Reset ONE module to its neutral defaults (v2 device-bay reset button). */
  resetModule: (id: string) => void;
  applyCoach: (apply: RackPatch) => void;
  applyRackMod: (mod: Record<string, ModuleState>) => void;
  activeCount: number;
  presets: RackPreset[];
  savePreset: (by: string) => void;
  recallPreset: (pr: RackPreset) => void;
  /** The live audio graph (Phase 2) when on the real-audio route; null on mock.
   *  Renderers use it (via useGainReduction) to read real meters. */
  graph: RackGraphBindings | null;
}

const cloneDefaults = (): Record<string, ModuleState> => {
  const fresh: Record<string, ModuleState> = {};
  Object.keys(MODULE_DEFAULTS).forEach((id) => {
    fresh[id] = JSON.parse(JSON.stringify(MODULE_DEFAULTS[id])) as ModuleState;
  });
  return fresh;
};

// ── rack state hook ────────────────────────────────────────────────────────
// `graph` (Phase 2): when supplied (real-audio route), every mutation also pushes
// to the audio graph so the knob is audible. Omit/null (mock demo route) keeps
// the rack purely local. The initial full-rack sync runs from the page once the
// AudioContext exists (first play) — see ListenRackPage.togglePlay.
export function useRackState(graph?: RackGraphBindings | null): RackState {
  const [mod, setMod] = useState<Record<string, ModuleState>>(cloneDefaults);
  const [order, setOrder] = useState<string[]>([...DEFAULT_ORDER]);
  const [masterBypass, setMasterBypass] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showBind, setShowBind] = useState(false);
  const [presets, setPresets] = useState<RackPreset[]>([]);

  const setParam = useCallback((id: string, key: string, val: ParamValue) => {
    if (graph) pushParam(graph, id, key, val);
    setMod((m) => ({ ...m, [id]: { ...m[id], [key]: val } }));
  }, [graph]);
  const setEnabled = useCallback((id: string, on: boolean) => {
    if (graph) pushEnabled(graph, id, on);
    setMod((m) => ({ ...m, [id]: { ...m[id], enabled: on } }));
  }, [graph]);
  const setEqBands = useCallback((bands: EqBand[]) => {
    if (graph) pushEqBands(graph, bands);
    setMod((m) => ({ ...m, eq: { ...m.eq, bands } }));
  }, [graph]);
  const reorder = useCallback((next: string[]) => {
    if (graph) graph.reorder(next.filter(isInsertEffect));
    setOrder(next);
  }, [graph]);
  const setMasterBypassBound = useCallback((v: boolean) => {
    graph?.setMasterBypass(v);
    setMasterBypass(v);
  }, [graph]);
  const reset = useCallback(() => {
    graph?.resetAll();
    setMod(cloneDefaults()); setOrder([...DEFAULT_ORDER]); setMasterBypass(false);
  }, [graph]);
  const resetModule = useCallback((id: string) => {
    const defaults = MODULE_DEFAULTS[id];
    if (!defaults) return;
    const fresh = JSON.parse(JSON.stringify(defaults)) as ModuleState;
    if (graph) pushModuleState(graph, id, fresh);
    setMod((m) => ({ ...m, [id]: fresh }));
  }, [graph]);
  const applyCoach = useCallback((apply: RackPatch) => {
    if (graph) pushCoach(graph, apply);
    setMod((m) => {
      const next = { ...m };
      Object.keys(apply).forEach((id) => { next[id] = { ...m[id], ...apply[id] } as ModuleState; });
      return next;
    });
  }, [graph]);
  const applyRackMod = useCallback((nextMod: Record<string, ModuleState>) => {
    if (graph) pushFullRack(graph, nextMod, order, masterBypass);
    setMod(nextMod);
  }, [graph, order, masterBypass]);
  const savePreset = useCallback((by: string) => setPresets((p) => [...p, {
    id: Math.random().toString(36).slice(2),
    name: `Preset ${p.length + 1}`,
    by: by || 'you',
    order: [...order],
    mod: JSON.parse(JSON.stringify(mod)) as Record<string, ModuleState>,
    n: Object.values(mod).filter((s) => s.enabled).length,
  }]), [order, mod]);
  const recallPreset = useCallback((pr: RackPreset) => {
    if (graph) pushFullRack(graph, pr.mod, pr.order, masterBypass);
    setMod(JSON.parse(JSON.stringify(pr.mod)) as Record<string, ModuleState>);
    setOrder([...pr.order]);
  }, [graph, masterBypass]);
  const activeCount = Object.values(mod).filter((s) => s.enabled).length;

  return {
    mod, order, setOrder: reorder, masterBypass, setMasterBypass: setMasterBypassBound,
    selected, setSelected, showBind, setShowBind,
    setParam, setEnabled, setEqBands, reset, resetModule, applyCoach, applyRackMod, activeCount, presets, savePreset, recallPreset,
    graph: graph ?? null,
  };
}

// ── live gain-reduction for comp/gate/limiter ──────────────────────────────
// Real meter (readEffectMeter) when a graph is supplied; synthetic sinusoid
// fallback for the mock demo route. `depth` only shapes the synthetic curve.
export function useGainReduction(
  graph: RackGraphBindings | null | undefined,
  id: string,
  enabled: boolean,
  playing: boolean,
  depth = 6,
): number {
  const [gr, setGr] = useState(0);
  useEffect(() => {
    if (!enabled || !playing) { setGr(0); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      if (graph && isInsertEffect(id)) {
        const v = graph.readEffectMeter(id)?.reductionDb;
        setGr(typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
      } else {
        const t = (performance.now() - t0) / 1000;
        const v = -(depth * (0.5 + 0.5 * Math.abs(Math.sin(t * 2.1)) * (0.6 + 0.4 * Math.sin(t * 5.3))));
        setGr(Math.round(v * 10) / 10);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph, id, enabled, playing, depth]);
  return gr;
}

// ── live device I/O levels (bay IN/OUT meters) ─────────────────────────────
// Attaches the graph's roaming analyser taps to `id` and polls RMS dBFS at the
// unit's input/output per frame. Works whether the module is enabled or not —
// a bypassed unit still passes signal through its dry lane, which is exactly
// what the meters should show. Synthetic wobble on the mock (no-graph) route.
// Detaches the taps on unmount / device switch.
export interface DeviceIoState {
  inDb: number;
  outDb: number;
}

const IO_FLOOR_DB = -60;

const clampIoDb = (x: number): number =>
  Number.isFinite(x) ? Math.max(IO_FLOOR_DB, Math.min(6, x)) : IO_FLOOR_DB;

export function useDeviceIo(
  graph: RackGraphBindings | null | undefined,
  id: string,
  active: boolean,
  playing: boolean,
): DeviceIoState | null {
  const [io, setIo] = useState<DeviceIoState | null>(null);
  useEffect(() => {
    const real = Boolean(graph?.tapDeviceIo && graph.readDeviceIo) && isInsertEffect(id);
    if (!active || (!real && graph)) { setIo(null); return undefined; }
    if (!playing) { setIo({ inDb: IO_FLOOR_DB, outDb: IO_FLOOR_DB }); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      if (real) {
        // Re-tap every frame: idempotent when unchanged, and covers the graph
        // being created lazily (first play) after this hook mounted.
        graph?.tapDeviceIo?.(id as EffectId);
        const v = graph?.readDeviceIo?.();
        setIo(v ? { inDb: clampIoDb(v.inDb), outDb: clampIoDb(v.outDb) } : null);
      } else {
        const t = (performance.now() - t0) / 1000;
        const base = -18 + 5 * Math.sin(t * 2.3);
        setIo({ inDb: base, outDb: base + 2 * Math.sin(t * 1.7) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      graph?.tapDeviceIo?.(null);
    };
  }, [graph, id, active, playing]);
  return io;
}

// ── drag-reorder for a chain (pointer based) ───────────────────────────────
export function useChainReorder(order: string[], setOrder: (next: string[]) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const onHandleDown = useCallback((id: string) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragId.current = id; setDraggingId(id);
    const move = (ev: PointerEvent) => {
      const cont = containerRef.current; if (!cont) return;
      const items = [...cont.querySelectorAll('[data-chip]')];
      const x = ev.clientX;
      let target = -1;
      items.forEach((el, i) => { const r = el.getBoundingClientRect(); if (x > r.left + r.width / 2) target = i; });
      const from = order.indexOf(dragId.current ?? '');
      const to = Math.max(0, Math.min(order.length - 1, target + 1));
      if (from !== -1 && to !== from && dragId.current) {
        const next = [...order]; next.splice(from, 1); next.splice(to > from ? to - 1 : to, 0, dragId.current); setOrder(next);
      }
    };
    const up = () => { dragId.current = null; setDraggingId(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); document.body.style.cursor = 'grabbing';
  }, [order, setOrder]);
  return { containerRef, onHandleDown, draggingId };
}
