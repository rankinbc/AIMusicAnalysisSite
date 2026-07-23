import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { ApiError, fetcher, getAccessToken } from '../../api/fetcher';
import { useMe } from '../../api/hooks';
import {
  PublicProfileView,
  type PublicProfile,
} from '../../features/profiles/PublicProfileView';
import { useFollow, useFollowState, useUnfollow } from '../../features/profiles/useFollow';

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
  const { data, isLoading, error, refetch } = usePublicProfile(handle);
  // Owner detection only matters when a session exists.
  const authed = Boolean(getAccessToken());
  const { data: me } = useMe(authed);
  const { data: followState } = useFollowState(handle);
  const followMut = useFollow(handle);
  const unfollowMut = useUnfollow(handle);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <p className="mono" style={{ color: 'var(--muted)' }}>Loading profile…</p>
      </div>
    );
  }
  // Audit wave-3 (E7.6) — only a 404 means "no such profile". A 429 says so
  // honestly, and any other failure gets a retry instead of the 404 copy.
  if (error instanceof ApiError && error.status === 429) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <h1>Slow down a second</h1>
        <p style={{ color: 'var(--muted)' }}>
          Too many profile views — try again in a minute.
        </p>
      </div>
    );
  }
  if (error && !(error instanceof ApiError && error.status === 404)) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <h1>Something went wrong</h1>
        <p style={{ color: 'var(--muted)' }}>
          Couldn&rsquo;t load this profile — try again.
        </p>
        <button type="button" className="btn" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) {
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
  return (
    <PublicProfileView
      profile={data}
      isOwner={isOwner}
      {...(followState
        ? {
            follow: {
              followers: followState.followers,
              following: followState.following,
              isFollowing: followState.isFollowing,
              canFollow: authed && !followState.isSelf,
              pending: followMut.isPending || unfollowMut.isPending,
              onToggle: () =>
                followState.isFollowing ? unfollowMut.mutate() : followMut.mutate(),
            },
          }
        : {})}
    />
  );
}
