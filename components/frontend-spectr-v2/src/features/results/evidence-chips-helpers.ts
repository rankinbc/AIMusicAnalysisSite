// Story 1.8 / Task 5 — helpers for EvidenceChips kept in a separate
// module so `EvidenceChips.tsx` only exports the React component
// (react-refresh/only-export-components lint).

const HIGHLIGHT_CLASS = 'sr-target-highlight';
const HIGHLIGHT_MS = 1400;

export function scrollAndHighlight(path: string): void {
  if (!path || typeof document === 'undefined') return;
  const el = document.getElementById(path);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => {
    el.classList.remove(HIGHLIGHT_CLASS);
  }, HIGHLIGHT_MS);
}
