/* Story 11.9 — follow graph hooks over /api/u/{handle}/follow. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: followKey(handle) }),
  });
}

export function useUnfollow(handle: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<void>({ url: `/u/${handle}/follow`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: followKey(handle) }),
  });
}
