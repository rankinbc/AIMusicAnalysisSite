# Library Page Audit

## Overview
The producer's collection of work-in-progress songs. Each song aggregates 1..N versions, each with a grade/score from its analysis. The user comes here to (a) survey progress across all songs at a glance, (b) drill into a single song to see its iteration arc, compare versions, and re-open analyses, and (c) start new work (new song, add version, re-analyze, publish).

## Subpages / variants
- **LibraryPage (grid view)** — card grid with cover art, version arc sparkline, score delta, version count.
- **LibraryPage (list view)** — denser table-style rows with cover thumb, grade chips per version, single grade pill on right.
- **SongDetailPage** — header (cover + title + tags + actions), large `ProgressTimeline` SVG sparkline with grade-band guides, two-column `VersionListCard` + `DeltaCard`.
- **DeltaCard (empty state)** — placeholder explaining "compare two versions" with quick-suggestion buttons (First→current, Last two).
- **ActiveDeltaCard** — when two versions selected: side-by-side grade pills, 6-row metric delta table, green "verdict" callout, "Open full diff" CTA.

## Data the page assumes
| Field | Status | Source today | Effort if not | Notes |
|---|---|---|---|---|
| `library[]` (list of songs for current user) | ✅ exists | `songs` table filtered by `user_id` | — | Need new `GET /songs?include=versions,latest_result` route — `GET /tracks` exists but is jobs-grouped-by-name, not Song-rows. |
| `song.id`, `song.name` | ✅ exists | `songs.id`, `songs.name` | — | |
| `song.genre` | ⚠️ derivable | `songs.genre_hint` OR latest `analysis_results.final_json.genre` | — | `genre_hint` is user-supplied at upload; analysis genre lives in `final_json`. Pick one as canonical for cards. |
| `song.bpm` | ⚠️ derivable | latest `analysis_results.final_json.phase2.bpm` (or `phase1.bpm`) | — | Pull from latest completed version's result. |
| `song.key` | ⚠️ derivable | latest `analysis_results.final_json.phase1.detected_key` | — | Same source as BPM. |
| `song.updatedDays` | ⚠️ derivable | `songs.updated_at` (or latest version `created_at`) | — | Compute `now - updated_at` server-side; render as "today" / "Nd ago". |
| `song.hue` (0–360 for cover art) | 🆕 schema | not stored | S (hours) | Either add `songs.cover_hue INT NULL` and seed from genre on create, or compute deterministically from `hash(song.id) % 360`. Recommend derive — no schema change. |
| `song.plays` (play count) | ❌ blocked | not tracked | M (days) | Requires play-event capture (frontend `<audio>` event → POST `/songs/{id}/plays`), table `song_play_events` or denormalized counter on `songs`. Cosmetic for v1 — stub to 0 or omit. |
| `song.versionCount` | ⚠️ derivable | `count(song_versions WHERE song_id=…)` | — | Trivially aggregable; include in `/songs` payload. |
| `song.grade` (latest grade letter) | ⚠️ derivable | latest `analysis_results.final_json.grade` (or compute from score) | — | Already in v1.1 report payload. |
| `song.score` (latest int 0–100) | ⚠️ derivable | latest `analysis_results.final_json.mix_score` / `score` | — | Same as grade. |
| `song.scoreDelta` (latest − first) | ⚠️ derivable | `versions[-1].score - versions[0].score` | — | Compute server-side in `/songs`. |
| `song.versions[]` | ✅ exists | `song_versions` joined to latest `analysis_results` per version | — | Need to flatten: each version → `{v, label, grade, score, date, current}`. |
| `version.v` (version_number) | ✅ exists | `song_versions.version_number` | — | |
| `version.label` | ✅ exists | `song_versions.label` | — | |
| `version.grade` | ⚠️ derivable | per-version `analysis_results.final_json.grade` | — | One result per version's latest successful job. |
| `version.score` | ⚠️ derivable | per-version `analysis_results.final_json.mix_score` | — | |
| `version.date` (display string) | ⚠️ derivable | `song_versions.created_at` formatted "Mar 17" | — | Server-side or client-side format. |
| `version.current` (boolean flag) | 🆕 schema | not stored | S (hours) | Add `song_versions.is_current BOOLEAN DEFAULT FALSE` + partial unique index `(song_id) WHERE is_current`. Default newest version on insert. Alternatively: derive as `version_number == MAX(version_number)`. |
| Version arc sparkline points | ⚠️ derivable | from `versions[].score` array | — | All client-side SVG; no backend work. |
| Grade-band guides on timeline (A/A-/B/C/D thresholds) | ✅ exists | hardcoded UI constants | — | Already used elsewhere in frontend. |
| Filter set: All / A grade / B grade / Needs work / In progress / Archived | ⚠️ derivable | `Archived` from `songs.archived_at IS NOT NULL`; grade filters from latest result; "In progress" = no completed analysis yet | — | All client-side filtering on the `/songs` response. "Needs work" needs a defined threshold (e.g. grade ∈ {C,D,F}). |
| Sort: Recent / Most progress / Highest grade / Most versions | ⚠️ derivable | all from fields above | — | Client-side sort. |
| Cross-version delta metrics (LUFS, Dyn range, Bass energy, Air, Width) | ⚠️ derivable | each version's `analysis_results.final_json` (phase1 LUFS/peak; phase3/4 spectral; phase2 stereo) | — | Frontend reads two `final_json` blobs and computes deltas. No backend work for the in-card preview; "Open full diff" route would be new. |
| `ActiveDeltaCard` "verdict" prose sentence | 🔨 pipeline | not generated | M (days) | LLM-authored narrative comparing two results. Stub with template string for v1 (e.g. "vN traded X LU of loudness for Y LU of dynamic range"). |
| "Open full diff" page | 🟠 deferred | not built | M (days) | Separate route/page not in scope of this audit. |
| `+ New song` CTA | ✅ exists | `POST /songs` (new — currently songs created implicitly via upload) | S (hours) | Existing flow creates a Song row when a track_name is supplied. Need explicit `POST /songs {name, genre_hint}` for empty-song-first creation. |
| `+ Add version` CTA | ✅ exists | `POST /uploads/` with `song_id` form field (new) | S (hours) | Upload flow exists; needs an optional `song_id` to bind directly instead of inferring by name. |
| `↺ Re-analyze` CTA | ✅ exists | `POST /uploads/{job_id}/reanalyze` or `POST /songs/{id}/versions/{v}/reanalyze` (new) | S (hours) | Re-runs the worker pipeline on the existing file_path. |
| `★ Publish to Discover` CTA | ❌ blocked | no public publishing feature | L (week+) | Belongs to a separate Discover surface; out of scope for Library v1. Stub button or hide. |
| Cover-art component (`CoverArt hue=…`) | ⚠️ derivable | none | — | Pure SVG/CSS generated from a hue value; no asset upload, no storage. |
| "edited Nd ago" footer string | ⚠️ derivable | `songs.updated_at` | — | |
| "vN-1↔vN" mini-pill in card footer | ⚠️ derivable | `versions.length >= 2` | — | Purely informational. |

## Interactions
| Trigger | Action | Backend route | DB changes |
|---|---|---|---|
| Page mount | Fetch user library | `GET /songs?include=versions,latest_result` (new) | none |
| Click card / row | Navigate to SongDetailPage | client route `/library/:songId` | none |
| Click `+ New song` | Open new-song modal → create empty Song | `POST /songs {name, genre_hint?}` (new) | INSERT `songs` row |
| Click `+ Add version` (on SongDetailPage) | Open upload modal pre-bound to song | `POST /uploads/ {song_id, file, label?, reference?}` (extend existing route) | INSERT `song_versions` + `upload_jobs` |
| Click `↺ Re-analyze vN` | Dispatch new analysis job for existing version file | `POST /songs/{id}/versions/{v}/reanalyze` (new) | INSERT `upload_jobs` referencing existing `song_versions.id` |
| Click `★ Publish to Discover` | (deferred — out of scope) | — | — |
| Click version dot on timeline | Set `selected` (local state) | none | none |
| Shift-click version dot | Set `compare` (local state) | none | none |
| Click `⇄ Compare` on version row | Toggle compare target | none | none |
| Click `Open` on version row | Navigate to analysis results | client route `/reports/:jobId` (exists) | none |
| Click `Open full diff →` in ActiveDeltaCard | Navigate to diff page (deferred) | — | — |
| Click filter chip | Client-side filter | none | none |
| Click sort dropdown | Client-side sort | none | none |
| Toggle grid/list | Local view state | none | none |
| Archive song (not in mock UI but filter exists) | Soft-archive | `POST /songs/{id}/archive` (new) | UPDATE `songs.archived_at` |

## Real-time / streaming behavior
None on the LibraryPage grid/list itself.

On SongDetailPage, if a re-analyze or new-version upload is in flight, the version row needs job-status updates — reuse the existing SSE job-stream (`GET /jobs/{id}/stream`) per pending version. No new transport needed.

## Open product questions
- "Current version" semantics: auto-flag newest (`MAX(version_number)`) vs explicit `is_current` column the user can pin to an older mix they prefer? Mock uses an explicit flag. Recommend explicit column for forward-compat (a v6 master might be worse than v5).
- `hue` for cover art: add `songs.cover_hue` column, derive deterministically from `hash(song.id)`, or seed from genre? Genre derivation will collide (every Prog House song looks identical). Recommend `hash(song.id) % 360` with no schema change.
- `plays` counter implies play-tracking infra (event capture, aggregation, possibly per-user vs global counts). Cut or stub for v1?
- "Needs work" filter: threshold definition (C and below? D and below? presence of `critical` verdicts?). Needs product decision.
- "Archived" filter implies an archive action; not present in the mock UI. Add a row-level overflow menu with Archive/Delete/Rename?
- Cross-version delta: which 6 metrics are canonical? Mock picks {Score, LUFS, Dyn range, Bass energy, Air, Width} — confirm these vs. e.g. True Peak, Stereo correlation, Mono compat.
- `ActiveDeltaCard` verdict prose: generated by Claude/Anthropic call (cost) or templated from numeric deltas (free)? Recommend templated for v1.
- Should the version label be free-form (mock allows `(unlabeled)`) or constrained (e.g. "rough mix", "mix v1", "master") via enum?
- Re-analyze policy: does it create a new `SongVersion`, or a new `UploadJob` against the same `SongVersion`? Mock implies the latter — re-analysis updates the same version's score.
- "Publish to Discover" — this whole concept needs its own product surface; not blocking Library v1 if we ship without it.

## Build verdict

**🟡 IMPLEMENT WITH PLACEHOLDERS** — the iteration-arc UX is the centerpiece and is fully buildable today (all data either exists in `songs` / `song_versions` / `analysis_results` or is trivially derivable). Backend gaps are small: one new `GET /songs?include=…` aggregation route, `POST /songs`, `POST /songs/{id}/versions/{v}/reanalyze`, and extending `POST /uploads/` to accept `song_id`. Cosmetic/cut items (`plays`, `Publish to Discover`, ActiveDeltaCard LLM verdict prose, "Open full diff" page) can ship as stubs or be omitted without breaking the primary value loop.

The two real schema decisions are: (1) `song_versions.is_current` flag — recommended for explicit pinning, and (2) cover-art hue — recommend derive-from-hash, no column.

## Recommended cuts / placeholders for v1
- **`plays` counter** — hide entirely or hardcode 0; play-event capture is its own epic.
- **`★ Publish to Discover` button** — hide; Discover is a separate surface.
- **"Archived" filter** — keep the chip but defer the archive action UI (server column already exists).
- **`ActiveDeltaCard` "verdict" prose paragraph** — render templated string ("vN gained +X mix-score points; loudness Y → Z, dyn range A → B") instead of LLM-generated narrative.
- **"Open full diff →" CTA** — disable or hide; route the user to compare-the-two-reports as a stretch goal.
- **Genre/BPM/Key on card** — show only if latest version has a completed analysis; gracefully omit for songs with only in-progress versions.
- **Waveform stripe on cover** — current code generates a fake sine-based bar pattern. Either keep as visual decoration (pure-client) or replace with the real `phase1` waveform_overview at SongDetail level only (not on every card — too expensive).
- **`scoreDelta` callout** — only show when `versions.length >= 2`; otherwise hide.
- **`+ New song` standalone flow** — initial v1 can keep the "upload creates song-on-the-fly" path; explicit empty-song creation is a small follow-up.

## Notes
- Existing frontend (`components/frontend/`) already has `LibraryPage.tsx`, `SongDetailPage.tsx`, `SongCard.tsx`, `VersionRow.tsx` (per CLAUDE.md commits e520308 / 601c786 / e082139). Those use the live `/tracks` + `/jobs` routes. The new design supersedes the visual layer but the data-fetch hooks (`useLibrary`, `useSongDetail`) are likely reusable — confirm shape parity with the new `/songs?include=…` payload before discarding.
- Backend `GET /tracks` (v1.1) groups *jobs* by `track_name` string. The new design treats `Song` as a first-class entity (it already is in the schema) — recommend replacing `/tracks` with `/songs` to align route with model, and deprecating `/tracks`.
- `SongDetailPage` shift-click compare is a clever interaction but undiscoverable; the helper text exists ("Click a version to inspect · shift-click to compare") — keep it visible.
- Mock `library` array has helpers at the bottom (`s.grade = cur.grade`, `s.versionCount = s.versions.length`, `s.scoreDelta = …`) — these are computed client-side from the versions array, not separate fields. Backend should NOT add columns for them; just return the versions array and let the client derive.
- The `ProgressTimeline` SVG renders fine for songs with 1–10 versions but will get crowded past ~15. Consider a "show last N" or horizontal-scroll affordance for long histories. None of the mock library entries exceed 6 versions.
- `coachFix` / verdict-related fields are NOT used on the Library page — they belong to the analysis report. Library only needs the score/grade aggregate per version.
