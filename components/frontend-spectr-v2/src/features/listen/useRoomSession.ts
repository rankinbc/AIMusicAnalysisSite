/* SPECTR · Listen V3 (PRP-4) — Room session lifecycle hooks. Start/end are
 * host-only (server-gated via AccessService.roomHostable); history + GET are
 * canView. recap publish creates View comments (PRP-3) from hottest moments. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import type {
  CommentDto,
  RecapPublishRequest,
  SessionDto,
} from '../../api/types';

const historyKey = (versionId: string) => ['versions', versionId, 'sessions'] as const;
const sessionKey = (sessionId: string) => ['sessions', sessionId] as const;
const commentsKey = (versionId: string) => ['versions', versionId, 'comments'] as const;

export function useSessionHistory(versionId: string) {
  return useQuery({
    queryKey: historyKey(versionId),
    queryFn: () => fetcher<SessionDto[]>({ url: `/versions/${versionId}/sessions`, method: 'GET' }),
    enabled: Boolean(versionId),
  });
}

// GET a single session (+ recap once ended). Anon callers pass the share/session
// token; the call also acts as the lazy-on-read finalize backstop server-side.
export function useSession(sessionId: string | null, token?: string | null) {
  return useQuery({
    queryKey: sessionKey(sessionId ?? ''),
    queryFn: () => fetcher<SessionDto>({
      url: `/sessions/${sessionId}`,
      method: 'GET',
      params: token ? { token } : undefined,
    }),
    enabled: Boolean(sessionId),
  });
}

export function useStartSession(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<SessionDto>({ url: `/versions/${versionId}/sessions`, method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKey(versionId) }),
  });
}

export function useEndSession(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      fetcher<void>({ url: `/sessions/${sessionId}/end`, method: 'POST' }),
    onSuccess: (_data, sessionId) => {
      qc.invalidateQueries({ queryKey: historyKey(versionId) });
      qc.invalidateQueries({ queryKey: sessionKey(sessionId) });
    },
  });
}

export function usePublishRecap(versionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { sessionId: string; body: RecapPublishRequest }) =>
      fetcher<CommentDto[]>({
        url: `/sessions/${vars.sessionId}/recap/publish`,
        method: 'POST',
        data: vars.body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(versionId) }),
  });
}
