import { Outlet, createFileRoute, useChildMatches } from '@tanstack/react-router';

import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';
import { useMockRoomOrchestration } from '../../features/listen-rack/useMockRoomOrchestration';

/**
 * Listen — Rack & Visuals redesign (design-handoff port), param-less DEMO route.
 *
 * Runs the mock rAF transport clock over the TRACK fixture — no real audio. The
 * real-audio page lives at `/listen-rack/$versionId` (Phase 1 port). Because that
 * versioned route is a path-child of this one, this component renders <Outlet />
 * when the child is active (same pattern as songs.$songId.tsx); otherwise it
 * renders the demo.
 *
 * Mode + identity + room-control come from useMockRoomOrchestration (all mocked;
 * later GET /access + the PRP-4 room stream). The SegBar inside the page is
 * owner-only (decision B). onGrant mutates the mock RoomControl locally so the
 * host→DJ/VJ delegation flow is demoable without the live session stream.
 */
function ListenRackRoute() {
  const childMatches = useChildMatches();
  const { mode, modes, identity, access, roomControl, onModeChange, onGrant } =
    useMockRoomOrchestration();
  if (childMatches.length > 0) return <Outlet />;
  return (
    <ListenRackPage mode={mode} modes={modes} identity={identity} access={access}
      roomControl={roomControl} onGrant={onGrant}
      {...(onModeChange ? { onModeChange } : {})} />
  );
}

export const Route = createFileRoute('/_app/listen-rack')({
  component: ListenRackRoute,
});
