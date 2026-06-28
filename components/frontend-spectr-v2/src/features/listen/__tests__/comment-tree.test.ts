import { describe, expect, it } from 'vitest';

import type { CommentDto } from '../../../api/types';
import { buildCommentThreads, canModerate } from '../comment-tree';

function c(over: Partial<CommentDto>): CommentDto {
  return {
    id: 'c1',
    targetVersionId: 'v1',
    parentId: null,
    t: null,
    author: { type: 'user', userId: 'u1', handle: 'kojo', displayName: null, hue: 200 },
    body: 'nice',
    status: 'open',
    suggestionId: null,
    createdAt: '2026-06-27T00:00:00Z',
    ...over,
  };
}

describe('buildCommentThreads', () => {
  it('orders top-level by status (pinned→open→resolved→hidden) then createdAt', () => {
    const threads = buildCommentThreads([
      c({ id: 'a', status: 'resolved', createdAt: '2026-06-27T00:00:01Z' }),
      c({ id: 'b', status: 'pinned', createdAt: '2026-06-27T00:00:02Z' }),
      c({ id: 'd', status: 'open', createdAt: '2026-06-27T00:00:03Z' }),
      c({ id: 'e', status: 'hidden', createdAt: '2026-06-27T00:00:00Z' }),
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(['b', 'd', 'a', 'e']);
  });

  it('nests replies under their parent, ordered by createdAt', () => {
    const threads = buildCommentThreads([
      c({ id: 'p', status: 'open' }),
      c({ id: 'r2', parentId: 'p', createdAt: '2026-06-27T00:00:05Z' }),
      c({ id: 'r1', parentId: 'p', createdAt: '2026-06-27T00:00:04Z' }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('surfaces an orphan reply (missing parent) as top-level, never dropping it', () => {
    const threads = buildCommentThreads([c({ id: 'orphan', parentId: 'gone' })]);
    expect(threads.map((t) => t.comment.id)).toEqual(['orphan']);
  });
});

describe('canModerate', () => {
  const mine = c({ author: { type: 'user', userId: 'me', handle: 'me', displayName: null, hue: 1 } });
  const theirs = c({ author: { type: 'user', userId: 'other', handle: 'o', displayName: null, hue: 1 } });
  const anon = c({ author: { type: 'anon', userId: null, handle: null, displayName: 'ghost', hue: 1 } });

  it('owner may moderate anything', () => {
    expect(canModerate(theirs, 'me', true)).toBe(true);
    expect(canModerate(anon, 'me', true)).toBe(true);
  });
  it('author may moderate their own comment', () => {
    expect(canModerate(mine, 'me', false)).toBe(true);
  });
  it('a non-owner cannot moderate someone else’s or an anon comment', () => {
    expect(canModerate(theirs, 'me', false)).toBe(false);
    expect(canModerate(anon, 'me', false)).toBe(false);
  });
  it('a signed-out viewer (no id) cannot moderate', () => {
    expect(canModerate(mine, null, false)).toBe(false);
  });
});
