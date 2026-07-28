// Improvement-Plan action log — localStorage only (v4 stub policy: no
// server-side plan-log table). Every board/plan action (Try Fixes, Create
// Preset, Coach Mix, Listen in Studio, export) appends an entry; the count
// badges the Improvement Plan tab.

export interface PlanLogEntry {
  /** Epoch ms. */
  ts: number;
  kind:
    | 'try_fixes'
    | 'create_preset'
    | 'coach_mix'
    | 'listen_in_studio'
    | 'export'
    | 'mark_applied'
    | 'note';
  label: string;
}

const key = (versionId: string) => `planLog:${versionId}`;

export function readPlanLog(versionId: string | null): PlanLogEntry[] {
  if (!versionId) return [];
  try {
    const raw = localStorage.getItem(key(versionId));
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as PlanLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendPlanLog(
  versionId: string | null,
  entry: Omit<PlanLogEntry, 'ts'>,
): PlanLogEntry[] {
  if (!versionId) return [];
  const next = [...readPlanLog(versionId), { ...entry, ts: Date.now() }];
  try {
    localStorage.setItem(key(versionId), JSON.stringify(next));
  } catch {
    /* quota / unavailable — non-fatal */
  }
  return next;
}
