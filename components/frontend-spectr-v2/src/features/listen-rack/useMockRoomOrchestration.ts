/* Listen V3 — shared mock orchestration for the /listen-rack routes.
 *
 * Both the param-less demo route and the versioned (real-audio) route own the
 * same parent-determined mode + identity + room-control state. It's all mocked
 * here for now; PRP-2 swaps MOCK_ACCESS for the real `GET /access` and PRP-4
 * swaps MOCK_ROOM_CONTROL for the live room stream. Keeping it in one hook means
 * that swap happens in exactly one place.
 */
import { useMemo, useState } from 'react';

import { availableModes, MOCK_ACCESS, type AccessDto, type ActorRef, type ModeId } from './access';
import { MOCK_IDENTITY, MOCK_ROOM_CONTROL, type Identity, type RoomControl } from './identity';

export interface MockRoomOrchestration {
  mode: ModeId;
  modes: ModeId[];
  identity: Identity;
  access: AccessDto;
  roomControl: RoomControl;
  /** Owner-only (decision B): undefined for non-owners so the SegBar is fixed. */
  onModeChange: ((m: ModeId) => void) | undefined;
  onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
}

export function useMockRoomOrchestration(): MockRoomOrchestration {
  const access = MOCK_ACCESS;
  const identity = MOCK_IDENTITY;
  const modes = useMemo(() => availableModes(access), [access]);
  const [mode, setMode] = useState<ModeId>(modes[0] ?? 'work');
  const [roomControl, setRoomControl] = useState<RoomControl>(MOCK_ROOM_CONTROL);
  const onModeChange = identity.isOwner ? setMode : undefined;
  const onGrant = (scope: 'rack' | 'visuals', actor: ActorRef | null) =>
    setRoomControl((rc) =>
      scope === 'rack' ? { ...rc, rackHolder: actor } : { ...rc, visualsHolder: actor });
  return { mode, modes, identity, access, roomControl, onModeChange, onGrant };
}
