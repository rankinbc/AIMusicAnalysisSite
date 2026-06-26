name: "Listen V3 · Bookmark UI — surface the shipped bookmarking backend on the Listen page"
description: |
  Frontend-only slice. The bookmarking BACKEND already shipped (entity + migration + authed/anon/owner-signal
  endpoints + DTOs) and the React hooks exist (`useBookmarks.ts`, `useBookmarkSignal.ts`) but are NOT consumed by
  any component — `canBookmark` is defined and never read. This PRP builds the UI: an add-bookmark affordance at the
  current playhead, a "Bookmarks" rail tab listing the user's (and anon's local) bookmarks with seek + delete, timeline
  markers on the transport waveform, and the owner-only aggregate signal. No new endpoints, no DB work. Capability-gated
  via the existing `resolveCapabilities()` model; anon path uses the localStorage fallback already in the hook.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Consume the shipped seam — do NOT rebuild hooks, DTOs, or endpoints, and do NOT use the duplicate bookmark hooks in `api/hooks.ts`.

**Design spec:** `PRPs/listen-v3-bookmarking.md` (backend + intended UX; backend sections are SHIPPED — this PRP delivers the UI it scoped).

---

## Goal
Make bookmarking usable end-to-end from the Listen page (`listen-rack`):
- **Create** a bookmark at the current playhead with an optional note + identity-visible toggle (authed) / note only (anon on a shared link).
- **List** the caller's bookmarks (authed: server; anon: localStorage) in a new **Bookmarks** rail tab — each seekable + deletable (own only).
- **Timeline markers** for the caller's bookmarks on the transport waveform, visually distinct from the existing note markers.
- **Owner signal**: owner sees an aggregate count + named (identity-visible) bookmarkers via the owner-only signal endpoint (hidden / no-op on 403 when not owner).

Out of scope: any backend/DTO/migration change; a durable anon bookmark library (anon stays browser-local, D-anon); notification wiring (that is the separate PRP-7 notifications work).

---

## What is already SHIPPED (consume, don't rebuild)

**Endpoints** (`components/bff/src/Spectr.Bff/Endpoints/`):
- `POST /me/bookmarks` (`BookmarkEndpoints.cs:17`) — body `CreateBookmarkRequest { targetVersionId?, t?, note?, identityVisible? }` → `BookmarkDto`. Gate `canBookmark`. Server-side dedup.
- `GET /me/bookmarks` (`:16`) — `BookmarkDto[]`, caller-scoped, newest first.
- `DELETE /me/bookmarks/{id}` (`:18`) — own only.
- `POST /v/{token}/bookmark` (`VersionViewEndpoints.cs:21`) — body `AnonBookmarkRequest { t?, note? }`, anon-or-authed on a shared version; identity always false (D5.4); counts toward owner signal.
- `GET /versions/{versionId}/bookmarks/signal` (`BookmarkEndpoints.cs:23`) — owner only (`:159`) → `BookmarkSignalDto { count, identified: ActorRefDto[] }` (anon counted anonymously; only `identity_visible=true` named).

**Hooks** (`components/frontend-spectr-v2/src/features/listen/`):
- `useMyBookmarks()` → `BookmarkDto[]`; `useCreateBookmark()`; `useDeleteBookmark()` (all invalidate `myBookmarksKey`). `useBookmarks.ts`.
- `usePostAnonBookmark(token, versionId)` — POSTs + mirrors into localStorage. `localBookmarksFor(versionId)` / `rememberLocalBookmark(versionId, bm)` — key `spectr.anonBookmarks`, shape `Record<versionId, BookmarkDto[]>`.
- `useBookmarkSignal(versionId, enabled?)` → `BookmarkSignalDto`, `retry:false` (403 is expected for non-owners). `useBookmarkSignal.ts`.

**Types** already mirrored in `src/api/types.ts`: `BookmarkDto`, `CreateBookmarkRequest`, `BookmarkSignalDto`, `canBookmark`.

> ⚠ A second, older bookmark hook set lives in `src/api/hooks.ts:747–769` (different path shape). Do NOT use it. Standardize on `features/listen/useBookmarks.ts`. If trivial, delete the dead `api/hooks.ts` bookmark trio in this PRP; otherwise leave it and note it.

---

## Files to touch

- **Create** `src/features/listen-rack/BookmarksPanel.tsx` — the rail-tab panel (merge server + anon-local, seek, delete, identity toggle).
- **Modify** `src/features/listen-rack/rail.tsx` — add `'bookmarks'` to `railTabsFor()` (gated on `cap.canBookmark`) + render `<BookmarksPanel />` in the tab switch (mirror the `active === 'comments' && <CommentsPanel/>` pattern, `~:609–628`).
- **Modify** `src/features/listen-rack/access.ts` — add `'bookmarks'` to the `railTabs` of the `MODE_SURFACE_MATRIX` modes that should expose it (work + view; room TBD per design).
- **Modify** `src/features/listen-rack/transport.tsx` — (1) an "Add bookmark" affordance that captures the current playhead `t` (gated `cap.canBookmark`); (2) render bookmark markers on the waveform, color-distinct from note markers (notes are cyan/violet at `~:76–83` — pick a third hue, e.g. amber).
- **Modify** `src/features/listen-rack/ListenRackPage.tsx` — thread `cap.canBookmark`, the active `versionId`, and (in view/shared mode) the share `token` down to transport + rail; mount the owner-signal display where the owner views their own version.
- **Reference only (already complete)**: `features/listen/useBookmarks.ts`, `features/listen/useBookmarkSignal.ts`, `api/types.ts`.

---

## Tasks

### Task 1 — Bookmarks rail tab + panel
- [ ] Add `'bookmarks'` to the rail tab union + `railTabsFor()` in `rail.tsx`, gated on `cap.canBookmark`; add to `access.ts` `MODE_SURFACE_MATRIX` (work + view modes).
- [ ] Create `BookmarksPanel.tsx`:
  - Authed: `useMyBookmarks()`. Anon (share-link/view): `localBookmarksFor(versionId)`. Decide source by identity (`id.actor.type === 'anon'`) or presence of a share token.
  - Render each: formatted `t` (mm:ss), note, identity-visible state; click row → seek transport to `t`.
  - Delete button on own bookmarks only (`useDeleteBookmark()`); anon local rows have no server delete (remove from localStorage).
  - Empty state copy.
- [ ] Unit test (`BookmarksPanel.test.tsx`): source selection (authed vs anon-local), seek callback fires with the row's `t`, delete only renders for own rows.

### Task 2 — Create affordance + identity toggle
- [ ] In `transport.tsx`, add an "Add bookmark" control gated on `cap.canBookmark`. Capture the live playhead `t`. Optional note (inline input or small popover) + an identity-visible toggle (authed only — anon is always non-visible, D5.4).
- [ ] Authed → `useCreateBookmark({ targetVersionId, t, note, identityVisible })`. Anon → `usePostAnonBookmark(token, versionId)({ t, note })` (hook mirrors to localStorage).
- [ ] On success, the new marker + list row appear without a manual refresh (authed: cache invalidation already in the hook; anon: re-read `localBookmarksFor`).
- [ ] Unit test: create payload shape for authed vs anon; identity toggle hidden for anon.

### Task 3 — Timeline markers
- [ ] In `transport.tsx`, render the caller's bookmarks as markers positioned by `t / duration`, color-distinct from note markers. Reuse the note-marker positioning math (`~:76–83`).
- [ ] Click a marker → seek to its `t` (same handler as the panel row).
- [ ] Guard against `duration === 0` / missing `t` (no marker).
- [ ] Unit test: marker x-position = `t/duration`; no markers when list empty or duration unknown.

### Task 4 — Owner signal display
- [ ] Where the owner views their OWN version (`id.isOwner` in work/view mode), call `useBookmarkSignal(versionId, id.isOwner)` (pass `enabled` = isOwner so non-owners never fire the 403).
- [ ] Render `count` + the `identified` named bookmarkers (e.g. "3 bookmarks · 2 named"). Hide entirely on 403 / when `!id.isOwner`.
- [ ] Unit test: hook not enabled when `!isOwner`; renders count + named list when present.

### Task 5 — Cleanup + gates
- [ ] Remove (or explicitly annotate) the dead bookmark hooks in `api/hooks.ts:747–769` so there is one source of truth.
- [ ] Confirm `canBookmark` is now consumed (was previously defined-but-unused).

---

## Validation gates (all four must pass — frontend rules in CLAUDE.md)
```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint    # --max-warnings 0
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```

## Manual smoke (owner, work mode)
1. Play a version → "Add bookmark" at ~0:30 with a note → marker appears on the waveform + a row in the Bookmarks tab.
2. Click the row / marker → transport seeks to 0:30.
3. Delete the bookmark → marker + row disappear.
4. Owner signal shows the count; toggle identity-visible on create → owner signal lists your name.
5. On a shared link as anon → bookmark persists in the tab across reload (localStorage), and increments the owner's signal count anonymously.

## Anti-patterns
- ❌ Don't add endpoints, DTOs, columns, or a migration — backend is shipped.
- ❌ Don't use the duplicate `api/hooks.ts` bookmark hooks.
- ❌ Don't fetch the owner signal for non-owners (403 by design — gate on `id.isOwner`).
- ❌ Don't show the identity-visible toggle for anon (always non-visible, D5.4).
- ❌ Don't reach for inline styles unless dynamic (marker x-position is the legitimate dynamic case).
