/* Story 11.7 — notifications inbox hooks over the 11.6 backend.
 * Contract (NotificationEndpoints.cs): GET /me/notifications?page&limit →
 * {items, page, limit, hasMore} · GET /me/notifications/unread-count →
 * {unread} · POST /me/notifications/{id}/read · POST /me/notifications/read-all.
 * The bell polls unread-count (TanStack refetchInterval — SSE deferred by AC1). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';

export interface NotificationDto {
  id: string;
  eventType: string; // comment_created | suggestion_created | suggestion_accepted | mention | bookmark (digest)
  payload: {
    commentId?: string;
    versionId?: string;
    suggestionId?: string;
    day?: string;
  } | null;
  digestKey: string | null; // non-null ⇒ digest row (render count wording)
  count: number;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  page: number;
  limit: number;
  hasMore: boolean;
}

const listKey = (page: number) => ['me', 'notifications', page] as const;
const unreadKey = ['me', 'notifications', 'unread'] as const;

export function useNotifications(page: number, enabled = true) {
  return useQuery({
    queryKey: listKey(page),
    queryFn: () =>
      fetcher<NotificationPageDto>({
        url: '/me/notifications',
        method: 'GET',
        params: { page },
      }),
    enabled,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: unreadKey,
    queryFn: () => fetcher<{ unread: number }>({ url: '/me/notifications/unread-count', method: 'GET' }),
    refetchInterval: 30_000, // AC1 — live-ish badge via poll; SSE deferred
    staleTime: 25_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      fetcher<void>({ url: `/me/notifications/${notificationId}/read`, method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'notifications'] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fetcher<void>({ url: '/me/notifications/read-all', method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'notifications'] });
    },
  });
}
