import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { availableModes, MOCK_ACCESS, type ModeId } from '../../features/listen-rack/access';
import { MOCK_IDENTITY } from '../../features/listen-rack/identity';
import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';

/**
 * Listen — Rack & Visuals redesign (design-handoff port).
 *
 * The parent route owns mode + identity (mocked here; later GET /access + the
 * room stream). The SegBar inside the page is owner-only (decision B). The
 * engine wiring map lives in src/features/listen-rack/PORTING_NOTES.md.
 */
function ListenRackRoute() {
  const access = MOCK_ACCESS;
  const identity = MOCK_IDENTITY;
  const modes = useMemo(() => availableModes(access), [access]);
  const [mode, setMode] = useState<ModeId>(modes[0] ?? 'work');
  const onModeChange = identity.isOwner ? setMode : undefined;
  return (
    <ListenRackPage mode={mode} modes={modes} identity={identity} access={access}
      {...(onModeChange ? { onModeChange } : {})} />
  );
}

export const Route = createFileRoute('/_app/listen-rack')({
  component: ListenRackRoute,
});
