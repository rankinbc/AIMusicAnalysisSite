/* Story 11.10 — feed wording helpers, split from the components so
 * react-refresh stays component-only (notification-text.ts precedent). */
import type { FeedItemDto } from './useFeed';

export function feedItemText(item: FeedItemDto): string {
  const who = item.displayName ?? `@${item.handle}`;
  const track = `${item.songName} v${item.versionNumber}`;
  return item.kind === 'recap'
    ? `${who} published a room recap on ${track}`
    : `${who} shared ${track}`;
}

export function feedItemGlyph(item: FeedItemDto): string {
  return item.kind === 'recap' ? '📻' : '🎵';
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString();
}
