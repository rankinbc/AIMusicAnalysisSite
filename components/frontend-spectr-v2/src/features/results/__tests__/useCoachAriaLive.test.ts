// @vitest-environment jsdom
// adhoc-coachchat-split (2026-09-19) — the throttled aria-live mirror
// extracted from CoachChat.tsx into its own hook. Pins three behaviours:
//   (a) the CURRENT first-chunk-flushes-immediately behaviour (the last
//       flush timestamp starts at 0, so the very first delta is always
//       "since >= throttle" and flushes synchronously — read the code
//       before assuming a throttle delay applies to the first chunk)
//   (b) several deltas inside one throttle window coalesce into ONE flush
//       containing only the NEW text (P9 — delta, not cumulative)
//   (c) unmounting clears the pending timer so no flush (and therefore no
//       state update) fires after unmount
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ARIA_LIVE_THROTTLE_MS, useCoachAriaLive } from '../useCoachAriaLive';

describe('useCoachAriaLive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes the first chunk immediately (current behaviour: lastFlush starts at 0)', () => {
    const { result } = renderHook(() => useCoachAriaLive());

    act(() => {
      result.current.scheduleAriaLive('Kick and bass ');
    });

    // No advanceTimersByTime needed — the first call flushes synchronously
    // because `Date.now() - 0` is always >= ARIA_LIVE_THROTTLE_MS.
    expect(result.current.ariaLiveText).toBe('Kick and bass ');
  });

  it('coalesces several chunks in one throttle window into ONE flush with only the delta', () => {
    const { result } = renderHook(() => useCoachAriaLive());

    act(() => {
      result.current.scheduleAriaLive('first ');
    });
    expect(result.current.ariaLiveText).toBe('first ');

    // Both land inside the same throttle window opened by the flush above.
    act(() => {
      result.current.scheduleAriaLive('second ');
      result.current.scheduleAriaLive('third');
    });
    // Still the old text — the scheduled flush hasn't fired yet.
    expect(result.current.ariaLiveText).toBe('first ');

    act(() => {
      vi.advanceTimersByTime(ARIA_LIVE_THROTTLE_MS);
    });

    // Delta only: "second third", NOT "first second third".
    expect(result.current.ariaLiveText).toBe('second third');
  });

  it('clears the pending timer on unmount (no state update fires after unmount)', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { result, unmount } = renderHook(() => useCoachAriaLive());

    act(() => {
      result.current.scheduleAriaLive('first'); // flushes immediately, no timer
    });
    act(() => {
      result.current.scheduleAriaLive('second'); // inside the window — schedules a timer
    });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const timerId = setTimeoutSpy.mock.results[0]?.value;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
    // Advancing time past the (now-cleared) window must not throw or
    // resurrect a flush on the unmounted hook.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(ARIA_LIVE_THROTTLE_MS + 10);
      });
    }).not.toThrow();
  });
});
