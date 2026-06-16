import type { VizState } from './StageDisplay';
import type { StageId } from './stageRegistry';

// Snapshot presets: the full DJ-tab visual state (laser, colors, energy macro,
// toggles + the active stage) saved under a name and persisted to localStorage
// so a producer's "look" survives reloads. Recall crossfades in the page (see
// the route's recall handler).

export interface VizPreset {
  name: string;
  viz: VizState;
  stage: StageId;
}

const STORAGE_KEY = 'spectr.viz.presets.v1';
const MAX_PRESETS = 12;

/** Read presets from localStorage. Returns [] on any parse/storage error. */
export function loadPresets(): VizPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shallow shape check — drop anything that isn't a well-formed preset.
    return parsed.filter(
      (p): p is VizPreset =>
        !!p &&
        typeof (p as VizPreset).name === 'string' &&
        typeof (p as VizPreset).viz === 'object' &&
        typeof (p as VizPreset).stage === 'string',
    );
  } catch {
    return [];
  }
}

/** Persist presets (capped + last-write-wins on name). Silently no-ops on error. */
export function savePresets(presets: VizPreset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
  } catch {
    /* quota / private-mode — non-fatal */
  }
}

/** Insert or replace a preset by name; returns the new list (most-recent-first). */
export function upsertPreset(presets: VizPreset[], preset: VizPreset): VizPreset[] {
  const without = presets.filter((p) => p.name !== preset.name);
  return [preset, ...without].slice(0, MAX_PRESETS);
}

/** Remove a preset by name. */
export function removePreset(presets: VizPreset[], name: string): VizPreset[] {
  return presets.filter((p) => p.name !== name);
}
