import type { FixRackDto, RackPresetDto } from '../../api/types';
import { enabledModuleIds } from './fix-rack-helpers';

// Pure model for the Send-to-Listen card — kept out of the component so it
// fast-refreshes and is unit-testable. One rack primitive underneath: a compiled
// Coach Mix and a saved preset are the same chain schema, so both become rows.

export interface PresetRow {
  key: string;
  name: string;
  /** true = the analysis-generated Coach Mix (source='analysis'), not a saved user preset. */
  auto: boolean;
  chain: unknown;
  /** Listen carry-over handle (?fixPreset=) — absent on pre-12.4 cached racks. */
  presetId?: string | undefined;
  moduleCount: number;
}

export const presetsEmptyCopy =
  'No presets yet — generate a Coach Mix from your queued fixes to audition them as one rack.';

/** Rows for the presets list: the generated Coach Mix (an `auto` row, when
 *  ready) first, then saved user presets. The Coach Mix comes from the fix-rack
 *  hook (source='analysis' — it is NOT in the version's `user` presets list). */
export function presetRows(fixRack: FixRackDto | null, userPresets: RackPresetDto[]): PresetRow[] {
  const rows: PresetRow[] = [];
  if (fixRack) {
    rows.push({
      key: 'coach-mix',
      // Always brand the generated auto preset as "Coach Mix" — the raw backend
      // rack name (e.g. "Fix rack — <track>") is an internal label, not UI copy.
      name: 'Coach Mix',
      auto: true,
      chain: fixRack.chain,
      presetId: fixRack.presetId,
      moduleCount: enabledModuleIds(fixRack.chain).length,
    });
  }
  for (const p of userPresets) {
    rows.push({
      key: p.id,
      name: p.name,
      auto: false,
      chain: p.chain,
      presetId: p.id,
      moduleCount: enabledModuleIds(p.chain).length,
    });
  }
  return rows;
}

/** "<N> fixes queued · <M> presets" summary for the card header. */
export function queuedSummary(queuedCount: number, presetCount: number): string {
  const fixes = queuedCount
    ? `${queuedCount} ${queuedCount === 1 ? 'fix' : 'fixes'} queued`
    : 'nothing queued';
  if (presetCount <= 0) return fixes;
  return `${fixes} · ${presetCount} ${presetCount === 1 ? 'preset' : 'presets'}`;
}
