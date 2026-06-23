// Story 1.8 / Task 5 — helpers for EvidenceChips kept in a separate
// module so `EvidenceChips.tsx` only exports the React component
// (react-refresh/only-export-components lint).

const HIGHLIGHT_CLASS = 'sr-target-highlight';
const HIGHLIGHT_MS = 1400;

// Per-target timer handles so a rapid second click on the same chip cancels
// the first scheduled class removal instead of letting it strip the highlight
// mid-animation (story 1.8 deferred follow-up).
const highlightTimers = new Map<string, number>();

export function scrollAndHighlight(path: string): void {
  if (!path || typeof document === 'undefined') return;
  const el = document.getElementById(path);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add(HIGHLIGHT_CLASS);

  const existing = highlightTimers.get(path);
  if (existing !== undefined) window.clearTimeout(existing);

  const handle = window.setTimeout(() => {
    el.classList.remove(HIGHLIGHT_CLASS);
    highlightTimers.delete(path);
  }, HIGHLIGHT_MS);
  highlightTimers.set(path, handle);
}
