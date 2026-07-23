/* SPECTR · Listen V3 — E6.11 transport sync: pure planning helpers.
 *
 * Host side: `planTransportEmit` decides whether a transport action posts
 * immediately (play/pause) or rides a trailing throttle (seek — scrubbing
 * must not flood the room channel). Listener side: `planTransportFollow`
 * turns the latest folded transport event into concrete audio actions
 * (play / pause / snap-seek on >2 s drift), skipping the host's own echo.
 * Pure functions — the page owns the timers and the <audio> element.
 */

/** Trailing window for seek emissions — scrub bursts collapse to the last value. */
export const SEEK_EMIT_THROTTLE_MS = 300;

/** Listeners snap to the host's expected position only past this drift. */
export const DRIFT_SNAP_SECONDS = 2;

export type TransportEmitKind = 'play' | 'pause' | 'seek';

export interface TransportEmitPlan {
  /** Post now (play/pause — state changes must not lag). */
  immediate: boolean;
  /** For deferred kinds: trailing delay before emitting the LATEST value. */
  delayMs: number;
}

export function planTransportEmit(kind: TransportEmitKind): TransportEmitPlan {
  return kind === 'seek'
    ? { immediate: false, delayMs: SEEK_EMIT_THROTTLE_MS }
    : { immediate: true, delayMs: 0 };
}

export interface TransportFollowAction {
  play?: boolean;
  pause?: boolean;
  seekTo?: number;
}

/**
 * Plan the follow-side reaction to a folded transport event.
 * expected = event.position + elapsed-while-playing; drift beyond
 * DRIFT_SNAP_SECONDS snaps. actorKey === meKey ⇒ self-echo, no action
 * (a null actorKey — the sync snapshot seed — always follows).
 */
export function planTransportFollow(
  local: { playing: boolean; position: number },
  event: { playing: boolean; position: number; at: number; actorKey: string | null },
  meKey: string | null,
  nowMs: number,
): TransportFollowAction {
  if (event.actorKey !== null && meKey !== null && event.actorKey === meKey) return {};
  const action: TransportFollowAction = {};
  const elapsed = event.playing ? Math.max(0, nowMs - event.at) / 1000 : 0;
  const expected = event.position + elapsed;
  if (Math.abs(local.position - expected) > DRIFT_SNAP_SECONDS) action.seekTo = expected;
  if (event.playing && !local.playing) action.play = true;
  if (!event.playing && local.playing) action.pause = true;
  return action;
}
