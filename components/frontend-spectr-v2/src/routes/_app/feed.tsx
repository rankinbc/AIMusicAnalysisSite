/* Story 11.10 — /feed route container: owns paging state + the useFeed hook;
 * rendering lives in the pure FeedView components (static-render tested). */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { FeedList } from '../../features/feed/FeedView';
import { useFeed } from '../../features/feed/useFeed';
import s from '../../features/feed/feed.module.css';

export const Route = createFileRoute('/_app/feed')({ component: FeedPage });

function FeedPage() {
  const [page, setPage] = useState(0);
  const { data, isLoading } = useFeed(page);

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Feed</h1>
      {isLoading ? (
        <p className="mono">Loading…</p>
      ) : (
        <FeedList
          items={data?.items ?? []}
          suggestions={data?.suggestions ?? null}
          hasMore={data?.hasMore ?? false}
          onMore={() => setPage((p) => p + 1)}
        />
      )}
    </div>
  );
}
