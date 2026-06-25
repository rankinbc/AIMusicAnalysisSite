import { createFileRoute } from '@tanstack/react-router';

import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';
import { useMockRoomOrchestration } from '../../features/listen-rack/useMockRoomOrchestration';

/**
 * Listen — Rack & Visuals redesign, REAL-AUDIO route (Phase 1 page port).
 *
 * Renders the canonical /listen-rack page for a real version: the page mounts an
 * <audio> element + the page-agnostic audio graph and drives its transport off
 * the element (streams `GET /api/versions/{id}/audio?t=<jwt>`). Mode / identity /
 * room-control are still mocked here — that swap is PRP-2 (GET /access) + PRP-4
 * (room stream). This route only makes the page PLAY a song; the rack knobs don't
 * shape the sound yet (Phase 2).
 */
function ListenRackVersionRoute() {
  const { versionId } = Route.useParams();
  const { mode, modes, identity, access, roomControl, onModeChange, onGrant } =
    useMockRoomOrchestration();
  return (
    <ListenRackPage versionId={versionId} mode={mode} modes={modes} identity={identity}
      access={access} roomControl={roomControl} onGrant={onGrant}
      {...(onModeChange ? { onModeChange } : {})} />
  );
}

export const Route = createFileRoute('/_app/listen-rack/$versionId')({
  component: ListenRackVersionRoute,
});
