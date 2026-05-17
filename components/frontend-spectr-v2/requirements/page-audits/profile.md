# Profile Page Audit

## Overview
The Profile page is the producer's personal home — accessed from the top-right avatar. It surfaces account identity, a library overview, the new **Reference Library** (URL/file/bulk imports of commercial tracks reused across mixes), a new **Bookmarks** tab (public Discover tracks the user saved for re-listening), an activity timeline, usage quotas, and settings. Primary outcomes: (1) manage saved references so subsequent analyses don't re-upload reference WAVs; (2) revisit other producers' published tracks bookmarked on Discover; (3) manage account/profile/quotas.

**Delta from previous audit:** A new `bookmarks` tab + `BookmarkCard` component has been added between `references` and `activity`. The tab renders a grid of `BookmarkCard`s — each one is a published-track tile (cover, title, artist handle, BPM/key/LUFS, bookmark timestamp) that click-plays the public track. Bookmarks are explicitly *not* part of the user's library — "listening only". Default landing tab is still `references`. Everything else from the previous audit (header, Overview, Library embed, References, Activity, Settings) is unchanged in this file.

## Subpages / variants
- Profile header (always visible) — avatar, name, handle, plan badge, joined date, 5-stat row (Songs · Versions · References · Analyses · Plays), this-month usage meter, "View your public profile" link
- Tab: Overview — recent songs (4), most-used references (4), usage bars, plan card with upsell, recent activity (5)
- Tab: Library — embeds `window.LibraryPage` in-place (audited separately)
- Tab: References — featured Add-Reference zone (URL paste / file drop / bulk paste) + filter chips (all / by set / by genre) + grid of `ReferenceCard`s
- **Tab: Bookmarks (NEW)** — header row with count + "not part of your library · listening only" caveat; responsive grid (`auto-fill minmax(280px, 1fr)`) of `BookmarkCard`s. Empty state: centered icon card "No bookmarks yet" + CTA pointing to Discover
- Tab: Activity — full chronological activity list
- Tab: Settings — Profile fields, Default analysis (default reference, default streaming target, auto-run specialists), Danger zone (export, delete account)
- Sub-flow: Add Reference — three sub-modes (`url`, `file`, `bulk`)
- Reference card states — `analyzed`, `analyzing`, `pending analysis`
- BookmarkCard states — only one state (analyzed public track); no in-progress shape since bookmarking happens against already-analyzed Discover tracks

## Data the page assumes
| Field | Status | Source today | Effort if not | Notes |
|---|---|---|---|---|
| `profile.name` (display name) | NEW schema | `users` table has only `email` | S | Add nullable `display_name` column |
| `profile.handle` (`@maek`) | NEW schema | none | S | New unique column on `users`; needed for `/u/:handle` public-profile URLs |
| `profile.email` | EXISTS | `users.email` | — | Already on `User` |
| `profile.initial` | DERIVABLE | first char of name | — | Compute client-side |
| `profile.plan` ("Studio") | BLOCKED | none — no billing model | L | Hardcode "Studio" for v1; real plans need billing infra |
| `profile.joined` ("Joined Jan 2025") | EXISTS | `users.created_at` | — | Format client-side |
| `profile.stats.songs` | EXISTS | `COUNT(songs WHERE user_id = me)` | — | New `/me/stats` route |
| `profile.stats.versions` | EXISTS | `COUNT(song_versions JOIN songs)` | — | Same route |
| `profile.stats.references` | NEW schema | none — reference library doesn't exist | M | New `references` table; count rows for user |
| `profile.stats.analyses` | DERIVABLE | `COUNT(upload_jobs WHERE user_id = me AND status = COMPLETE)` | — | Already queryable |
| `profile.stats.plays` | NEW schema | none — no play tracking | M | New `play_events` or counter on song/version; only matters if Discover ships |
| `profile.usage.analysesThisMonth` | DERIVABLE | `COUNT(upload_jobs WHERE created_at >= month_start)` | — | Free query |
| `profile.usage.analysesCap` | BLOCKED | none — no plan tier model | L | Hardcode or omit cap entirely |
| `profile.usage.specialistsCalls` | NEW schema | specialist runs live inside `verdicts_payload`, not counted | M | Counter column on `users` or derive from `verdict_validation_failures` + `analysis_results` |
| `profile.usage.specialistsCap` | BLOCKED | none | L | Same as `analysesCap` |
| Usage-meter "resets May 31" | DERIVABLE | calendar end of current month | — | Client-side |
| `profile.activity[]` | NEW schema | none | M | New `activity_events` table; needs cross-cutting write-instrumentation |
| `library[]` (Recent songs preview) | EXISTS | `songs` + `song_versions` joined | — | Reuse library query, slice to 4 |
| `references[]` whole collection | NEW schema | none — current "reference" is a single `reference_path` on `UploadJob` | L | New `references` table: id, user_id, title, artist, source, source_url, file_path, added_at, genre, bpm, key, duration_sec, lufs, true_peak, dynamic_range, width, correlation, hue, tags JSONB, status, used_count, notes |
| `sets[]` (REFERENCE_SETS) | NEW schema | none | M | New `reference_sets` + `reference_set_members` join |
| **`bookmarks[]` (BookmarksTab)** | **NEW schema** | **none** | **M** | **New `track_bookmarks` join table (`user_id`, `published_track_id`, `created_at`). Server returns each bookmark as `{ track: PublishedTrack, artist: PublicUser, bookmarkedAgo: string }` — same shape used by Discover's public track card** |
| `bookmark.track.id`, `title`, `hue`, `lufs`, `bpm`, `key`, `genre`, `plays` | NEW schema (joined) | none — `published_tracks` doesn't exist yet | L | All come from the joined `published_tracks` row; depends on Discover/publish-to-discover landing first |
| `bookmark.artist.handle`, `displayName`, `avatarHue` | NEW schema | none | M | Joined from `users` via published_track owner; same fields needed by Discover audit (`PUBLIC_USERS`) |
| `bookmark.bookmarkedAgo` ("3d ago") | DERIVABLE | `created_at` on bookmark row | — | Format client-side |
| `publicProfile` (presence triggers header CTA) | NEW schema | none | M | `is_public` / `public_handle` on `users`; depends on Discover shipping |
| Settings: "Default reference" | NEW schema | none | S | FK on `users` referencing `references.id` |
| Settings: "Default streaming target" | NEW schema | none | S | Enum on `users` |
| Settings: "Auto-run AI specialists" | NEW schema | none | S | Bool on `users` |

## Interactions
| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| Open page | Load profile + stats + library preview + references + sets + activity + **bookmarks** | `GET /api/me/profile`, `/me/stats`, `/me/library?limit=4`, `/api/references`, `/api/reference-sets`, `/api/me/activity?limit=5`, **`GET /api/me/bookmarks`** (all new) | read-only |
| Click tab | Local state, no fetch | — | none |
| Click `View your public profile` | Navigate to `/u/:handle` | `GET /api/public/users/{handle}` (new) | none |
| Add reference via URL | Submit URL for ingest + analysis | `POST /api/references` `{source_url}` (new); SSE/poll | INSERT references row with `analyzing=true` |
| Add reference via file | Upload + queue analysis | `POST /api/references` multipart | INSERT references row |
| Bulk URL paste | Submit N URLs | `POST /api/references/bulk` | N INSERTs |
| Filter chip click | Local filter only | — | none |
| `+ New set` | Open modal, create empty set | `POST /api/reference-sets` | INSERT |
| Add reference to set | Drag/click into set | `POST /api/reference-sets/{id}/members` | INSERT join row |
| ReferenceCard "Compare to my tracks" | Open compare modal/page (`onCompare`) | reuses compare flow with reference_id | increments `references.used_count` on actual run |
| ReferenceCard "Analyze baseline" | Trigger analysis on pending reference | `POST /api/references/{id}/analyze` | UPDATE references row |
| ReferenceCard ⋯ menu | Edit/delete reference | `PATCH/DELETE /api/references/{id}` | UPDATE/DELETE |
| **BookmarkCard click (anywhere on tile)** | Calls `onPlayPublicTrack(track)` — navigate to `PublicListenView` with the published track loaded (recipe playable via real Web Audio DSP ToolsRail there) | `GET /api/public/tracks/{id}` (new — Discover dependency) | none |
| **BookmarkCard artist-row click** | `e.stopPropagation()` + `onOpenPublicProfilePage(artist.handle)` — navigate to `/u/:handle` | `GET /api/public/users/{handle}` (new) | none |
| **(Implicit) Remove bookmark** | Not surfaced in this file — happens on Discover or PublicListenView via the bookmark toggle | `DELETE /api/me/bookmarks/{published_track_id}` (new) | DELETE row from `track_bookmarks` |
| **(Implicit) Add bookmark** | Happens on Discover, not on Profile | `POST /api/me/bookmarks` `{published_track_id}` (new) | INSERT into `track_bookmarks` |
| Activity row click | (No handler in mock) | — | — |
| Settings row "Edit" | Inline editor / modal | `PATCH /api/me/profile` | UPDATE users |
| Export all data | Trigger ZIP export | `POST /api/me/export` | none |
| Delete account | Soft delete + 30-day window | `DELETE /api/me` | UPDATE `users.deleted_at` |
| Manage plan | Open billing portal | external (Stripe etc.) | none |

## Real-time / streaming behavior
- Reference analysis status — `analyzing` cards animate `EQDots`. Needs SSE channel (`/api/references/stream`) or polling, or tie each reference to a backing `upload_job` row and reuse `useJobStream`.
- Bulk paste — N concurrent analyses, same streaming concern multiplied.
- **Bookmarks** — no streaming. The list is fully static once fetched. Live bookmark counts elsewhere (Discover, PublicListenView) could optimistically update via TanStack Query mutation invalidation, but the Profile-side tab itself is a one-shot fetch.
- Otherwise none — Activity, Usage, Settings are static fetches.

## Open product questions
- **Bookmarks vs Library distinction** — the design copy is emphatic ("not part of your library · listening only"). Confirm: does bookmarking a track ever do anything beyond saving it for re-listen? (e.g., can you "use this as a reference"? — current design says no; reference-import is a separate flow that re-analyzes the audio.)
- **Bookmark sort/filter** — file has no sort controls. Implicit assumption is reverse-chronological. Do we ship a sort dropdown (most recent / most played / by artist) or leave it minimal?
- **Bookmark count cap** — any limit per user? (10? unlimited?) Affects whether we paginate or just load all.
- **Cross-page consistency** — if the user removes a bookmark on Discover/PublicListenView, does the Profile tab need to know (refetch on tab activate vs. global TanStack invalidation)?
- **Privacy** — bookmarks are visible only to the bookmark owner, correct? Or do they appear on the public profile too ("Mae bookmarked these")? Mock implies private.
- **What happens if the artist deletes/un-publishes a bookmarked track?** Soft-orphaned bookmark vs. cascading delete. Mock doesn't address.
- Plan tier + quotas — ship hardcoded or full billing?
- Activity log scope — what events do we instrument?
- Reference URL ingest — file-only v1, or also YT/Spotify/SC/Apple? URL ingest needs `yt-dlp` (YT/SC); Spotify/Apple are DRM-walled.
- Reference sets — flat only, or nested / shareable?
- "Specialist runs" — what counts as a call?
- Default streaming target — UI preference only, or does it re-rank Streaming Readiness rows?

## Build verdict

**Conditional split — bumped from the previous "DEFER large portions":**

- **Unit A (small, ships with main app):** header identity (minus plan/quotas/public-profile CTA), Library tab embed, Settings tab (profile fields only).
- **Unit B (References workstream):** References tab + Reference Sets + Activity + Usage quotas. Same scope as before.
- **Unit C (NEW — Bookmarks):** **Tied to Discover shipping.** The Bookmarks tab is structurally trivial (a join table + a list endpoint + a card grid), but every data field on `BookmarkCard` depends on `published_tracks` and `PUBLIC_USERS` schemas, which only exist if Discover ships. Bookmarks rides on Discover's coattails:
  - **If Discover is v1** (per the user's note, this is being re-audited and Apply-preset is now real, ToolsRail-on-public-tracks is real) → Bookmarks tab is **v1**. Effort: S — one join table, one list endpoint, one create/delete pair, one grid component. The card markup is ~60 lines of CSS Modules; the only data dependency is `PublishedTrack` + `PublicUser` shapes, which Discover already needs.
  - **If Discover is still deferred** → Bookmarks tab is deferred with it (the tab button can be hidden behind the same feature flag as the "View your public profile" CTA).

**Default assumption (pending Discover re-audit):** Bookmarks ships **with Discover in v1**, not as a separate workstream. Hide the tab when `bookmarks` prop is undefined so the page degrades gracefully on builds without Discover.

## Recommended cuts / placeholders for v1
- Plan tier — hardcode "Studio"; hide "Manage plan" or toast "Coming soon"
- Usage quotas — show `analysesThisMonth` (free to compute); drop cap and "Specialist runs" bar
- Activity timeline — defer or back with UNION over `upload_jobs` + `songs`
- URL-based reference import — defer to follow-up; v1 References is file-upload only
- Bulk paste — defer with URL import
- Reference sets — defer; ship flat reference list with genre filter chips only
- "View your public profile" — hide behind Discover feature flag
- Plays stat — show only if Discover ships
- "Default reference" / "Default streaming target" — defer
- Export all data — defer; manual support
- Delete account — soft `deleted_at` flag; 30-day restore window is a follow-up cron
- **Bookmarks tab (NEW):**
  - If kept in v1: ship as-is — empty state, card grid, click-to-play, click-handle-to-profile. No sort/filter controls in MVP (cap loaded list at 50 most recent and add pagination later).
  - Bookmark add/remove UI lives on Discover + PublicListenView, **not** on this page — the Profile tab is read-only display + remove-on-click affordance can be added in a follow-up if users ask.
  - `bookmarkedAgo` formatting — reuse the existing `formatRelativeTime()` helper used elsewhere; no new util.
  - Visual cap: `gridTemplateColumns: repeat(auto-fill, minmax(280px, 1fr))` matches the References grid exactly — reuse the same CSS Module mixin.

## Notes
- The page uses `window.LibraryPage` directly inside the Library tab — Library and Profile must coexist as siblings.
- Reference cards already show `lufs`, `truePeak`, `dynamicRange`, `width`, `correlation`, `bpm`, `key`, `genre` — all derivable from `audio_analysis.run_pipeline`. A "reference-mode" runner that skips structure/specialist phases would speed this up but isn't strictly required.
- `references.used_count` should be incremented when a `SongVersion` analysis is dispatched with that reference, not on button click. A new `reference_id` FK on `UploadJob`/`SongVersion` replaces the current `reference_path` string.
- Activity events worth logging cheaply (no new code): `upload_jobs.created_at` and `songs.created_at` cover most events in the mock — v1 Activity can be a UNION over existing tables instead of a dedicated `activity_events` table.
- **BookmarkCard data shape confirmed by component contract:** `bookmark.track.{id, title, hue, lufs, bpm, key, genre, plays}` + `bookmark.artist.{handle, displayName, avatarHue}` + top-level `bookmark.bookmarkedAgo` (string). All `track.*` fields mirror the published-track card used on Discover — the server should return one consolidated DTO from `GET /api/me/bookmarks` rather than client-side stitching two endpoints.
- **BookmarkCard schema cost:** the `track_bookmarks` table itself is trivial (`user_id`, `published_track_id`, `created_at`, unique composite key). The cost is the *prerequisite* schema — `published_tracks` (Discover) + `users.handle` + `users.display_name` + `users.avatar_hue` (Public profile). None exist today.
- **BookmarkCard interaction contract:** the entire card is a single `<button>` calling `onPlay(track)`. The handle sub-area calls `e.stopPropagation()` + `onOpenProfile(artist.handle)`. There is no inline "remove bookmark" affordance in this file — that's intentional; removal lives on Discover/PublicListenView where bookmarking happens.
- **No `Apply preset` interaction surfaces on Profile** — the new "Apply preset loads recipe into ToolsRail on Listen" flow is a sibling interaction on the Verdict cards, *not* on this page. Bookmarks here only navigate to PublicListenView; they don't carry a recipe.
- The tab list now has 6 entries (Overview, Library, References, **Bookmarks**, Activity, Settings) — adjust nav-overflow CSS if porting to narrower viewports. Mobile breakpoint not yet defined in mock.
- Inline `style={{ ... }}` everywhere — all becomes CSS Modules per locked architecture when ported.
- File size: ~820 lines (up from ~710). `AddReferenceZone` subcomponents and the new `BookmarksTab` + `BookmarkCard` should each get their own files in `features/profile/` (Bookmarks may also live under `features/bookmarks/` if reused on the public profile page later).
