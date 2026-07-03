/* Story 11.10 — followed-users activity feed hook over FeedEndpoints.
 * Contract (FeedEndpoints.cs): GET /me/feed?page&limit →
 * {items, page, limit, hasMore, suggestions} — items are the union of public
 * version-shares and published room recaps from followed users, reverse-chron;
 * suggestions only arrive on an empty page 0 (discovery empty state).
 * Infinite query so "More…" APPENDS pages (review patch — a page-replace
 * container dropped page 0 from view and flashed a false empty state). */
import { useInfiniteQuery } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';

export interface FeedItemDto {
  itemId: string; // version id (share) | session id (recap) — stable React key
  kind: 'share' | 'recap';
  handle: string;
  displayName: string | null;
  songName: string;
  versionNumber: number;
  shareToken: string;
  occurredAt: string;
}

export interface FeedSuggestionDto {
  handle: string;
  displayName: string | null;
}

export interface FeedPageDto {
  items: FeedItemDto[];
  page: number;
  limit: number;
  hasMore: boolean;
  suggestions: FeedSuggestionDto[] | null;
}

export const FEED_KEY = ['me', 'feed'] as const;

export function useFeed() {
  return useInfiniteQuery({
    queryKey: FEED_KEY,
    queryFn: ({ pageParam }) =>
      fetcher<FeedPageDto>({
        url: '/me/feed',
        method: 'GET',
        params: { page: pageParam },
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}
