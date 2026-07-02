import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { fetcher, getAccessToken } from '../../api/fetcher';
import { useMe } from '../../api/hooks';
import {
  PublicProfileView,
  type PublicProfile,
} from '../../features/profiles/PublicProfileView';

// Story 11.8 — public profile at /u/{handle}. Unauthenticated read; the
// owner (matched by handle via /auth/me) gets the Edit-profile affordance.

export const Route = createFileRoute('/_public/u/$handle')({
  component: PublicProfileRoute,
});

function usePublicProfile(handle: string) {
  return useQuery({
    queryKey: ['u', handle],
    queryFn: () => fetcher<PublicProfile>({ url: `/u/${handle}`, method: 'GET' }),
    enabled: Boolean(handle),
    retry: false,
  });
}

function PublicProfileRoute() {
  const { handle } = Route.useParams();
  const { data, isLoading, error } = usePublicProfile(handle);
  // Owner detection only matters when a session exists.
  const { data: me } = useMe(Boolean(getAccessToken()));

  if (isLoading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <p className="mono" style={{ color: 'var(--muted)' }}>Loading profile…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <h1>No one lives here</h1>
        <p style={{ color: 'var(--muted)' }}>
          There's no profile at <span className="mono">@{handle}</span>.
        </p>
      </div>
    );
  }

  const isOwner = Boolean(me?.handle && me.handle.toLowerCase() === data.handle.toLowerCase());
  return <PublicProfileView profile={data} isOwner={isOwner} />;
}
