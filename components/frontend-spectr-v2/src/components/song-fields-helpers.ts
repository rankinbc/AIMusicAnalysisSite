// Pure helpers to seed the shared SongFields state and serialize it back into a
// create/patch request payload. Kept separate from the component so they're easy
// to unit-test.

import type { CreateSongRequest, SongDto, SongReferenceProfile } from '../api/types';
import { GENRE_PRESETS } from '../features/references/genrePresets';
import { fallbackVisual, randomVisual, serializeColor, visualFromDto } from '../ui/songVisualModel';
import type { SongFieldsValue } from './SongFields';

/** Fresh field state for the create flow — a random visual, everything else empty. */
export function emptySongFields(): SongFieldsValue {
  return {
    name: '',
    description: '',
    genreHint: '',
    referenceProfile: null,
    visual: randomVisual(),
  };
}

/** Seed field state from an existing song for the edit flow.
 *  `sets` resolves a stored set-kind reference profile to its display name + hue. */
export function songFieldsFromSong(
  song: SongDto,
  sets: { id: string; name: string; hue: number | null }[],
): SongFieldsValue {
  let referenceProfile: SongReferenceProfile | null = null;
  if (song.referenceProfileKind && song.referenceProfileId) {
    if (song.referenceProfileKind === 'preset') {
      const preset = GENRE_PRESETS.find((g) => g.id === song.referenceProfileId);
      if (preset) referenceProfile = { kind: 'preset', id: preset.id, name: preset.name, hue: preset.hue };
    } else {
      const found = sets.find((x) => x.id === song.referenceProfileId);
      if (found) {
        referenceProfile = { kind: 'set', id: found.id, name: found.name, hue: found.hue ?? 168 };
      }
    }
  }

  return {
    name: song.name,
    description: song.description ?? '',
    genreHint: song.genreHint ?? '',
    referenceProfile,
    // Stored visual if present; otherwise the deterministic look the card shows
    // today, so saving an edit never silently changes the cover.
    visual: visualFromDto(song.visualTemplate, song.visualPrimary, song.visualSecondary) ?? fallbackVisual(song.id),
  };
}

/** Serialize field state into the flat request fields shared by create + patch. */
export function songFieldsToRequest(v: SongFieldsValue): Required<Omit<CreateSongRequest, 'name'>> & { name: string } {
  return {
    name: v.name.trim(),
    genreHint: v.genreHint.trim() || null,
    description: v.description.trim() || null,
    visualTemplate: v.visual.template,
    visualPrimary: serializeColor(v.visual.primary),
    visualSecondary: serializeColor(v.visual.secondary),
    referenceProfileKind: v.referenceProfile?.kind ?? null,
    referenceProfileId: v.referenceProfile?.id ?? null,
  };
}
