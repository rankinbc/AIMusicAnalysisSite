/* Task V1 (2026-09-21) — single source of truth for "apply a director
 * program to the viz state". `chooseDirector` (ListenRackPage, the Visuals
 * panel's click path) and the page's initial state both go through
 * `applyDirectorToViz` so they can never drift.
 *
 * Persistence note (verified against the code, not assumed): nothing today
 * restores a saved viz/director choice into this page on mount.
 * `useVizPresets` / `useSaveVizPreset` / `useDeleteVizPreset` /  `asVizLook`
 * in `useVizPresetsServer.ts` are a named-preset ("look") save/recall list —
 * they exist and are unit-tested, but no component ever calls them, so
 * there is no live restore to race against. `initialDirectorState` is a
 * pure, no-argument, side-effect-free function (reads only the DEFAULT_VIZ /
 * DIRECTORS constants) used as a `useState` LAZY initializer — it runs once,
 * before first paint, and never writes anywhere, so it can't overwrite a
 * persisted choice or save the default back as if chosen. If a real restore
 * is wired up later, check it BEFORE falling back to this. */
import { DEFAULT_VIZ, DIRECTORS, type Director, type VizState } from './data';

/** The program a visitor with nothing persisted starts on. Product call
 * 2026-09-21: the light show is a minor feature — start calm. */
export const DEFAULT_DIRECTOR_ID = 'minimal';

/** Merges a director's `apply` flags onto a viz state exactly as the
 * Visuals panel's program buttons do: a `behaviorOnly` director (e.g.
 * Pulse) and a director with no `apply` (Manual) never touch viz, and the
 * base object is returned untouched (same reference) so a no-op `setViz`
 * call is a React state bail-out, not a re-render. */
export function applyDirectorToViz(base: VizState, dir: Director | undefined): VizState {
  if (dir && dir.apply && !dir.behaviorOnly) return { ...base, ...dir.apply };
  return base;
}

/** What the Visuals panel's "Sync all to music" button switches on. */
export const SYNC_ALL_TO_MUSIC = { autoReact: true, laserSync: true, autoColor: true, bgSync: true } as const;

/** The page's director + viz pair for a visitor with no persisted choice —
 * literally "as if they had clicked Minimal, then Sync all to music, from the
 * base state" (owner ruling 2026-10-01: the visuals follow the track by
 * default). */
export function initialDirectorState(): { director: string; viz: VizState } {
  const dir = DIRECTORS.find((d) => d.id === DEFAULT_DIRECTOR_ID);
  return { director: DEFAULT_DIRECTOR_ID, viz: { ...applyDirectorToViz(DEFAULT_VIZ, dir), ...SYNC_ALL_TO_MUSIC } };
}
