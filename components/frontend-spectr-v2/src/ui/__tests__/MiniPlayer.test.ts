import { describe, expect, it } from 'vitest';

import { pickMiniPlayerTrack } from '../miniPlayerTrack';
import type { SongDto, VersionDto } from '../../api/types';

function version(over: Partial<VersionDto> & { id: string }): VersionDto {
  return {
    songId: 'song',
    versionNumber: 1,
    label: null,
    isCurrent: false,
    filePath: '/mix.wav',
    createdAt: '2026-06-01T00:00:00Z',
    alsFilePath: null,
    referencePath: null,
    ...over,
  };
}

function song(over: Partial<SongDto> & { id: string }): SongDto {
  return {
    name: 'Track',
    genreHint: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    archivedAt: null,
    versions: [version({ id: `${over.id}-v1` })],
    latestResult: null,
    tags: [],
    ...over,
  };
}

describe('pickMiniPlayerTrack', () => {
  it('picks the most-recently-updated song and prefers its current version', () => {
    const older = song({
      id: 'a',
      updatedAt: '2026-06-10T00:00:00Z',
      versions: [version({ id: 'a-v1', isCurrent: true })],
    });
    const newer = song({
      id: 'b',
      updatedAt: '2026-06-15T00:00:00Z',
      versions: [
        version({ id: 'b-v1', versionNumber: 1 }),
        version({ id: 'b-v2', versionNumber: 2, isCurrent: true }),
      ],
    });
    const picked = pickMiniPlayerTrack([older, newer]);
    expect(picked?.song.id).toBe('b');
    expect(picked?.version.id).toBe('b-v2');
  });

  it('falls back to the latest version when none is flagged current', () => {
    const s = song({
      id: 'c',
      versions: [
        version({ id: 'c-v1', versionNumber: 1 }),
        version({ id: 'c-v2', versionNumber: 2 }),
      ],
    });
    const picked = pickMiniPlayerTrack([s]);
    expect(picked?.version.id).toBe('c-v2');
  });

  it('returns null when there is nothing playable (empty, archived, or versionless)', () => {
    expect(pickMiniPlayerTrack(undefined)).toBeNull();
    expect(pickMiniPlayerTrack([])).toBeNull();
    expect(
      pickMiniPlayerTrack([song({ id: 'd', archivedAt: '2026-06-01T00:00:00Z' })]),
    ).toBeNull();
    expect(pickMiniPlayerTrack([song({ id: 'e', versions: [] })])).toBeNull();
  });
});
