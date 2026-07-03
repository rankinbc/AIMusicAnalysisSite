/* Story 11.10 — pure presentational feed (static-render testable, AC5).
 * The route container owns fetching/paging; these components take plain props.
 * Deep links (AC3): item card → /v/{token} (recap comments live there too),
 * actor handle + suggestions → /u/{handle}. */
import { Pill } from '../../ui/Pill';

import { feedItemGlyph, feedItemText, relativeTime } from './feed-text';
import type { FeedItemDto, FeedSuggestionDto } from './useFeed';
import s from './feed.module.css';

export function FeedItemRow({ item }: { item: FeedItemDto }) {
  return (
    <li className={s.itemLi} data-kind={item.kind}>
      <a href={`/v/${item.shareToken}`} className={`card ${s.itemCard}`}>
        <span className={s.itemGlyph} aria-hidden>{feedItemGlyph(item)}</span>
        <span className={s.itemBody}>
          <span className={s.itemText}>{feedItemText(item)}</span>
          <span className={`mono ${s.itemTime}`}>{relativeTime(item.occurredAt)}</span>
        </span>
        <Pill>
          <span className="mono">{item.kind === 'recap' ? 'recap' : `v${item.versionNumber}`}</span>
        </Pill>
      </a>
      <a href={`/u/${item.handle}`} className={`mono ${s.itemHandle}`}>@{item.handle}</a>
    </li>
  );
}

export function FeedEmptyState({ suggestions }: { suggestions: FeedSuggestionDto[] }) {
  return (
    <div className={`card card-body ${s.empty}`} data-testid="empty-feed">
      <p className={s.emptyLead}>Your feed is quiet.</p>
      <p className={`mono ${s.emptyHint}`}>
        Follow producers to see their public tracks and room recaps here.
      </p>
      {suggestions.length > 0 && (
        <div className={s.suggestions} data-testid="feed-suggestions">
          <span className="label">Profiles to discover</span>
          <ul className={s.suggestionList}>
            {suggestions.map((p) => (
              <li key={p.handle}>
                <a href={`/u/${p.handle}`} className={`btn sm ghost ${s.suggestionLink}`}>
                  {p.displayName ?? `@${p.handle}`}
                  <span className={`mono ${s.suggestionHandle}`}>@{p.handle}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FeedList({
  items,
  suggestions,
  hasMore,
  morePending,
  onMore,
}: {
  items: FeedItemDto[];
  suggestions: FeedSuggestionDto[] | null;
  hasMore?: boolean;
  morePending?: boolean;
  onMore?: () => void;
}) {
  if (items.length === 0) {
    return <FeedEmptyState suggestions={suggestions ?? []} />;
  }
  return (
    <div>
      <ul className={s.list}>
        {items.map((item) => (
          // itemId is server-stable (version id / session id) — token+timestamp
          // can collide when two published sessions share one version.
          <FeedItemRow key={`${item.kind}:${item.itemId}`} item={item} />
        ))}
      </ul>
      {hasMore && (
        <button type="button" className={`btn sm ghost ${s.more}`} onClick={onMore} disabled={morePending}>
          {morePending ? 'Loading…' : 'More…'}
        </button>
      )}
    </div>
  );
}
