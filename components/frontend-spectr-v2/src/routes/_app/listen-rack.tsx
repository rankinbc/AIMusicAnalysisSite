import { createFileRoute } from '@tanstack/react-router';

import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';

/**
 * Listen — Rack & Visuals redesign (design-handoff port).
 *
 * Renders the redesigned Listen page at `/listen-rack`. Currently a faithful
 * VISUAL port driven by MOCK data (playback clock, presence, coach, meters are
 * all simulated). The engine wiring map lives in
 * src/features/listen-rack/PORTING_NOTES.md. The shipping `/listen/$versionId`
 * route is untouched.
 */
export const Route = createFileRoute('/_app/listen-rack')({
  component: ListenRackPage,
});
