import { describe, expect, it } from 'vitest';

import type { StemRole } from '../../api/types';
import {
  buildAutoConfirmPayload,
  decideDispatchPath,
  decideSongAssociation,
  GENRE_HINTS,
} from '../unified-upload-helpers';

describe('decideDispatchPath', () => {
  it('routes to the stems confirm dispatch when stems are present', () => {
    expect(decideDispatchPath({ hasStems: true })).toBe('stems');
  });

  it('routes to /analyze when there are no stems', () => {
    expect(decideDispatchPath({ hasStems: false })).toBe('analyze');
  });
});

describe('buildAutoConfirmPayload', () => {
  it('maps id + detectedRole for each stem', () => {
    const out = buildAutoConfirmPayload([
      { id: 'a', detectedRole: 'kick' as StemRole },
      { id: 'b', detectedRole: 'bass' as StemRole },
    ]);
    expect(out).toEqual([
      { id: 'a', confirmedRole: 'kick' },
      { id: 'b', confirmedRole: 'bass' },
    ]);
  });

  it("falls back to 'other' when the classifier returned no role", () => {
    expect(buildAutoConfirmPayload([{ id: 'a', detectedRole: null }])).toEqual([
      { id: 'a', confirmedRole: 'other' },
    ]);
  });

  it('returns empty for no stems', () => {
    expect(buildAutoConfirmPayload([])).toEqual([]);
  });
});

describe('decideSongAssociation', () => {
  const base = { mode: 'new' as const, pickedSongId: '', newSongName: '' };

  it('uses the fixed songId when the dialog was opened from a song page', () => {
    expect(decideSongAssociation({ ...base, songIdProp: 'song-1' })).toEqual({
      action: 'fixed',
      songId: 'song-1',
    });
  });

  it('the fixed songId wins even if the user typed a new name', () => {
    expect(
      decideSongAssociation({ songIdProp: 'song-1', mode: 'new', pickedSongId: '', newSongName: 'X' }),
    ).toEqual({ action: 'fixed', songId: 'song-1' });
  });

  it('uses the picked song when in existing mode', () => {
    expect(
      decideSongAssociation({ mode: 'existing', pickedSongId: 'song-9', newSongName: '' }),
    ).toEqual({ action: 'existing', songId: 'song-9' });
  });

  it('creates a song when a trimmed new name is provided', () => {
    expect(
      decideSongAssociation({ mode: 'new', pickedSongId: '', newSongName: '  My Track  ' }),
    ).toEqual({ action: 'create', name: 'My Track' });
  });

  it('falls back to auto when new mode has a blank name', () => {
    expect(
      decideSongAssociation({ mode: 'new', pickedSongId: '', newSongName: '   ' }),
    ).toEqual({ action: 'auto' });
  });

  it('falls back to auto when existing mode has no pick', () => {
    expect(
      decideSongAssociation({ mode: 'existing', pickedSongId: '', newSongName: 'ignored' }),
    ).toEqual({ action: 'auto' });
  });
});

describe('GENRE_HINTS', () => {
  it('is a non-empty, de-duplicated list of genre strings', () => {
    expect(GENRE_HINTS.length).toBeGreaterThan(0);
    expect(new Set(GENRE_HINTS).size).toBe(GENRE_HINTS.length);
  });
});
