// Photosensitivity safety: the single shared chokepoint that every visual
// FLASH must route through. Hard-clamps the flash rate to a maximum frequency
// (default 3 Hz) regardless of what any control, slider, or future feature
// requests. Strobe, beat flashes, drop bursts — all of them ask this limiter
// "may I flash now?" and it says no until enough time has elapsed.
//
// The 3 Hz ceiling keeps us well clear of the 3–30 Hz photosensitive-seizure
// band. The UI may flash LESS often, never more. This module owns the rule so
// no caller can route around it.

export const MAX_FLASH_HZ = 3;

export interface FlashLimiter {
  /**
   * Returns true at most `maxHz` times per second. Pass a monotonic timestamp
   * (performance.now()). When it returns true the caller may render one flash;
   * when false the flash must be suppressed.
   */
  allow: (nowMs: number) => boolean;
  reset: () => void;
}

export function createFlashLimiter(maxHz: number = MAX_FLASH_HZ): FlashLimiter {
  // Clamp the ceiling itself so a caller can't construct a limiter that
  // permits an unsafe rate.
  const safeHz = Math.min(MAX_FLASH_HZ, Math.max(0.1, maxHz));
  const minIntervalMs = 1000 / safeHz;
  let lastFlashMs = -Infinity;

  return {
    allow(nowMs) {
      if (nowMs - lastFlashMs >= minIntervalMs) {
        lastFlashMs = nowMs;
        return true;
      }
      return false;
    },
    reset() {
      lastFlashMs = -Infinity;
    },
  };
}
