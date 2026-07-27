import { describe, expect, it } from 'vitest';

import type { CommentDto, SessionDto } from '../../../api/types';
import {
  actorLabel,
  bookmarkMarkers,
  commentMarkers,
  densityCurve,
  densityPath,
  markerPct,
  mmss,
  recapEmojiEvents,
  threadComments,
} from '../feedback-timeline-model';

const author = { type: 'user' as const, userId: 'u1', handle: 'jo', displayName: 'Jo', hue: 120 };

function cmt(over: Partial<CommentDto>): CommentDto {
  return {
    id: 'c1',
    targetVersionId: 'v1',
    parentId: null,
    t: null,
    author,
    body: 'nice drop',
    status: 'open',
    suggestionId: null,
    createdAt: '2026-07-26T00:00:00Z',
    ...over,
  };
}

describe('markers', () => {
  it('keeps only timestamped, visible, top-level comments (numeric t)', () => {
    const ms = commentMarkers([
      cmt({ id: 'a', t: 62.5 }),
      cmt({ id: 'b', t: null }),
      cmt({ id: 'c', t: 10, status: 'hidden' }),
      cmt({ id: 'd', t: 5, parentId: 'a' }),
    ]);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ t: 62.5, label: 'Jo', detail: 'nice drop' });
  });

  it('filters bookmarks to this version', () => {
    const base = {
      id: 'b1', targetShareToken: null, targetPublishedTrack: null, note: 'love this',
      identityVisible: true, title: null, artist: null, createdAt: '2026-07-26T00:00:00Z',
    };
    const ms = bookmarkMarkers(
      [
        { ...base, targetVersionId: 'v1', t: 30 },
        { ...base, id: 'b2', targetVersionId: 'v2', t: 40 },
        { ...base, id: 'b3', targetVersionId: 'v1', t: null },
      ],
      'v1',
    );
    expect(ms).toHaveLength(1);
    expect(ms[0]?.t).toBe(30);
  });
});

describe('recap emoji events', () => {
  const session = (over: Partial<SessionDto>): SessionDto => ({
    id: 's1', songVersionId: 'v1', hostId: 'u1', status: 'ended',
    startedAt: '', endedAt: '', recap: null, ...over,
  });

  it('flattens hottest moments from ended sessions only', () => {
    const events = recapEmojiEvents([
      session({
        recap: {
          hottestMoments: [{ t: 60, reactionCount: 5, topEmoji: '🔥' }],
          reactionHistogram: {}, peakConcurrency: 3, attendance: [],
        },
      }),
      session({ id: 's2', status: 'live', recap: null }),
      session({ id: 's3', recap: null }),
    ]);
    expect(events).toEqual([{ t: 60, emoji: '🔥', count: 5 }]);
  });

  it('yields nothing when no recap is reachable (emoji lane hides)', () => {
    expect(recapEmojiEvents([session({ recap: null })])).toEqual([]);
  });
});

describe('density curve + misc', () => {
  it('normalizes to 0..1 and smooths across bins', () => {
    const curve = densityCurve([{ t: 30, emoji: '🔥', count: 10 }], 120, 12);
    expect(curve).toHaveLength(12);
    expect(Math.max(...curve)).toBe(1);
    // Neighbor bins pick up smoothing spill.
    const peak = curve.indexOf(1);
    expect(curve[peak + 1]).toBeGreaterThan(0);
  });

  it('returns empty for zero duration or no events', () => {
    expect(densityCurve([], 120)).toEqual([]);
    expect(densityCurve([{ t: 1, emoji: 'x', count: 1 }], 0)).toEqual([]);
    expect(densityPath([], 100, 24)).toBe('');
  });

  it('formats and positions', () => {
    expect(mmss(65)).toBe('1:05');
    expect(markerPct(30, 120)).toBe(25);
    expect(markerPct(999, 120)).toBe(100);
    expect(actorLabel({ displayName: null, handle: null, type: 'anon' })).toBe(
      'Anonymous listener',
    );
  });
});

describe('threadComments', () => {
  it('threads replies under their parent and drops hidden', () => {
    const threads = threadComments([
      cmt({ id: 'a' }),
      cmt({ id: 'b', parentId: 'a', body: 'agreed' }),
      cmt({ id: 'c', parentId: 'a', status: 'hidden' }),
      cmt({ id: 'd', body: 'second thread' }),
    ]);
    expect(threads).toHaveLength(2);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(['b']);
  });
});
