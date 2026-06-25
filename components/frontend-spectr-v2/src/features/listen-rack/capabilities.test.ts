import { describe, it, expect } from 'vitest';

import type { AccessDto, ActorRef, ModeId } from './access';
import { resolveCapabilities } from './capabilities';
import type { Identity, RoomControl } from './identity';

const me: ActorRef = { type: 'user', userId: 'me', handle: 'maek' };
const guest: ActorRef = { type: 'user', userId: 'g', handle: 'vela' };

function access(over: Partial<AccessDto> = {}): AccessDto {
  return {
    role: 'owner', canWork: true, canView: true, roomHostable: true, roomJoinable: false,
    coachAvailable: true, gates: { canComment: true, canSuggest: true, canBookmark: true },
    ...over,
  };
}
function ident(over: Partial<Identity> = {}): Identity {
  return { actor: me, isOwner: true, baseRole: 'owner', isHost: false, ...over };
}
const noGrants: RoomControl = { rackHolder: null, visualsHolder: null };
const cap = (m: ModeId, id: Identity, c: RoomControl, a: AccessDto) => resolveCapabilities(m, id, c, a);

describe('work mode', () => {
  it('owner edits the rack, gets the coach, drives their own transport', () => {
    const c = cap('work', ident(), noGrants, access());
    expect(c.canEditRack).toBe(true);
    expect(c.rackReadOnly).toBe(false);
    expect(c.canControlTransport).toBe(true);
    expect(c.canUseCoach).toBe(true);
    expect(c.canReact).toBe(false);
    expect(c.canGrantControl).toBe(false);
  });
  it('coach is gated by coachAvailable (X.1)', () => {
    expect(cap('work', ident(), noGrants, access({ coachAvailable: false })).canUseCoach).toBe(false);
  });
  it('a non-owner in work mode is read-only and cannot edit (defensive — unreachable via availableModes)', () => {
    const c = cap('work', ident({ isOwner: false }), noGrants, access());
    expect(c.canEditRack).toBe(false);
    expect(c.rackReadOnly).toBe(true);
  });
});

describe('view mode', () => {
  it('rack is read-only; suggest follows the gate; coach is reference-only', () => {
    const c = cap('view', ident({ isOwner: false, baseRole: 'reviewer' }), noGrants,
      access({ role: 'reviewer', coachAvailable: false, gates: { canComment: true, canSuggest: true, canBookmark: false } }));
    expect(c.canEditRack).toBe(false);
    expect(c.rackReadOnly).toBe(true);
    expect(c.canSuggest).toBe(true);
    expect(c.canBookmark).toBe(false);
    expect(c.canUseCoach).toBe(false);
    expect(c.canReact).toBe(false);
  });
});

describe('room mode', () => {
  it('host drives transport + grants; holds both scopes by default', () => {
    const c = cap('room', ident({ isHost: true }), noGrants, access());
    expect(c.canControlTransport).toBe(true);
    expect(c.transportFollowsHost).toBe(false);
    expect(c.canEditRack).toBe(true);        // host holds rack while undelegated
    expect(c.canControlVisuals).toBe(true);
    expect(c.canGrantControl).toBe(true);
    expect(c.canUseCoach).toBe(false);       // coach never in Room
    expect(c.canReact && c.canChat).toBe(true);
  });
  it('a plain listener cannot edit, follows the host, may still react/chat', () => {
    const c = cap('room', ident({ isOwner: false, isHost: false, baseRole: 'anon' }), noGrants, access({ role: 'anon' }));
    expect(c.canEditRack).toBe(false);
    expect(c.rackReadOnly).toBe(true);
    expect(c.canControlTransport).toBe(false);
    expect(c.transportFollowsHost).toBe(true);
    expect(c.canGrantControl).toBe(false);
    expect(c.canReact).toBe(true);
  });
  it('granting rack to a listener makes them the DJ and removes it from the host', () => {
    const delegated: RoomControl = { rackHolder: guest, visualsHolder: null };
    const asGuest = cap('room', ident({ actor: guest, isOwner: false, isHost: false }), delegated, access());
    const asHost = cap('room', ident({ isHost: true }), delegated, access());
    expect(asGuest.canEditRack).toBe(true);  // guest is now DJ
    expect(asGuest.canSuggest).toBe(true);   // DJ can grantee-save → Suggestion
    expect(asHost.canEditRack).toBe(false);  // host no longer holds rack
    expect(asHost.canControlVisuals).toBe(true); // host still holds visuals
  });
});
