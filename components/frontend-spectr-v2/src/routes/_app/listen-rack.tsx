import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { availableModes, MOCK_ACCESS, type ActorRef, type ModeId } from '../../features/listen-rack/access';
import { MOCK_IDENTITY, MOCK_ROOM_CONTROL } from '../../features/listen-rack/identity';
import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';

/**
 * Listen — Rack & Visuals redesign (design-handoff port).
 *
 * The parent route owns mode + identity + room-control (all mocked here; later
 * GET /access + the PRP-4 room stream). The SegBar inside the page is owner-only
 * (decision B). onGrant mutates the mock RoomControl locally so the host→DJ/VJ
 * delegation flow is demoable without the live session stream.
 */
function ListenRackRoute() {
  const access = MOCK_ACCESS;
  const identity = MOCK_IDENTITY;
  const modes = useMemo(() => availableModes(access), [access]);
  const [mode, setMode] = useState<ModeId>(modes[0] ?? 'work');
  const [roomControl, setRoomControl] = useState(MOCK_ROOM_CONTROL);
  const onModeChange = identity.isOwner ? setMode : undefined;
  const onGrant = (scope: 'rack' | 'visuals', actor: ActorRef | null) =>
    setRoomControl((rc) => (scope === 'rack' ? { ...rc, rackHolder: actor } : { ...rc, visualsHolder: actor }));
  return (
    <ListenRackPage mode={mode} modes={modes} identity={identity} access={access}
      roomControl={roomControl} onGrant={onGrant}
      {...(onModeChange ? { onModeChange } : {})} />
  );
}

export const Route = createFileRoute('/_app/listen-rack')({
  component: ListenRackRoute,
});
