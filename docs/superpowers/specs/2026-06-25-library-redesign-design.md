# Library Redesign + Song Visibility — Design

**Date:** 2026-06-25
**Component(s):** `components/frontend-spectr-v2` (primary), `components/bff` (small backend change)
**Status:** Approved design — ready for implementation plan
**Design handoff:** `PRPs/design_handoffs/design_handoff_library/` — interactive React prototype
(`js/library.jsx`, `js/data.jsx`, `js/visuals.jsx`, `styles.css`) that maps file-for-file
onto `features/library/SongsLibrarySection.tsx`. The build target is parity with this
prototype. (Its `js/tweaks-panel.jsx` is a prototype-only exploration harness — **do not ship**.)

## Problem

The user library page (`/library`, Songs tab) is grade-centric: cards lead with a
mix grade pill, a "VERSION ARC" block that mostly reads "No scored versions yet",
and the filter row is grade buckets (A GRADE / B GRADE / NEEDS WORK). Grades are
being de-emphasized across the product. The page needs to re-center on **the song,
its versions, and who can see it**, and to add a real **per-song visibility** concept
(private / shared / public) that doesn't exist today.

## Scope

**In scope**
- Redesign the library grid card and list row.
- Remove grade/score from this page entirely (pill, score text, scored-version arc block, grade filters).
- New **song-level `visibility`** field (`private` | `shared` | `public`), default `private`.
- Show visibility as a badge; let the user change it (kebab submenu + edit dialog).
- Two card action buttons: **Play** (latest version → listening room) and **Analysis
  Results** (latest version's analysis report, only when an analysis exists).
- Description peek, tags, and a display-only version-sequence strip on the card.
- Replace grade filter pills with visibility filter pills.
- **Tag-refine row** under the visibility pills + clickable card tags (filter by tag,
  **union/any-match**). *(Decision: union, confirmed 2026-06-25.)*
- **Hard-delete** a song (permanent, with a confirm dialog) as a new kebab action,
  alongside the existing reversible Archive. *(Decision: add hard-delete, confirmed 2026-06-25.)*

**Out of scope — deferred to a second spec ("sharing platform")**
- Public profile pages (`/u/<user>`) listing a user's public songs.
- Global discover / browse feed of public songs.
- Actual access **enforcement** when a non-owner opens a shared/public song
  (view-mode access on the listen-rack page for strangers).
- Song-level share tokens / copyable share links.

This spec lets the owner **set and see** a song's visibility. The platform that
*honors* `shared`/`public` for other users is the next spec. No `share_token` is
added now.

## Visibility model (agreed semantics, for context)

Final intended meaning (only the field + owner-facing UI are built in this spec):
- `private` — only the owner.
- `shared` — anyone with a link can view (listen-only). *(link/enforcement: spec 2)*
- `public` — profile-listed **and** discoverable in a global browse feed. *(spec 2)*
- Non-owner viewing scope = **listen-rack page in view mode (listen-only)** — not the
  analysis report. *(enforcement: spec 2)*

## Backend changes (BFF — `components/bff`)

1. **Entity / column.** Add `Visibility` to the `Song` entity → column `songs.visibility`,
   `string`/enum, **not null, default `'private'`**. Follow the existing EF Core 10
   migration pattern: scaffold `add` then append the raw default to `Up()`/`Down()` if
   the fluent API can't express it cleanly (same workaround style as the partial-index
   gotcha in `bff/README.md`).
2. **DTO.** `SongDto` gains `Visibility` (string). Populate it in `GET /api/songs`
   (the `include=versions,latest_result` query) and any single-song fetch.
3. **PATCH.** `PATCH /api/songs/{id}` accepts an optional `visibility` value; validate
   it's one of the three; persist via a **tracked** entity lookup (do not introduce
   `AsNoTracking()` in the write path — known EF gotcha where it silently drops the
   update). Existing name/genreHint patch behavior unchanged.
4. **Hard-delete endpoint.** Add a new endpoint to **permanently** delete a song and
   its dependents (versions, analyses/jobs, tags, plus any staged/stored audio via
   `IFileStorage`). The existing `DELETE /api/songs/{id}` is **archive (soft-delete)** —
   do not repurpose it. Add a distinct route (e.g. `DELETE /api/songs/{id}?hard=true`
   or `DELETE /api/songs/{id}/permanent`) scoped to the owner (`WHERE user_id = me`).
   Cascade behavior must be explicit (EF cascade or manual child cleanup) and storage
   blobs removed. Archive remains the reversible default.
5. **No `share_token`**, no other new endpoints, no access-control changes.

## Frontend changes (`frontend-spectr-v2`)

### Types & hooks
- `src/api/types.ts`: `SongDto.visibility: 'private' | 'shared' | 'public'`.
- `usePatchSong` / edit flow: support sending `visibility`.
- **Already added by the New Song modal work** (`SongDto` + `CreateSongRequest` +
  `PatchSongRequest`, all nullable for back-compat): `description`,
  `visualTemplate` (`SongVisualTemplate`), `visualPrimary` / `visualSecondary`
  (serialized `oklch(l c h)` strings), `referenceProfileKind` (`'set' | 'preset'`),
  `referenceProfileId`. This spec only adds `visibility` on top of those.

### Grid card (the main redesign) — `SongCard` in `SongsLibrarySection.tsx`
Top-to-bottom:
- **Cover visual** — the song's chosen, persisted cover art via
  `<CoverArt visual={visualFromDto(song.visualTemplate, song.visualPrimary,
  song.visualSecondary)} hue={…} />`. When the song has no stored visual, `CoverArt`
  falls back to the legacy `hueFromId` Aurora gradient, so existing rows render
  unchanged. (Already wired on the grid card + row by the New Song modal work.)
  - top-right: **version pill** (`v{latestVersionNumber}`).
  - top-left: **visibility badge** — 🔒 Private / 🔗 Shared / 🌐 Public.
  - overlay: **▶ Play** → plays the **latest version** (highest `versionNumber`) in the
    listening room (listen-rack page).
- **Song name** (links to song detail) + **kebab menu**.
- **Genre** chip (from `genreHint`; hidden if null).
- **Description peek** — single line, truncated with ellipsis; hidden when empty.
  Reads `song.description` (now persisted via the New Song modal work).
- **Tags** — up to 4 shown, `+N` overflow (kept from current behavior, incl. the
  per-tag public indicator).
- **Version sequence strip** — minimal markers `v0 · v1 · v2 · v3` along a track; the
  latest version accented; hover shows date/label; **display-only** (not clickable).
  Leave a clearly-commented placeholder where future **delta connectors** between
  versions will render (progress-over-versions feature, not built here).
- **Action row / footer:** **Report** button (opens the latest version's analysis
  report; **only shown/enabled when `latestResult` is present**, otherwise hidden or
  disabled) · updated relative time · version count.
- **Removed:** grade pill, score text, "VERSION ARC / No scored versions yet" block.

### List row — `SongRow`
Same data, condensed: thumbnail, name, genre, **visibility badge**, short description
peek, tags, compact version markers, **Report** (conditional) + **Play**, updated time,
kebab. Grade pill and version grade-strip removed.

### Kebab menu — `SongMenu`
`Open · Edit · Visibility ▸ (Private / Shared / Public) · Add version · — · Archive/Unarchive · Delete`.
- **Portaled to `<body>`** with fixed coords from the trigger rect so the card's
  `overflow: hidden` can't clip it; flips upward near the viewport bottom, the
  visibility submenu flips sides near an edge; closes on outside-click / Esc / scroll
  (per the prototype `SongMenu`).
- Visibility submenu = radio items (Private/Shared/Public) with one-line "who can see it"
  hints; current value checked. Sets `visibility` via `PATCH`.
- **Archive** toggles to **Unarchive** for archived rows (reversible).
- **Delete** is destructive (`menuItem danger`) → opens the confirm dialog (below).
- No "Copy share link" entry (deferred).
- `Edit` dialog (`SongEditDialog`) gains a segmented Private/Shared/Public visibility
  control next to name/genre. (Tags + cover stay in the full editor, per the prototype.)

### Delete confirm dialog — `DeleteDialog`
Destructive confirm: titles the song, counts its versions, warns it removes all analysis
results and **can't be undone**, and points to Archive as the non-destructive alternative.
Confirm → hard-delete endpoint → invalidate `['songs']` → toast.

### Filters & header — `SongsLibrarySection`
- Replace grade filter pills with **visibility filters**: `All · Private · Shared ·
  Public · Archived`. `All` excludes archived (as today); `Archived` shows archived.
  Each pill shows its count, and the **count recomputes against the active tag filter**
  so the numbers always match the grid (per prototype `counts` memo).
- Header stat line ("N songs · M versions · last edit …") unchanged. Sort dropdown
  (recent / name / versions) and Grid/List toggle unchanged.

### Tag-refine row — `SongsLibrarySection`
- A `tags` refine row under the visibility pills: one chip per unique tag across the
  active (non-archived) songs, each chip showing how many songs carry it; public tags
  get a subtle cyan tint (mirrors `Tag.isPublic`). `clear (n)` resets.
- **Union match:** selecting multiple chips shows songs carrying **any** selected tag.
- **Card tags are clickable** — clicking a card's tag toggles the same filter and
  reflects active state. Tracked in component state (`selectedTags: Set<string>`),
  not the URL, for now.

## Data flow

`GET /api/songs?include=versions,latest_result` → `SongDto[]` (now with `visibility`)
→ `useSongs()` → filter by active visibility pill + sort → render `SongCard`/`SongRow`.
Visibility change: kebab/edit → `usePatchSong({ visibility })` → `PATCH /api/songs/{id}`
→ invalidate `['songs']` → card badge updates. Play → navigate to listen-rack for the
latest version. Report → navigate to the analysis report route for the latest version's
job/analysis (`latestResult`).

## Error handling
- `PATCH` visibility failure → toast (Sonner), revert optimistic badge if used.
- Report button absent when no analysis — no dead navigation.
- Empty description → no peek line (no empty gap). Empty tags → no tag row.
- Song with zero versions → version strip empty/placeholder; Play disabled.

## Testing
**BFF**
- Migration applies; new rows default to `private`.
- `GET /api/songs` returns `visibility`.
- `PATCH /api/songs/{id}` updates `visibility`; rejects invalid values; persists
  (tracked lookup) — assert it actually saved.
- Hard-delete endpoint removes the song + child versions/analyses/tags and the audio
  blobs; is owner-scoped (a non-owner can't delete); is distinct from archive (archive
  still only sets `archived_at`).

**Frontend (Vitest + four gates: `tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run`)**
- Card renders the correct badge per visibility value.
- Play targets the latest version; Report shown only when `latestResult` present and
  hidden/disabled otherwise.
- Description peek truncates and is omitted when empty.
- Version strip renders markers and is non-interactive (display-only).
- No grade pill/score anywhere on card or row.
- Visibility filter pills filter the list; counts correct (and recompute against the
  active tag filter); Archived behavior preserved.
- Kebab visibility submenu issues a `PATCH` with the chosen value.
- Tag chips + clickable card tags filter by **union**; `clear` resets; counts match grid.
- Delete opens the confirm dialog; confirming calls the hard-delete endpoint and removes
  the row; Archive remains a separate reversible action.

## Open items to resolve during planning
- **`description` source — RESOLVED.** The New Song modal work added `description`
  to `SongDto` / `CreateSongRequest` / `PatchSongRequest` and the frontend collects it.
  ⚠️ The **BFF/worker persistence is still pending** — `songs.description` (and the
  visual + reference-profile columns) must be added on the `Song` EF entity + shared
  SQLAlchemy model + a migration. Fold that into this spec's backend change alongside
  `visibility` (see `PRPs/design_handoffs/new-song-creation-backend-requirements.md`).
  Until those columns exist the description peek will read empty (frontend falls back
  gracefully).
- **Listen-rack play target.** Confirm the exact route/params to open the listen-rack
  page for a specific (latest) version during planning.
- **Report route.** Confirm the analysis-report route for a version's latest analysis
  (`latestResult.jobId` / analysis id) during planning.
