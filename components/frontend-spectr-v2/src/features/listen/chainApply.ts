import type { EffectId } from './audio/EffectUnit';
import { DEFAULT_ORDER } from './audio/state';
import type { AudioGraphHandle, EffectParamMap } from './useAudioGraph';

// The ONE canonical path between a stored/suggested/AI-generated chain and live
// useAudioGraph state (PRP-1). Pure + framework-agnostic: it drives the memoized
// AudioGraphHandle imperatively and never captures React state, so the same loop
// is reused later by verdict-fix / coach-preset apply (reconciliation Δ3).
//
// chain_json is the persisted shape — a superset of Verdict.fix.dsp_chain and
// shape-compatible with audio/state.ts. `pitch` is NOT an insert (it's the
// separate buffer lane), so it never appears in `order` and is never a module.

export interface Chain {
  /** Insert order. Unknown ids (manifest drift) are tolerated and skipped. */
  order: EffectId[];
  /** Per-module params, keyed by EffectId. Missing entries are skipped on apply. */
  modules: Partial<EffectParamMap>;
  /** Master bypass passthrough (outside the insert chain). */
  masterBypass: boolean;
}

// Authoritative valid-id set = the canonical default insert order. Anything not
// in here (a renamed/removed/future module, or 'pitch') is drift → skip it.
const VALID_EFFECT_IDS: ReadonlySet<EffectId> = new Set(DEFAULT_ORDER);

function isKnown(id: unknown): id is EffectId {
  return typeof id === 'string' && VALID_EFFECT_IDS.has(id as EffectId);
}

/**
 * Apply a stored chain to a live audio graph: per-module params, then insert
 * order, then master bypass. Tolerant of manifest drift — unknown module ids and
 * missing params are skipped, never thrown. A malformed/empty order leaves the
 * existing rack order untouched rather than wiping it.
 */
export function applyChainToGraph(graph: AudioGraphHandle, chain: Chain | null | undefined): void {
  if (!chain) return;
  const order: unknown[] = Array.isArray(chain.order) ? chain.order : [];
  const modules = chain.modules ?? {};

  for (const id of order) {
    if (!isKnown(id)) continue; // skips unknown ids AND 'pitch' (not an insert)
    const mod = modules[id];
    if (mod == null) continue; // tolerate missing params for a listed module
    // eq passes its full { enabled, bands } object — there is no per-band setter.
    graph.setEffectParams(id, mod);
  }

  const cleanOrder = order.filter(isKnown);
  if (cleanOrder.length > 0) graph.reorder(cleanOrder);
  graph.setMasterBypass(chain.masterBypass ?? false);
}

/**
 * Inverse of {@link applyChainToGraph} — capture the live graph + the caller's
 * module state into a chain_json-ready snapshot. Used by Save preset + autosave.
 * masterBypass comes from graph.getMasterBypass() (without it, bypass is silently
 * lost on save).
 */
export function snapshotChainFromGraph(
  graph: AudioGraphHandle,
  moduleState: EffectParamMap,
): Chain {
  return {
    order: graph.getOrder(),
    modules: structuredClone(moduleState),
    masterBypass: graph.getMasterBypass(),
  };
}
