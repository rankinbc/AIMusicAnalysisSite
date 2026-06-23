/**
 * Stem-identification assist (the .als-metadata angle).
 *
 * Given the staged stem filenames and the track names extracted from a dropped
 * `.als` (see {@link ./alsPreview}), propose filename → track-name matches. This
 * lets us pre-label stem roles from the producer's own track names instead of
 * guessing purely from audio content.
 *
 * Scope: this module owns ONLY the filename↔track-name matching + a light
 * keyword role guesser. Wiring the matches into the stem confirm flow is a
 * documented follow-up (see DECISIONS.md) so it can be reconciled with the
 * `research/stem-classification` window's audio-content recommendation.
 */

import type { StemRole } from '../../api/types';

export interface StemTrackMatch {
  /** The stem filename as provided. */
  stemFilename: string;
  /** Best-matching .als track name, or null if nothing cleared the threshold. */
  trackName: string | null;
  /** Match confidence 0..1 (1 = normalized strings identical). */
  score: number;
}

// Words that carry no identity — stripped before comparing.
const NOISE_WORDS = new Set([
  'audio',
  'stem',
  'stems',
  'export',
  'exports',
  'exported',
  'bounce',
  'bounced',
  'render',
  'rendered',
  'print',
  'printed',
  'final',
  'wav',
  'flac',
  'aiff',
  'aif',
  'mixdown',
  'take',
  'rec',
  'recording',
]);

/** Strip extension, lowercase, drop separators/noise, collapse to tokens. */
export function normalizeTokens(raw: string): string[] {
  const noExt = raw.replace(/\.[a-z0-9]{1,5}$/i, '');
  return noExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !NOISE_WORDS.has(t));
}

/**
 * Similarity 0..1 between a filename and a track name. Token Sørensen–Dice
 * coefficient, with a bonus when one normalized string contains the other
 * (handles "Bass" ⊂ "Reese Bass Layer").
 */
export function nameSimilarity(filename: string, trackName: string): number {
  const a = normalizeTokens(filename);
  const b = normalizeTokens(trackName);
  if (a.length === 0 || b.length === 0) return 0;

  const sa = a.join(' ');
  const sb = b.join(' ');
  if (sa === sb) return 1;

  const setB = new Set(b);
  let overlap = 0;
  for (const t of new Set(a)) if (setB.has(t)) overlap += 1;
  const dice = (2 * overlap) / (new Set(a).size + new Set(b).size);

  // Substring containment bonus (either direction).
  const contains = sa.includes(sb) || sb.includes(sa);
  const score = contains ? Math.max(dice, 0.6) : dice;
  return Math.min(1, score);
}

/**
 * Propose a track-name match for each stem filename. For every stem we pick its
 * best-scoring track; matches below `threshold` resolve to null. Tracks may be
 * reused (several stems can map to one track) — this is an assist, not a
 * constraint. Results are returned in the input order of `filenames`.
 */
export function matchStemsToTracks(
  filenames: readonly string[],
  trackNames: readonly string[],
  threshold = 0.34,
): StemTrackMatch[] {
  return filenames.map((stemFilename) => {
    let best: { trackName: string; score: number } | null = null;
    for (const trackName of trackNames) {
      const score = nameSimilarity(stemFilename, trackName);
      if (!best || score > best.score) best = { trackName, score };
    }
    if (best && best.score >= threshold) {
      return { stemFilename, trackName: best.trackName, score: Math.round(best.score * 100) / 100 };
    }
    return { stemFilename, trackName: null, score: best ? Math.round(best.score * 100) / 100 : 0 };
  });
}

// Keyword → role table for the light name-based role guesser. Order matters:
// more specific drum parts are checked before the generic "drums".
const ROLE_KEYWORDS: ReadonlyArray<[StemRole, readonly string[]]> = [
  ['kick', ['kick', 'bd', 'bassdrum']],
  ['snare', ['snare', 'clap', 'rim', 'sd']],
  ['hats', ['hat', 'hats', 'hihat', 'hi hat', 'cymbal', 'ride', 'crash', 'perc', 'shaker']],
  ['drums', ['drum', 'drums', 'beat', 'breakbeat']],
  ['bass', ['bass', 'sub', '808', 'reese']],
  ['vocals', ['vocal', 'vox', 'voice', 'acapella', 'adlib', 'choir']],
  ['lead', ['lead', 'melody', 'arp', 'pluck', 'synth', 'topline']],
  ['pad', ['pad', 'chord', 'keys', 'piano', 'string', 'strings', 'atmos', 'atmosphere']],
  ['fx', ['fx', 'riser', 'sweep', 'impact', 'noise', 'foley', 'downlifter', 'uplifter']],
];

/**
 * Best-effort {@link StemRole} guess from a stem filename or .als track name.
 * Returns null when no keyword matches (caller should fall back to 'other' or
 * the audio classifier). This is the assist surface the follow-up will wire into
 * the stem review step.
 */
export function guessRoleFromName(name: string): StemRole | null {
  const tokens = new Set(normalizeTokens(name));
  const joined = normalizeTokens(name).join(' ');
  for (const [role, keywords] of ROLE_KEYWORDS) {
    for (const kw of keywords) {
      if (kw.includes(' ') ? joined.includes(kw) : tokens.has(kw)) return role;
    }
  }
  return null;
}
