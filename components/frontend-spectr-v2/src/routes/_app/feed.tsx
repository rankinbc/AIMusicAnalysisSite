/* Story 11.10 — /feed route container: owns the infinite feed query;
 * rendering lives in the pure FeedView components (static-render tested).
 * Pages ACCUMULATE (review patch): "More…" appends the next page instead of
 * replacing the list. */
import { createFileRoute } from '@tanstack/react-router';

import { FeedList } from '../../features/feed/FeedView';
import { useFeed } from '../../features/feed/useFeed';
import s from '../../features/feed/feed.module.css';

export const Route = createFileRoute('/_app/feed')({ component: FeedPage });

function FeedPage() {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useFeed();

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  // Suggestions only ever arrive on an empty page 0.
  const suggestions = data?.pages[0]?.suggestions ?? null;

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Feed</h1>
      {isLoading ? (
        <p className="mono">Loading…</p>
      ) : (
        <FeedList
          items={items}
          suggestions={suggestions}
          hasMore={hasNextPage ?? false}
          morePending={isFetchingNextPage}
          onMore={() => void fetchNextPage()}
        />
      )}
    </div>
  );
}
