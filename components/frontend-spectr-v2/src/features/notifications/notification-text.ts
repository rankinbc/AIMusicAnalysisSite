/* Story 11.7 — pure wording/emoji for notification rows (kept out of the
 * component file so react-refresh stays component-only). */
import type { NotificationDto } from './useNotifications';

export function notificationText(n: NotificationDto): string {
  if (n.digestKey !== null) {
    // Digest rows: rolling per-day count (bookmarks today). Song-name
    // enrichment is a payload follow-on — wording stays generic until then.
    const people = n.count === 1 ? '1 person' : `${n.count} people`;
    return `${people} bookmarked your track today`;
  }
  switch (n.eventType) {
    case 'comment_created': return 'New comment on your track';
    case 'suggestion_created': return 'New rack suggestion on your track';
    case 'suggestion_accepted': return 'Your suggestion was accepted';
    case 'mention': return 'You were mentioned in a comment';
    default: return n.eventType.replaceAll('_', ' ');
  }
}

export function notificationEmoji(n: NotificationDto): string {
  if (n.digestKey !== null) return '🔖';
  switch (n.eventType) {
    case 'comment_created': return '💬';
    case 'suggestion_created': return '🎛';
    case 'suggestion_accepted': return '✅';
    case 'mention': return '@';
    default: return '•';
  }
}
