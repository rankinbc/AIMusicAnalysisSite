import { describe, expect, it } from 'vitest';
import { createFlashLimiter, MAX_FLASH_HZ } from './flashLimiter';

describe('createFlashLimiter', () => {
  it('expected use: allows at most maxHz flashes per second', () => {
    const limiter = createFlashLimiter(3);
    // Simulate 60fps for one second; count how many flashes are allowed.
    let allowed = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      if (limiter.allow(frame * (1000 / 60))) allowed += 1;
    }
    // 3 Hz over ~1s → 3 (the first frame at t=0 also counts as one).
    expect(allowed).toBeLessThanOrEqual(4);
    expect(allowed).toBeGreaterThanOrEqual(3);
  });

  it('safety: a caller cannot construct a limiter faster than MAX_FLASH_HZ', () => {
    const limiter = createFlashLimiter(60); // asks for 60 Hz
    let allowed = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      if (limiter.allow(frame * (1000 / 60))) allowed += 1;
    }
    // Clamped to MAX_FLASH_HZ regardless of the requested rate.
    expect(allowed).toBeLessThanOrEqual(MAX_FLASH_HZ + 1);
  });

  it('edge: back-to-back calls at the same timestamp only flash once', () => {
    const limiter = createFlashLimiter(3);
    expect(limiter.allow(1000)).toBe(true);
    expect(limiter.allow(1000)).toBe(false);
    expect(limiter.allow(1000)).toBe(false);
  });

  it('reset re-arms the limiter immediately', () => {
    const limiter = createFlashLimiter(3);
    expect(limiter.allow(1000)).toBe(true);
    expect(limiter.allow(1100)).toBe(false);
    limiter.reset();
    expect(limiter.allow(1100)).toBe(true);
  });
});
