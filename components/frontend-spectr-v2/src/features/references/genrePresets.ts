// Built-in genre reference profiles (map to phase-6 profile_source).
// NOTE: only trance/techno/house/dnb have backing statistical profiles today
// (see PRPs/design_handoffs/new-song-creation-backend-requirements.md §3);
// hiphop/pop are listed per the design and need profile JSONs generated before
// they influence analysis.
export const GENRE_PRESETS: { id: string; name: string; hue: number }[] = [
  { id: 'trance', name: 'Trance', hue: 232 },
  { id: 'techno', name: 'Techno', hue: 196 },
  { id: 'hiphop', name: 'Hip-Hop', hue: 22 },
  { id: 'house', name: 'House', hue: 45 },
  { id: 'dnb', name: 'Drum & Bass', hue: 300 },
  { id: 'pop', name: 'Pop', hue: 330 },
];
