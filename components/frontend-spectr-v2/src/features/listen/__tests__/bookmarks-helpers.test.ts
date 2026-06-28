import { describe, expect, it } from 'vitest';

import type { BookmarkDto } from '../../../api/types';
import { bookmarksForVersion, markerPct } from '../bookmarks-helpers';

function bm(over: Partial<BookmarkDto>): BookmarkDto {
  return {
    id: 'b1',
    targetShareToken: null,
    targetPublishedTrack: null,
    targetVersionId: 'v1',
    t: 10,
    note: null,
    identityVisible: false,
    title: null,
    artist: null,
    createdAt: '2026-06-28T00:00:00Z',
    ...over,
  };
}

describe('bookmarksForVersion', () => {
  it('keeps only this version and orders by timestamp, track-level last', () => {
    const out = bookmarksForVersion(
      [
        bm({ id: 'a', t: 30 }),
        bm({ id: 'other', targetVersionId: 'v2', t: 5 }),
        bm({ id: 'b', t: 10 }),
        bm({ id: 'tracklevel', t: null }),
      ],
      'v1',
    );
    expect(out.map((b) => b.id)).toEqual(['b', 'a', 'tracklevel']);
  });

  it('returns empty when no bookmark targets the version', () => {
    expect(bookmarksForVersion([bm({ targetVersionId: 'v9' })], 'v1')).toEqual([]);
  });
});

describe('markerPct', () => {
  it('maps a timestamp to a clamped 0–100 offset', () => {
    expect(markerPct(30, 120)).toBe(25);
    expect(markerPct(240, 120)).toBe(100); // clamped
  });
  it('returns null for a track-level bookmark or a bad duration', () => {
    expect(markerPct(null, 120)).toBeNull();
    expect(markerPct(10, 0)).toBeNull();
  });
});
