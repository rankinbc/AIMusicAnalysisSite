# Story 11.1: Threaded Timestamped Comments Panel

Status: done

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
  - [x] 1.1 ⚠️ DEVIATION — a `CommentsPanel` already existed (mock) inline in `features/listen-rack/rail.tsx:587`, rendering `MOCK_COMMENTS`. Per house convention (all rail panels live in `rail.tsx`, reusing local `Avatar`/`PLabel`/`fmtTime`), **rewrote it in place + `export`ed it** rather than creating a new `features/listen/CommentsPanel.tsx`. Props: `{ versionId?, access, isOwner, position, onSeek }`.
  - [x] 1.2 Consumes `useComments(versionId)`; threading/ordering extracted to a pure, testable helper `features/listen/comment-tree.ts` (`buildCommentThreads`: pinned→open→resolved→hidden, then createdAt; orphan replies surface top-level). Status badges (PINNED/RESOLVED) via inline tones (matching the rail's inline-style idiom).
  - [x] 1.3 Composer wired to `usePostComment` with a "pin to current time" toggle (`@mm:ss` from `position`) + reply affordance (`parentId`).
  - [x] 1.4 Moderation (resolve/reopen, pin/unpin, hide, delete) via `usePatchCommentStatus`/`useDeleteComment`, gated by pure `canModerate(comment, meId, isOwner)` (`useMe` supplies the author id).
  - [x] 1.5 `commentsQ.isError` → "you don't have access" state; empty → "No feedback yet". No client-side permission computation.
- [x] **Task 2: Timestamp seek (AC: 2)**
  - [x] 2.1 `t != null` renders the `@mm:ss` chip calling `onSeek(t)`.
  - [x] 2.2 `onSeek` was ALREADY wired — `RightRail` passes the page's pitch-aware `seek` (`ListenRackPage.tsx:595`) to the comments tab. No new wiring needed.
- [x] **Task 3: Mount into the Listen page (AC: 1)**
  - [x] 3.1 Panel was already mounted in the rail's `'comments'` tab; added `isOwner`/`position`/`versionId` to the `RightRail` signature + render, and passed `isOwner={identity.isOwner}` from `ListenRackPage`.
- [x] **Task 4: Tests (AC: 5)**
  - [x] 4.1 `features/listen/__tests__/comment-tree.test.ts` (7 pure tests: ordering, nesting, orphan, canModerate matrix) + `features/listen-rack/__tests__/CommentsPanel.test.tsx` (4 render tests via a seeded `QueryClientProvider`: status badges + `@1:05` chip, reply nesting, owner-vs-viewer moderation, comments-closed state).
- [x] **Task 5: Gates** — tsc clean, lint clean, build ✓, vitest 572 passed (+11).

## Dev Notes

- **Server-side gating is law.** `AccessService` already resolves canComment/visibility; the panel must not gate by role locally — it renders what `useComments` returns and surfaces 403/404 as empty states (AC4).
- Reuse global utilities (`.pill`, `.btn`, `.card`, `.label`) + `tokens.css`; component-specific styles in the module. No inline styles except dynamic values.
- TS strict + `verbatimModuleSyntax`: `import type` for `CommentDto`.
- This is a prerequisite for 11.2 (suggestions render inline in threads) and 11.4 (anon variant reuses this component).

### References
- AC source: `PRPs/epics.md` Story 11.1. Reuse anchors: `useComments.ts`, `CommentDto` (`types.ts:473`), `ListenRackPage.tsx:604` (capabilities), `FeedbackEndpoints.cs` (backend).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story workflow)

### Debug Log References

- The story's premise ("CommentsPanel absent, create new file") was partly wrong:
  a mock `CommentsPanel` + a `'comments'` rail tab + a pitch-aware `seek` already
  existed (same drift pattern as 5.4). Pivoted to an in-place rewrite, which is the
  idiomatic choice (all rail panels live in `rail.tsx`).
- Render-testing a hook component needed a new pattern (none existed): a seeded
  `QueryClientProvider` (`setQueryData(['versions','v1','comments'], …)` + `['auth','me']`)
  rendered via `renderToStaticMarkup`. Pure thread/moderation logic was extracted to
  `comment-tree.ts` and tested directly to keep most coverage provider-free.

### Completion Notes List

- AC1 threaded list (pinned→open→resolved→hidden, nested replies, status badges) ✓
- AC2 timestamp chip → existing pitch-aware `seek` ✓ (already wired through `RightRail`)
- AC3 owner/author moderation via pure `canModerate` + `useMe` ✓
- AC4 server-side gating only; `isError` → not-permitted, `!canComment` → closed ✓
- AC5 11 new tests (7 pure + 4 render) ✓
- `MOCK_COMMENTS` left intact in `access.ts` (still used by `access.test.ts`); only the
  rail panel stopped consuming it.

### File List

- `components/frontend-spectr-v2/src/features/listen/comment-tree.ts` (A)
- `components/frontend-spectr-v2/src/features/listen/__tests__/comment-tree.test.ts` (A)
- `components/frontend-spectr-v2/src/features/listen-rack/rail.tsx` (M — real CommentsPanel + RightRail `isOwner` prop)
- `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx` (M — pass `isOwner={identity.isOwner}`)
- `components/frontend-spectr-v2/src/features/listen-rack/__tests__/CommentsPanel.test.tsx` (A)

### Change Log

- 2026-06-27 — Story 11.1 implemented: rail CommentsPanel rewired from MOCK_COMMENTS to
  real PRP-3 `useComments` (threaded, timestamped, owner/author-moderated) + pure
  comment-tree helper. Gates green. Status → review.

## Review Findings (code review 2026-06-28, 3 adversarial layers)

- [x] [Review][Patch] Enter-key submit bypasses the in-flight guard → duplicate comment POST [rail.tsx:679] — FIXED: `submit()` now early-returns on `postMut.isPending`.
- [x] [Review][Patch] No loading state — initial fetch renders "No feedback yet." instead of a loader [rail.tsx:662] — FIXED: added a `commentsQ.isLoading` branch before the empty/error checks.
- [x] [Review][Defer] No explicit test that the timestamp chip click invokes `onSeek` [CommentsPanel.test.tsx] — deferred; panel tests are SSR (`renderToStaticMarkup`, no `@testing-library`), so click-invocation isn't in the established pattern; the chip→`onSeek` pass-through is verified structurally.
- [x] [Review][Defer] Mutation failures show no error feedback (server-rejected moderation, reply to a since-deleted parent) [rail.tsx] — deferred; a general "mutation error toast" is out of this story's scope.
- [x] [Review][Defer] `position` not guarded for NaN/negative when pinning to time [rail.tsx:~648] — deferred; `position` comes from the audio element (finite ≥0); cheap defensive guard for later.
- [x] [Review][Defer] `MOCK_COMMENTS` keeps an extra `deletedAt` field vs the API `CommentDto` [access.ts] — deferred, pre-existing (not caused by this change).

Dismissed (3): Auditor "AC4 test would fail" — **false positive** (the empty-list message and the composer "Comments are closed" gate render in separate sections; the test's `toContain('Comments are closed')` passes, consistent with the 572-green run); moderation toggle idempotent re-POST (harmless); "nesting test only checks text" (nesting is structurally asserted in `comment-tree.test.ts`).
