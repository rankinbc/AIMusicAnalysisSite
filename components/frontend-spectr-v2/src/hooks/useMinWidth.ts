import { useEffect, useState } from 'react';

// Task P8 — gate desktop-only work (the Listen page's LightShow canvas) off
// phones. Same shape as useReducedMotion, keyed on `(min-width: ${px}px)`.
// Initial/fallback value is `true` when matchMedia is unavailable (old
// browsers, node tests) so today's "always render" behaviour is kept there.

export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
