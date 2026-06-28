# Story 11.1: Threaded Timestamped Comments Panel

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a producer reviewing a track,
I want to read and leave comments pinned to specific moments,
So that feedback points to the exact spot in the mix it's about.

## Acceptance Criteria

1. **Given** a version I can view, **When** I open the Comments panel, **Then** threaded comments render ordered with status (open/resolved/pinned/hidden) and timestamp anchors, consuming the existing `useComments` hooks (no new backend).
2. **Given** I click a timestamped comment, **Then** the player seeks to that timestamp.
3. **Given** I am the author or owner, **When** I patch a comment's status (resolve/pin/hide), **Then** the list reflects it after query invalidation.
4. **Given** a server 403/404, **Then** the panel renders a "not permitted" empty state — gating is server-side via `AccessService`; never re-implemented client-side.
5. **Given** the panel renders, **Then** a vitest static-render test covers the threaded list + status badges.

## Context — what already exists (reuse, do not rebuild)

The BFF backend is complete (`FeedbackEndpoints.cs` + `TrackComment.cs`: threaded via `parent_id`, `timestamp_seconds`, status open/resolved/pinned/hidden, anon-capable). The frontend **hooks already exist and are unused** — this story is pure UI wiring.

- Hooks: `src/features/listen/useComments.ts` — `useComments(versionId)` (13), `usePostComment(versionId)` (21), `usePatchCommentStatus(versionId)` (30), `useDeleteComment(versionId)` (39). (Anon variants `useAnonComments`/`usePostAnonComment` are for Story 11.4 — ignore here.)
- Type: `CommentDto` in `src/api/types.ts:473`.

## Tasks / Subtasks

- [ ] **Task 1: CommentsPanel component (AC: 1, 3, 4)**
  - [ ] 1.1 Create `src/features/listen/CommentsPanel.tsx` (+ `CommentsPanel.module.css`). Props: `{ versionId: string; isOwner: boolean; onSeek: (seconds: number) => void }`.
  - [ ] 1.2 Consume `useComments(versionId)`; build the parent/child tree from the flat `CommentDto[]` (group by `parent_id`). Order: pinned first, then open, then resolved/hidden; within a group, by `created_at`. Render status badges (reuse the global `.pill[.tone]` utility).
  - [ ] 1.3 Composer: a textarea + "post" wired to `usePostComment`; optional "pin to current time" using the playhead seconds (passed in via prop or read from the page's transport). Reply affordance sets `parent_id`.
  - [ ] 1.4 Moderation controls (resolve/pin/hide) via `usePatchCommentStatus`, shown only when `isOwner` or the viewer is the comment author. Delete via `useDeleteComment` (author/owner only).
  - [ ] 1.5 Error/empty states: on the query's 403/404 render a "You don't have access to comments here" card; on empty render the designed empty state. Do NOT compute permission client-side — render whatever the server returns.
- [ ] **Task 2: Timestamp seek (AC: 2)**
  - [ ] 2.1 A comment with `timestamp_seconds != null` renders a clickable time chip (`mm:ss`) that calls `onSeek(timestamp_seconds)`.
  - [ ] 2.2 In the mount point (Task 3) wire `onSeek` to the existing player transport seek.
- [ ] **Task 3: Mount into the Listen page (AC: 1)**
  - [ ] 3.1 Mount `CommentsPanel` in the Listen rack right-rail (`src/features/listen-rack/ListenRackPage.tsx` — it already owns the tabbed right rail and the audio transport for `onSeek`). Pass `versionId`, owner-ness (derive from `identity`/`access` already in the page — `resolveCapabilities` at `ListenRackPage.tsx:604`), and the seek callback.
- [ ] **Task 4: Tests (AC: 5)**
  - [ ] 4.1 `src/features/listen/__tests__/CommentsPanel.test.tsx` — `renderToStaticMarkup` with a fixture `CommentDto[]` (mixed statuses + a threaded reply + a timestamped comment): asserts thread nesting, status badges, and the time chip render. Mock the hooks (the existing `useBookmarks.test.ts`/`useRoomStream.test.ts` show the test style).
- [ ] **Task 5: Gates** — `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`.

## Dev Notes

- **Server-side gating is law.** `AccessService` already resolves canComment/visibility; the panel must not gate by role locally — it renders what `useComments` returns and surfaces 403/404 as empty states (AC4).
- Reuse global utilities (`.pill`, `.btn`, `.card`, `.label`) + `tokens.css`; component-specific styles in the module. No inline styles except dynamic values.
- TS strict + `verbatimModuleSyntax`: `import type` for `CommentDto`.
- This is a prerequisite for 11.2 (suggestions render inline in threads) and 11.4 (anon variant reuses this component).

### References
- AC source: `PRPs/epics.md` Story 11.1. Reuse anchors: `useComments.ts`, `CommentDto` (`types.ts:473`), `ListenRackPage.tsx:604` (capabilities), `FeedbackEndpoints.cs` (backend).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
