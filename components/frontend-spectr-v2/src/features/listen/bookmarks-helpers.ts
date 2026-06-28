// SPECTR · Listen V3 (PRP-6 / story 11.3) — pure helpers for the bookmarks rail.
// Kept separate from the component so filtering/positioning is unit-testable.
import type { BookmarkDto } from '../../api/types';

/**
 * `GET /me/bookmarks` returns ALL of my bookmarks across versions; the rail wants
 * only this version's, ordered along the timeline. Track-level bookmarks (`t == null`)
 * sort last (they have no timeline position).
 */
export function bookmarksForVersion(all: BookmarkDto[], versionId: string): BookmarkDto[] {
  return all
    .filter((b) => b.targetVersionId === versionId)
    .slice()
    .sort((a, b) => {
      if (a.t == null && b.t == null) return a.createdAt.localeCompare(b.createdAt);
      if (a.t == null) return 1;
      if (b.t == null) return -1;
      return a.t - b.t;
    });
}

/** Left offset (0–100%) of a bookmark on a timeline of `durationSeconds`. Clamped;
 *  returns null for a track-level bookmark (no `t`) or a non-positive duration. */
export function markerPct(t: number | null, durationSeconds: number): number | null {
  if (t == null || !(durationSeconds > 0)) return null;
  return Math.max(0, Math.min(100, (t / durationSeconds) * 100));
}
