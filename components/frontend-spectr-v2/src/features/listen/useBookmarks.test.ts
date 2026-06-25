// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { localBookmarksFor } from './useBookmarks';
import type { BookmarkDto } from '../../api/types';

const bm = (id: string): BookmarkDto => ({
  id,
  targetShareToken: null,
  targetPublishedTrack: null,
  targetVersionId: 'v1',
  t: 12,
  note: null,
  identityVisible: false,
  title: null,
  artist: null,
  createdAt: '2026-06-25T00:00:00Z',
});

describe('localBookmarksFor (anon browser-local fallback)', () => {
  beforeEach(() => localStorage.clear());

  it('returns [] when nothing stored for the version', () => {
    expect(localBookmarksFor('v1')).toEqual([]);
  });

  it('reads the stored bookmarks for a version', () => {
    localStorage.setItem('spectr.anonBookmarks', JSON.stringify({ v1: [bm('a')] }));
    expect(localBookmarksFor('v1').map((b) => b.id)).toEqual(['a']);
    expect(localBookmarksFor('v2')).toEqual([]);
  });

  it('returns [] on corrupt storage instead of throwing', () => {
    localStorage.setItem('spectr.anonBookmarks', '{not json');
    expect(localBookmarksFor('v1')).toEqual([]);
  });
});
