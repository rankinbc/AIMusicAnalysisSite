import { useEffect, useRef } from 'react';

/**
 * Run `fn` exactly once per mounted component instance.
 *
 * React StrictMode (dev) double-invokes effects on the SAME fiber — a plain
 * `useEffect(fn, [])` therefore fires twice in dev. Refs survive the simulated
 * remount, so the guard makes the call truly one-shot (wave-3: the invite
 * accept route's mutate must not double-fire).
 */
export function useOneShotEffect(fn: () => void): void {
  const firedRef = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fnRef.current();
  }, []);
}
