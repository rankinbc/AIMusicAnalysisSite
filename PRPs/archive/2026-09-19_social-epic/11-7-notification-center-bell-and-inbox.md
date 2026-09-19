# Story 11.7: Notification Center — Bell & Inbox

Status: review

## Story

As a user,
I want a bell with unread count and an inbox,
So that I can see and act on what happened while I was away.

## Acceptance Criteria

1. **Given** unread notifications, **Then** the bell in the app shell shows a live unread count (TanStack Query `refetchInterval` poll; SSE deferred).
2. **Given** I open the bell, **Then** I see a paged list; per-event items render individually, bookmarks render as a digest ("3 people bookmarked Aurora v3 today").
3. **Given** I click a notification, **Then** it deep-links to the version/comment/room and marks read.
4. **Given** mark-all-read, **Then** the unread count resets.
5. **Given** the center renders, **Then** a static-render test covers per-event vs digest rendering and the unread badge.

## Dev Agent Record

### Agent Model Used

claude-fable-5 (2026-07-02)

### Completion Notes List

- **AC1** — `useUnreadCount` polls `/me/notifications/unread-count` every 30 s (staleTime 25 s); badge caps at "99+"; aria-label carries the count.
- **AC2** — `useNotifications(page)` pages the 11.6 contract (`{items, page, limit, hasMore}`); inbox list fetches only while open. Digest rows (`digestKey != null`) render count wording via `notification-text.ts` ("N people bookmarked your track today" — song-NAME enrichment needs payload enrichment server-side; noted as a follow-on, wording stays generic until then). Per-event rows render individually with type-specific text/emoji.
- **AC3** — clicking a row marks it read (`useMarkRead`) and deep-links to `/listen-rack/$versionId` from `payload.versionId` (comments/suggestions/bookmarks all land on the version surface; comment-anchor deep-linking is part of the 11.11 discovery polish).
- **AC4** — "Mark all read" → `POST /me/notifications/read-all`, invalidates both list + unread queries.
- **AC5** — `notification-center.test.tsx`: 10 static-render tests (per-event wording ×4, digest singular/plural, unknown-event fallback, unread dot/data-unread, data-digest, list/empty/More states).
- App shell: the decorative bell placeholder in `_app.tsx` replaced by `<NotificationBell className={s.navIconBtn}/>`; dropdown panel z-index sits above the topnav; wording helpers split into `notification-text.ts` (react-refresh component-only rule).

### File List

- `src/features/notifications/useNotifications.ts` (new)
- `src/features/notifications/notification-text.ts` (new)
- `src/features/notifications/NotificationCenter.tsx` (new — NotificationBell container + pure NotificationList/Item)
- `src/features/notifications/notifications.module.css` (new)
- `src/features/notifications/__tests__/notification-center.test.tsx` (new, 10 tests)
- `src/routes/_app.tsx` (bell swap)

### Change Log

- 2026-07-02: implemented; gates green (vite build, tsc -b, eslint 0 warnings, lint:css, vitest 621/621). Status → review.
