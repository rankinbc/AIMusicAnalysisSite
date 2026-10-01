import { useEffect, useState } from 'react';

// Task P8 — phone fixes: gate desktop-only visuals (LightShow) off phones.
// Same shape as useReducedMotion, keyed on `(min-width: ${px}px)` instead of
// the reduced-motion query. Fallback/initial `true` when matchMedia is
// unavailable (SSR / old browsers / bare node tests) — that preserves
// today's "always render" behaviour rather than silently hiding content.

export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
