// Results → Listen handoff. The user's "Added" fixes are persisted to
// localStorage (per version) so the Listen "Plan" tab can list them as
// checkboxes — survives reload and direct navigation. Only applyable fixes
// (those whose dsp_chain maps to a rack module) are written; prose fixes belong
// to the DAW game plan, not the rack.
import type { VerdictDspOp } from '../../api/types';
import { isApplyable } from './fixToRackPatch';

export interface ListenFix {
  fixId: string;
  verdictId: string | null;
  title: string;
  scope: string;
  sev: string;
  specialist: string | null;
  ops: VerdictDspOp[];
  /** Story 12.4 (AC5): true when NO op maps to a rack module (sidechain,
   *  multiband, per-stem). Rendered as a disabled row — never silently
   *  dropped. Absent (old persisted rows) = applyable. */
  notApplicable?: boolean;
}

/** Minimal shape the builder needs — `Move` satisfies it structurally. */
export interface FixSource {
  id: string;
  verdictId: string | null;
  title: string;
  scope: string;
  sev: string;
  specialist: string | null;
  ops: VerdictDspOp[];
}

const fixesKey = (versionId: string) => `listenFixes:${versionId}`;
const appliedKey = (versionId: string) => `listenApplied:${versionId}`;

export function buildListenFixes(
  sources: FixSource[],
  isCommitted: (id: string) => boolean,
): ListenFix[] {
  // Story 12.4 (AC5): committed-but-unmappable fixes are KEPT and flagged
  // instead of filtered — the Plan tab shows them as disabled rows so the
  // user learns "not applicable in the rack" rather than "my fix vanished".
  return sources
    .filter((s) => isCommitted(s.id))
    .map((s) => ({
      fixId: s.id,
      verdictId: s.verdictId,
      title: s.title,
      scope: s.scope,
      sev: s.sev,
      specialist: s.specialist,
      ops: s.ops,
      notApplicable: !isApplyable(s.ops),
    }));
}

export function writeListenFixes(versionId: string, fixes: ListenFix[]): void {
  try {
    localStorage.setItem(fixesKey(versionId), JSON.stringify({ fixes }));
  } catch {
    /* quota / unavailable — non-fatal */
  }
}

export function readListenFixes(versionId: string): ListenFix[] {
  try {
    const raw = localStorage.getItem(fixesKey(versionId));
    if (!raw) return [];
    const data = JSON.parse(raw) as { fixes?: unknown };
    return Array.isArray(data.fixes) ? (data.fixes as ListenFix[]) : [];
  } catch {
    return [];
  }
}

// Story 12.4 review: the chip reset must clear a MOUNTED PlanPanel's overlay
// state too, not just localStorage (stale React state would re-apply "reset"
// fixes on the next toggle). The page can't reach the hook instance, so the
// clear flows through a window event the hook subscribes to.
export const FIX_OVERLAY_CLEAR_EVENT = 'spectr:fix-overlay-clear';

export function clearFixOverlay(versionId: string): void {
  writeAppliedIds(versionId, []);
  try {
    window.dispatchEvent(new CustomEvent(FIX_OVERLAY_CLEAR_EVENT, { detail: { versionId } }));
  } catch {
    /* non-fatal (SSR/test env without CustomEvent) */
  }
}

export function readAppliedIds(versionId: string): string[] {
  try {
    const raw = localStorage.getItem(appliedKey(versionId));
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as string[]) : [];
  } catch {
    return [];
  }
}

export function writeAppliedIds(versionId: string, ids: string[]): void {
  try {
    localStorage.setItem(appliedKey(versionId), JSON.stringify(ids));
  } catch {
    /* non-fatal */
  }
}
