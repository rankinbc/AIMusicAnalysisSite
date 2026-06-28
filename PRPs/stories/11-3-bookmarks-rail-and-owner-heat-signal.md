# Story 11.3: Bookmarks Rail & Owner Heat Signal

Status: ready-for-dev

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

- [ ] **Task 1: BookmarksRail component (AC: 1, 2)**
  - [ ] 1.1 Create `src/features/listen/BookmarksRail.tsx` (+ module css). Props: `{ versionId: string; durationSeconds: number; currentTime: number; onSeek: (s: number) => void }`.
  - [ ] 1.2 Consume `useMyBookmarks()`; render each as a marker positioned at `timestamp_seconds / durationSeconds` along the timeline, click → `onSeek`.
  - [ ] 1.3 "Add bookmark" at the playhead via `useCreateBookmark` with optional note (small inline popover); edit note + toggle `identity_visible` (PATCH or delete+recreate per the hook surface — check `useBookmarks.ts` for an update hook; if absent, scope edit to note via the create/delete pair and note the limitation); delete via `useDeleteBookmark`.
- [ ] **Task 2: Owner heat-signal overlay (AC: 3, 4)**
  - [ ] 2.1 Create `src/features/listen/BookmarkSignalOverlay.tsx`. Consume `useBookmarkSignal(versionId, enabled = isOwner)` — **pass `enabled=false` for non-owners so the owner-only request is never issued** (AC4).
  - [ ] 2.2 Render `BookmarkSignalDto` as a density heat strip over the timeline (aggregate counts → opacity/height per bucket). Show identified bookmarkers (those with `identity_visible=true`) in a small list.
- [ ] **Task 3: Mount into the Listen page (AC: 1, 3)**
  - [ ] 3.1 Mount `BookmarksRail` on the transport in `ListenRackPage.tsx` (it owns the audio element/duration/currentTime and `onSeek`). Mount `BookmarkSignalOverlay` only when the viewer is the owner (derive from capabilities at `ListenRackPage.tsx:604`).
- [ ] **Task 4: Tests (AC: 5)**
  - [ ] 4.1 `__tests__/BookmarksRail.test.tsx` — markers positioned from a fixture `BookmarkDto[]`; `__tests__/BookmarkSignalOverlay.test.tsx` — heat strip from a `BookmarkSignalDto` fixture + asserts the signal hook is called with `enabled=false` for a non-owner. Match the `useBookmarks.test.ts` style.
- [ ] **Task 5: Gates** — `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`.

## Dev Notes

- **AC4 is enforced via the `enabled` flag** on `useBookmarkSignal`, not by hiding a rendered result — a non-owner must never fire the owner-only request.
- If `useBookmarks.ts` lacks an update hook for note/`identity_visible`, confirm against `BookmarkEndpoints.cs` whether PATCH exists; if only create/delete exist, implement edit as delete+recreate and record the constraint in Completion Notes (do not invent an endpoint).
- Parallelizable with 11.1 (no shared state). Reuse `tokens.css` + global utilities; dynamic position/opacity are the only allowed inline styles.

### References
- AC source: `PRPs/epics.md` Story 11.3. Anchors: `useBookmarks.ts`, `useBookmarkSignal.ts`, `BookmarkDto`/`BookmarkSignalDto` (`types.ts:690/720`), `BookmarkEndpoints.cs`, `ListenRackPage.tsx:604`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
