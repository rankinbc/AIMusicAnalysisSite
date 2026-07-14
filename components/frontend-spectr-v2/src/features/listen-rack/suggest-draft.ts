/* SPECTR · Story 11.12 — fork-to-suggest draft snapshots (pure helpers).
 *
 * The fork/audition flows edit the LIVE rack (that's the point — the reviewer
 * hears the draft) and restore the pre-fork state on exit. `rs.mod` is a live
 * mutable map, so every capture here deep-clones; a shallow snapshot would
 * alias the state being edited and turn restore into a no-op.
 *
 * Restore goes through `rs.recallPreset` — the same full-rack path the draft
 * restore uses (pushFullRack + full module-map replace), which re-applies
 * DISABLED modules too. `overlayChain` is NOT usable for restore: it skips
 * disabled entries by design (carry-over semantics), which would leave a
 * reviewer's enabled-then-restored module stuck on.
 */
import type { Chain } from './chain';
import type { ModuleState } from './data';
import type { RackPreset } from './rackState';
import { asChain } from './useRackPresets';

export interface RackSnapshot {
  order: string[];
  mod: Record<string, ModuleState>;
  masterBypass: boolean;
}

/** The slice of RackState the restore path needs (testable without React). */
export interface RackRestoreTarget {
  recallPreset: (pr: RackPreset) => void;
  setMasterBypass: (v: boolean) => void;
}

/** Deep-cloned capture of the current rack. Safe to hold across edits. */
export function snapshotRack(src: {
  order: string[];
  mod: Record<string, ModuleState>;
  masterBypass: boolean;
}): RackSnapshot {
  return {
    order: [...src.order],
    mod: structuredClone(src.mod),
    masterBypass: src.masterBypass,
  };
}

/** Re-apply a snapshot in full — order, every module (incl. disabled), bypass.
 *  recallPreset clones its input, so the snapshot survives repeated restores
 *  (the A/B toggle flips through here on every press). */
export function restoreRack(rs: RackRestoreTarget, snap: RackSnapshot): void {
  rs.recallPreset({
    id: 'suggest-restore', name: 'suggest-restore', by: 'you',
    order: [...snap.order], mod: snap.mod, n: 0,
  });
  rs.setMasterBypass(snap.masterBypass);
}

/** How the rack surface renders given read-only + fork state (AC1/AC2/AC8).
 *  Pure so the badge gating and the A-side edit block are unit-testable —
 *  they'd otherwise live only in a page-render conditional. */
export type RackSurface =
  | { editable: true; badge: null }
  | { editable: false; badge: 'readonly' | 'fork-button' | 'original-block' };

export function resolveRackSurface(args: {
  rackReadOnly: boolean;
  suggesting: boolean;
  abSide: 'draft' | 'original';
  canSuggest: boolean;
  mode: string;
  realAudio: boolean;
}): RackSurface {
  const { rackReadOnly, suggesting, abSide, canSuggest, mode, realAudio } = args;
  // While A/B'ing the ORIGINAL, edits are blocked — editing the original by
  // accident would be silently discarded on the flip back to the draft (AC8).
  if (suggesting && abSide === 'original') return { editable: false, badge: 'original-block' };
  // Fork (draft side) lifts the read-only overlay (AC2).
  if (suggesting) return { editable: true, badge: null };
  if (!rackReadOnly) return { editable: true, badge: null };
  return {
    editable: false,
    badge: canSuggest && mode === 'view' && realAudio ? 'fork-button' : 'readonly',
  };
}

/** A snapshot as the wire Chain shape (the CreateSuggestionRequest payload). */
export function chainFromSnapshot(snap: RackSnapshot): Chain {
  return { order: [...snap.order], modules: structuredClone(snap.mod), masterBypass: snap.masterBypass };
}

/**
 * Audition apply: merge a suggestion's (possibly partial) chain onto a base
 * snapshot and apply the merged rack via the restore path, so React knob state
 * and the audio graph stay in sync (a graph-only apply would leave the UI
 * showing stale values that the next knob move pushes back). `pitch` is never
 * written (separate buffer lane — 12.4 rule). Returns false on a malformed
 * chain (nothing applied).
 */
export function applySuggestionChain(
  rs: RackRestoreTarget,
  base: RackSnapshot,
  rawChain: unknown,
): boolean {
  const chain = asChain(rawChain);
  if (!chain) return false;
  const mod = structuredClone(base.mod);
  for (const id of Object.keys(chain.modules)) {
    // Merge ONLY ids the base rack knows. An unknown id (drifted or hostile
    // chain — the server validates shape, not content) would inject a
    // half-formed ModuleState the renderers dereference (MANIFEST_BY_ID[id])
    // and crash the page on click (review finding).
    if (id === 'pitch' || mod[id] == null) continue;
    const m = chain.modules[id];
    if (m && typeof m === 'object') mod[id] = { ...mod[id], ...m };
  }
  // The applied order must stay a PERMUTATION of the base order — pushFullRack
  // → reorder throws "not a permutation" on a partial/drifted order (review
  // finding). Chain-known ids keep the chain's relative order; the rest of the
  // base order appends behind them.
  const baseIds = new Set(base.order);
  const fromChain = chain.order.filter((id, i) => baseIds.has(id) && chain.order.indexOf(id) === i);
  const order = [...fromChain, ...base.order.filter((id) => !fromChain.includes(id))];
  rs.recallPreset({
    id: 'suggest-audition', name: 'suggest-audition', by: 'you',
    order, mod, n: 0,
  });
  rs.setMasterBypass(chain.masterBypass);
  return true;
}
