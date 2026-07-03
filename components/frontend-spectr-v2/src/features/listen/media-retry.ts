/* Story 3.3 (AC4) — transparent recovery from an expired signed URL.
 *
 * Playback rides a 302 → short-lived presigned GET (15 min). When the user
 * resumes after the URL expired, the media element errors; the fix is
 * re-requesting the SAME API URL (with a fresh ?t= where applicable) — the
 * BFF mints a fresh presign. Review-hardened state machine:
 *   - min-interval guard AND a consecutive-attempts cap (a genuinely dead
 *     resource terminates instead of hammering the BFF/S3 every 5 s forever);
 *   - success (loadedmetadata after a retry) resets the attempt counter;
 *   - exactly one pending loadedmetadata listener at a time, and dispose()
 *     removes it (a stale once-listener would seek + autoplay a FUTURE,
 *     unrelated source — e.g. after a token-rotation src swap);
 *   - getSrc may be async (listen-rack awaits a silent token refresh first —
 *     after >15 min idle BOTH the presign and the JWT are expired).
 * Pure factory (no React, injectable clock) — unit-tested. */

export interface RetryableMediaElement {
  currentTime: number;
  readonly paused: boolean;
  src: string;
  load(): void;
  play(): Promise<void> | void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

export function createMediaRetry(opts: {
  /** Rebuild the API media URL (may refresh auth first); null → give up. */
  getSrc: () => string | null | Promise<string | null>;
  /** Called when the error is NOT retried (guard/cap tripped, no src). */
  onGiveUp?: () => void;
  /** Called when the post-retry play() is rejected (autoplay policy). */
  onResumeBlocked?: () => void;
  minIntervalMs?: number;
  maxConsecutiveAttempts?: number;
  now?: () => number; // test seam
}) {
  const minInterval = opts.minIntervalMs ?? 5_000;
  const maxAttempts = opts.maxConsecutiveAttempts ?? 3;
  const now = opts.now ?? (() => Date.now());
  let lastRetryAt = Number.NEGATIVE_INFINITY;
  let attempts = 0;
  let pending: { el: RetryableMediaElement; cb: () => void } | null = null;

  const clearPending = () => {
    if (pending) {
      pending.el.removeEventListener('loadedmetadata', pending.cb);
      pending = null;
    }
  };

  return {
    /** Resolves true when a retry was started; false → caller surfaces the error. */
    async handleError(el: RetryableMediaElement): Promise<boolean> {
      if (attempts >= maxAttempts || now() - lastRetryAt < minInterval) {
        opts.onGiveUp?.();
        return false;
      }
      const src = await opts.getSrc();
      if (!src) {
        opts.onGiveUp?.();
        return false;
      }
      lastRetryAt = now();
      attempts += 1;

      const position = el.currentTime;
      const wasPlaying = !el.paused;
      clearPending(); // never two armed listeners — stale ones replay old state
      const cb = () => {
        pending = null;
        attempts = 0; // metadata came back — the retry worked
        el.currentTime = position;
        if (wasPlaying) {
          const p = el.play();
          if (p && typeof (p as Promise<void>).catch === 'function') {
            (p as Promise<void>).catch(() => opts.onResumeBlocked?.());
          }
        }
      };
      pending = { el, cb };
      el.addEventListener('loadedmetadata', cb, { once: true });
      el.src = src;
      el.load();
      return true;
    },

    /** Effect-cleanup hook: disarm any pending restore listener. */
    dispose() {
      clearPending();
    },
  };
}
