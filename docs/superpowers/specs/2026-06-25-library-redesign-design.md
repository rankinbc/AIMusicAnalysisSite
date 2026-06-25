# Library Redesign + Song Visibility — Design

**Date:** 2026-06-25
**Component(s):** `components/frontend-spectr-v2` (primary), `components/bff` (small backend change)
**Status:** Approved design — ready for implementation plan

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
- Two card action buttons: **Play** (latest version → listening room) and **Report**
  (latest version's analysis report, only when an analysis exists).
- Description peek, tags, and a display-only version-sequence strip on the card.
- Replace grade filter pills with visibility filter pills.

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
4. **No `share_token`**, no new endpoints, no access-control changes.

## Frontend changes (`frontend-spectr-v2`)

### Types & hooks
- `src/api/types.ts`: `SongDto.visibility: 'private' | 'shared' | 'public'`.
- `usePatchSong` / edit flow: support sending `visibility`.

### Grid card (the main redesign) — `SongCard` in `SongsLibrarySection.tsx`
Top-to-bottom:
- **Cover visual** (existing hue/gradient art).
  - top-right: **version pill** (`v{latestVersionNumber}`).
  - top-left: **visibility badge** — 🔒 Private / 🔗 Shared / 🌐 Public.
  - overlay: **▶ Play** → plays the **latest version** (highest `versionNumber`) in the
    listening room (listen-rack page).
- **Song name** (links to song detail) + **kebab menu**.
- **Genre** chip (from `genreHint`; hidden if null).
- **Description peek** — single line, truncated with ellipsis; hidden when empty.
  *(Requires `description` to be available on the song — see Open Items.)*
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
`Open · Edit · Visibility ▸ (Private / Shared / Public) · Add version · Archive`.
- Visibility submenu sets `visibility` via `PATCH`; current value checked/highlighted.
- No "Copy share link" entry (deferred).
- `Edit` dialog (`SongEditDialog`) also gains a visibility control next to name/genre/tags.

### Filters & header — `SongsLibrarySection`
- Replace grade filter pills with **visibility filters**: `All · Private · Shared ·
  Public · Archived`. `All` excludes archived (as today); `Archived` shows archived.
  Each pill shows its count.
- Header stat line ("N songs · M versions · last edit …") unchanged. Sort dropdown
  and Grid/List toggle unchanged.

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

**Frontend (Vitest + four gates: `tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run`)**
- Card renders the correct badge per visibility value.
- Play targets the latest version; Report shown only when `latestResult` present and
  hidden/disabled otherwise.
- Description peek truncates and is omitted when empty.
- Version strip renders markers and is non-interactive (display-only).
- No grade pill/score anywhere on card or row.
- Visibility filter pills filter the list; counts correct; Archived behavior preserved.
- Kebab visibility submenu issues a `PATCH` with the chosen value.

## Open items to resolve during planning
- **`description` source.** The card description peek needs a `description` on the song.
  The current `Song` entity / `SongDto` has **no `description` column** (the field exists
  in the "New song" mockup but isn't persisted). Planning must decide: (a) add a
  `songs.description` column + DTO/edit wiring as part of this spec, or (b) drop the
  description peek until a later spec. Recommendation: include `songs.description`
  (small additive column, mirrors `visibility` work) so the peek is real.
- **Listen-rack play target.** Confirm the exact route/params to open the listen-rack
  page for a specific (latest) version during planning.
- **Report route.** Confirm the analysis-report route for a version's latest analysis
  (`latestResult.jobId` / analysis id) during planning.
