/* Listen V3 — rack → audio-graph bindings (Phase 2).
 *
 * Pure functions that translate a rack mutation (knob/enable/eq/preset/coach)
 * into the exact `useAudioGraph` call, so turning a knob on /listen-rack is
 * audible. `useRackState` calls these when given a live graph; the mock demo
 * route passes no graph and stays purely local.
 *
 * Param-key parity: every rack param key equals its engine EffectParamMap field
 * name (verified Phase 2 Task 0 against audio/state.ts), so a rack ModuleState
 * patches the engine 1:1. `pitch` is NOT an insert effect (separate buffer lane)
 * and is guarded out of every push.
 *
 * PRP-4 reuse: a room `rack` delta handler calls the SAME applyPatch path —
 * keep these graph-driven and side-effect-free beyond the graph calls.
 */
import type { EffectId, EffectMeter } from '../listen/audio/EffectUnit';
import type { DeviceIoLevels } from '../listen/audio/composer';
import type { EffectParamMap } from '../listen/useAudioGraph';
import { DEFAULT_ORDER, type ModuleState, type ParamValue, type RackPatch } from './data';

export type { DeviceIoLevels };

/** The slice of AudioGraphHandle the rack binds to. Satisfied by AudioGraphHandle. */
export interface RackGraphBindings {
  setEffectParams: <K extends EffectId>(id: K, patch: Partial<EffectParamMap[K]>) => void;
  reorder: (order: EffectId[]) => void;
  setMasterBypass: (bypassed: boolean) => void;
  resetAll: () => void;
  readEffectMeter: (id: EffectId) => EffectMeter | null;
  /** Device I/O taps (bay IN/OUT meters). Optional — test fakes and older
   *  graph handles without metering still satisfy the binding. */
  tapDeviceIo?: (id: EffectId | null) => void;
  readDeviceIo?: () => DeviceIoLevels | null;
}

/** The 13 insert effects (data.ts DEFAULT_ORDER) — `pitch` is intentionally absent. */
const INSERT_IDS: ReadonlySet<string> = new Set(DEFAULT_ORDER);

export function isInsertEffect(id: string): id is EffectId {
  return INSERT_IDS.has(id);
}

type DynamicPatch = Record<string, ParamValue>;

/**
 * Apply a dynamically-built patch to one insert effect. Keys are verified 1:1
 * with EffectParamMap (Task 0), but a runtime-keyed object can't be matched to
 * the per-effect generic type statically — the cast is isolated to this one spot.
 */
function applyPatch(graph: RackGraphBindings, id: EffectId, patch: DynamicPatch): void {
  (graph.setEffectParams as unknown as (id: EffectId, patch: DynamicPatch) => void)(id, patch);
}

/** A single knob/fader/select change. No-op for `pitch`/unknown ids. */
export function pushParam(graph: RackGraphBindings, id: string, key: string, val: ParamValue): void {
  if (!isInsertEffect(id)) return;
  applyPatch(graph, id, { [key]: val });
}

/** Module enable/bypass toggle. */
export function pushEnabled(graph: RackGraphBindings, id: string, on: boolean): void {
  if (!isInsertEffect(id)) return;
  applyPatch(graph, id, { enabled: on });
}

/** EQ band-array change (the whole 8-band array, per the eq bind). */
export function pushEqBands(graph: RackGraphBindings, bands: ParamValue): void {
  applyPatch(graph, 'eq', { bands });
}

/** Push one module's full state (used by recall / coach-apply / initial sync). */
export function pushModuleState(graph: RackGraphBindings, id: string, state: ModuleState): void {
  if (!isInsertEffect(id)) return;
  applyPatch(graph, id, { ...state });
}

/** Coach patch: apply each module's partial state. */
export function pushCoach(graph: RackGraphBindings, patch: RackPatch): void {
  for (const id of Object.keys(patch)) {
    if (isInsertEffect(id)) applyPatch(graph, id, { ...patch[id] } as DynamicPatch);
  }
}

/**
 * Push the entire rack to the graph in one shot — chain order, every module's
 * state, and master bypass. Called once the AudioContext exists (first play) so
 * the engine matches the UI even if knobs were moved or a preset recalled while
 * paused (those live pushes no-op before the graph has nodes).
 */
export function pushFullRack(
  graph: RackGraphBindings,
  mod: Record<string, ModuleState>,
  order: string[],
  masterBypass: boolean,
): void {
  const insertOrder = order.filter(isInsertEffect);
  graph.reorder(insertOrder);
  for (const id of insertOrder) {
    const st = mod[id];
    if (st) applyPatch(graph, id, { ...st });
  }
  graph.setMasterBypass(masterBypass);
}
