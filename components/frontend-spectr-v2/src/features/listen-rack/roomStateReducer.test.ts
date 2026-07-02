/* Story 11.5 — pure reducer coverage: snapshot-then-delta, seq dedupe,
 * presence roster, grant/revoke → roomControl, feed cap. Fixture SessionEvents
 * only — no live SSE (useRoomStream owns the wire; parseRoomFrame has its own
 * tests). */
import { describe, expect, it } from 'vitest';

import type { ActorRefDto, ControlGrantDto, RoomSnapshot, SessionEvent } from '../../api/types';

import {
  FEED_CAP,
  applyEvent,
  applySnapshot,
  initialRoomState,
  toActorRef,
} from './roomStateReducer';

const vela: ActorRefDto = { type: 'user', userId: 'u-vela', handle: 'vela', displayName: 'Vela', hue: 220 };
const forge: ActorRefDto = { type: 'user', userId: 'u-forge', handle: 'forge', displayName: 'Forge', hue: 18 };
const anon: ActorRefDto = { type: 'anon', userId: null, handle: null, displayName: 'anon-river', hue: 195 };

const ME_KEY = 'user:u-vela';

function snap(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return { chain: null, transport: null, visuals: null, roster: [], feed: [], snapshotSeq: 10, ...over };
}

function grant(seq: number, scope: 'rack' | 'visuals', grantee: ActorRefDto, revoked = false): SessionEvent {
  const g: ControlGrantDto = {
    id: `g${seq}`, sessionId: 's1', scope, grantee, grantedBy: vela,
    revokedAt: revoked ? '2026-07-02T00:00:00Z' : null,
  };
  return { seq, at: seq * 1000, type: 'grant', grant: g };
}

describe('applySnapshot (AC1 — sync frame hydrates)', () => {
  it('hydrates roster/transport/feed and marks synced at snapshotSeq', () => {
    const s = applySnapshot(snap({
      roster: [vela, forge],
      transport: { playing: true, position: 42 },
      feed: [
        { seq: 3, at: 3000, type: 'reaction', id: 'r3', actor: forge, emoji: '🔥', t: 61.9 },
        { seq: 7, at: 7000, type: 'reaction', id: 'r7', actor: vela, emoji: '💜', t: 90.2, text: 'that drop' },
      ],
    }), ME_KEY);

    expect(s.synced).toBe(true);
    expect(s.lastSeq).toBe(10);
    expect(s.roster).toHaveLength(2);
    expect(s.transport).toEqual({ playing: true, position: 42 });
    // Newest first, floored t, `you` derived from meKey.
    expect(s.feed.map((f) => f.id)).toEqual(['r7', 'r3']);
    expect(s.feed[0]).toMatchObject({ emoji: '💜', handle: 'vela', text: 'that drop', t: 90, you: true });
    expect(s.feed[1]).toMatchObject({ emoji: '🔥', handle: 'forge', t: 61, you: false });
  });
});

describe('applyEvent (AC1 — deltas after snapshot)', () => {
  it('drops frames at or below the snapshot seq (relay resume contract)', () => {
    const s0 = applySnapshot(snap({ snapshotSeq: 10 }), ME_KEY);
    const stale: SessionEvent = { seq: 10, at: 0, type: 'reaction', id: 'rX', actor: forge, emoji: '🔥', t: 1 };
    expect(applyEvent(s0, stale, ME_KEY)).toBe(s0); // identity — untouched
  });

  it('folds presence join/leave into the roster (keyed, no dupes)', () => {
    let s = applySnapshot(snap(), ME_KEY);
    s = applyEvent(s, { seq: 11, at: 0, type: 'presence', actor: forge, state: 'join' }, ME_KEY);
    s = applyEvent(s, { seq: 12, at: 0, type: 'presence', actor: forge, state: 'join' }, ME_KEY);
    expect(s.roster).toHaveLength(1);
    s = applyEvent(s, { seq: 13, at: 0, type: 'presence', actor: forge, state: 'leave' }, ME_KEY);
    expect(s.roster).toHaveLength(0);
  });

  it('chat rides the feed with the body as text', () => {
    let s = applySnapshot(snap(), ME_KEY);
    s = applyEvent(s, { seq: 11, at: 0, type: 'chat', id: 'c1', actor: anon, body: 'loud for streaming', t: 12.7 }, ME_KEY);
    expect(s.feed[0]).toMatchObject({ handle: 'anon-river', text: 'loud for streaming', t: 12 });
  });

  it('caps the feed at FEED_CAP newest-first', () => {
    let s = applySnapshot(snap(), ME_KEY);
    for (let i = 1; i <= FEED_CAP + 5; i++) {
      s = applyEvent(s, { seq: 10 + i, at: 0, type: 'reaction', id: `r${i}`, actor: forge, emoji: '🔥', t: i }, ME_KEY);
    }
    expect(s.feed).toHaveLength(FEED_CAP);
    expect(s.feed[0]!.id).toBe(`r${FEED_CAP + 5}`);
  });

  it('tracks per-actor status', () => {
    let s = applySnapshot(snap(), ME_KEY);
    s = applyEvent(s, { seq: 11, at: 0, type: 'status', actor: forge, status: '🕺' }, ME_KEY);
    expect(s.statusByActor['user:u-forge']).toBe('🕺');
  });

  it('applies transport deltas', () => {
    let s = applySnapshot(snap(), ME_KEY);
    s = applyEvent(s, { seq: 11, at: 0, type: 'transport', actor: vela, playing: true, position: 128 }, ME_KEY);
    expect(s.transport).toEqual({ playing: true, position: 128 });
  });
});

describe('grant/revoke → roomControl (AC3 — capabilities recompute live)', () => {
  it('grant sets the scope holder; revoke clears it', () => {
    let s = applySnapshot(snap(), ME_KEY);
    s = applyEvent(s, grant(11, 'rack', forge), ME_KEY);
    expect(s.roomControl.rackHolder).toMatchObject({ type: 'user', userId: 'u-forge', handle: 'forge' });
    expect(s.roomControl.visualsHolder).toBeNull();

    s = applyEvent(s, grant(12, 'visuals', anon), ME_KEY);
    expect(s.roomControl.visualsHolder).toMatchObject({ type: 'anon', displayName: 'anon-river' });

    s = applyEvent(s, grant(13, 'rack', forge, /* revoked */ true), ME_KEY);
    expect(s.roomControl.rackHolder).toBeNull();
    expect(s.roomControl.visualsHolder).not.toBeNull(); // other scope untouched
  });
});

describe('toActorRef', () => {
  it('drops nulls so the listen-rack ActorRef keeps optional semantics', () => {
    expect(toActorRef(anon)).toEqual({ type: 'anon', displayName: 'anon-river', hue: 195 });
    expect(toActorRef(vela)).toEqual({ type: 'user', userId: 'u-vela', handle: 'vela', displayName: 'Vela', hue: 220 });
  });
});

describe('initialRoomState', () => {
  it('starts unsynced with empty control', () => {
    const s = initialRoomState();
    expect(s.synced).toBe(false);
    expect(s.roomControl).toEqual({ rackHolder: null, visualsHolder: null });
  });
});
