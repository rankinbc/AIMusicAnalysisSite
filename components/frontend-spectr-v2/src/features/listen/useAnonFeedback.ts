/* Story 11.4 — anon reviewer feedback over the token-scoped /v/{token} routes.
 * The opaque ResourceToken IS the grant (never JWT ?t=); the durable anon
 * identity rides the signed cookie server-side (PRP-0 UseAnonIdentity), so
 * these hooks just talk to the token routes with credentials included
 * (fetcher always sends credentials). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { BookmarkDto, CommentDto, PostCommentRequest } from '../../api/types';

const commentsKey = (token: string) => ['v', token, 'comments'] as const;

export function useAnonComments(token: string, enabled = true) {
  return useQuery({
    queryKey: commentsKey(token),
    queryFn: () => fetcher<CommentDto[]>({ url: `/v/${token}/comments`, method: 'GET' }),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function usePostAnonComment(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostCommentRequest) =>
      fetcher<CommentDto>({ url: `/v/${token}/comments`, method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(token) }),
  });
}

export function useAnonBookmark(token: string) {
  return useMutation({
    mutationFn: (body: { t?: number | null; note?: string | null }) =>
      fetcher<BookmarkDto>({ url: `/v/${token}/bookmark`, method: 'POST', data: body }),
  });
}
