import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NotificationItem, NotificationList } from '../NotificationCenter';
import { notificationEmoji, notificationText } from '../notification-text';
import type { NotificationDto } from '../useNotifications';

// Story 11.7 (AC5) — static-render coverage: per-event vs digest rendering
// + unread markers. The container (bell/hooks) is exercised in the browser;
// the pure pieces carry the rendering contract.

function n(over: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'n1',
    eventType: 'comment_created',
    payload: { versionId: 'v1', commentId: 'c1' },
    digestKey: null,
    count: 1,
    readAt: null,
    createdAt: '2026-07-02T10:00:00Z',
    updatedAt: '2026-07-02T10:00:00Z',
    ...over,
  };
}

describe('notificationText (story 11.7)', () => {
  it('renders per-event wording', () => {
    expect(notificationText(n({ eventType: 'comment_created' }))).toBe('New comment on your track');
    expect(notificationText(n({ eventType: 'suggestion_created' }))).toBe('New rack suggestion on your track');
    expect(notificationText(n({ eventType: 'suggestion_accepted' }))).toBe('Your suggestion was accepted');
    expect(notificationText(n({ eventType: 'mention' }))).toBe('You were mentioned in a comment');
  });

  it('renders digest wording with the rolling count', () => {
    const digest = n({ eventType: 'bookmark', digestKey: 'u:bookmark:v1:2026-07-02', count: 3 });
    expect(notificationText(digest)).toBe('3 people bookmarked your track today');
    expect(notificationText({ ...digest, count: 1 })).toBe('1 person bookmarked your track today');
  });

  it('falls back to a humanized event type for unknown events', () => {
    expect(notificationText(n({ eventType: 'something_new' }))).toBe('something new');
  });

  it('picks distinct emoji per class', () => {
    expect(notificationEmoji(n())).toBe('💬');
    expect(notificationEmoji(n({ digestKey: 'k' }))).toBe('🔖');
  });
});

describe('NotificationItem', () => {
  it('marks unread rows with data-unread and a dot', () => {
    const html = renderToStaticMarkup(<NotificationItem n={n({ readAt: null })} />);
    expect(html).toContain('data-unread="true"');
    expect(html).toContain('aria-label="unread"');
  });

  it('read rows carry no unread dot', () => {
    const html = renderToStaticMarkup(<NotificationItem n={n({ readAt: '2026-07-02T11:00:00Z' })} />);
    expect(html).toContain('data-unread="false"');
    expect(html).not.toContain('aria-label="unread"');
  });

  it('digest rows flag data-digest and render the count wording', () => {
    const html = renderToStaticMarkup(
      <NotificationItem n={n({ digestKey: 'k', count: 3, eventType: 'bookmark' })} />,
    );
    expect(html).toContain('data-digest="true"');
    expect(html).toContain('3 people bookmarked your track today');
  });
});

describe('NotificationList', () => {
  it('renders items + mark-all-read affordance', () => {
    const html = renderToStaticMarkup(
      <NotificationList items={[n(), n({ id: 'n2', eventType: 'mention' })]} />,
    );
    expect(html).toContain('New comment on your track');
    expect(html).toContain('You were mentioned in a comment');
    expect(html).toContain('Mark all read');
  });

  it('renders the empty state when there is nothing', () => {
    const html = renderToStaticMarkup(<NotificationList items={[]} />);
    expect(html).toContain('Nothing yet');
  });

  it('renders the More affordance only when hasMore', () => {
    expect(renderToStaticMarkup(<NotificationList items={[n()]} hasMore />)).toContain('More…');
    expect(renderToStaticMarkup(<NotificationList items={[n()]} />)).not.toContain('More…');
  });
});
