// FR12 — split verdict prose into plain-text + .als track-name segments so the
// UI can render the named tracks as cyan chips that link to the Project panel.
export type TrackSegment =
  | { type: 'text'; value: string }
  | { type: 'track'; value: string };

/**
 * Tokenize `text` against the authoritative `names` list (from the rule engine's
 * `where.track_names`). Matches are EXACT, case-sensitive substrings — the names
 * come from the .als verbatim, so a loose/word match would false-positive on
 * common words (a track literally named "Bass" must not light up the word "bass"
 * in unrelated prose). Longest names first so a name containing another wins the
 * longer match. Returns a single text segment when there are no names/matches.
 */
export function tokenizeTrackNames(
  text: string,
  names: string[] | undefined | null,
): TrackSegment[] {
  if (!text || !names || names.length === 0) return [{ type: 'text', value: text }];
  const uniq = Array.from(new Set(names.filter((n) => n && n.length > 0)));
  if (uniq.length === 0) return [{ type: 'text', value: text }];
  uniq.sort((a, b) => b.length - a.length);

  const segments: TrackSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const matched = uniq.find((name) => text.startsWith(name, i));
    if (matched) {
      segments.push({ type: 'track', value: matched });
      i += matched.length;
    } else {
      const last = segments[segments.length - 1];
      if (last && last.type === 'text') last.value += text[i];
      else segments.push({ type: 'text', value: text[i] });
      i += 1;
    }
  }
  return segments;
}
