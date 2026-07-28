// Pure derivations for the Improvement Plan tab (v4). No API calls here.

import type { VerdictDto } from '../../api/types';
import type { Move } from './move-model';
import { parseEvidenceRows, formatEvRange, formatEvValue } from './evidence-model';
import { deviceOf } from './fix-board-helpers';
import { formatWhere } from './problems-helpers';

export interface DeviceGroup {
  device: string;
  moves: Move[];
}

/** Committed moves grouped by fix target, Master first, then A–Z. */
export function perDeviceGroups(moves: Move[]): DeviceGroup[] {
  const byDevice = new Map<string, Move[]>();
  for (const m of moves) {
    const device = deviceOf(m.scope) ?? 'Master';
    const arr = byDevice.get(device) ?? [];
    arr.push(m);
    byDevice.set(device, arr);
  }
  return [...byDevice.entries()]
    .sort(([a], [b]) => (a === 'Master' ? -1 : b === 'Master' ? 1 : a.localeCompare(b)))
    .map(([device, ms]) => ({ device, moves: ms.sort((a, b) => b.impact - a.impact) }));
}

export interface TimedMoment {
  t: number;
  label: string;
  headline: string;
  verdictId: string;
}

/** Section-anchored findings with a start time, sorted by track position. */
export function timestampedMoments(verdicts: VerdictDto[]): TimedMoment[] {
  return verdicts
    .filter((v) => v.headline !== 'Specialist failed' && v.where?.start_seconds != null)
    .map((v) => ({
      t: v.where!.start_seconds as number,
      label: formatWhere(v.where) ?? '',
      headline: v.headline,
      verdictId: v.id,
    }))
    .sort((a, b) => a.t - b.t);
}

export interface GenreTarget {
  metric: string;
  yours: string;
  target: string;
}

/** Measured-vs-expected rows pulled from the committed verdicts' evidence —
 *  there is deliberately NO genre-targets API (stub policy). Deduped by metric. */
export function genreTargets(verdicts: VerdictDto[], committedVerdictIds: ReadonlySet<string>): GenreTarget[] {
  const seen = new Set<string>();
  const out: GenreTarget[] = [];
  for (const v of verdicts) {
    if (!committedVerdictIds.has(v.id)) continue;
    for (const row of parseEvidenceRows(v.evidence)) {
      if (!row.expected_range || seen.has(row.metric)) continue;
      seen.add(row.metric);
      out.push({
        metric: row.label || row.metric,
        yours: formatEvValue(row.value),
        target: formatEvRange(row.expected_range),
      });
    }
  }
  return out;
}

/** Non-fixable findings the user checked as notes — the manual-work footnote. */
export function manualNotes(
  verdicts: VerdictDto[],
  checkedNoteIds: ReadonlySet<string>,
): VerdictDto[] {
  return verdicts.filter(
    (v) => checkedNoteIds.has(v.id) && !v.userState.dismissed && v.headline !== 'Specialist failed',
  );
}
