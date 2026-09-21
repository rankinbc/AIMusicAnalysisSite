/* A deploy while a tab is open turns the next lazy navigation into a failed
 * dynamic import. One guarded reload fixes it; an unguarded one is a loop. */
const KEY = 'spectr:chunk-reload-at';
const WINDOW_MS = 5 * 60_000;
export const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;
type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface ReloadDeps { now?: number; storage?: GuardStorage | null; reload?: () => void }
function sessionStore(): GuardStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}
export function isStaleChunkError(err: unknown): boolean {
  return err instanceof Error && STALE_CHUNK_RE.test(err.message);
}
export function reloadOnceForStaleChunk(deps: ReloadDeps = {}): boolean {
  const storage = deps.storage === undefined ? sessionStore() : deps.storage;
  if (!storage) return false;
  const now = deps.now ?? Date.now();
  try {
    const last = Number(storage.getItem(KEY) ?? 0);
    if (last > 0 && now - last < WINDOW_MS) return false;
    storage.setItem(KEY, String(now));
  } catch { return false; }
  (deps.reload ?? (() => window.location.reload()))();
  return true;
}
export function installChunkReloadListener(opts: {
  target?: EventTarget; storage?: GuardStorage | null; reload?: () => void; now?: () => number;
} = {}): () => void {
  const target = opts.target ?? window;
  const onError = (e: Event) => {
    const deps: ReloadDeps = { now: (opts.now ?? Date.now)() };
    if (opts.storage !== undefined) deps.storage = opts.storage;
    if (opts.reload) deps.reload = opts.reload;
    if (reloadOnceForStaleChunk(deps)) e.preventDefault();
  };
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}
