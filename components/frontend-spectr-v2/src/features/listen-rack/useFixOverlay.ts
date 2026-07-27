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
  FIX_OVERLAY_CLEAR_EVENT, readAppliedIds, writeAppliedIds, type ListenFix,
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
  const [appliedIds, setAppliedIds] = useState<string[]>(() => readAppliedIds(versionId));
  const [mergeNotes, setMergeNotes] = useState<string[]>([]);
  const appliedRef = useRef(appliedIds);
  const baselineRef = useRef<Record<string, ModuleState> | null>(null);
  useEffect(() => {
    appliedRef.current = appliedIds;
  }, [appliedIds]);

  // Re-read when switching versions.
  useEffect(() => {
    const restored = readAppliedIds(versionId);
    appliedRef.current = restored;
    baselineRef.current = null;
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
      // Everything unchecked → restore the pre-fix baseline (manual tweaks intact).
      const baseline = baselineRef.current;
      baselineRef.current = null;
      setMergeNotes([]);
      applyRackMod(baseline ?? composeRack([]));
      return;
    }
    if (!baselineRef.current && getLiveMod) {
      const live = getLiveMod();
      if (live) baselineRef.current = JSON.parse(JSON.stringify(live)) as Record<string, ModuleState>;
    }
    const { mod, changeLog } = combineFixes(
      checked.map((f) => ({ ops: f.ops, weight: fixWeight(f) })),
      baselineRef.current ?? undefined,
    );
    setMergeNotes(changeLog);
    applyRackMod(mod);
  }, [byId, applyRackMod, getLiveMod]);

  const toggle = useCallback((id: string) => {
    const prev = appliedRef.current;
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    appliedRef.current = next;
    setAppliedIds(next);
    writeAppliedIds(versionId, next);
    recompute(next);
  }, [versionId, recompute]);

  const isApplied = useCallback((id: string) => appliedIds.includes(id), [appliedIds]);

  return { appliedIds, isApplied, toggle, mergeNotes };
}
