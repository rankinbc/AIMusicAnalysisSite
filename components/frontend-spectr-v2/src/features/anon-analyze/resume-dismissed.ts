/* Story 6.4 — remembers which resume cards a visitor dismissed. Anon has no
 * account, so this is client-only localStorage. Non-sensitive UI state (the
 * auth-out-of-localStorage rule is about SECRETS). SSR/no-window safe so the
 * static-render tests and any non-browser render don't throw. */
const KEY = 'spectr.resumeDismissed';

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isResumeDismissed(jobId: string): boolean {
  return read().includes(jobId);
}

export function dismissResume(jobId: string): void {
  if (typeof window === 'undefined') return;
  // Re-insert at the END so the cap below is true LRU — a re-dismissed id must
  // not keep its old position and get evicted while newer ones survive (review).
  const ids = read().filter((id) => id !== jobId);
  ids.push(jobId);
  try {
    // Cap the list so it can't grow unbounded across many devices/jobs.
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    /* storage full / disabled — dismissal just won't persist */
  }
}
