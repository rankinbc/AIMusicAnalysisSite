/* Listen findings board — pure helpers. No React, no I/O, no DOM. */
import type { VerdictDto } from '../../../api/types';
import type { Move } from '../../results/move-model';
import { buildListenFixes, type ListenFix } from '../listenFixes';
import { lrTime } from '../lrUtil';
import type { CarryPhase } from '../useFixCarryOver';

export interface SeekTarget {
  start: number;
  end: number | null;
  /** "1:23" or "1:23–1:41", in the transport's own clock. */
  label: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Spec D4 — the playable moment a finding points at, or null when it carries
 * none we can trust. `where` (the rule engine's localisation) wins over
 * `fix.section`. A start past the end of the track is not a start: the worker
 * has written placeholder seconds before, and a dead "jump" button is worse
 * than no button. `durationSeconds <= 0` means "not known yet" and skips the
 * bound rather than rejecting everything while the audio loads.
 */
export function timeRangeOf(v: VerdictDto, durationSeconds: number): SeekTarget | null {
  const sources: Array<{ start: unknown; end: unknown }> = [
    { start: v.where?.start_seconds, end: v.where?.end_seconds },
    { start: v.fix?.section?.start_seconds, end: v.fix?.section?.end_seconds },
  ];
  for (const s of sources) {
    const start = finiteOrNull(s.start);
    if (start === null || start < 0) continue;
    if (durationSeconds > 0 && start >= durationSeconds) continue;
    const rawEnd = finiteOrNull(s.end);
    const end =
      rawEnd !== null && rawEnd > start && (durationSeconds <= 0 || rawEnd <= durationSeconds)
        ? rawEnd
        : null;
    return {
      start,
      end,
      label: end === null ? lrTime(start) : `${lrTime(start)}–${lrTime(end)}`,
    };
  }
  return null;
}

export interface ApplyGate {
  enabled: boolean;
  /** Why applying is off right now; rendered verbatim. null when enabled. */
  reason: string | null;
  /** True when a Clear-preset button belongs next to the reason. */
  showClearPreset: boolean;
}

/**
 * Spec D8 — a carried ?fixPreset= chain is auditioned AS ONE. Per-fix toggling
 * stays off until it is cleared, because `combineFixes` is a weighted merge and
 * a merged chain cannot be decomposed back into the fixes that built it. A
 * carry that FAILED never reached the rack, so toggling is live.
 */
export function applyGate(carryPhase: CarryPhase): ApplyGate {
  if (carryPhase === 'pending') {
    return { enabled: false, reason: 'Loading the carried fix rack…', showClearPreset: false };
  }
  if (carryPhase === 'applied') {
    return {
      enabled: false,
      reason: 'A fix preset is loaded — clear it to A/B single fixes.',
      showClearPreset: true,
    };
  }
  return { enabled: true, reason: null, showClearPreset: false };
}

/**
 * Every applyable AI move as a ListenFix row. The Listen board can apply ANY
 * of them, not just the subset the report queued, so the filter is
 * always-true. `Move` satisfies `FixSource` structurally, so this is the
 * existing builder rather than a parallel adapter. Rule-engine prose moves
 * (no verdict, no ops) are dropped — they have nothing to put on a rack.
 */
export function boardListenFixes(moves: Move[]): ListenFix[] {
  return buildListenFixes(
    moves.filter((m) => m.verdictId != null && m.ops.length > 0),
    () => true,
  );
}
