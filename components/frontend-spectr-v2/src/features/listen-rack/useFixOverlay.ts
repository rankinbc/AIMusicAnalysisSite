// Per-fix apply for the Listen "Plan" tab. Each Added fix is a checkbox; the set
// of checked fixes defines an overlay recomputed from a fix-free baseline on
// every toggle, so toggling is clean and fixes stack. Checked fixes merge via
// the weighted combiner (combineFixes) — order-independent: same checkboxes,
// same rack, regardless of click sequence. Applied ids persist to localStorage
// per version; merge decisions surface as `mergeNotes`.
//
// Story 12.4 (AC4): the fix-free baseline is CAPTURED from the live rack at
// first apply (getLiveMod) instead of neutral defaults — manual knob moves made
// before applying fixes survive, and unchecking everything restores them.
// `pitch` is never written by composeRack regardless.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { combineFixes, fixWeight } from './combineFixes';
import { composeRack } from './fixToRackPatch';
import {
  clearBaseline, FIX_OVERLAY_CLEAR_EVENT, readAppliedIds, readBaseline, writeAppliedIds,
  writeBaseline, type ListenFix,
} from './listenFixes';
import type { ModuleState } from './data';
import type { RackState } from './rackState';

interface UseFixOverlayArgs {
  versionId: string;
  fixes: ListenFix[];
  applyRackMod: RackState['applyRackMod'];
  /** Live module map snapshotter — captured as the fix-free baseline at first
   *  apply. Optional for back-compat: without it the baseline is defaults. */
  getLiveMod?: () => Record<string, ModuleState>;
}

export function useFixOverlay({ versionId, fixes, applyRackMod, getLiveMod }: UseFixOverlayArgs) {
  // F2: applied ids are only half the restored state — without the baseline we
  // cannot UN-apply, so ids without one are not restored at all (see below).
  const [appliedIds, setAppliedIds] = useState<string[]>(
    () => (readBaseline(versionId) ? readAppliedIds(versionId) : []));
  const [mergeNotes, setMergeNotes] = useState<string[]>([]);
  const appliedRef = useRef(appliedIds);
  const baselineRef = useRef<Record<string, ModuleState> | null>(null);
  useEffect(() => {
    appliedRef.current = appliedIds;
  }, [appliedIds]);

  // Mount + every version switch: restore BOTH halves of the overlay state.
  //
  // We deliberately do NOT re-apply the restored fixes onto the rack here: the
  // draft-restore effect (useFixCarryOver) is racing us with the autosaved
  // chain, which already CONTAINS whatever was applied when autosave last
  // fired, so re-applying would stack a second copy. The known gap: if the tab
  // closed inside the ~1.2 s autosave debounce the draft may lack a fix the
  // board still lists as applied — toggling it off and on reconciles it.
  useEffect(() => {
    const baseline = readBaseline(versionId);
    let restored = readAppliedIds(versionId);
    if (restored.length > 0 && !baseline) {
      // State written by an older build (or a cleared baseline): we cannot
      // reconstruct the pre-fix rack, and the UI must never claim "applied"
      // for something it cannot un-apply. Drop the ids instead of lying.
      restored = [];
      writeAppliedIds(versionId, restored);
    }
    appliedRef.current = restored;
    baselineRef.current = baseline;
    setAppliedIds(restored);
    setMergeNotes([]);
  }, [versionId]);

  // Story 12.4 review: the page's chip reset clears the overlay through this
  // event so a mounted PlanPanel's checkboxes + baseline reset in lockstep
  // (the page already reset the rack — no applyRackMod here).
  useEffect(() => {
    const onClear = (e: Event) => {
      const detail = (e as CustomEvent<{ versionId?: string }>).detail;
      if (detail?.versionId !== versionId) return;
      appliedRef.current = [];
      baselineRef.current = null;
      clearBaseline(versionId);
      setAppliedIds([]);
      setMergeNotes([]);
    };
    window.addEventListener(FIX_OVERLAY_CLEAR_EVENT, onClear);
    return () => window.removeEventListener(FIX_OVERLAY_CLEAR_EVENT, onClear);
  }, [versionId]);

  // notApplicable fixes are display-only rows — never resolvable into ops, so
  // stale applied-ids pointing at them can't hold the baseline hostage.
  const byId = useMemo(
    () => new Map(fixes.filter((f) => f.notApplicable !== true).map((f) => [f.fixId, f])),
    [fixes]);

  const recompute = useCallback((ids: string[]) => {
    const checked = ids.map((id) => byId.get(id)).filter((f): f is ListenFix => f != null && Array.isArray(f.ops));
    if (checked.length === 0) {
      // Everything unchecked → restore the pre-fix baseline (manual tweaks
      // intact). With NO baseline there is nothing to restore, so we leave the
      // rack alone: falling back to composeRack([]) here wiped the user's whole
      // rack to factory defaults and autosave then persisted the wipe (F1/F2).
      // The neutral-defaults fallback survives only for a caller that supplies
      // no getLiveMod — i.e. never in production (useListenFindings passes it).
      const baseline = baselineRef.current;
      baselineRef.current = null;
      clearBaseline(versionId);
      setMergeNotes([]);
      if (baseline) applyRackMod(baseline);
      else if (!getLiveMod) applyRackMod(composeRack([]));
      return;
    }
    if (!baselineRef.current && getLiveMod) {
      const live = getLiveMod();
      if (live) {
        const snapshot = JSON.parse(JSON.stringify(live)) as Record<string, ModuleState>;
        baselineRef.current = snapshot;
        writeBaseline(versionId, snapshot);
      }
    }
    const { mod, changeLog } = combineFixes(
      checked.map((f) => ({ ops: f.ops, weight: fixWeight(f) })),
      baselineRef.current ?? undefined,
    );
    setMergeNotes(changeLog);
    applyRackMod(mod);
  }, [byId, applyRackMod, getLiveMod, versionId]);

  /** True iff this id resolves to a real, applyable fix of the CURRENT
   *  analysis. The Coach tab lists fixes from its own localStorage queue,
   *  which can outlive the analysis they were built from. */
  const canToggle = useCallback((id: string) => byId.has(id), [byId]);

  const toggle = useCallback((id: string) => {
    // An id we cannot resolve (stale queue row, notApplicable fix) has no ops,
    // so "applying" it can only ever mean "rebuild the rack from nothing".
    // A complete no-op is the only safe answer — never a rack write.
    if (!byId.has(id)) return;
    const prev = appliedRef.current;
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    appliedRef.current = next;
    setAppliedIds(next);
    writeAppliedIds(versionId, next);
    recompute(next);
  }, [versionId, recompute, byId]);

  const isApplied = useCallback((id: string) => appliedIds.includes(id), [appliedIds]);

  return { appliedIds, isApplied, toggle, canToggle, mergeNotes };
}
