/* SPECTR · Listen V3 — story 11.5: pure room-state reducer.
 *
 * Folds the SSE contract (first `sync` snapshot, then `SessionEvent` deltas)
 * into the state the page consumes: roster, reaction/chat feed, control
 * holders, transport, ended flag. Pure functions — unit-tested with fixture
 * events, no live SSE (the stream plumbing lives in useRoomStream).
 */
import type { ActorRefDto, RoomSnapshot, SessionEvent } from '../../api/types';

import type { ActorRef } from './access';
import type { ReactionFeedItem } from './data';
import type { RoomControl } from './identity';

export const FEED_CAP = 14; // matches the page's local feed cap

export interface RoomLiveState {
  synced: boolean;
  lastSeq: number;
  roster: ActorRefDto[];
  feed: ReactionFeedItem[]; // newest first — reactions + chat share the rail feed
  roomControl: RoomControl;
  // `at` (unix ms) + actorKey ride along so the follow side can compute drift
  // and skip self-echoed host events (E6.11). Snapshot transport carries
  // neither → at = snapshot receipt time, actorKey = null.
  transport: { playing: boolean; position: number; at: number; actorKey: string | null } | null;
  statusByActor: Record<string, string>; // actorKey -> emoji
  // E6.10 — the room was ended (transient `ended` event, or a POST rejected
  // with `session_ended`). Latched: no later event un-ends a room.
  ended: boolean;
}

export function initialRoomState(): RoomLiveState {
  return {
    synced: false,
    lastSeq: 0,
    roster: [],
    feed: [],
    roomControl: { rackHolder: null, visualsHolder: null },
    transport: null,
    statusByActor: {},
    ended: false,
  };
}

// ActorRefDto (api, nullable fields) -> ActorRef (listen-rack, optional fields).
export function toActorRef(a: ActorRefDto): ActorRef {
  const ref: ActorRef = { type: a.type };
  if (a.userId != null) ref.userId = a.userId;
  if (a.handle != null) ref.handle = a.handle;
  if (a.displayName != null) ref.displayName = a.displayName;
  if (a.hue != null) ref.hue = a.hue;
  return ref;
}

/** Stable identity key — type-prefixed so user/anon never collide. Accepts both
 * the wire ActorRefDto (nullable fields) and the page ActorRef (optional
 * fields); exported so the People panel derives `you` without duplicating. */
export function actorKey(a: {
  type: 'user' | 'anon';
  userId?: string | null | undefined;
  handle?: string | null | undefined;
  displayName?: string | null | undefined;
}): string {
  return `${a.type}:${a.userId ?? a.handle ?? a.displayName ?? ''}`;
}

function feedItem(
  id: string,
  emoji: string,
  actor: ActorRefDto,
  text: string,
  t: number,
  meKey: string | null,
  kind: 'react' | 'chat',
): ReactionFeedItem {
  return {
    id,
    emoji,
    handle: actor.handle ?? actor.displayName ?? 'anon',
    text,
    t: Math.floor(t),
    you: meKey !== null && actorKey(actor) === meKey,
    kind,
  };
}

export function applySnapshot(
  snapshot: RoomSnapshot,
  meKey: string | null,
  nowMs: number = Date.now(),
): RoomLiveState {
  const s = initialRoomState();
  s.synced = true;
  s.lastSeq = snapshot.snapshotSeq;
  s.roster = snapshot.roster;
  // Snapshot transport carries no actor/at → seed with receipt time + null key
  // (a late joiner's first follow snaps off this).
  s.transport = snapshot.transport
    ? { playing: snapshot.transport.playing, position: snapshot.transport.position, at: nowMs, actorKey: null }
    : null;
  s.feed = snapshot.feed
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .slice(0, FEED_CAP)
    .map((e) => feedItem(e.id, e.emoji, e.actor, e.text ?? '', e.t, meKey, 'react'));
  return s;
}

export function applyEvent(
  state: RoomLiveState,
  e: SessionEvent,
  meKey: string | null,
): RoomLiveState {
  // `ended` is transient (no seq — published outside the WAL): fold BEFORE the
  // seq guard, regardless of ordering.
  if (e.type === 'ended') {
    return state.ended ? state : { ...state, ended: true };
  }
  // The relay guarantees deltas after snapshotSeq; drop stale/duplicate frames.
  if (e.seq <= state.lastSeq) return state;
  const s: RoomLiveState = { ...state, lastSeq: e.seq };

  switch (e.type) {
    case 'presence': {
      const key = actorKey(e.actor);
      const without = s.roster.filter((a) => actorKey(a) !== key);
      s.roster = e.state === 'join' ? [...without, e.actor] : without;
      return s;
    }
    case 'reaction': {
      s.feed = [feedItem(e.id, e.emoji, e.actor, e.text ?? '', e.t, meKey, 'react'), ...s.feed].slice(0, FEED_CAP);
      return s;
    }
    case 'chat': {
      // Chat rides the same rail feed (ReactionFeedItem.text carries the body).
      s.feed = [feedItem(e.id, '💬', e.actor, e.body, e.t, meKey, 'chat'), ...s.feed].slice(0, FEED_CAP);
      return s;
    }
    case 'status': {
      s.statusByActor = { ...s.statusByActor, [actorKey(e.actor)]: e.status };
      return s;
    }
    case 'grant': {
      const g = e.grant;
      const holder = g.revokedAt === null ? toActorRef(g.grantee) : null;
      s.roomControl =
        g.scope === 'rack'
          ? { ...s.roomControl, rackHolder: holder }
          : { ...s.roomControl, visualsHolder: holder };
      return s;
    }
    case 'transport': {
      s.transport = { playing: e.playing, position: e.position, at: e.at, actorKey: actorKey(e.actor) };
      return s;
    }
    // visuals/rack deltas mutate the shared performance surfaces; applying the
    // remote patches to the local engine is a follow-on (the state carries no
    // representation for them yet) — seq still advances so late frames stay ordered.
    case 'visuals':
    case 'rack':
      return s;
    default:
      return s;
  }
}
