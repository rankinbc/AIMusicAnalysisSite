/* Story 3.3 (AC4) — transparent recovery from an expired signed URL.
 *
 * Playback now rides a 302 → short-lived presigned GET (15 min). When the
 * user resumes after the URL expired, the media element errors; the fix is
 * simply re-requesting the SAME API URL (with a fresh ?t= where applicable) —
 * the BFF mints a fresh presign. This helper does that once per error with a
 * minimum interval guard so a genuine 404/permission failure can't loop.
 * Pure factory (no React, injectable clock) — unit-tested. */

export interface RetryableMediaElement {
  currentTime: number;
  readonly paused: boolean;
  src: string;
  load(): void;
  play(): Promise<void> | void;
  addEventListener(
    type: string,
    listener: () => void,
    options?: { once?: boolean },
  ): void;
}

export function createMediaRetry(opts: {
  /** Rebuild the API media URL (fresh access token where applicable). */
  getSrc: () => string | null;
  /** Called when the error is NOT retried (guard tripped / no src). */
  onGiveUp?: () => void;
  minIntervalMs?: number;
  now?: () => number; // test seam
}) {
  const minInterval = opts.minIntervalMs ?? 5_000;
  const now = opts.now ?? (() => Date.now());
  let lastRetryAt = Number.NEGATIVE_INFINITY;

  return {
    /** Returns true when a retry was started; false → caller surfaces the error. */
    handleError(el: RetryableMediaElement): boolean {
      if (now() - lastRetryAt < minInterval) {
        opts.onGiveUp?.();
        return false;
      }
      const src = opts.getSrc();
      if (!src) {
        opts.onGiveUp?.();
        return false;
      }
      lastRetryAt = now();

      const position = el.currentTime;
      const wasPlaying = !el.paused;
      el.addEventListener(
        'loadedmetadata',
        () => {
          el.currentTime = position;
          if (wasPlaying) {
            const p = el.play();
            if (p && typeof (p as Promise<void>).catch === 'function') {
              (p as Promise<void>).catch(() => undefined);
            }
          }
        },
        { once: true },
      );
      el.src = src;
      el.load();
      return true;
    },
  };
}
