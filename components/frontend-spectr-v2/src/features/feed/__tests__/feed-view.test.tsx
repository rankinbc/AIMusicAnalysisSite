/* Story 11.10 AC5 — static-render coverage for the pure feed components.
 * The route container (hooks/paging) is exercised in the browser; these pure
 * pieces carry the rendering contract. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { feedItemGlyph, feedItemText } from '../feed-text';
import { FeedEmptyState, FeedItemRow, FeedList } from '../FeedView';
import type { FeedItemDto, FeedSuggestionDto } from '../useFeed';

const item = (over?: Partial<FeedItemDto>): FeedItemDto => ({
  kind: 'share',
  handle: 'aurora',
  displayName: 'Aurora',
  songName: 'Nightdrive',
  versionNumber: 3,
  shareToken: 'tok-123',
  occurredAt: new Date().toISOString(),
  ...over,
});

const suggestion = (over?: Partial<FeedSuggestionDto>): FeedSuggestionDto => ({
  handle: 'kepler',
  displayName: 'Kepler',
  ...over,
});

describe('feed-text', () => {
  it('words share vs recap items distinctly', () => {
    expect(feedItemText(item())).toBe('Aurora shared Nightdrive v3');
    expect(feedItemText(item({ kind: 'recap' }))).toBe('Aurora published a room recap on Nightdrive v3');
    expect(feedItemText(item({ displayName: null }))).toBe('@aurora shared Nightdrive v3');
    expect(feedItemGlyph(item())).not.toBe(feedItemGlyph(item({ kind: 'recap' })));
  });
});

describe('FeedItemRow', () => {
  it('deep-links the card to /v/{token} and the handle to /u/{handle} (AC3)', () => {
    const html = renderToStaticMarkup(<FeedItemRow item={item()} />);
    expect(html).toContain('href="/v/tok-123"');
    expect(html).toContain('href="/u/aurora"');
    expect(html).toContain('data-kind="share"');
    expect(html).toContain('Aurora shared Nightdrive v3');
  });

  it('marks recap items with a recap pill', () => {
    const html = renderToStaticMarkup(<FeedItemRow item={item({ kind: 'recap' })} />);
    expect(html).toContain('data-kind="recap"');
    expect(html).toContain('recap');
    expect(html).toContain('published a room recap');
  });
});

describe('FeedList', () => {
  it('renders populated feed reverse-chron as given, with More on hasMore (AC1)', () => {
    const html = renderToStaticMarkup(
      <FeedList
        items={[item(), item({ kind: 'recap', shareToken: 'tok-456' })]}
        suggestions={null}
        hasMore
      />,
    );
    expect(html).toContain('href="/v/tok-123"');
    expect(html).toContain('href="/v/tok-456"');
    expect(html).toContain('More…');
    expect(html).not.toContain('data-testid="empty-feed"');
  });

  it('omits More when hasMore is false', () => {
    const html = renderToStaticMarkup(<FeedList items={[item()]} suggestions={null} />);
    expect(html).not.toContain('More…');
  });

  it('renders the empty state with discovery suggestions (AC2)', () => {
    const html = renderToStaticMarkup(
      <FeedList items={[]} suggestions={[suggestion(), suggestion({ handle: 'vega', displayName: null })]} hasMore={false} />,
    );
    expect(html).toContain('data-testid="empty-feed"');
    expect(html).toContain('data-testid="feed-suggestions"');
    expect(html).toContain('href="/u/kepler"');
    expect(html).toContain('href="/u/vega"');
    expect(html).toContain('@vega'); // falls back to handle when no display name
  });

  it('renders the empty state without a suggestions block when none arrive', () => {
    const html = renderToStaticMarkup(<FeedEmptyState suggestions={[]} />);
    expect(html).toContain('data-testid="empty-feed"');
    expect(html).not.toContain('data-testid="feed-suggestions"');
  });
});
