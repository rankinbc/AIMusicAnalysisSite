/* Story 3.3 (AC4) — expired-presign media retry helper. */
import { describe, expect, it, vi } from 'vitest';

import { createMediaRetry, type RetryableMediaElement } from '../media-retry';

function fakeEl(over?: Partial<RetryableMediaElement>) {
  const listeners: Record<string, (() => void)[]> = {};
  const el = {
    currentTime: 42,
    paused: false,
    src: '/api/old',
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((type: string, cb: () => void) => {
      (listeners[type] ??= []).push(cb);
    }),
    fire(type: string) {
      for (const cb of listeners[type] ?? []) cb();
    },
    ...over,
  };
  return el as unknown as RetryableMediaElement & { fire(type: string): void; load: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> };
}

describe('createMediaRetry', () => {
  it('re-assigns a fresh src, reloads, and restores position + playback', () => {
    let t = 0;
    const retry = createMediaRetry({ getSrc: () => '/api/fresh?t=new', now: () => t });
    const el = fakeEl();

    expect(retry.handleError(el)).toBe(true);
    expect(el.src).toBe('/api/fresh?t=new');
    expect(el.load).toHaveBeenCalledOnce();

    el.currentTime = 0; // load reset
    el.fire('loadedmetadata');
    expect(el.currentTime).toBe(42);
    expect(el.play).toHaveBeenCalledOnce(); // was playing → resumes

    t = 10_000; // allow a later, unrelated retry
    expect(retry.handleError(el)).toBe(true);
  });

  it('does not resume playback when the element was paused', () => {
    const retry = createMediaRetry({ getSrc: () => '/api/fresh' });
    const el = fakeEl({ paused: true });
    retry.handleError(el);
    el.fire('loadedmetadata');
    expect(el.play).not.toHaveBeenCalled();
  });

  it('refuses rapid repeat retries (real failures surface, no loop)', () => {
    let t = 0;
    const onGiveUp = vi.fn();
    const retry = createMediaRetry({ getSrc: () => '/api/fresh', now: () => t, onGiveUp });
    const el = fakeEl();

    expect(retry.handleError(el)).toBe(true);
    t = 1_000; // < 5 s later — the retried URL failed too
    expect(retry.handleError(el)).toBe(false);
    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(el.load).toHaveBeenCalledOnce(); // no second reload
  });

  it('gives up when no src can be built (logged out)', () => {
    const onGiveUp = vi.fn();
    const retry = createMediaRetry({ getSrc: () => null, onGiveUp });
    const el = fakeEl();
    expect(retry.handleError(el)).toBe(false);
    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(el.load).not.toHaveBeenCalled();
  });
});
