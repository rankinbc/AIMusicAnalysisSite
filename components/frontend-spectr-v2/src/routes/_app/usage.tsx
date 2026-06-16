import { createFileRoute } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { fetcher } from '../../api/fetcher';
import type { CreditsResponse } from '../../api/types';
import { BuyCreditsCard } from '../../features/billing/BuyCreditsCard';
import { CreditLedgerTable } from '../../features/billing/CreditLedgerTable';
import { Pill } from '../../ui/Pill';
import s from './usagePage.module.css';

// Story 2.3 — /_app/usage. Shows credit balance + mono ledger +
// BuyCreditsCard. UX-DR32 HonestMathBanner deferred to story 2.8.

export const Route = createFileRoute('/_app/usage')({
  component: UsagePage,
});

function UsagePage() {
  const query = useInfiniteQuery({
    queryKey: ['billing', 'credits'],
    queryFn: ({ pageParam }) => {
      const path = pageParam
        ? `/billing/credits?cursor=${encodeURIComponent(pageParam)}`
        : '/billing/credits';
      return fetcher<CreditsResponse>({ url: path, method: 'GET' });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Story 2.2 review-fix P28 pattern — billing state changes only via
    // explicit user actions or webhook arrival. 30s staleTime avoids
    // tab-focus refetch storms after returning from Stripe.
    staleTime: 30_000,
  });

  const { entries, balance } = useMemo(() => {
    const pages = query.data?.pages ?? [];
    if (pages.length === 0) {
      return { entries: [], balance: 0 };
    }
    const allEntries = pages.flatMap((p) => p.entries);
    // The first page carries the canonical balance — subsequent pages
    // re-fetch the same value but we trust the first.
    return { entries: allEntries, balance: pages[0].balance };
  }, [query.data]);

  if (query.isLoading) {
    return (
      <main className={s.shell}>
        <header className={s.header}>
          <span className="label">Usage</span>
          <h1 className={s.title}>Loading…</h1>
        </header>
      </main>
    );
  }

  // TODO(story-2.8): HonestMathBanner (UX-DR32) — "You've spent $X on
  // credits in 90 days — Pro would've been $Y". Insertion point above
  // the ledger table once the cost-comparison math is wired up.

  return (
    <main className={s.shell}>
      <header className={s.header}>
        <span className="label">Usage</span>
        <div className={s.headerRow}>
          <h1 className={s.title}>Credits</h1>
          <Pill tone="violet">
            <span className={s.balanceText}>{balance} credits</span>
          </Pill>
        </div>
      </header>

      <div className={s.grid}>
        <section className={`card ${s.ledgerCard}`}>
          <h2 className={s.cardTitle}>Ledger</h2>
          {entries.length === 0 && balance === 0 ? (
            <p className={s.empty}>
              You haven&rsquo;t bought any credits yet.
            </p>
          ) : (
            <>
              <CreditLedgerTable entries={entries} />
              {query.hasNextPage && (
                <div className={s.loadMore}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                  >
                    {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <BuyCreditsCard />
      </div>
    </main>
  );
}
