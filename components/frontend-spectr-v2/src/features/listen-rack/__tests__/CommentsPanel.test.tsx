import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AuthedUser, CommentDto } from '../../../api/types';
import { MOCK_ACCESS, type AccessDto } from '../access';
import { CommentsPanel } from '../rail';

const ME: AuthedUser = { id: 'u-me', email: 'm@e', handle: 'me', displayName: null, tier: 'free' };

function comment(over: Partial<CommentDto>): CommentDto {
  return {
    id: 'c1',
    targetVersionId: 'v1',
    parentId: null,
    t: null,
    author: { type: 'user', userId: 'u-other', handle: 'kojo', displayName: null, hue: 200 },
    body: 'tighten the low end',
    status: 'open',
    suggestionId: null,
    createdAt: '2026-06-27T00:00:00Z',
    ...over,
  };
}

function render(comments: CommentDto[], me: AuthedUser | null, isOwner: boolean, access: AccessDto = MOCK_ACCESS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['versions', 'v1', 'comments'], comments);
  if (me) qc.setQueryData(['auth', 'me'], me);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CommentsPanel versionId="v1" access={access} isOwner={isOwner} position={42} onSeek={() => {}} />
    </QueryClientProvider>,
  );
}

describe('CommentsPanel (story 11.1)', () => {
  it('renders real comments from the query with status badges + a timestamp chip', () => {
    const html = render(
      [
        comment({ id: 'a', body: 'tighten the low end', status: 'pinned', t: 65 }),
        comment({ id: 'b', body: 'nice drop', status: 'resolved' }),
      ],
      ME,
      false,
    );
    expect(html).toContain('tighten the low end');
    expect(html).toContain('nice drop');
    expect(html).toContain('PINNED');
    expect(html).toContain('RESOLVED');
    expect(html).toContain('@1:05'); // timestamp chip for t=65s
  });

  it('nests a reply under its parent', () => {
    const html = render(
      [comment({ id: 'p', body: 'parent note' }), comment({ id: 'r', parentId: 'p', body: 'a reply' })],
      ME,
      false,
    );
    expect(html).toContain('parent note');
    expect(html).toContain('a reply');
  });

  it('shows moderation controls to the owner, hides them from a non-owner', () => {
    const asOwner = render([comment({ id: 'a' })], ME, true);
    expect(asOwner).toContain('resolve');
    expect(asOwner).toContain('delete');

    const asViewer = render([comment({ id: 'a' })], ME, false); // author is u-other, viewer is u-me
    expect(asViewer).not.toContain('delete');
  });

  it('renders the not-permitted state when comments are closed', () => {
    const closed: AccessDto = { ...MOCK_ACCESS, gates: { ...MOCK_ACCESS.gates, canComment: false } };
    const html = render([], ME, false, closed);
    expect(html).toContain('Comments are closed');
  });

  // Story 11.11 AC2/AC4 — author avatars deep-link to public profiles.
  it('links authed authors to /u/{handle} and leaves anon authors unlinked', () => {
    const html = render(
      [
        comment({ id: 'a' }), // user author, handle kojo
        comment({ id: 'b', author: { type: 'anon', userId: null, handle: null, displayName: 'ghost', hue: 20 } }),
      ],
      ME,
      false,
    );
    expect(html).toContain('href="/u/kojo"');
    expect(html).toContain('ghost');
    expect(html).not.toContain('href="/u/ghost"');
  });
});
