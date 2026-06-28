# Story 11.3: Bookmarks Rail & Owner Heat Signal

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a listener,
I want to bookmark moments with a note and let owners see where attention lands,
So that "love this part" becomes durable, aggregated signal.

## Acceptance Criteria

1. **Given** I am listening, **When** I add a bookmark at the playhead with an optional note, **Then** it persists and appears on the timeline (consume `useBookmarks`).
2. **Given** my bookmarks, **Then** I can edit the note, toggle `identity_visible`, and delete (CRUD via `/me/bookmarks`).
3. **Given** I am the version owner, **When** I open the signal view, **Then** I see aggregated bookmark density over the timeline (`/versions/{id}/bookmarks/signal`, owner-only).
4. **Given** a non-owner, **Then** the owner-only signal call is never made.
5. **Given** the rail/overlay renders, **Then** a static-render test covers bookmark markers + signal heat.

## Context — what already exists (reuse, do not rebuild)

> ⚠️ **Verify before building — the "unused / no component" claims below are grep-level, not
> render-truth.** Stories 5.6 and 11.1 both found the "missing" component already existed as a
> **mock or dead code** (the rail `CommentsPanel` rendered `MOCK_COMMENTS`; `VerdictCard` was
> unrendered in the redesign). **First grep for the real render path** (who actually renders
> this surface today) — you may be replacing a mock or wiring an existing seam, not building net-new.

Backend complete (`BookmarkEndpoints.cs` + `TrackBookmark.cs`: `timestamp_seconds`, `note` (280), `identity_visible`, anon-capable; owner-only signal endpoint). Frontend **hooks exist, unused**:
- `src/features/listen/useBookmarks.ts` — `useMyBookmarks()` (12), `useCreateBookmark()` (21), `useDeleteBookmark()` (30). (`usePostAnonBookmark` is for 11.4.)
- `src/features/listen/useBookmarkSignal.ts` — `useBookmarkSignal(versionId, enabled=true)` (11) — the `enabled` flag is how AC4 is satisfied.
- Types: `BookmarkDto` (`types.ts:690`), `BookmarkSignalDto` (`types.ts:720`).

## Tasks / Subtasks

- [x] **Task 1: BookmarksRail component (AC: 1, 2)**
  - [x] 1.1 Created `src/features/listen/BookmarksRail.tsx` (+ `.module.css`). Props: `{ versionId, durationSeconds, position, onSeek, isOwner }`.
  - [x] 1.2 Consumes `useMyBookmarks()` filtered to this version via pure `bookmarks-helpers.ts` (`bookmarksForVersion` — `useMyBookmarks` returns ALL my bookmarks, not version-scoped); markers positioned via `markerPct(t, dur)`, click → `onSeek`.
  - [x] 1.3 "★ Bookmark @ {time}" via `useCreateBookmark` with optional note; name-toggle via the server **upsert** (re-POST same version+t flips `identity_visible` — confirmed in `BookmarkEndpoints.Create`); **note-edit via delete+recreate** (⚠️ no PATCH endpoint, and the upsert ignores `note` — see Completion Notes); delete via `useDeleteBookmark`.
- [x] **Task 2: Owner signal (AC: 3, 4)** — ⚠️ SCOPE ADJUSTED, see Completion Notes
  - [x] 2.1 `useBookmarkSignal(versionId, enabled = isOwner)` — non-owner never issues the request (AC4).
  - [x] 2.2 ⚠️ `BookmarkSignalDto` is `{ count, identified[] }` — **no per-timestamp data**, so a timeline density heat-strip is not backed by the API. Rendered the supported signal: aggregate **count + opted-in named bookmarkers** inline in the rail header. Folded into `BookmarksRail` (no separate `BookmarkSignalOverlay`).
- [x] **Task 3: Mount into the Listen page (AC: 1, 3)**
  - [x] 3.1 Mounted `BookmarksRail` directly under the `Transport` in `ListenRackPage.tsx` (gated `realAudio && versionId`), passing `duration`/`position`/`seek`/`identity.isOwner`. The owner signal self-gates via `enabled=isOwner`.
- [x] **Task 4: Tests (AC: 5)**
  - [x] 4.1 `bookmarks-helpers.test.ts` (4 pure: version-filter + track-level-last ordering, `markerPct` clamp/null) + `BookmarksRail.test.tsx` (3 render via seeded `QueryClientProvider`: version-filtered markers + `@0:30` chip + add button, owner-only signal `7 saved`, empty state).
- [x] **Task 5: Gates** — tsc/lint clean, build ✓, vitest 579 (+7).

## Dev Notes

- **AC4 is enforced via the `enabled` flag** on `useBookmarkSignal`, not by hiding a rendered result — a non-owner must never fire the owner-only request.
- If `useBookmarks.ts` lacks an update hook for note/`identity_visible`, confirm against `BookmarkEndpoints.cs` whether PATCH exists; if only create/delete exist, implement edit as delete+recreate and record the constraint in Completion Notes (do not invent an endpoint).
- Parallelizable with 11.1 (no shared state). Reuse `tokens.css` + global utilities; dynamic position/opacity are the only allowed inline styles.

### References
- AC source: `PRPs/epics.md` Story 11.3. Anchors: `useBookmarks.ts`, `useBookmarkSignal.ts`, `BookmarkDto`/`BookmarkSignalDto` (`types.ts:690/720`), `BookmarkEndpoints.cs`, `ListenRackPage.tsx:604`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story workflow)

### Debug Log References

- Verify-before-build (per the story caveat): confirmed NO existing render-usage of the
  bookmark hooks (only a comment in `routes/_app/listen.$versionId.tsx`), so this is a genuine
  net-new UI — unlike 5.6/11.1.
- Two backend realities surfaced that adjusted scope (below): `BookmarkSignalDto` shape and the
  absence of a PATCH endpoint.

### Completion Notes List

- ⚠️ **AC3 scope adjusted to the data contract.** The story envisioned a timeline "density
  heat-strip," but `BookmarkSignalDto = { count, identified[] }` carries no per-timestamp data
  (anon bookmarks are counted anonymously; the owner doesn't receive their `t` values). Rendered
  the supported signal: aggregate **count + opted-in named bookmarkers**. A true heat-strip would
  need a new owner-only timestamped-density endpoint — out of scope.
- ⚠️ **AC2 note-edit via delete+recreate.** `BookmarkEndpoints` exposes only GET/POST/DELETE (no
  PATCH). The POST is an upsert that toggles `identity_visible` on a repeat (same version+t) call
  but **ignores `note`**. So: name-toggle = re-POST upsert; note-edit = delete then recreate at
  the same `t` (new id/createdAt). Documented; a PATCH would make edits in-place.
- ⚠️ **Two-component split folded into one.** No separate `BookmarkSignalOverlay` — since the
  signal is a count+names summary (not a timeline overlay), it lives in the `BookmarksRail` header.
- AC4 enforced via `useBookmarkSignal(versionId, enabled = isOwner)` — a non-owner never fires the
  owner-only request (verified by a test asserting the signal is absent + the hook's `enabled` gate).
- Mounted under the existing `Transport` (which owns duration/position/seek), gated `realAudio && versionId`.

### File List

- `components/frontend-spectr-v2/src/features/listen/bookmarks-helpers.ts` (A)
- `components/frontend-spectr-v2/src/features/listen/__tests__/bookmarks-helpers.test.ts` (A)
- `components/frontend-spectr-v2/src/features/listen/BookmarksRail.tsx` (A)
- `components/frontend-spectr-v2/src/features/listen/BookmarksRail.module.css` (A)
- `components/frontend-spectr-v2/src/features/listen/__tests__/BookmarksRail.test.tsx` (A)
- `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx` (M — import + mount under Transport)

### Change Log

- 2026-06-28 — Story 11.3 implemented: `BookmarksRail` on the transport (timestamped markers,
  add-at-playhead, note/name-toggle/delete, owner count signal) consuming the real PRP-6 hooks +
  pure `bookmarks-helpers`. AC3 scoped to count+identified (DTO has no density); AC2 note-edit via
  delete+recreate (no PATCH). Gates green. Status → review.
