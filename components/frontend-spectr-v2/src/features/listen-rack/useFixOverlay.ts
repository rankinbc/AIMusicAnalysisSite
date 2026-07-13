// Per-fix apply for the Listen "Plan" tab. Each Added fix is a checkbox; the set
// of checked fixes defines an overlay recomputed from a fix-free baseline on
// every toggle (composeRack), so toggling is clean and fixes stack (two EQ fixes
// land on different bands; unchecking one keeps the other). Applied ids persist
// to localStorage per version.
//
// Story 12.4 (AC4): the fix-free baseline is CAPTURED from the live rack at
// first apply (getLiveMod) instead of neutral defaults — manual knob moves made
// before applying fixes survive, and unchecking everything restores them.
// `pitch` is never written by composeRack regardless.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    const ops = ids.map((id) => byId.get(id)?.ops).filter((o): o is ListenFix['ops'] => Array.isArray(o));
    if (ops.length === 0) {
      // Everything unchecked → restore the pre-fix baseline (manual tweaks intact).
      const baseline = baselineRef.current;
      baselineRef.current = null;
      applyRackMod(baseline ?? composeRack([]));
      return;
    }
    if (!baselineRef.current && getLiveMod) {
      const live = getLiveMod();
      if (live) baselineRef.current = JSON.parse(JSON.stringify(live)) as Record<string, ModuleState>;
    }
    applyRackMod(composeRack(ops, baselineRef.current ?? undefined));
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

  return { appliedIds, isApplied, toggle };
}
