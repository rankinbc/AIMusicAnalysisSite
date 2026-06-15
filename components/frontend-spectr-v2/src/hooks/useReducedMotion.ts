import { useEffect, useState } from 'react';

// Story 1.8 / Task 8 / closes story 1.7 deferred D1 — track
// `prefers-reduced-motion: reduce` so JS-driven motion (rAF loops, canvas
// visualisers) can opt out of animation, matching the CSS-side blanket
// freeze story 1.7 added in global.css. Consumers: TranceBot (story 1.8),
// future PreviewTools oscilloscope + Listen page spectrum rAF (deferred).
//
// SSR-safe: initial value reads `false` when `window` is undefined so the
// hook does not crash in a Node test environment.

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduce;
}
