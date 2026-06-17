import type { SongDto, VersionDto } from '../api/types';

export interface MiniPlayerTrack {
  song: SongDto;
  version: VersionDto;
}

/**
 * Pick the track the shell MiniPlayer surfaces: the most-recently-updated
 * non-archived song that has a playable version. Prefers the current version,
 * else the latest. Returns null when there is nothing to play (a brand-new
 * library), so the bar hides rather than showing an empty transport.
 */
export function pickMiniPlayerTrack(songs: readonly SongDto[] | undefined): MiniPlayerTrack | null {
  const candidates = (songs ?? [])
    .filter((song) => song.archivedAt == null && song.versions.length > 0)
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const song = candidates[0];
  if (!song) return null;
  const version = song.versions.find((v) => v.isCurrent) ?? song.versions.at(-1);
  if (!version) return null;
  return { song, version };
}
