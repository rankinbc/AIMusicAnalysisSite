import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Legacy Listen route — RETIRED in the Phase 3 cutover. The canonical Listen
 * page is now `/listen-rack/$versionId` (features/listen-rack/). This route only
 * survives as a redirect so old links/bookmarks keep working; it renders nothing.
 */
export const Route = createFileRoute('/_app/listen/$versionId')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/listen-rack/$versionId', params });
  },
});
