/* SPECTR · Listen V3 — the rack `Chain` currency (PRP-1, LISTEN_V3_UI_CONTRACT Q3).
 *
 * The shape used for save/recall/coach-apply and View suggestions; mirrors
 * `features/listen/audio/state.ts`. When PRP-1 lands, the real apply loop
 * (`features/listen/chainApply.ts → applyChainToGraph / snapshotChainFromGraph`)
 * consumes exactly this. Kept here so the page's preset seams already speak it.
 */
import type { ModuleState } from './data';

export type EffectId = string;

export interface Chain {
  order: EffectId[];                                 // insert order; pitch is NOT in here
  modules: Partial<Record<EffectId, ModuleState>>;   // per-module { enabled, ...params }
  masterBypass: boolean;
}
