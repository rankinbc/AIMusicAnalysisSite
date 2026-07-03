/* Story 11.9 — follow graph hooks over /api/u/{handle}/follow. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import { FEED_KEY } from '../feed/useFeed';

export interface FollowStateDto {
  followers: number;
  following: number;
  isFollowing: boolean;
  isSelf: boolean;
}

const followKey = (handle: string) => ['u', handle, 'follow'] as const;

export function useFollowState(handle: string) {
  return useQuery({
    queryKey: followKey(handle),
    queryFn: () => fetcher<FollowStateDto>({ url: `/u/${handle}/follow`, method: 'GET' }),
    enabled: Boolean(handle),
    retry: false,
  });
}

export function useFollow(handle: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<void>({ url: `/u/${handle}/follow`, method: 'PUT' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: followKey(handle) });
      // Story 11.10 — the feed's contents/suggestions depend on the follow
      // graph; without this a follow-from-suggestion shows a stale empty feed.
      void qc.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
}

export function useUnfollow(handle: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<void>({ url: `/u/${handle}/follow`, method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: followKey(handle) });
      void qc.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
}
