// @vitest-environment jsdom
/* Audit wave-3 (E7.7) — the notifications list is an infinite query so
 * "More…" APPENDS pages (page-0 items stay visible). Also pins the key
 * under the ['me','notifications'] prefix so markRead/markAll's prefix
 * invalidation keeps hitting the list. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../../../api/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/fetcher')>();
  return { ...actual, fetcher: vi.fn() };
});

import { fetcher } from '../../../api/fetcher';
import { useNotifications, type NotificationDto, type NotificationPageDto } from '../useNotifications';

const fetcherMock = vi.mocked(fetcher);

function n(id: string): NotificationDto {
  return {
    id,
    eventType: 'comment_created',
    payload: { versionId: 'v1' },
    digestKey: null,
    count: 1,
    readAt: null,
    createdAt: '2026-07-02T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
  };
}

function page(pageNo: number, items: NotificationDto[], hasMore: boolean): NotificationPageDto {
  return { items, page: pageNo, limit: 20, hasMore };
}

describe('useNotifications (audit wave-3 E7.7)', () => {
  it('appends the next page — page-0 items remain after More…', async () => {
    fetcherMock
      .mockResolvedValueOnce(page(0, [n('n1')], true) as never)
      .mockResolvedValueOnce(page(1, [n('n2')], false) as never);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useNotifications(true), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    const flat = (result.current.data?.pages ?? []).flatMap((p) => p.items).map((i) => i.id);
    expect(flat).toEqual(['n1', 'n2']); // page 0 retained, page 1 appended
    expect(result.current.hasNextPage).toBe(false);

    // page param travels with each request
    expect(fetcherMock).toHaveBeenNthCalledWith(1, {
      url: '/me/notifications',
      method: 'GET',
      params: { page: 0 },
    });
    expect(fetcherMock).toHaveBeenNthCalledWith(2, {
      url: '/me/notifications',
      method: 'GET',
      params: { page: 1 },
    });

    // Invalidation-prefix compatibility: markRead/markAll invalidate
    // ['me','notifications'] — the list key must live under that prefix.
    const matches = qc.getQueryCache().findAll({ queryKey: ['me', 'notifications'] });
    expect(matches.some((q) => JSON.stringify(q.queryKey) === JSON.stringify(['me', 'notifications', 'list']))).toBe(true);
  });
});
