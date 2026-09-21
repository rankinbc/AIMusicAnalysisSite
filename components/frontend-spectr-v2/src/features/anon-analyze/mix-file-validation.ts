// Task G5 fix1 item 5 — validate BEFORE minting a guest session. A `.txt` (or
// any other bad drop) must never call startDemo()/upload() at all — it
// currently sails straight through to the mix uploader. Same allow-list
// UnifiedUploadDialog's AUDIO_ACCEPT enforces and the same ≤250 MB ceiling
// this very page already advertises in its drop-zone hint text (not a new
// number) — pure, no React, unit-testable in isolation.
const AUDIO_EXTENSIONS = ['.wav', '.flac', '.mp3', '.aiff', '.aif', '.m4a', '.ogg'];
const MAX_MIX_BYTES = 250 * 1024 * 1024;

/** Existing copy (UnifiedUploadDialog.tsx) — reused verbatim, not invented. */
export const UNSUPPORTED_FILE_MESSAGE = 'Drop an audio file (WAV / FLAC / MP3 / AIFF / M4A / OGG).';
export const OVERSIZED_FILE_MESSAGE = 'That file is over the 250 MB limit.';

/** Returns an error message when the file fails client-side validation, else null. */
export function validateMixFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return UNSUPPORTED_FILE_MESSAGE;
  if (file.size > MAX_MIX_BYTES) return OVERSIZED_FILE_MESSAGE;
  return null;
}
