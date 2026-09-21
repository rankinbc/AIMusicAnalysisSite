import type { ConfirmStemItem, StemRole } from '../api/types';

// Pure orchestration helpers for the unified-upload flow. Kept out of the dialog
// so they're unit-testable and so react-refresh stays happy (no component export).

export type DispatchPath = 'stems' | 'analyze';

/** Curated genre hints for the unified-upload select (UX-DR41 "genre hint select"). */
export const GENRE_HINTS = [
  'House',
  'Tech House',
  'Deep House',
  'Progressive House',
  'Future House',
  'Bass House',
  'Techno',
  'Melodic Techno',
  'Trance',
  'Psytrance',
  'Drum & Bass',
  'Dubstep',
  'Future Bass',
  'Trap',
  'Hip-Hop',
  'Pop',
  'R&B',
  'Ambient',
  'Downtempo',
  'Synthwave',
  'Hardstyle',
  'UK Garage',
] as const;

export type SongAssocMode = 'existing' | 'new';

/**
 * Resolve how the mix upload should associate with a song, given the dialog's
 * inputs. Pure so the orchestration is unit-testable.
 *
 * - `fixed`    — the dialog was opened from a song page; always use that songId.
 * - `existing` — the user picked a song from the dropdown.
 * - `create`   — the user typed a new song name; create the song first.
 * - `auto`     — no name / no pick; let the BFF name the song from the mix filename.
 */
export type SongAssociation =
  | { action: 'fixed'; songId: string }
  | { action: 'existing'; songId: string }
  | { action: 'create'; name: string }
  | { action: 'auto' };

export function decideSongAssociation(opts: {
  songIdProp?: string;
  mode: SongAssocMode;
  pickedSongId: string;
  newSongName: string;
}): SongAssociation {
  if (opts.songIdProp) return { action: 'fixed', songId: opts.songIdProp };
  if (opts.mode === 'existing' && opts.pickedSongId) {
    return { action: 'existing', songId: opts.pickedSongId };
  }
  const name = opts.newSongName.trim();
  if (opts.mode === 'new' && name) return { action: 'create', name };
  return { action: 'auto' };
}

/**
 * Which single dispatch closes the upload: when stems are attached the analysis is
 * dispatched by /stems/confirm; otherwise by /versions/{id}/analyze. Exactly one of
 * the two ever fires — that's the "analyzed once" guarantee.
 */
export function decideDispatchPath(opts: { hasStems: boolean }): DispatchPath {
  return opts.hasStems ? 'stems' : 'analyze';
}

/**
 * Build the confirm payload for the review-OFF path straight from the worker's
 * detected roles. A stem the classifier couldn't place falls back to 'other'.
 */
export function buildAutoConfirmPayload(
  stems: ReadonlyArray<{ id: string; detectedRole: StemRole | null }>,
): ConfirmStemItem[] {
  return stems.map((s) => ({ id: s.id, confirmedRole: s.detectedRole ?? 'other' }));
}

// D10 (guest shell, addendum a/b) — the guest upload dialog is NOT mix-only;
// stems/.als/reference stay visible, with server-sourced limits as helper
// text instead of being hidden. Kept pure + here (not inline JSX) so the
// already-1200+-line dialog doesn't grow, and so these are unit-testable
// without mounting it.

/** Substitute the whole dialog with the upgrade dialog once the guest has
 *  used every upload the server granted them. Never blocks a real user. */
export function guestUploadBlocked(guest: { isGuest: boolean; canUpload: boolean }): boolean {
  return guest.isGuest && !guest.canUpload;
}

/** Stems drop-zone helper line for a guest — server-sourced caps, never a
 *  hardcoded number (the per-version stems limit, GuestStateDto). */
export function formatGuestStemsHelp(stemsMaxFiles: number, stemsMaxMb: number): string {
  return `Up to ${stemsMaxFiles} stems · ${stemsMaxMb} MB per track`;
}

/** Reference-track helper line for a guest — remaining slots, clamped at 0
 *  (a guest can't go negative even if a race lets `used` exceed `max`). */
export function formatGuestReferenceHelp(referencesMax: number, referencesUsed: number): string {
  const left = Math.max(referencesMax - referencesUsed, 0);
  return `${left} reference left`;
}
