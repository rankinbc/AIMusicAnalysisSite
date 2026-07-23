/* E6.11 — transport sync planning: emit throttle matrix + follow matrix
 * (drift under/over the snap threshold, paused host, self-echo skip,
 * snapshot seed with a null actorKey). Pure fixtures, no timers. */
import { describe, expect, it } from 'vitest';

import {
  DRIFT_SNAP_SECONDS,
  SEEK_EMIT_THROTTLE_MS,
  planTransportEmit,
  planTransportFollow,
} from './transportSync';

const ME = 'user:u-host';

describe('planTransportEmit', () => {
  it('emits play/pause immediately', () => {
    expect(planTransportEmit('play')).toEqual({ immediate: true, delayMs: 0 });
    expect(planTransportEmit('pause')).toEqual({ immediate: true, delayMs: 0 });
  });

  it('defers seek behind the trailing throttle window', () => {
    expect(planTransportEmit('seek')).toEqual({ immediate: false, delayMs: SEEK_EMIT_THROTTLE_MS });
  });
});

describe('planTransportFollow', () => {
  it("does nothing on the host's own echo (actorKey === meKey)", () => {
    const action = planTransportFollow(
      { playing: false, position: 0 },
      { playing: true, position: 100, at: 0, actorKey: ME },
      ME,
      0,
    );
    expect(action).toEqual({});
  });

  it('follows a snapshot seed (null actorKey) even for the join-mid-play case', () => {
    // Guest joins 4 s after the snapshot transport was stamped playing at 60 s.
    const action = planTransportFollow(
      { playing: false, position: 0 },
      { playing: true, position: 60, at: 10_000, actorKey: null },
      'user:u-guest',
      14_000,
    );
    expect(action.play).toBe(true);
    expect(action.seekTo).toBeCloseTo(64);
  });

  it('does not seek under the drift threshold', () => {
    const action = planTransportFollow(
      { playing: true, position: 101 },
      { playing: true, position: 100, at: 5_000, actorKey: 'user:u-h' },
      'user:u-guest',
      5_000, // no elapsed — expected = 100, drift = 1 s < 2 s
    );
    expect(action).toEqual({});
  });

  it('snaps past the drift threshold, accounting for elapsed play time', () => {
    const action = planTransportFollow(
      { playing: true, position: 100 },
      { playing: true, position: 100, at: 0, actorKey: 'user:u-h' },
      'user:u-guest',
      (DRIFT_SNAP_SECONDS + 1) * 1000, // host has advanced 3 s past us
    );
    expect(action.seekTo).toBeCloseTo(100 + DRIFT_SNAP_SECONDS + 1);
    expect(action.play).toBeUndefined(); // both already playing
  });

  it('pauses when the host paused — with no elapsed extrapolation', () => {
    const action = planTransportFollow(
      { playing: true, position: 130 },
      { playing: false, position: 120, at: 0, actorKey: 'user:u-h' },
      'user:u-guest',
      60_000, // a paused event never advances with wall time
    );
    expect(action.pause).toBe(true);
    expect(action.seekTo).toBe(120);
  });

  it('plays when the host plays and we are paused in sync (no seek)', () => {
    const action = planTransportFollow(
      { playing: false, position: 45 },
      { playing: true, position: 45, at: 1_000, actorKey: 'user:u-h' },
      'user:u-guest',
      1_500,
    );
    expect(action).toEqual({ play: true });
  });
});
