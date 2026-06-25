// Pure, framework-free helpers for the Songs library. Kept apart from the
// component so the filter / count / tag-aggregation / sort logic is trivially
// unit-testable. Grades/scores intentionally play NO role here.

import type { SongDto, SongVisibility, VersionDto } from '../../api/types';

export interface VisMeta {
  label: string;
  glyph: string;
  desc: string;
}

export const VIS_META: Record<SongVisibility, VisMeta> = {
  private: { label: 'Private', glyph: '🔒', desc: 'Only you' },
  shared: { label: 'Shared', glyph: '🔗', desc: 'Anyone with the link' },
  public: { label: 'Public', glyph: '🌐', desc: 'Listed + discoverable' },
};

export const VIS_ORDER: SongVisibility[] = ['private', 'shared', 'public'];

/** A missing `visibility` is treated as 'private' everywhere. */
export function visibilityOf(song: SongDto): SongVisibility {
  return song.visibility ?? 'private';
}

/** The latest version = the one with the highest versionNumber. (A flagged
 *  `isCurrent` version wins ties / out-of-order arrays.) `undefined` when the
 *  song has no versions yet. */
export function latestVersion(song: SongDto): VersionDto | undefined {
  if (song.versions.length === 0) return undefined;
  const current = song.versions.find((v) => v.isCurrent);
  if (current) return current;
  return song.versions.reduce((best, v) => (v.versionNumber > best.versionNumber ? v : best));
}

export type VisFilterKey = 'all' | 'private' | 'shared' | 'public' | 'archived';

/** Filter pills. `vis` themes the pill via `data-vis`; for `all`/`archived`
 *  it's a neutral-ish stand-in (no glyph rendered for those two). */
export const FILTERS: { key: VisFilterKey; label: string; vis: SongVisibility }[] = [
  { key: 'all', label: 'All', vis: 'shared' },
  { key: 'private', label: 'Private', vis: 'private' },
  { key: 'shared', label: 'Shared', vis: 'shared' },
  { key: 'public', label: 'Public', vis: 'public' },
  { key: 'archived', label: 'Archived', vis: 'private' },
];

/** `all` excludes archived; `archived` shows only archived; the three
 *  visibility keys match non-archived songs of that visibility. */
export function matchesFilter(song: SongDto, key: VisFilterKey): boolean {
  if (key === 'all') return song.archivedAt == null;
  if (key === 'archived') return song.archivedAt != null;
  return song.archivedAt == null && visibilityOf(song) === key;
}

/** Union match: a song passes when it carries ANY selected tag (or when no
 *  tags are selected at all). */
export function songMatchesTags(song: SongDto, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  return song.tags.some((t) => selected.has(t.name));
}

export interface TagAgg {
  name: string;
  isPublic: boolean;
  count: number;
}

/** Unique tag names across the active (non-archived) songs, with how many
 *  songs carry each, sorted by count desc then name asc. */
export function aggregateTags(songs: SongDto[]): TagAgg[] {
  const map = new Map<string, TagAgg>();
  for (const song of songs) {
    if (song.archivedAt != null) continue;
    for (const t of song.tags) {
      const cur = map.get(t.name) ?? { name: t.name, isPublic: false, count: 0 };
      cur.count += 1;
      cur.isPublic = cur.isPublic || t.isPublic;
      map.set(t.name, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Pill counts recompute against the active tag filter so the numbers always
 *  match the rendered grid. */
export function pillCounts(
  songs: SongDto[],
  selectedTags: ReadonlySet<string>,
): Record<VisFilterKey, number> {
  const out = { all: 0, private: 0, shared: 0, public: 0, archived: 0 } as Record<
    VisFilterKey,
    number
  >;
  for (const f of FILTERS) {
    out[f.key] = songs.filter(
      (s) => matchesFilter(s, f.key) && songMatchesTags(s, selectedTags),
    ).length;
  }
  return out;
}

export type SortKey = 'recent' | 'name' | 'versions';

/** Non-mutating sort (returns a new array). */
export function sortSongs(songs: SongDto[], sort: SortKey): SongDto[] {
  return [...songs].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'versions') return b.versions.length - a.versions.length;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}
