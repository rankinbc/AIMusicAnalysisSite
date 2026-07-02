/* SPECTR · Listen V3 — story 11.5: pure room-state reducer.
 *
 * Folds the SSE contract (first `sync` snapshot, then `SessionEvent` deltas)
 * into the state the page consumes: roster, reaction/chat feed, control
 * holders, transport. Pure functions — unit-tested with fixture events, no
 * live SSE (the stream plumbing lives in useRoomStream).
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
  transport: { playing: boolean; position: number } | null;
  statusByActor: Record<string, string>; // actorKey -> emoji
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

function actorKey(a: ActorRefDto): string {
  return `${a.type}:${a.userId ?? a.handle ?? a.displayName ?? ''}`;
}

function feedItem(
  id: string,
  emoji: string,
  actor: ActorRefDto,
  text: string,
  t: number,
  meKey: string | null,
): ReactionFeedItem {
  return {
    id,
    emoji,
    handle: actor.handle ?? actor.displayName ?? 'anon',
    text,
    t: Math.floor(t),
    you: meKey !== null && actorKey(actor) === meKey,
  };
}

export function applySnapshot(snapshot: RoomSnapshot, meKey: string | null): RoomLiveState {
  const s = initialRoomState();
  s.synced = true;
  s.lastSeq = snapshot.snapshotSeq;
  s.roster = snapshot.roster;
  s.transport = snapshot.transport;
  s.feed = snapshot.feed
    .slice()
    .sort((a, b) => b.seq - a.seq)
    .slice(0, FEED_CAP)
    .map((e) => feedItem(e.id, e.emoji, e.actor, e.text ?? '', e.t, meKey));
  return s;
}

export function applyEvent(
  state: RoomLiveState,
  e: SessionEvent,
  meKey: string | null,
): RoomLiveState {
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
      s.feed = [feedItem(e.id, e.emoji, e.actor, e.text ?? '', e.t, meKey), ...s.feed].slice(0, FEED_CAP);
      return s;
    }
    case 'chat': {
      // Chat rides the same rail feed (ReactionFeedItem.text carries the body).
      s.feed = [feedItem(e.id, '💬', e.actor, e.body, e.t, meKey), ...s.feed].slice(0, FEED_CAP);
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
      s.transport = { playing: e.playing, position: e.position };
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
