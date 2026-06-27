// Per-fix apply for the Listen "Plan" tab. Each Added fix is a checkbox; the set
// of checked fixes defines an overlay recomputed from a fix-free baseline on
// every toggle (composeRack), so toggling is clean and fixes stack (two EQ fixes
// land on different bands; unchecking one keeps the other). Applied ids persist
// to localStorage per version.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { composeRack } from './fixToRackPatch';
import { readAppliedIds, writeAppliedIds, type ListenFix } from './listenFixes';
import type { RackState } from './rackState';

interface UseFixOverlayArgs {
  versionId: string;
  fixes: ListenFix[];
  applyRackMod: RackState['applyRackMod'];
}

export function useFixOverlay({ versionId, fixes, applyRackMod }: UseFixOverlayArgs) {
  const [appliedIds, setAppliedIds] = useState<string[]>(() => readAppliedIds(versionId));

  // Re-read when switching versions.
  useEffect(() => {
    setAppliedIds(readAppliedIds(versionId));
  }, [versionId]);

  const byId = useMemo(() => new Map(fixes.map((f) => [f.fixId, f])), [fixes]);

  const recompute = useCallback((ids: string[]) => {
    const ops = ids.map((id) => byId.get(id)?.ops).filter((o): o is ListenFix['ops'] => Array.isArray(o));
    applyRackMod(composeRack(ops));
  }, [byId, applyRackMod]);

  const toggle = useCallback((id: string) => {
    setAppliedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeAppliedIds(versionId, next);
      recompute(next);
      return next;
    });
  }, [versionId, recompute]);

  const isApplied = useCallback((id: string) => appliedIds.includes(id), [appliedIds]);

  return { appliedIds, isApplied, toggle };
}
