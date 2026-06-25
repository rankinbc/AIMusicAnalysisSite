import { describe, it, expect } from 'vitest';

import type { ActorRef } from './access';
import {
  sameActor, sessionHats, roleLabels, MOCK_IDENTITY, MOCK_ROOM_CONTROL,
  type Identity, type RoomControl,
} from './identity';

const me: ActorRef = { type: 'user', userId: 'me', handle: 'maek' };
const vela: ActorRef = { type: 'user', userId: 'u2', handle: 'vela' };
const anonRiver: ActorRef = { type: 'anon', displayName: 'anon-river' };

function ident(over: Partial<Identity> = {}): Identity {
  return { actor: me, isOwner: true, baseRole: 'owner', isHost: false, ...over };
}
const noGrants: RoomControl = { rackHolder: null, visualsHolder: null };

describe('sameActor', () => {
  it('matches users by userId', () => {
    expect(sameActor(me, { type: 'user', userId: 'me', handle: 'different' })).toBe(true);
    expect(sameActor(me, vela)).toBe(false);
  });
  it('matches anon by displayName and never crosses user/anon', () => {
    expect(sameActor(anonRiver, { type: 'anon', displayName: 'anon-river' })).toBe(true);
    expect(sameActor(me, { type: 'anon', displayName: 'maek' })).toBe(false);
  });
  it('is false when either side is null', () => {
    expect(sameActor(me, null)).toBe(false);
    expect(sameActor(null, null)).toBe(false);
  });
});

describe('sessionHats / roleLabels', () => {
  it('host wears a single host hat even though it controls both scopes', () => {
    expect(sessionHats(ident({ isHost: true }), noGrants)).toEqual(['host']);
    expect(roleLabels(ident({ isHost: true }), noGrants)).toEqual(['HOST']);
  });
  it('a non-host holding both grants is DJ and VJ', () => {
    const control: RoomControl = { rackHolder: me, visualsHolder: me };
    expect(sessionHats(ident({ isHost: false }), control)).toEqual(['dj', 'vj']);
    expect(roleLabels(ident({ isHost: false }), control)).toEqual(['DJ', 'VJ']);
  });
  it('holding only rack is DJ', () => {
    expect(sessionHats(ident({ isHost: false }), { rackHolder: me, visualsHolder: vela }))
      .toEqual(['dj']);
  });
  it('holding nothing is a listener', () => {
    expect(roleLabels(ident({ isHost: false }), { rackHolder: vela, visualsHolder: vela }))
      .toEqual(['LISTENER']);
  });
});

describe('mock fixtures', () => {
  it('MOCK_IDENTITY owns + hosts the demo room; MOCK_ROOM_CONTROL has no delegates', () => {
    expect(MOCK_IDENTITY.isOwner).toBe(true);
    expect(MOCK_IDENTITY.isHost).toBe(true);
    expect(MOCK_ROOM_CONTROL).toEqual({ rackHolder: null, visualsHolder: null });
  });
});
