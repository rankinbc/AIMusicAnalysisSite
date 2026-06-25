/* SPECTR · Listen V3 — authority resolver.
 *
 * resolveCapabilities is the single source of "what can THIS actor DO in THIS
 * mode" — the authority layer. It is SEPARATE from MODE_SURFACE_MATRIX (the
 * layout layer in access.ts): the matrix says what SHOWS, this says what's
 * ALLOWED/ENABLED. Inputs mirror PRP-2 AccessDto + PRP-4 ControlGrant so the
 * real endpoints swap in without touching any cap.* read site.
 */
import type { ActorRef, AccessDto, ModeId } from './access';
import { sameActor, type Identity, type RoomControl } from './identity';

export interface CapabilitySet {
  // rack / audio
  canEditRack: boolean;
  rackReadOnly: boolean;
  // transport
  canControlTransport: boolean;
  transportFollowsHost: boolean;
  // visuals
  canControlVisuals: boolean;
  // coach
  canUseCoach: boolean;
  // feedback / social
  canComment: boolean;
  canSuggest: boolean;
  canBookmark: boolean;
  canReact: boolean;
  canChat: boolean;
  // host powers
  canGrantControl: boolean;
  canHostRoom: boolean;
  canJoinRoom: boolean;
}

/** Host holds a scope until it's delegated away; otherwise the named holder does. */
function holds(holder: ActorRef | null, id: Identity): boolean {
  if (id.isHost && holder == null) return true;
  return sameActor(holder, id.actor);
}

export function resolveCapabilities(
  mode: ModeId,
  id: Identity,
  control: RoomControl,
  access: AccessDto,
): CapabilitySet {
  const g = access.gates;
  const base = {
    canComment: g.canComment,
    canBookmark: g.canBookmark,
    canHostRoom: access.roomHostable,
    canJoinRoom: access.roomJoinable,
  };

  if (mode === 'work') {
    return {
      ...base,
      canEditRack: id.isOwner, rackReadOnly: !id.isOwner,
      canControlTransport: true, transportFollowsHost: false,
      canControlVisuals: true,
      canUseCoach: access.coachAvailable,
      canSuggest: g.canSuggest,
      canReact: false, canChat: false,
      canGrantControl: false,
    };
  }

  if (mode === 'view') {
    return {
      ...base,
      canEditRack: false, rackReadOnly: true,
      canControlTransport: true, transportFollowsHost: false,
      canControlVisuals: true,
      canUseCoach: access.coachAvailable,
      canSuggest: g.canSuggest,
      canReact: false, canChat: false,
      canGrantControl: false,
    };
  }

  // room
  const holdsRack = holds(control.rackHolder, id);
  const holdsVisuals = holds(control.visualsHolder, id);
  return {
    ...base,
    canEditRack: holdsRack, rackReadOnly: !holdsRack,
    canControlTransport: id.isHost, transportFollowsHost: !id.isHost,
    canControlVisuals: holdsVisuals,
    canUseCoach: false,
    canSuggest: holdsRack,
    canReact: true, canChat: true,
    canGrantControl: id.isHost,
  };
}
