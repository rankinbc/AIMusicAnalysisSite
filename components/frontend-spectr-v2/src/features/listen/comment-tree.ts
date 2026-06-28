// SPECTR · Listen V3 (PRP-3 / story 11.1) — pure helpers for the comments panel.
// Kept separate from the rail component so the threading/ordering/moderation
// rules are unit-testable without a render or a QueryClient.
import type { CommentDto } from '../../api/types';

export interface CommentThread {
  comment: CommentDto;
  replies: CommentDto[];
}

// Pinned float to the top, then open, then resolved, then hidden.
const STATUS_ORDER: Record<CommentDto['status'], number> = {
  pinned: 0,
  open: 1,
  resolved: 2,
  hidden: 3,
};

/**
 * Group a flat comment list into top-level threads with one level of replies.
 * Top-level order: status (pinned→open→resolved→hidden) then `createdAt` asc.
 * Replies order: `createdAt` asc. A reply whose parent is absent from the list
 * surfaces as its own top-level entry (never dropped).
 */
export function buildCommentThreads(comments: CommentDto[]): CommentThread[] {
  const ids = new Set(comments.map((c) => c.id));
  const repliesByParent = new Map<string, CommentDto[]>();
  const tops: CommentDto[] = [];

  for (const c of comments) {
    if (c.parentId && ids.has(c.parentId)) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    } else {
      tops.push(c);
    }
  }

  const byCreated = (a: CommentDto, b: CommentDto) => a.createdAt.localeCompare(b.createdAt);
  tops.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byCreated(a, b));

  return tops.map((comment) => ({
    comment,
    replies: (repliesByParent.get(comment.id) ?? []).slice().sort(byCreated),
  }));
}

/**
 * AC3 — a viewer may moderate (resolve/pin/hide/delete) a comment when they own
 * the version OR authored the comment. Anon authors (no `userId`) can only be
 * moderated by the owner.
 */
export function canModerate(
  comment: CommentDto,
  meUserId: string | null,
  isOwner: boolean,
): boolean {
  return isOwner || (!!meUserId && comment.author.userId === meUserId);
}
