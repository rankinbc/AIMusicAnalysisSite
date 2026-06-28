import { Outlet, createFileRoute, useChildMatches } from '@tanstack/react-router';
import { SongConsole } from '../../features/song/SongConsole';

export const Route = createFileRoute('/_app/songs/$songId')({
  component: SongDetailPage,
});

function SongDetailPage() {
  const { songId } = Route.useParams();
  const childMatches = useChildMatches();
  // When a nested route is active (e.g. /songs/:id/results/:jobId), render
  // only the child via <Outlet />. The song-detail UI is not a layout shell
  // for the report page — they're separate full-page views.
  if (childMatches.length > 0) return <Outlet />;
  return <SongConsole songId={songId} />;
}
