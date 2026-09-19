import { describe, expect, it } from 'vitest';

import type { SongDto, VersionDto } from '../../../api/types';
import {
  aggregateTags,
  latestVersion,
  matchesFilter,
  pillCounts,
  songMatchesTags,
  sortSongs,
} from '../library-helpers';

const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();

function version(n: number, over: Partial<VersionDto> = {}): VersionDto {
  return {
    id: `v${n}-${Math.random().toString(36).slice(2, 7)}`,
    songId: 'song',
    versionNumber: n,
    label: null,
    isCurrent: false,
    filePath: '',
    createdAt: iso(n),
    alsFilePath: null,
    referencePath: null,
    ...over,
  };
}

function song(over: Partial<SongDto> = {}): SongDto {
  return {
    id: `song-${Math.random().toString(36).slice(2, 7)}`,
    name: 'Untitled',
    genreHint: null,
    createdAt: iso(10),
    updatedAt: iso(1),
    archivedAt: null,
    versions: [],
    latestResult: null,
    tags: [],
    ...over,
  };
}

describe('latestVersion', () => {
  it('returns the highest versionNumber regardless of array order', () => {
    const s = song({ versions: [version(3), version(1), version(2)] });
    expect(latestVersion(s)?.versionNumber).toBe(3);
  });
  it('prefers an isCurrent version', () => {
    const s = song({ versions: [version(1, { isCurrent: true }), version(2)] });
    expect(latestVersion(s)?.versionNumber).toBe(1);
  });
  it('is undefined for a song with no versions', () => {
    expect(latestVersion(song({ versions: [] }))).toBeUndefined();
  });
});

describe('matchesFilter', () => {
  it('all excludes archived', () => {
    expect(matchesFilter(song({ archivedAt: null }), 'all')).toBe(true);
    expect(matchesFilter(song({ archivedAt: iso(2) }), 'all')).toBe(false);
  });
  it('archived shows only archived', () => {
    expect(matchesFilter(song({ archivedAt: iso(2) }), 'archived')).toBe(true);
    expect(matchesFilter(song({ archivedAt: null }), 'archived')).toBe(false);
  });
});

describe('songMatchesTags (union)', () => {
  const tagged = song({
    tags: [
      { id: 'a', name: 'festival', isPublic: true },
      { id: 'b', name: 'wip', isPublic: false },
    ],
  });
  it('matches all when nothing is selected', () => {
    expect(songMatchesTags(tagged, new Set())).toBe(true);
  });
  it('matches when the song has ANY selected tag', () => {
    expect(songMatchesTags(tagged, new Set(['festival', 'other']))).toBe(true);
  });
  it('does not match when the song has none of the selected tags', () => {
    expect(songMatchesTags(tagged, new Set(['nope']))).toBe(false);
  });
});

describe('aggregateTags', () => {
  it('counts tags across non-archived songs, flags public, sorts by count', () => {
    const songs = [
      song({ tags: [{ id: '1', name: 'house', isPublic: false }] }),
      song({ tags: [{ id: '2', name: 'house', isPublic: true }] }),
      song({ archivedAt: iso(1), tags: [{ id: '3', name: 'house', isPublic: true }] }), // skipped
      song({ tags: [{ id: '4', name: 'demo', isPublic: false }] }),
    ];
    const agg = aggregateTags(songs);
    expect(agg[0]).toEqual({ name: 'house', isPublic: true, count: 2 });
    expect(agg.find((t) => t.name === 'demo')?.count).toBe(1);
    expect(agg.some((t) => t.count === 3)).toBe(false); // archived not counted
  });
});

describe('pillCounts', () => {
  const songs = [
    song({}),
    song({ tags: [{ id: 't', name: 'fav', isPublic: false }] }),
    song({}),
    song({ archivedAt: iso(2) }),
  ];
  it('recomputes counts with no tag filter', () => {
    const c = pillCounts(songs, new Set());
    expect(c.all).toBe(3); // archived excluded
    expect(c.archived).toBe(1);
  });
  it('recomputes counts against the active tag filter', () => {
    const c = pillCounts(songs, new Set(['fav']));
    expect(c.all).toBe(1); // only the tagged song carries #fav
    expect(c.archived).toBe(0); // the archived song isn't tagged
  });
});

describe('sortSongs', () => {
  it('sorts by name / versions / recent without mutating input', () => {
    const a = song({ name: 'Beta', updatedAt: iso(5), versions: [version(1)] });
    const b = song({ name: 'Alpha', updatedAt: iso(1), versions: [version(1), version(2)] });
    const input = [a, b];
    expect(sortSongs(input, 'name').map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(sortSongs(input, 'versions')[0]).toBe(b);
    expect(sortSongs(input, 'recent')[0]).toBe(b); // b updated more recently
    expect(input).toEqual([a, b]); // not mutated
  });
});
