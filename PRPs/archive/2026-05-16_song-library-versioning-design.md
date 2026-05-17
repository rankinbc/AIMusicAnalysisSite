# Song Library, Versioning, and Delta Analysis — Design Spec

**Date:** 2026-05-16
**Status:** Draft — awaiting implementation plan
**Author:** brainstorming session with rankinbc

---

## 1. Summary

Today, every audio upload is a standalone analysis job; the only song-grouping mechanism is the legacy `track_name` string + `/tracks` route. There is a partially-built `Song` model and `/songs` router, but they auto-create songs from uploads and only store the most-recent file path — there is no concept of a *version* as a first-class entity, no upload-without-analysis path, no re-analysis of a stored version, and no delta-between-versions feature.

This spec defines a **post-hoc-curated song library with first-class versions and on-demand delta analysis**. The user can:

- Quick-analyze an audio file with no library involvement (today's flow, retained).
- After analysis, optionally save the result to the library — as a new song, or as the next version of an existing song.
- Upload a new audio file directly into a song (as a new version) without running analysis.
- Run or rerun analysis on any version that lives in the library.
- Generate a delta comparison between any two versions of the same song — quantitative metric diff + verdict evolution + a Claude-generated narrative.

The Library becomes a sibling top-level route alongside the existing Upload page. Songs and versions are created **only when the user explicitly asks**.

---

## 2. Goals and non-goals

### Goals
- First-class `Song` and `SongVersion` entities with deterministic version ordering.
- A user can curate which analyses end up in their library — quick-analyze does not auto-add.
- Versions can exist without an analysis (audio-only) and analyses can exist without a version (standalone).
- Delta analysis between any two versions of the same song, cached and replayable.
- Existing analysis pipeline, verdict pipeline, and SSE/upload mechanics are reused without modification.

### Non-goals (v1)
- Sharing a song or a delta publicly (only per-analysis sharing remains, unchanged).
- Auto-generation of deltas on analysis-complete (on-demand only).
- Rate-limiting or per-user cost caps on delta generation.
- Replacing the post-login landing page (UploadPage stays as default).
- Introducing vitest / playwright into `frontend-spectr` (manual UAT only).
- Cover art, release dates, tags on songs.

---

## 3. User flows

### 3.1 Quick analyze (today's flow, retained)
1. User drops audio on UploadPage.
2. Server saves audio, dispatches Celery (`UploadJob.version_id = NULL`).
3. ProcessingPage streams SSE progress.
4. ResultsPage renders.
5. ResultsPage shows **"Save to Library"** CTA. User can:
   - Save as new song → name input → song created, this job linked as v1.
   - Add to existing song → autocomplete picker → new version created, this job linked, server assigns next `version_number`.
   - Ignore — job stays in `/jobs` history forever, audio file is purged after 30 days.

### 3.2 Upload to library (no analysis)
1. User navigates to LibraryPage → opens a song → clicks "+ Add Version".
2. AddVersionModal: file picker + optional reference / als / stems + optional label + optional multi-line notes.
3. Server stores files on `SongVersion`. No `UploadJob` created, no Celery dispatch.
4. Version appears in the song's versions list with "Analyze" action button.

### 3.3 Analyze a stored version
1. User clicks "Analyze" (or "Re-analyze") on a version row.
2. Server creates `UploadJob(version_id=...)`, dispatches Celery.
3. ProcessingPage streams progress (existing flow).
4. On complete, version row shows updated score/grade. Older analyses for that version remain in the version's analysis history.

### 3.4 Compare two versions (delta)
1. User opens song detail page, picks two versions in the "Compare" picker (defaults to the two most recent COMPLETE-analyzed versions), clicks "Compare".
2. Server checks delta cache.
3. Frontend opens SSE on `/songs/{id}/deltas/{delta_id}/stream`.
4. DeltaPage renders headline + metric diff + verdict evolution instantly; narrative tokens stream in.

### 3.5 Soft-delete and restore
1. User clicks delete on a song → confirmation modal (type the song name).
2. Server sets `archived_at = now()`. Song disappears from Library.
3. Restore action within 30 days clears `archived_at`.
4. After 30d, daily beat task hard-purges (cascade through versions, jobs, files on disk).

---

## 4. Data model

### 4.1 New table: `song_versions`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `song_id` | UUID FK → `songs.id` ON DELETE CASCADE | indexed |
| `version_number` | INTEGER | Default: next available for the song. **User-editable.** Unique per song. |
| `label` | VARCHAR(120) NULL | User-supplied free-text label (e.g. "after mastering pass"). |
| `notes` | TEXT NULL | Multiline notes. |
| `file_path` | VARCHAR(500) NOT NULL | Owns the audio file on disk. |
| `reference_path` | VARCHAR(500) NULL | |
| `als_file_path` | VARCHAR(500) NULL | |
| `stem_paths_raw` | JSONB NULL | Raw stem upload paths. |
| `stem_paths` | JSONB NULL | Confirmed role→path mapping (filled after `/versions/{id}/stems/confirm`). |
| `created_at` | TIMESTAMPTZ | Immutable chronological order — used as the canonical sort key for delta "previous version". |
| `updated_at` | TIMESTAMPTZ | |

**Constraints:**
- `UNIQUE (song_id, version_number)`
- `INDEX (song_id, created_at DESC)`

### 4.2 Changes to `upload_jobs`
- **Add** `version_id` UUID FK → `song_versions.id` ON DELETE CASCADE, nullable, indexed.
- **Drop** `song_id` (replaced by `version_id` — chain is `job → version → song`).
- **Drop** `track_name` (legacy `/tracks` system removed).
- `stem_paths_raw` and `stem_paths` columns are **retained on UploadJob for v1** to avoid a destructive data move; SongVersion will also carry these fields. New code writes to SongVersion only. A follow-up migration deduplicates.

### 4.3 Changes to `songs`
- **Drop** `file_path`, `reference_path`, `als_file_path` — audio now lives on `SongVersion`.
- **Add** `archived_at TIMESTAMPTZ NULL` for soft-delete (30-day restore window).
- Retained: `id`, `user_id`, `name`, `genre_hint`, `created_at`, `updated_at`.
- Existing `UNIQUE (user_id, name)` constraint (`uq_songs_user_name`) is retained — `POST /songs/` returns **409 `song_name_in_use`** on duplicate.

### 4.4 New table: `version_deltas`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `song_id` | UUID FK → `songs.id` ON DELETE CASCADE | |
| `from_version_id` | UUID FK → `song_versions.id` ON DELETE CASCADE | |
| `to_version_id` | UUID FK → `song_versions.id` ON DELETE CASCADE | |
| `from_job_id` | UUID FK → `upload_jobs.id` | The specific analysis run that was diffed. |
| `to_job_id` | UUID FK → `upload_jobs.id` | |
| `payload` | JSONB | Full structured delta payload (see §6). |
| `prompt_version_set` | VARCHAR(2000) | Delta-narrative prompt version + all verdict prompt versions of from/to. |
| `model` | VARCHAR(50) | Claude model ID used. |
| `created_at` | TIMESTAMPTZ | |

**Constraints:**
- `UNIQUE (from_job_id, to_job_id, prompt_version_set)` — cache key.

### 4.5 Cascade rules
- Delete `User` → cascade all the way down (existing behavior).
- Soft-delete `Song` (`archived_at` set) → hidden from `/songs/`; restorable for 30d.
- Hard-purge `Song` (beat task after 30d) → cascade-deletes versions, their jobs+results, audio files on disk.
- Hard-delete `SongVersion` → cascade-deletes its jobs + results + audio files on disk. Loud action, confirmation required client-side.

### 4.6 Migration (alembic, one file)
1. Create `song_versions` table.
2. Create `version_deltas` table.
3. Add `upload_jobs.version_id`. Add `songs.archived_at`.
4. Backfill:
   - For each `Song`: INSERT one `SongVersion(song_id, version_number=1, file_path=Song.file_path, reference_path, als_file_path, created_at=Song.created_at, updated_at=Song.updated_at)`.
   - For each `UploadJob` with `song_id IS NOT NULL`: `UPDATE upload_jobs SET version_id = (SELECT id FROM song_versions WHERE song_id = upload_jobs.song_id LIMIT 1)`.
5. Drop columns: `upload_jobs.song_id`, `upload_jobs.track_name`, `songs.file_path`, `songs.reference_path`, `songs.als_file_path`.

**Forward-only after deploy** — column drops are destructive. Staging gets validated first; production migration runs in a maintenance window. Down-revision exists as a best-effort restore (recreates columns, copies values back from `song_versions`) but is not guaranteed reversible.

---

## 5. API surface

### 5.1 Songs

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/songs/` | Create empty song. Body: `{name: str, genre_hint?: str}`. Returns the Song. **409** on duplicate name for same user. |
| `GET` | `/songs/` | List user's songs (excludes archived). Each entry: latest version summary + latest analysis score/grade + analysis count + last_analyzed_at. |
| `GET` | `/songs/{id}` | Song detail: full versions list, each with latest analysis summary. |
| `PATCH` | `/songs/{id}` | Edit name, genre_hint. |
| `DELETE` | `/songs/{id}` | Soft-delete (sets `archived_at`). |
| `POST` | `/songs/{id}/restore` | Clear `archived_at` within 30d. After 30d, returns 410. |

### 5.2 Versions

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/songs/{id}/versions` | **Upload-to-library, no analysis.** Multipart form fields: `file` (required), optional `reference`, `als`, `stems`, `reference_stems`, `label`, `notes`. Server assigns next `version_number`. Returns the new SongVersion. If stems are included, returns proposed mapping (existing pattern). |
| `POST` | `/versions/{id}/stems/confirm` | Confirm stem role→path mapping for a version. Same payload as today's `/uploads/{job_id}/stems/confirm`. |
| `GET` | `/versions/{id}` | Version detail: audio metadata + ordered list of all UploadJobs (analysis runs) for this version. |
| `PATCH` | `/versions/{id}` | Edit `version_number`, `label`, `notes`. |
| `DELETE` | `/versions/{id}` | Hard-delete. Cascades to jobs + results + files. |
| `POST` | `/versions/{id}/analyze` | Run or rerun analysis on this version. Creates `UploadJob(version_id=this)`, dispatches Celery. Returns `{job_id}`. |

### 5.3 Quick-analyze (today's standalone flow)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/uploads/` | Existing flow. **`track_name` form field removed.** Returns `{job_id}`. `version_id` stays NULL. |
| `POST` | `/jobs/{job_id}/save-to-library` | Post-analysis CTA endpoint. Body: <br>• `{action: "new_song", name: str, genre_hint?: str, label?: str, notes?: str}` — creates Song + SongVersion (v1), links job. <br>• `{action: "add_to_song", song_id: UUID, label?: str, notes?: str}` — creates new SongVersion (next version_number), links job. <br>Both paths reuse the job's existing `file_path` (the SongVersion FK-references the same file on disk; no copy). Returns `{song_id, version_id}`. |

### 5.4 Delta

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/songs/{id}/deltas` | Generate or return cached delta. Body: `{from_version_id?: UUID, to_version_id?: UUID}` — if omitted, server picks the two most recent COMPLETE-analyzed versions. Returns `{delta_id, status: "ready" | "generating"}`. |
| `GET` | `/songs/{id}/deltas` | List all cached deltas for this song. |
| `GET` | `/songs/{id}/deltas/{delta_id}` | Fetch finished delta payload. |
| `GET` | `/songs/{id}/deltas/{delta_id}/stream` | SSE stream during generation. Events: `metrics` (instant), `verdict_evolution` (instant), `narrative_token` (per token), `done`. |

### 5.5 Removed
- `GET /tracks/` — legacy.
- `POST /songs/{id}/analyze` — replaced by per-version endpoint.
- `track_name` form field on `POST /uploads/`.

### 5.6 Auth and safety
- Every endpoint depends on `get_current_user` (existing).
- Every query filters by `user_id` at the SQL level (CLAUDE.md IDOR rule). Version and delta endpoints filter via join through `songs.user_id`, never by Python post-filter.
- IDOR negative tests: every endpoint tested with `user_b` token against `user_a`'s resources must return **404** (not 403 — leaks less existence info).

---

## 6. Delta engine

### 6.1 Code layout

| Path | Purpose |
|---|---|
| `components/shared/aimusic_shared/deltas/models.py` | Pydantic models: `DeltaPayload`, `MetricDiff`, `VerdictEvolution`, `Narrative`. |
| `components/shared/aimusic_shared/deltas/metrics_diff.py` | Pure deterministic metric diffing with significance thresholds. |
| `components/shared/aimusic_shared/deltas/verdict_matcher.py` | Rule-based verdict-evolution matching. |
| `components/api/app/delta_pipeline/orchestrator.py` | End-to-end: load both AnalysisResults, run metric diff, run verdict matcher, dispatch narrative LLM, assemble + cache + emit SSE. |
| `components/api/app/delta_pipeline/narrative.py` | Build prompt, invoke CLI wrapper, parse + schema-validate response. |
| `components/api/app/delta_pipeline/prompt_loader.py` | Load `delta_narrative.md` (with frontmatter version). |
| `components/api/app/routers/deltas.py` | REST + SSE surface mounted under `/songs/{id}/deltas`. |
| `components/api/app/prompts/delta_narrative.md` | The Claude prompt for narrative generation. |

### 6.2 Payload structure

```python
class DeltaPayload(BaseModel):
    delta_id: UUID
    from_version: VersionSummary       # version_number, label, created_at
    to_version: VersionSummary
    from_job_id: UUID
    to_job_id: UUID
    metric_diff: MetricDiff
    verdict_evolution: VerdictEvolution
    narrative: Narrative
    generated_at: datetime

class MetricDiff(BaseModel):
    overall_score_delta: int                # int diff
    grade_from: str
    grade_to: str
    lufs_integrated_delta: float            # dB
    lufs_significance: Literal["unchanged", "slightly_louder", "louder", "much_louder", "slightly_quieter", "quieter", "much_quieter"]
    true_peak_db_delta: float
    bpm_delta: float
    key_delta_semitones: int                # null if either side missing detected_key
    mono_compatibility_delta: float
    danceability_delta: int
    frequency_band_deltas: dict[str, float] # band name → dB delta
    stem_clash_count_delta: int | None      # null if either side missing stem analysis

class VerdictEvolution(BaseModel):
    resolved: list[VerdictRef]      # non-win verdict in `from`, no match in `to`
    improved: list[VerdictPair]     # matched, severity went down
    persisting: list[VerdictPair]   # matched, severity same
    worsened: list[VerdictPair]     # matched, severity went up
    new: list[VerdictRef]           # non-win verdict in `to`, no match in `from`
    praises_from: list[VerdictRef]  # severity="win" verdicts on the `from` side
    praises_to:   list[VerdictRef]  # severity="win" verdicts on the `to` side

class Narrative(BaseModel):
    summary: str                            # <= 600 chars, producer voice
    tone: Literal["positive", "mixed", "regression"]
    headline_change: str                    # <= 80 chars
```

### 6.3 Verdict matching rules (deterministic)

Schema reference: `Verdict` (from `components/shared/aimusic_shared/verdicts/models.py`) has `category: Category` (enum of ~25 values), `specialist: str`, `severity: Literal["critical","severe","moderate","minor","win"]`, `evidence: list[Evidence]` where each `Evidence` may carry `frequency_range_hz: Optional[tuple[float, float]]`, and `fix: Optional[Fix]` where `fix.target` is `{"type": "stem"|"master"|"bus", "name": str}`.

For each verdict, derive helpers:
- `freq_ranges(v)` = the set of `frequency_range_hz` values on its evidence entries (may be empty).
- `stem_target(v)` = `fix.target.name` if `fix and fix.target.type == "stem"`, else `None`.

`severity="win"` verdicts (praises, not problems) are **excluded from matching** in both `from` and `to`. They are reported as a separate `praises` list on the payload (not part of the evolution buckets).

Two non-win verdicts match if:
- `from.category == to.category` AND `from.specialist == to.specialist`, AND
- At least one of:
  - Both have non-empty `freq_ranges`, and at least one pair of ranges (one from each side) overlaps by ≥10% of the shorter range, OR
  - `stem_target(from) == stem_target(to)` and both are non-None, OR
  - Category is one of the structural categories that lack frequency/stem context: `{"sections", "trance_arrangement", "section_contrast", "density", "humanization", "chord_harmony"}`.

Classification of matched pairs (severity ordering: `critical > severe > moderate > minor`):
- `to.severity < from.severity` → **IMPROVED**
- `to.severity == from.severity` → **PERSISTING**
- `to.severity > from.severity` → **WORSENED**

Unmatched:
- Non-win verdict only in `from` → **RESOLVED**
- Non-win verdict only in `to` → **NEW**

When a verdict has multiple candidate matches on the other side, pick the candidate with the most overlapping evidence ranges (or any if tied) — each verdict participates in at most one pair.

### 6.4 Narrative LLM call
- Transport: existing CLI wrapper (`USE_CLAUDE_CLI=true`), `subprocess.run` inside `asyncio.to_thread`, shared `asyncio.Semaphore(1)` with the verdict pipeline (CLI is not concurrency-safe).
- Model: `claude-sonnet-4-6` (cheaper than Opus, sufficient for 2-4 sentence narrative).
- Prompt input bundles: metric_diff + verdict_evolution + version labels + genre.
- Output is JSON-mode, schema-validated against `Narrative`. Parse failure or schema mismatch → fallback `Narrative(summary="Comparison generated (narrative unavailable — try again).", tone="mixed", headline_change="—")`. Structured parts (metrics, verdict evolution) still ship.

### 6.5 Caching
- Cache key: `(from_job_id, to_job_id, prompt_version_set)`.
- `prompt_version_set` = `delta_narrative.md` frontmatter version concatenated with the `verdicts_prompt_version_set` of both `from` and `to` analyses. Bumping any of those invalidates exactly those deltas.
- Cache stored in `version_deltas` table (§4.4).
- Existing cached deltas remain accessible as historical records after re-analysis of a version — the user explicitly chooses which two job_ids to diff.

### 6.6 Errors
| Condition | HTTP | Code |
|---|---|---|
| Either version has no COMPLETE analysis | 422 | `version_not_analyzed` |
| In-flight analysis on either version | 409 | `analysis_in_progress` |
| Both version IDs identical | 422 | `same_version` |
| Versions belong to different songs | 422 | `cross_song_delta` |
| Versions belong to a different user | 404 | (IDOR — no body) |

---

## 7. Frontend (frontend-spectr, vanilla JSX)

The current frontend is a state-machine in `App.jsx`. No router is introduced.

### 7.1 New top-level states
- `library` — Library page.
- `song-detail` — Song detail page.
- `delta` — Delta view.

### 7.2 New pages
| File | Purpose |
|---|---|
| `pages/LibraryPage.jsx` | Grid of song cards. Top-right "+ New Song" button (opens NewSongModal). Empty state: large "+ Create your first song" CTA. |
| `pages/SongDetailPage.jsx` | Header (name + genre + edit/delete). Score-over-time sparkline. Versions list (newest first), each row: label, version_number, created_at, latest analysis score/grade, action buttons (Analyze / Re-analyze / View results / Delete). Bottom: "Compare versions" dual-picker → "Compare" button. Floating "+ Add Version" action. |
| `pages/DeltaPage.jsx` | Header: from vs to with score/grade delta and tone badge. Body: `<NarrativeCard/>`, `<MetricDiffTable/>`, `<VerdictEvolution/>`. Loading skeletons during SSE. "Back to song" link. |

### 7.3 New components
| File | Purpose |
|---|---|
| `components/SongCard.jsx` | Library grid tile: name, version count, latest score/grade, mini sparkline thumbnail. |
| `components/VersionRow.jsx` | Row in versions list. |
| `components/NewSongModal.jsx` | Name + optional genre. Calls `POST /songs/`. |
| `components/AddVersionModal.jsx` | File picker (file + optional reference / als / stems) + label + notes. Reuses existing upload XHR with progress bar. Calls `POST /songs/{id}/versions`. |
| `components/SaveToLibraryModal.jsx` | **Post-analysis CTA** on ResultsPage. Two tabs: "Save as new song" (name) and "Add to existing song" (autocomplete over `/songs/`). On confirm calls `POST /jobs/{job_id}/save-to-library`, routes to song-detail. |
| `components/DeleteSongModal.jsx` | Type-the-name confirmation for soft-delete. |
| `features/delta/DeltaHeadline.jsx` | Score delta + tone badge + headline_change. |
| `features/delta/MetricDiffTable.jsx` | Side-by-side table with significance annotations. |
| `features/delta/VerdictEvolution.jsx` | Five collapsible sections (Resolved / Improved / Persisting / Worsened / New), each lists verdicts with deep-link to view full verdict. |
| `features/delta/NarrativeCard.jsx` | LLM narrative with skeleton during stream. |

### 7.4 API client additions (`src/api/`)
- `songs.js` — add `createSong`, `patchSong`, `deleteSong`, `restoreSong`, `listVersions`, `createVersion`, `analyzeVersion`, `patchVersion`, `deleteVersion`, `confirmVersionStems`.
- `deltas.js` — new: `generateDelta(songId, fromId, toId)`, `getDelta(songId, deltaId)`, `listDeltas(songId)`.
- `uploads.js` — add `saveToLibrary(jobId, body)`.

### 7.5 New hook
- `hooks/useDeltaStream.js` — mirrors `useJobStream`. Opens SSE on `/songs/{id}/deltas/{delta_id}/stream`. Surfaces reactive state `{status, metrics, verdictEvolution, narrative}`. Closes EventSource on unmount.

### 7.6 Navigation changes
- Add a "Library" button to whatever the current header/profile-button area is in App.jsx.
- Default landing after login: **UploadPage stays as today.** Moving the default landing to Library is a separate UX decision out of scope here.

### 7.7 Removals
- Delete the embedded `SongLibrary.jsx` panel from UploadPage — it is superseded by the top-level LibraryPage.

### 7.8 Auth + error display
- All API calls go through existing `client.js` (`apiRequest`) — cookie-based auth.
- 401 → `onLogout()`.
- 410 on save-to-library → inline "Recording has expired; please re-upload" banner.
- 409 on version_number conflict → inline "Use {proposed} instead" affordance.
- 422 / 409 on delta endpoints → inline error banner on DeltaPage.

---

## 8. Lifecycle, edge cases, ops

### 8.1 Storage TTLs
- **SongVersion-owned files** live as long as the version (or its song).
- **Standalone UploadJob files** (`version_id IS NULL`) — **30-day TTL** enforced by new daily beat task `cleanup_orphan_uploads`. After purge, audio/reference/als/stem paths on the job are nulled; analysis JSON stays.
- ResultsPage surfaces an explicit "Save to Library before {date}, or this recording will be removed" banner so the TTL isn't a surprise.

### 8.2 Soft-delete and hard-purge
- `DELETE /songs/{id}` sets `archived_at`. Song hidden from `/songs/`. UploadJobs / AnalysisResults remain.
- `POST /songs/{id}/restore` clears `archived_at` if within 30d, else 410.
- New daily beat task `purge_archived_songs`: any song with `archived_at < now() - 30d` is hard-deleted (cascade through versions, jobs, files on disk).

### 8.3 Stem mapping for library-only uploads
- `POST /songs/{id}/versions` with stems puts the new SongVersion into a pending-mapping state.
- Frontend calls `POST /versions/{id}/stems/confirm` to commit the role→path mapping (reuses today's `propose_mapping` + confirmation pattern).
- Hourly beat task already auto-fails stale AWAITING_STEM_MAPPING UploadJobs; **extend** it to also fail/purge SongVersions that have been pending-mapping for >24h with no analysis ever run.

### 8.4 Concurrency
- `POST /versions/{id}/analyze` returns **409 `analysis_in_progress`** if any `UploadJob(version_id=this, status IN (PENDING, PROCESSING, AWAITING_STEM_MAPPING))` exists.
- Worker concurrency unchanged (=1). Analyses across versions serialize on the Celery queue.

### 8.5 version_number conflicts
- `UNIQUE (song_id, version_number)` enforces.
- `PATCH /versions/{id}` catches `IntegrityError`, returns **409** with `{code: "version_number_in_use", proposed: <next-free-int>}`. UI offers "use {proposed}" affordance.

### 8.6 Delta validity over time
- Deltas are cached against specific `(from_job_id, to_job_id)` pairs and live permanently.
- Re-analyzing a version creates a new `UploadJob`; the old delta against the old job_id remains as a historical record.
- DeltaPage shows "Comparing analysis from {date} vs analysis from {date}" so staleness is visible.

### 8.7 Sharing (unchanged)
- Existing `share_token` on `AnalysisResult` still works per-analysis.
- Public `/reports/share/{token}` does **not** leak song or version metadata (only analysis fields). No regression introduced.
- Sharing a whole song / version-history chart / delta is **out of scope for v1**.

### 8.8 Cost guardrails
- No rate-limit on delta generation in v1. Revisit once production cost data exists.

### 8.9 Cleanup follow-ups (not v1)
- Migrate `stem_paths_raw` / `stem_paths` off `upload_jobs` (left on UploadJob for v1 to avoid destructive data move).
- Introduce vitest + playwright into `frontend-spectr`.
- Auto-generate "vs previous version" delta when an analysis completes.
- Public sharing of whole songs or deltas.
- Cover art, release date, tags on songs.

---

## 9. Testing

### 9.1 Pure-logic unit tests — `components/shared/aimusic_shared/deltas/`
- `metrics_diff.py`:
  - Identical analyses → zero deltas everywhere.
  - Score +5 → headline reflects +5, grade transition (B → A-).
  - LUFS shift +0.5 → "slightly louder"; +3.0 → "much louder".
  - Key change → correct semitone delta across enharmonics.
  - Missing optional fields on one side → no crash, structured absence.
- `verdict_matcher.py`:
  - Same (category, specialist) + overlapping evidence frequency range → matched.
  - Same (category, specialist), disjoint evidence ranges → not matched (resolved + new).
  - Same (category, specialist), same `fix.target.name` stem → matched (no freq overlap required).
  - Structural category (e.g. `sections`) with no freq/stem context → matched on category+specialist alone.
  - Severity `critical` → `moderate` → IMPROVED.
  - Same severity → PERSISTING.
  - Severity `moderate` → `critical` → WORSENED.
  - `severity="win"` verdicts excluded from buckets, routed to `praises_from`/`praises_to`.
  - Verdict only in `from` (and not a win) → RESOLVED.
  - Verdict only in `to` (and not a win) → NEW.
  - Empty `from` → entire non-win `to` set is NEW.

### 9.2 Delta pipeline tests — `components/api/app/delta_pipeline/`
- Orchestrator returns cached delta on `(from_job_id, to_job_id, prompt_version_set)` hit.
- Orchestrator generates fresh on cache miss; second call hits cache.
- LLM narrative parse failure → fallback narrative inserted; structured parts intact.
- Narrative LLM call serializes on the shared semaphore (no concurrent CLI invocations).

### 9.3 Route tests — `components/api/tests/`
- `POST /songs/` creates a song; second POST with same name returns 409.
- `GET /songs/` excludes soft-deleted songs.
- `POST /songs/{id}/versions` (no stems) creates SongVersion without an UploadJob — assert no Celery dispatch.
- `POST /songs/{id}/versions` (with stems) returns 200 with proposed mapping; SongVersion is in pending-mapping state.
- `POST /versions/{id}/analyze` creates UploadJob with `version_id` set, dispatches Celery.
- `POST /versions/{id}/analyze` returns 409 if in-flight job exists.
- `POST /jobs/{id}/save-to-library` "new_song" path: Song + SongVersion created, job linked.
- `POST /jobs/{id}/save-to-library` "add_to_song" path: SongVersion created with next version_number, job linked.
- `POST /jobs/{id}/save-to-library` returns 410 when audio file is gone.
- `PATCH /versions/{id}` version_number conflict returns 409 with `proposed`.
- `DELETE /songs/{id}` sets `archived_at`; `POST /songs/{id}/restore` clears it.
- `POST /songs/{id}/restore` after 30d returns 410.
- IDOR: every endpoint with `user_b` token against `user_a` resources returns 404.

### 9.4 Integration test — `components/api/tests/integration/`
- Full flow: upload (standalone) → analyze → save-to-library new song → upload v2 to that song → analyze v2 → generate delta. Assert delta payload structure and that it is cached on second request.

### 9.5 Migration test — `components/api/tests/migrations/`
- Seed pre-migration DB with Song + UploadJob rows (old schema), run alembic upgrade, assert:
  - One SongVersion per old Song (version_number=1, paths copied).
  - UploadJob.version_id populated for all rows that had song_id.
  - Old columns gone.

### 9.6 Worker tests
- Worker tolerates `UploadJob.version_id IS NULL` and `IS NOT NULL` identically — analysis logic is unchanged.

### 9.7 Beat task tests
- `cleanup_orphan_uploads`: standalone job older than 30d → files removed from disk, job retained with paths nulled.
- `purge_archived_songs`: song with `archived_at < now() - 30d` → cascade delete works; idempotent on rerun.

### 9.8 Frontend (manual UAT)
Per CLAUDE.md, `frontend-spectr` has no automated test stack. Manual UAT checklist:
- New Song → name appears in Library grid → click → song detail empty state.
- Add Version (no stems) → upload-only → row appears, "Analyze" button visible, no Celery activity in logs.
- Analyze a version → progress → score appears on row, sparkline updates.
- Quick-analyze → results page → "Save to Library" → new song → song detail shows v1.
- Compare two versions → delta page renders metric table + verdict evolution; narrative streams in over SSE; closes cleanly on back-nav.
- Soft-delete song → disappears from library → restore within 30d → reappears.
- Edit `version_number` to a value that exists → 409 → "use {proposed}" affordance.

### 9.9 Validation gates (CLAUDE.md)
```bash
ruff check components/api/ components/shared/
mypy components/api/app/ --ignore-missing-imports
pytest -q components/shared/tests/
pytest -q components/api/tests/
pytest -q components/worker/tests/
alembic -c migrations/alembic.ini upgrade head
```

---

## 10. Open questions and assumptions

### 10.1 Closed by this brainstorming session
- Song creation is **explicit-only and post-hoc** — driven from the ResultsPage CTA or the LibraryPage "+ New Song" button.
- `version_number` is server-assigned by default but **user-editable** (with uniqueness constraint).
- All versions kept forever in the library — no audio retention limit.
- Delta delivers headline + measurable metrics + verdict evolution + LLM narrative (the full stack).
- Library lives as a sibling top-level route; UploadPage remains the default landing.
- Uploads to library can happen without analysis; analyses can be run/re-run on stored versions.
- Embedded `SongLibrary.jsx` panel on UploadPage is removed.

### 10.2 Assumed (call out if wrong)
- The existing verdict pipeline's `prompt_loader.SLUG_TO_FILENAME` pattern and frontmatter-versioning convention will be reused for `delta_narrative.md`.
- The 30d TTL on standalone UploadJob audio is an acceptable user-facing constraint. If users complain, raise the TTL or make it a per-user setting.
- Soft-delete + 30d restore is sufficient — no separate "trash bin" UI in v1 (restore is by direct URL/song-id only).
- Genre hint stays a single string on Song; not promoted to its own table.

### 10.3 Deferred
- Cover art / release dates / tags on songs.
- Public sharing of whole songs and deltas.
- Auto-generating deltas on analysis-complete.
- Vitest + playwright in frontend-spectr.
- Per-user rate limits / cost caps on delta generation.

---

## 11. Acceptance criteria

A reviewer can verify this spec is implemented when:

1. `migrations/versions/00X_song_library_versioning.py` applies cleanly against a production-like DB seeded with existing data, with `song_versions` and `version_deltas` populated and the old columns dropped.
2. `pytest components/api/tests/ components/shared/tests/ components/worker/tests/` is green, covering every case in §9.
3. A manual run of the UAT checklist in §9.8 completes without bugs.
4. `ruff check` and `mypy` pass cleanly on changed files.
5. The validation gates block in `CLAUDE.md` runs end-to-end with no failures.
6. `/tracks` route is removed; `track_name` form field is removed; `POST /songs/{id}/analyze` is removed — no callers in repo.
