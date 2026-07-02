import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CommentDto, GatesDto } from '../../../api/types';
import { AnonCommentList, AnonGatePills } from '../AnonReviewerSurface';

// Story 11.4 (AC5) — the anon gating matrix + comment rendering, static.

function gates(over: Partial<GatesDto> = {}): GatesDto {
  return { canComment: false, canSuggest: false, canBookmark: false, ...over };
}

describe('AnonGatePills (story 11.4 gating matrix)', () => {
  it.each([
    [gates({ canComment: true }), ['comments open'], ['suggestions open', 'bookmarks open']],
    [gates({ canSuggest: true }), ['suggestions open'], ['comments open', 'bookmarks open']],
    [gates({ canBookmark: true }), ['bookmarks open'], ['comments open', 'suggestions open']],
    [gates({ canComment: true, canSuggest: true, canBookmark: true }),
      ['comments open', 'suggestions open', 'bookmarks open'], ['listen only']],
    [gates(), ['listen only'], ['comments open', 'suggestions open', 'bookmarks open']],
  ])('renders exactly the granted gates (%#)', (g, present, absent) => {
    const html = renderToStaticMarkup(<AnonGatePills gates={g} />);
    for (const p of present) expect(html).toContain(p);
    for (const a of absent) expect(html).not.toContain(a);
  });
});

function comment(over: Partial<CommentDto> = {}): CommentDto {
  return {
    id: 'c1',
    targetVersionId: 'v1',
    parentId: null,
    t: 64,
    author: { type: 'anon', userId: null, handle: null, displayName: 'anon-river', hue: 195 },
    body: 'sub feels hot',
    status: 'open',
    suggestionId: null,
    createdAt: '2026-07-02T10:00:00Z',
    ...over,
  };
}

describe('AnonCommentList', () => {
  it('renders threaded rows with timestamp anchors and status badges', () => {
    const html = renderToStaticMarkup(
      <AnonCommentList
        comments={[
          comment(),
          comment({ id: 'c2', parentId: 'c1', t: null, body: 'agreed', status: 'pinned',
            author: { type: 'user', userId: 'u1', handle: 'vela', displayName: null, hue: 220 } }),
        ]}
      />,
    );
    expect(html).toContain('@1:04'); // timestamp anchor
    expect(html).toContain('anon-river');
    expect(html).toContain('sub feels hot');
    expect(html).toContain('data-depth="1"'); // reply nests
    expect(html).toContain('vela');
    expect(html).toContain('pinned'); // status badge
  });

  it('renders the empty state', () => {
    expect(renderToStaticMarkup(<AnonCommentList comments={[]} />)).toContain('No comments yet');
  });
});
