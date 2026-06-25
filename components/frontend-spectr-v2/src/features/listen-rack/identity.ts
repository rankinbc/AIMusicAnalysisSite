/* SPECTR · Listen V3 — actor identity + Room control holders + derived roles.
 *
 * Version-level identity (who I am, do I own this version, am I hosting). The
 * session roles (DJ = rack holder, VJ = visuals holder) are DERIVED from the
 * live RoomControl, never stored — a person can wear both hats. Shapes mirror
 * PRP-4 ControlGrant so the real room stream swaps in without touching callers.
 */
import type { ActorRef, AccessDto } from './access';

export type BaseRole = AccessDto['role'];

export interface Identity {
  actor: ActorRef;     // who I am (user|anon)
  isOwner: boolean;    // I own the version being listened to
  baseRole: BaseRole;  // === AccessDto.role
  isHost: boolean;     // I host the current Room session (false outside Room)
}

export interface RoomControl {
  rackHolder: ActorRef | null;     // the DJ   (null ⇒ host drives / nobody delegated)
  visualsHolder: ActorRef | null;  // the VJ
}

export type SessionHat = 'host' | 'dj' | 'vj' | 'listener';

/** Stable identity key: type-prefixed so a user and an anon never collide.
 * NOTE: the `??` chain prefers `userId` — for a `user` that's the durable key.
 * An `anon` is expected to carry NO `userId` (only `handle`/`displayName`), so
 * it keys on those; the `type` prefix is what guarantees user↔anon never match.
 * If real data ever puts a `userId` on an anon, key by handle/displayName here. */
function actorKey(a: ActorRef): string {
  return `${a.type}:${a.userId ?? a.handle ?? a.displayName ?? ''}`;
}

export function sameActor(a: ActorRef | null, b: ActorRef | null): boolean {
  return !!a && !!b && actorKey(a) === actorKey(b);
}

/** Host ⇒ ['host'] (implicitly both scopes). Else DJ/VJ from holders; else listener. */
export function sessionHats(id: Identity, control: RoomControl): SessionHat[] {
  if (id.isHost) return ['host'];
  const hats: SessionHat[] = [];
  if (sameActor(control.rackHolder, id.actor)) hats.push('dj');
  if (sameActor(control.visualsHolder, id.actor)) hats.push('vj');
  return hats.length ? hats : ['listener'];
}

/** Uppercased display labels for the People-panel chips. */
export function roleLabels(id: Identity, control: RoomControl): string[] {
  return sessionHats(id, control).map((h) => h.toUpperCase());
}

/**
 * MOCK — the page's actor owns the version AND hosts the demo Room. `isHost`
 * is true so the host-centric Room fixture stays coherent: the People panel's
 * "you" row, "You're hosting", and the +DJ/+Vis grant buttons (gated on
 * `cap.canGrantControl === isHost`) all line up. A real non-host listener
 * arrives only with the PRP-4 room stream, which supplies the real Identity.
 */
export const MOCK_IDENTITY: Identity = {
  actor: { type: 'user', userId: 'me', handle: 'maek', displayName: 'Mae Karlsson', hue: 168 },
  isOwner: true,
  baseRole: 'owner',
  isHost: true,
};

export const MOCK_ROOM_CONTROL: RoomControl = { rackHolder: null, visualsHolder: null };
