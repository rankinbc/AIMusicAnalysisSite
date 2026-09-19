// Story 5.10 (UX-DR43) — global product shortcuts. Pure decision logic so the
// AppLayout listener stays a two-liner and the matrix is unit-testable
// without mounting the shell.

export type ShortcutAction = 'palette' | 'upload' | 'sheet';

/** Minimal structural type so tests can pass plain objects. */
export interface ShortcutKeyEvent {
  key: string;
  /** Physical-key fallback (KeyK/KeyU) — e.key is layout-dependent, so ⌘K
   *  must still work on Cyrillic/Greek/etc. layouts. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

/** Text-entry input types — checkbox/radio/range/button-likes are NOT
 *  editable and must not swallow modifier chords. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'file',
  'color',
]);

/** True when the event originates inside an editable control — shortcuts
 *  must never fire while the user is typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const host = target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
  );
  if (!host) return false;
  if (host instanceof HTMLInputElement && NON_TEXT_INPUT_TYPES.has(host.type)) return false;
  return true;
}

/** Maps a keydown to a shortcut action, or null. ⌘/Ctrl interchangeable
 *  (mac/win); shift EXCLUDED for k/u (Ctrl+Shift+K is the Firefox console —
 *  never hijack three-key browser chords). `?` is shift+/ by nature, matched
 *  on the produced key with no ctrl/meta. */
export function matchShortcut(e: ShortcutKeyEvent): ShortcutAction | null {
  if (e.repeat || e.isComposing || e.altKey) return null;
  if (isEditableTarget(e.target)) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && !e.shiftKey && (key === 'k' || e.code === 'KeyK')) return 'palette';
  if (mod && !e.shiftKey && (key === 'u' || e.code === 'KeyU')) return 'upload';
  if (!mod && e.key === '?') return 'sheet';
  return null;
}

export interface PaletteCommand {
  id: string;
  label: string;
  /** 'nav' = static route command; 'song' = library search hit. */
  kind: 'nav' | 'song';
  /** Route target: static path for nav, songId for song. */
  to: string;
}

export const NAV_COMMANDS: PaletteCommand[] = [
  { id: 'nav-library', label: 'Library', kind: 'nav', to: '/library' },
  { id: 'nav-reports', label: 'Reports', kind: 'nav', to: '/reports' },
  { id: 'nav-usage', label: 'Usage', kind: 'nav', to: '/usage' },
  { id: 'nav-billing', label: 'Billing', kind: 'nav', to: '/billing' },
  { id: 'nav-profile', label: 'Profile', kind: 'nav', to: '/profile' },
];

/** Case-insensitive substring filter: empty query → nav commands only (the
 *  song list would be noise); non-empty → matching navs + matching songs.
 *  Archived songs are excluded — the palette must agree with the library. */
export function filterCommands(
  query: string,
  songs: ReadonlyArray<{ id: string; name: string; archivedAt?: string | null }>,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return NAV_COMMANDS;
  const navs = NAV_COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  const songHits: PaletteCommand[] = songs
    .filter((s) => s.archivedAt == null && s.name.toLowerCase().includes(q))
    .slice(0, 8)
    .map((s) => ({ id: `song-${s.id}`, label: s.name, kind: 'song' as const, to: s.id }));
  return [...navs, ...songHits];
}
