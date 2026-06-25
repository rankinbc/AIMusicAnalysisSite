/* SPECTR · Listen V3 (PRP-3) — View comment hooks (authed version-scoped + anon
 * token-scoped). Threaded, author-moderated; gating is enforced server-side via
 * AccessService, so a 403/404 from these calls means "not permitted". */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type { CommentDto, PatchCommentStatusRequest, PostCommentRequest } from '../../api/types';

const commentsKey = (versionId: string) => ['versions', versionId, 'comments'] as const;
const anonCommentsKey = (token: string) => ['v', token, 'comments'] as const;

// ── authed (version-scoped) ──────────────────────────────────────────────────
export function useComments(versionId: string) {
  return useQuery({
    queryKey: commentsKey(versionId),
    queryFn: () => fetcher<CommentDto[]>({ url: `/versions/${versionId}/comments`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

export function usePostComment(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostCommentRequest) =>
      fetcher<CommentDto>({ url: `/versions/${versionId}/comments`, method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(versionId) }),
  });
}

export function usePatchCommentStatus(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { commentId: string; body: PatchCommentStatusRequest }) =>
      fetcher<void>({ url: `/comments/${vars.commentId}`, method: 'PATCH', data: vars.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(versionId) }),
  });
}

export function useDeleteComment(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      fetcher<void>({ url: `/comments/${commentId}`, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(versionId) }),
  });
}

// ── anonymous (opaque share token) ───────────────────────────────────────────
export function useAnonComments(token: string) {
  return useQuery({
    queryKey: anonCommentsKey(token),
    queryFn: () => fetcher<CommentDto[]>({ url: `/v/${token}/comments`, method: 'GET' }),
    enabled: Boolean(token),
    retry: false,
  });
}

export function usePostAnonComment(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostCommentRequest) =>
      fetcher<CommentDto>({ url: `/v/${token}/comments`, method: 'POST', data: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: anonCommentsKey(token) }),
  });
}
