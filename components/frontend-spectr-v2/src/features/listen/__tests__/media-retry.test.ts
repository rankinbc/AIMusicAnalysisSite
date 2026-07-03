/* Story 3.3 (AC4) — expired-presign media retry helper (review-hardened). */
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
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((x) => x !== cb);
    }),
    fire(type: string) {
      const cbs = [...(listeners[type] ?? [])];
      listeners[type] = []; // once semantics for the test double
      for (const cb of cbs) cb();
    },
    pendingCount(type: string) {
      return (listeners[type] ?? []).length;
    },
    ...over,
  };
  return el as unknown as RetryableMediaElement & {
    fire(type: string): void;
    pendingCount(type: string): number;
    load: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
  };
}

describe('createMediaRetry', () => {
  it('re-assigns a fresh src, reloads, and restores position + playback', async () => {
    let t = 0;
    const retry = createMediaRetry({ getSrc: () => '/api/fresh?t=new', now: () => t });
    const el = fakeEl();

    await expect(retry.handleError(el)).resolves.toBe(true);
    expect(el.src).toBe('/api/fresh?t=new');
    expect(el.load).toHaveBeenCalledOnce();

    el.currentTime = 0; // load reset
    el.fire('loadedmetadata');
    expect(el.currentTime).toBe(42);
    expect(el.play).toHaveBeenCalledOnce(); // was playing → resumes
  });

  it('supports an async getSrc (token refresh before rebuilding the URL)', async () => {
    const retry = createMediaRetry({ getSrc: async () => '/api/fresh?t=refreshed' });
    const el = fakeEl();
    await expect(retry.handleError(el)).resolves.toBe(true);
    expect(el.src).toBe('/api/fresh?t=refreshed');
  });

  it('does not resume playback when the element was paused', async () => {
    const retry = createMediaRetry({ getSrc: () => '/api/fresh' });
    const el = fakeEl({ paused: true });
    await retry.handleError(el);
    el.fire('loadedmetadata');
    expect(el.play).not.toHaveBeenCalled();
  });

  it('refuses rapid repeats AND terminates after the consecutive-attempt cap', async () => {
    let t = 0;
    const onGiveUp = vi.fn();
    const retry = createMediaRetry({ getSrc: () => '/api/fresh', now: () => t, onGiveUp });
    const el = fakeEl();

    await expect(retry.handleError(el)).resolves.toBe(true);
    t = 1_000; // < 5 s later — guard
    await expect(retry.handleError(el)).resolves.toBe(false);
    expect(onGiveUp).toHaveBeenCalledOnce();

    // Never a metadata success → attempts accumulate → hard stop at 3.
    t = 10_000;
    await expect(retry.handleError(el)).resolves.toBe(true);
    t = 20_000;
    await expect(retry.handleError(el)).resolves.toBe(true);
    t = 30_000;
    await expect(retry.handleError(el)).resolves.toBe(false); // cap: dead resource terminates
    expect(el.load).toHaveBeenCalledTimes(3);
  });

  it('a successful retry resets the attempt counter', async () => {
    let t = 0;
    const retry = createMediaRetry({ getSrc: () => '/api/fresh', now: () => t });
    const el = fakeEl();
    for (const at of [0, 10_000, 20_000]) {
      t = at;
      await retry.handleError(el);
      el.fire('loadedmetadata'); // success each time — counter resets
    }
    t = 30_000;
    await expect(retry.handleError(el)).resolves.toBe(true); // no cap hit
  });

  it('keeps at most ONE pending restore listener and dispose() disarms it', async () => {
    let t = 0;
    const retry = createMediaRetry({ getSrc: () => '/api/fresh', now: () => t });
    const el = fakeEl();

    await retry.handleError(el);
    t = 10_000;
    await retry.handleError(el); // second retry replaces the first listener
    expect(el.pendingCount('loadedmetadata')).toBe(1);

    retry.dispose(); // effect cleanup — a stale listener must never replay
    expect(el.pendingCount('loadedmetadata')).toBe(0);
    el.fire('loadedmetadata');
    expect(el.play).not.toHaveBeenCalled();
  });

  it('reports a blocked resume (autoplay policy) instead of failing silently', async () => {
    const onResumeBlocked = vi.fn();
    const retry = createMediaRetry({
      getSrc: () => '/api/fresh',
      onResumeBlocked,
    });
    const el = fakeEl({ play: vi.fn(() => Promise.reject(new Error('gesture'))) });
    await retry.handleError(el);
    el.fire('loadedmetadata');
    await Promise.resolve(); // let the rejection propagate
    expect(onResumeBlocked).toHaveBeenCalledOnce();
  });

  it('gives up when no src can be built (logged out)', async () => {
    const onGiveUp = vi.fn();
    const retry = createMediaRetry({ getSrc: () => null, onGiveUp });
    const el = fakeEl();
    await expect(retry.handleError(el)).resolves.toBe(false);
    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(el.load).not.toHaveBeenCalled();
  });
});
