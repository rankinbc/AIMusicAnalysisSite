// Story 5.10 (UX-DR43) — global product shortcuts. Pure decision logic so the
// AppLayout listener stays a two-liner and the matrix is unit-testable
// without mounting the shell.

export type ShortcutAction = 'palette' | 'upload' | 'sheet';

/** Minimal structural type so tests can pass plain objects. */
export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  target: EventTarget | null;
}

/** True when the event originates inside an editable control — shortcuts
 *  must never fire while the user is typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'),
  );
}

/** Maps a keydown to a shortcut action, or null. ⌘/Ctrl are interchangeable
 *  (mac/win). `?` is plain (shift+/ produces key === '?'), no modifier. */
export function matchShortcut(e: ShortcutKeyEvent): ShortcutAction | null {
  if (e.repeat || e.isComposing || e.altKey) return null;
  if (isEditableTarget(e.target)) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'k') return 'palette';
  if (mod && key === 'u') return 'upload';
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
  { id: 'nav-feed', label: 'Feed', kind: 'nav', to: '/feed' },
  { id: 'nav-usage', label: 'Usage', kind: 'nav', to: '/usage' },
  { id: 'nav-billing', label: 'Billing', kind: 'nav', to: '/billing' },
  { id: 'nav-profile', label: 'Profile', kind: 'nav', to: '/profile' },
];

/** Case-insensitive substring filter: empty query → nav commands only (the
 *  song list would be noise); non-empty → matching navs + matching songs. */
export function filterCommands(
  query: string,
  songs: ReadonlyArray<{ id: string; name: string }>,
): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return NAV_COMMANDS;
  const navs = NAV_COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  const songHits: PaletteCommand[] = songs
    .filter((s) => s.name.toLowerCase().includes(q))
    .slice(0, 8)
    .map((s) => ({ id: `song-${s.id}`, label: s.name, kind: 'song' as const, to: s.id }));
  return [...navs, ...songHits];
}
