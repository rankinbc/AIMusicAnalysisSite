import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has scrolled (mostly) into view — and then stays true,
 * so a landing section animates in once rather than every time it re-enters.
 * Without IntersectionObserver (old browsers, jsdom) it reveals immediately:
 * the hidden pre-reveal state must never strand content.
 */
export function useRevealOnScroll<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, revealed };
}
