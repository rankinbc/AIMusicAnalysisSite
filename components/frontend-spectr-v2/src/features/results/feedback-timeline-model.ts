// Pure helpers for the Notes/Feedback tab timeline (v4). Numeric seconds only —
// never parse "m:ss" strings (the wire carries numbers; prototype anti-pattern).

import type { BookmarkDto, CommentDto, NoteDto, SessionDto } from '../../api/types';

export interface TimelineMarker {
  t: number;
  label: string;
  detail: string;
}

export interface EmojiEvent {
  t: number;
  emoji: string;
  count: number;
}

export function mmss(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function actorLabel(a: {
  displayName: string | null;
  handle: string | null;
  type: string;
}): string {
  return a.displayName || a.handle || (a.type === 'anon' ? 'Anonymous listener' : 'Listener');
}

/** Timestamped, visible, top-level comments → timeline markers. */
export function commentMarkers(comments: CommentDto[]): TimelineMarker[] {
  return comments
    .filter((c) => c.t != null && c.status !== 'hidden' && c.parentId == null)
    .map((c) => ({
      t: c.t as number,
      label: actorLabel(c.author),
      detail: c.body,
    }))
    .sort((a, b) => a.t - b.t);
}

/** The owner's bookmarks on this version → timeline markers. */
export function bookmarkMarkers(bookmarks: BookmarkDto[], versionId: string): TimelineMarker[] {
  return bookmarks
    .filter((b) => b.targetVersionId === versionId && b.t != null)
    .map((b) => ({ t: b.t as number, label: 'Bookmark', detail: b.note ?? '' }))
    .sort((a, b) => a.t - b.t);
}

/** Timestamped owner notes → timeline markers. */
export function noteMarkers(notes: NoteDto[]): TimelineMarker[] {
  return notes
    .filter((n) => n.tSeconds > 0)
    .map((n) => ({ t: n.tSeconds, label: 'Note', detail: n.text }))
    .sort((a, b) => a.t - b.t);
}

/** Emoji events from ENDED sessions' recaps (hottest moments). Empty when no
 *  session recap is reachable — the emoji lane hides entirely (stub policy:
 *  no per-version recap endpoint gets added for this). */
export function recapEmojiEvents(sessions: SessionDto[]): EmojiEvent[] {
  return sessions
    .filter((s) => s.status === 'ended' && s.recap != null)
    .flatMap((s) =>
      s.recap!.hottestMoments.map((m) => ({
        t: m.t,
        emoji: m.topEmoji,
        count: m.reactionCount,
      })),
    )
    .sort((a, b) => a.t - b.t);
}

/** Binned, moving-average-smoothed reaction density (0..1 per bin). */
export function densityCurve(events: EmojiEvent[], durationSec: number, bins = 48): number[] {
  if (durationSec <= 0 || events.length === 0) return [];
  const raw = new Array<number>(bins).fill(0);
  for (const e of events) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((e.t / durationSec) * bins)));
    raw[i] = (raw[i] ?? 0) + Math.max(1, e.count);
  }
  // 3-tap moving average.
  const smooth = raw.map((_, i) => {
    const a = raw[i - 1] ?? 0;
    const b = raw[i] ?? 0;
    const c = raw[i + 1] ?? 0;
    return (a + b + c) / 3;
  });
  const max = Math.max(...smooth);
  return max <= 0 ? smooth : smooth.map((v) => v / max);
}

/** SVG path (area outline) for the density curve in a w×h box. */
export function densityPath(values: number[], w: number, h: number): string {
  if (values.length === 0) return '';
  const step = w / (values.length - 1 || 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - v * h).toFixed(1)}`);
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`;
}

/** 0..100 left-position percentage for a marker. */
export function markerPct(t: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.max(0, Math.min(100, (t / durationSec) * 100));
}

/** Threaded view: top-level visible comments with their visible replies. */
export function threadComments(
  comments: CommentDto[],
): { top: CommentDto; replies: CommentDto[] }[] {
  const visible = comments.filter((c) => c.status !== 'hidden');
  const byParent = new Map<string, CommentDto[]>();
  for (const c of visible) {
    if (!c.parentId) continue;
    const arr = byParent.get(c.parentId) ?? [];
    arr.push(c);
    byParent.set(c.parentId, arr);
  }
  return visible
    .filter((c) => c.parentId == null)
    .map((top) => ({ top, replies: byParent.get(top.id) ?? [] }));
}
