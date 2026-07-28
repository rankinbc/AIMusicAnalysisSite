// Shared animation clock — ONE requestAnimationFrame loop for the whole rack.
// Subscribers get `t` seconds each frame and mutate DOM directly (refs /
// attributes), never React state. The loop starts with the first subscriber
// and stops with the last, so an idle page costs nothing.
type ClockCb = (t: number) => void;

const subs = new Set<ClockCb>();
let raf = 0;
let t0 = 0;

function loop(now: number) {
  const t = (now - t0) / 1000;
  subs.forEach((cb) => cb(t));
  raf = subs.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Subscribe to the shared clock. Returns the unsubscribe. */
export function subscribeClock(cb: ClockCb): () => void {
  if (subs.size === 0) {
    t0 = performance.now();
    raf = requestAnimationFrame(loop);
  }
  subs.add(cb);
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Deterministic per-id seed (0..1) so cards never move in unison. */
export function idSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
