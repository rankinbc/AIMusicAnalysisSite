# Requirements: Backend Capabilities

> **This document describes BOTH the legacy backend (still running today) AND the new v2 schema (EF Core, being built). Where they differ, columns are marked LEGACY (going away) or NEW (v2). The `final_json` JSONB shape inside `analyses.final_json` is preserved verbatim from the legacy worker.**

Reference inventory of what SPECTR can do today and what the v2 schema scaffold supports. Used as the audit baseline against the design files. Status as of 2026-05-17.

Each capability lists: what produces it, where it lands in the system, and any caveats. A field NOT in this doc is a field we don't have — design pages that need it require new pipeline work, new schema, or both.

**v2 schema source of truth:** `components/bff/src/Spectr.Data/Entities/*.cs` (EF Core, owns migrations). The Python analysis worker mirrors these via `aimusic_shared.models` for reads/writes only.

---

## Auth + identity

| Capability | Where (v2) | Notes |
|---|---|---|
| Register / login (email + password) | `POST /auth/register`, `POST /auth/login` | Returns access token + sets httpOnly refresh cookie |
| JWT refresh | `POST /auth/refresh` | Silent refresh on app mount; rotation on each refresh |
| Logout | `POST /auth/logout` (auth required) | Revokes refresh token server-side (NEW vs. legacy) |
| Current user | `GET /auth/me` | |
| Profile read/edit | `GET /me/profile`, `PATCH /me/profile` | NEW in v2 |
| Stats | `GET /me/stats` | NEW in v2 |
| Activity feed | `GET /me/activity` | NEW; UNION over jobs/songs/versions |

**Schema:** `users` — `Spectr.Data/Entities/User.cs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `email` | citext, unique | |
| `hashed_password` | text | bcrypt |
| `is_active` | bool | |
| `handle` | citext, unique | NEW; 3–32 chars, `[a-z0-9_]`; auto-seeded at register |
| `display_name` | text(80) | NEW |
| `bio` | text(500) | NEW |
| `avatar_hue` | smallint (0–359) | NEW |
| `banner_hue` | smallint (0–359) | NEW |
| `accent` | text(16) | NEW; cyan/violet/orange/yellow/green/red |
| `public_link` | text(200) | NEW |
| `ui_prefs` | jsonb | NEW; `{ density, ... }` |
| `created_at` | timestamptz | |

**Schema:** `refresh_tokens` — `Spectr.Data/Entities/RefreshToken.cs`. NEW table for server-side token revocation. Columns: `id`, `user_id`, `token_hash` (SHA-256 of cookie value), `expires_at`, `revoked_at`, `created_at`.

**Missing:** password reset, email verification, OAuth/social login, plan/tier, usage quotas.

---

## Audio upload + ingest

| Capability | Where | Notes |
|---|---|---|
| Upload as new version | `POST /versions/` | NEW; multipart; replaces legacy `POST /uploads/` |
| Magic-byte validation | First 4–12 bytes | MP3 / FLAC / WAV only — `Content-Type` ignored |
| Reference attachment | Via `analysis_jobs.reference_id` FK | Reference is a saved-library entity (`reference_tracks`), not an ad-hoc file |
| Optional `.als` project | Persisted on `song_versions.als_file_path` | Triggers phase 8 (ALS analysis) |
| Optional stems (1–30 files) | `song_versions.stem_paths_raw` (unmapped) → `stem_paths` (mapped) | Unlocks phase 4 stem analysis + 3 stem specialists |
| Job dispatch | dramatiq task posted to Redis from BFF | Replaces Celery (still in legacy worker until cutover) |

**Schema:** `analysis_jobs` — `Spectr.Data/Entities/AnalysisJob.cs`. Transient runtime state; on COMPLETE the worker inserts an `analyses` row.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid | denormalized for fast queries |
| `version_id` | uuid? | nullable for ad-hoc not-yet-saved analyses |
| `status` | text(32) | `pending|processing|complete|failed|awaiting_stem_mapping` |
| `current_phase` | text(64) | |
| `phase_pct` | double | |
| `reference_id` | uuid? | FK to `reference_tracks`; drives `used_count` |
| `task_id` | text(255) | dramatiq message id |
| `error_message` | text | |
| `dispatched_at` / `started_at` / `completed_at` / `failed_at` | timestamptz | |

Index: `(user_id, status)`.

**Storage layout** (`IFileStorage` abstraction):

```
audio/upload/{job_id}/source.{ext}
audio/upload/{job_id}/reference.{ext}
audio/upload/{job_id}/stems/{stem_name}.{ext}
audio/upload/{job_id}/project.als
peaks/{job_id}.json
reference/{reference_id}/audio.{ext}
avatars/{user_id}/{hash}.{ext}
```

Local disk in dev (`LocalDiskFileStorage`); Cloudflare R2 in prod (`R2FileStorage`). Swap via `STORAGE__PROVIDER=local|r2`.

**Missing:** URL-based reference import (Spotify/YouTube/SoundCloud); auto-titling from filename; multi-file batch upload.

---

## Job lifecycle + progress

| Capability | Where | Notes |
|---|---|---|
| Job state | `analysis_jobs.status` | PostgreSQL is source of truth |
| Progress streaming | `GET /jobs/{jobId}/stream` (SSE) | Per-phase progress |
| Job results | `GET /jobs/{jobId}/results` | Returns `final_json`; includes `song_id`, `song_name`, `version_id` when version-bound |
| Job list | `GET /jobs` | Paginated; includes score/grade summaries |
| Single job | `GET /jobs/{jobId}` | |
| Public share | `GET /share/{token}` | Public; reads `analyses.share_token` |
| Share generate / revoke | `POST/PATCH/DELETE /analyses/{id}/share` | NEW; lazy share-token generation |

**Schema:** `analyses` — `Spectr.Data/Entities/Analysis.cs`. One row per completed analysis (1:1 with successful `AnalysisJob`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `job_id` | uuid, unique | FK back to `analysis_jobs` |
| `user_id` | uuid | denormalized for IDOR-safe list queries |
| `version_id` | uuid? | nullable for ad-hoc analyses |
| `song_id` | uuid? | denormalized |
| `song_name` | text(200) | denormalized |
| `final_json` | jsonb | the big pipeline output blob (see below) |
| `phase_durations` | jsonb | `{ decode: 1240, loudness: 820, ... }` for Results timeline |
| `waveform_peaks_path` | text(500) | storage key to BBC `audiowaveform` JSON |
| `stem_metrics` | jsonb? | per-stem analysis (only when stems uploaded) |
| `share_token` | text(36)? | nullable; generated lazily on share-enable |
| `share_show_verdicts` | bool | controls public share verdict surfacing |
| `share_enabled_at` | timestamptz? | |
| `created_at` | timestamptz | |

Indexes: `user_id`, `version_id`, unique `(job_id)`, unique `(share_token)`.

**Missing:** notifications-on-complete (in-app or email), webhook callbacks, batch dispatch.

---

## Analysis pipeline — phase outputs (shape of `analyses.final_json`)

> The keys (`phase1`, `phase2`, …) below describe the **JSONB shape inside `analyses.final_json`**, preserved verbatim from the legacy backend. The Python worker writes this blob; the BFF deserializes it for the Results page.

### Phase 1 — Loudness + spectral

```
phase1.duration_seconds        float
phase1.integrated_lufs         float    (canonical LUFS)
phase1.lufs                    float    (alias)
phase1.true_peak_db            float    (4× oversampled dBTP)
phase1.peak_dbfs               float
phase1.clipping_detected       bool
phase1.clipped_sample_count    int
phase1.crest_factor            float
phase1.rms                     float    (linear scale; convert to dB with 20*log10)
phase1.bpm                     float
phase1.detected_key            string   (e.g. "F#" / "A min" via chroma_cqt)
phase1.key_detection_confidence float
phase1.mono_compatibility      float    (0.0–1.0 RMS ratio)
phase1.low_energy              float    (20–200 Hz RMS)
phase1.stereo_correlation      float    (-1.0 to 1.0)
phase1.stereo_width            float    (0.0–1.0)
phase1.bands                   {sub_bass, bass, low_mid, mid, upper_mid, presence, air}  (dB per band)
```

### Phase 2 — Genre classification

```
phase2.genre                   string   (e.g. "trance" / "house" / "techno" / "dnb" / "other")
phase2.confidence              float    (0.0–1.0)
phase2.stereo_correlation      float    (redundant w/ phase1)
```

### Phase 3 — Genre-specific sub-scores

```
phase3.total_score             int      (0–100, weighted by genre rubric)
phase3.sub_scores              dict     (e.g. {"low_mid_energy": 0.31, "groove_score": 78, …})
phase3.low_mid_energy          float
```

### Phase 4 — Stem clash detection + per-stem analysis

```
phase4.clashes                 [{stems: "Kick vs Bass", frequency_range: "60–120 Hz",
                                 severity: "high|moderate", eq_suggestion: "…"}, ...]

# Only present when user uploaded stems:
phase4.stems.status            "ok" | "skipped"
phase4.stems.per_stem          {kick: {rms_db, peak_db, …}, bass: {…}, …}
phase4.stems.clash_matrix      [{a, b, range, severity, overlap_pct}, ...]
phase4.stems.balance_flags     [list of strings]
```

**Cost note:** stem analysis runs librosa STFT clash detection by default (~1–2 s). Demucs source separation is disabled (`USE_DEMUCS=False`) and would take 10–20 min/track.

### Phase 5 — Reference comparison

```
# Only present when reference linked:
phase5.reference_track         {present, lufs_delta, freq_band_deltas, stereo_delta, …}
phase5.stem_reference_comparison "ok" | "skipped"
phase5.per_stem_reference_deltas [...]
```

### Phase 6 — Gap analysis vs curated genre profile

```
phase6.percentile              int     (0–100; user's track percentile vs reference set)
phase6.profile_source          string  (e.g. "Reference set: 1,240 Progressive House releases · 2022–2026")
phase6.gaps                    {
  bpm:        {user_val, genre_mean, genre_std, delta, acceptable_range, in_range, percentile, description},
  lufs:       {...},
  rms:        {...},
  stereo_correlation: {...},
  stereo_width: {...},
  band_sub_bass: {...},
  band_bass:  {...},
  band_low_mid: {...},
  band_mid:   {...},
  band_upper_mid: {...},
  band_presence: {...},
  band_air:   {...},
}
```

### Phase 7 — Arrangement scan

```
phase7.sections                [{section_type: "intro|buildup|drop|breakdown|outro",
                                  start_seconds, end_seconds, bars}, ...]
phase7.violations              [list of strings]
```

**Source:** allin1 / all-in-one-fix (NATTEN-based structure detection). Requires Docker on Windows.

### Phase 8 — Ableton project (.als) parsing

```
# Only present when user uploaded an .als:
phase8.status                  "ok" | "skipped"
phase8.tracks                  [{name, type, device_chain: [{name, params: {…}}], …}, ...]
phase8.tempo_locked, phase8.master_chain, etc.
```

### Pipeline root (synthesized after all phases)

```
overall_score                  int     (0–100; the canonical score)
grade                          string  ("A" / "A-" / "B+" / ... / "F")
top_fixes                      [string, string, string]
coach_name                     string
coach_intro                    string
coached_fixes                  [string, ...]   (max 5)
danceability_score             int     (0–100, genre-aware)
```

---

## AI specialists — 26 on-demand verdicts

Each specialist is a single Claude CLI call against a prompt file in `components/api/prompts/experts/<Name>.md`. Slugs and prompt files in `prompt_loader.py::SLUG_TO_FILENAME`.

### Categories (matches new UI grouping)

| Category | Slugs |
|---|---|
| Low End | `low_end`, `stem_balance`† |
| Frequency | `frequency_balance`, `frequency_collision`, `harmonic`, `chord_harmony` |
| Dynamics | `dynamics`, `humanization`, `density` |
| Stereo & Width | `stereo_phase`, `stereo_field`, `spatial`, `stem_stereo_width`† |
| Loudness | `loudness`, `gain_staging`, `playback` |
| Arrangement | `sections`, `trance_arrangement`, `section_contrast` |
| Reference | `stem_reference`, `stem_reference_delta`‡ |
| Production Detail | `clarity`, `surround`, `device_chain`§ |
| Big Picture | `overall` |
| Synthesis | `priority_summary` (the "Run Summary" CTA) |

† Requires stems uploaded.
‡ Requires stems + reference.
§ Requires `.als` uploaded.

### Storage — `verdicts` table (NEW; promoted from JSONB)

`Spectr.Data/Entities/Verdict.cs`. One row per LLM specialist finding; sortable, queryable, indexed.

| Column | Type | Notes |
|---|---|---|
| `id` | text(40) | ULID string (`vrd_…`) for Python compatibility |
| `analysis_id` | uuid | FK; indexed; `(analysis_id, specialist)` composite index |
| `specialist` | text(64) | slug |
| `prompt_version` | text(120) | `<slug>@<semver>` |
| `model` | text(60) | `claude-cli`, `claude-api`, etc. |
| `severity` | text(20) | `critical|severe|moderate|minor|win` |
| `category` | text(40) | category slug from table above |
| `confidence` | double | 0.0–1.0 |
| `priority_score` | int | **server-computed**; never LLM-supplied |
| `impact` | text(8) | `high|med|low` mapped from severity+score |
| `chart_type` | text(20)? | `lufs|frequency|eq-curve|sidechain|arrangement|stems` |
| `headline` | text(120) | |
| `summary` | text(400)? | short form (~1 sentence) |
| `body` | text? | long form (2–3 sentences) |
| `metric_line` | text(240)? | `"-11.2 LUFS · -14 SPOTIFY · 5.4 LU DYN"` |
| `why_it_matters` | text(280)? | |
| `preset_name` | text(120)? | e.g. `"Spotify-safe master"` |
| `evidence` | jsonb | `[{metric, value, expected_range, label}, ...]` |
| `fix` | jsonb? | full fix object incl. `fix.steps[]` (Apply Preset wire format) |
| `sources` | jsonb | `[string, …]` |
| `created_at` | timestamptz | |

**`fix.steps[]` wire format** (shared with frontend Listen ToolsRail):

```
[{ kind, where, what, from, to }]
# kind enum is defined in Spectr.Domain.FixStepKind
```

**Per-user overlay — `verdict_user_state`** (`Spectr.Data/Entities/VerdictUserState.cs`). Composite key `(verdict_id, user_id)`.

| Column | Type | Notes |
|---|---|---|
| `verdict_id` | text(40) | FK to `verdicts.id` |
| `user_id` | uuid | |
| `dismissed` | bool | |
| `applied` | bool | producer marked the fix applied in their DAW |
| `user_modified_fix` | jsonb? | user-tweaked override |
| `feedback` | text(20)? | `helpful | wrong | unclear` |
| `created_at` / `updated_at` | timestamptz | |

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /reports/{jobId}/verdicts` | List rows + user_state overlay |
| `POST /reports/{jobId}/verdicts/run/{specialist}` | Enqueue one specialist (on-demand UI primitive) |
| `GET /reports/{jobId}/verdicts/stream` | SSE while specialists are running |
| `POST /verdicts/{verdictId}/dismiss` | |
| `POST /verdicts/{verdictId}/applied` | NEW; producer-side "Apply Preset audition" outcome |
| `POST /verdicts/{verdictId}/feedback` | `helpful | wrong | unclear` |

**Cost note:** every specialist call is a paid Claude CLI invocation. UI must gate one-at-a-time to avoid runaway spend.

**Missing:** specialist persona metadata (color/glyph/label) — still inferred client-side; not stored server-side.

---

## Library — songs + versions

| Capability | Where | Notes |
|---|---|---|
| List user's songs | `GET /songs?include=versions,latest_result` | Paginated; excludes archived |
| Song detail | `GET /songs/{songId}` | Includes versions + latest grade/score |
| Create song | `POST /songs` | UNIQUE(`user_id`, `name`) |
| Rename song | `PATCH /songs/{songId}` | |
| Archive (soft delete) | `DELETE /songs/{songId}` | 30-day restore window |
| Restore | `POST /songs/{songId}/restore` | 410 if past window |
| Upload new version | `POST /versions/` | Multipart; triggers analysis dispatch |
| Version detail | `GET /versions/{versionId}` | |
| Edit version label/notes | `PATCH /versions/{versionId}` | |
| Delete version | `DELETE /versions/{versionId}` | |
| Re-analyze | `POST /versions/{versionId}/analyze` | 409 if already running |
| **Mark version current** | `POST /versions/{versionId}/set-current` | NEW; flips `is_current` flag |
| Streaming audio | `GET /versions/{versionId}/audio` | ASP.NET Core `enableRangeProcessing` — native Range support |
| Session notes (per-version) | `GET/POST/PATCH/DELETE /versions/{versionId}/notes[/{noteId}]` | NEW; timestamp-pinned notes |

### Schema

- **`songs`** — `Spectr.Data/Entities/Song.cs`. `id`, `user_id`, `name`, `genre_hint`, `default_reference_id` (NEW; FK → `reference_tracks`), `archived_at`, `created_at`, `updated_at`. UNIQUE `(user_id, name)`.
- **`song_versions`** — `Spectr.Data/Entities/SongVersion.cs`. `id`, `song_id`, `version_number`, `label`, `notes`, `file_path`, `reference_path`, `als_file_path`, `stem_paths_raw`, `stem_paths`, **`is_current`** (NEW), timestamps. UNIQUE `(song_id, version_number)`. Partial unique index enforces only ONE current version per song (raw SQL in initial migration).
- **`session_notes`** — `Spectr.Data/Entities/SessionNote.cs`. NEW. `id`, `version_id`, `user_id`, `t_seconds` (timestamp pin, double), `text`, `pinned`, timestamps. Index `(version_id, user_id)`.

**Missing:**
- `hue` for cover-art coloring — would derive from genre or add column
- Play count (no play tracking)
- Cross-version diff route — clients fetch both and diff client-side

---

## References library (NEW; scaffolded, awaiting implementation)

Saved commercial mixes used as comparison targets. Replaces the legacy "reference is an optional file attached to one upload" model.

| Capability | Where | Notes |
|---|---|---|
| List references | `GET /references` | |
| Add reference (file upload) | `POST /references` | Multipart |
| Reference detail | `GET /references/{referenceId}` | |
| Edit | `PATCH /references/{referenceId}` | |
| Delete | `DELETE /references/{referenceId}` | |
| Analyze reference | `POST /references/{referenceId}/analyze` | Dispatches `analyze_reference_track` dramatiq task |
| Sets CRUD | `GET/POST/PATCH/DELETE /reference-sets[/{setId}]` | |
| Set membership | `POST /reference-sets/{setId}/members`, `DELETE /reference-sets/{setId}/members/{referenceId}` | |

**Schema:** `reference_tracks` — `Spectr.Data/Entities/ReferenceTrack.cs`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | uuid | |
| `title` | text(200) | |
| `artist` | text(120)? | |
| `source` | text(20) | `file` in v1; URL-based ingest defers to Phase 2.5 |
| `source_url` | text(500)? | |
| `file_path` | text(500)? | |
| `genre` | text(50)? | |
| `bpm` | double? | |
| `detected_key` | text(10)? | |
| `duration_seconds` | double? | |
| `lufs` / `true_peak_db` / `dynamic_range_lu` | double? | |
| `stereo_width` / `stereo_correlation` | double? | |
| `band_levels` | jsonb? | 8-band frequency curve `[0.62, 0.88, …]` |
| `tags` | jsonb | `[string, …]` |
| `analyzed` | bool | |
| `used_count` | int | |
| `notes` | text? | |
| `created_at` | timestamptz | |

**Schema:** `reference_sets` + `reference_set_members` — `Spectr.Data/Entities/ReferenceSet.cs`. Set has `id`, `user_id`, `name`, `hue`. Member is composite `(set_id, reference_id)`.

**Missing:** URL-based reference import; reference re-analysis trigger on prompt-version change.

---

## Compare (NEW; scaffolded)

| Capability | Where | Notes |
|---|---|---|
| Compare track-version vs reference | `GET /compare?trackVersionId=…&referenceId=…` | Cacheable; key is the pair |

**Schema:** `compare_cache` — `Spectr.Data/Entities/CompareCache.cs`. Unique `(track_version_id, reference_id)`. Columns: `id`, `user_id`, `track_version_id`, `reference_id`, `match_score` (0–100), `sub_scores` jsonb (`{ loudness, frequency, stereo, dynamics }`), `delta_metrics` jsonb (`[{ metric, yours, theirs, delta }, …]`), `suggestions` jsonb (`[{ category, title, detail }, …]`), `created_at`. Cache invalidated by cascade-delete when either side is re-analyzed.

---

## Share links + feedback (NEW; scaffolded, awaiting implementation)

| Capability | Where | Notes |
|---|---|---|
| Generate share token | `POST /analyses/{analysisId}/share` | Lazy; sets `share_token` |
| Toggle show-verdicts | `PATCH /analyses/{analysisId}/share` | |
| Revoke | `DELETE /analyses/{analysisId}/share` | |
| Public report | `GET /share/{token}` | Anonymous; user_state stripped from verdicts |
| Public audio | `GET /share/{token}/audio` | Range-streaming |
| Public peaks JSON | `GET /share/{token}/peaks` | |
| Public comments read | `GET /share/{token}/comments` | |
| Public comment post | `POST /share/{token}/comments` | Anonymous; rate-limited per IP hash |

**Schema:** `track_comments` — `Spectr.Data/Entities/TrackComment.cs`. Polymorphic — one of `target_share_token` (v1.5) or `target_published_track` (Phase 4 Discover) set; enforced by CHECK constraint `ck_track_comments_one_target`. Columns: `id`, `target_share_token`?, `target_published_track`?, `author_user_id`? (null = anonymous), `author_display_name`?, `author_ip_hash` bytea (salted SHA-256, 90-day TTL), `timestamp_seconds`? (null = general comment), `body`, `created_at`, `deleted_at`? (producer-side hide).

---

## Bookmarks (NEW; scaffolded)

| Capability | Where | Notes |
|---|---|---|
| List bookmarks | `GET /me/bookmarks` | Returns joined track metadata |
| Add bookmark | `POST /me/bookmarks` | Body: `{ target_share_token }` OR `{ target_published_track }` |
| Remove | `DELETE /me/bookmarks/{bookmarkId}` | |

**Schema:** `track_bookmarks` — `Spectr.Data/Entities/TrackComment.cs` (same file). Same polymorphic CHECK as comments. Index on `user_id`.

---

## Coach (chat — Phase 3; verdict surface in v1)

| Endpoint | Purpose |
|---|---|
| `GET /coach/{jobId}` | Combined analysis + verdicts + summary |
| `POST /coach/{jobId}/chat` | SSE; Vercel AI SDK Data Stream protocol |

v1 ships only the verdict-list portion of Coach; chat panel arrives later.

**Missing:** chat history persistence, tool-use in chat (e.g., "run the Low End specialist" invoked by the bot), cross-version context in prompts.

---

## Files

| Endpoint | Purpose |
|---|---|
| `GET /files/{**key}` | Authenticated fall-through for `IFileStorage.GetPresignedReadUrlAsync` on local disk. Unused in R2 mode (clients hit signed URLs directly). |

---

## What we explicitly DON'T have today

Use this as the gap list when auditing pages.

### Analysis pipeline gaps

- **Time-localized spectral data** (per-section LUFS, per-section freq balance) — phase 7 detects sections but doesn't compute metrics per-section.
- **Spectrogram / detailed FFT data** for visualizers — phase 1 produces 7 aggregate bands only.
- **Short-term LUFS series** (mock has `loudness.shortTermSeries`) — not computed; we have integrated only.
- **Punch / transient index** as named score (some specialists mention; not in `final_json`).
- **Dimension scores** (loudness/balance/low-end/dynamics/stereo/arrangement) — mock surfaces 6 anchor scores with deltas vs. prior version. Today: one `overall_score` + per-band data; would need a synthesis step.

### Community / Discover (whole concept new)

- Public/private song visibility (today: all songs are private)
- Publish-to-Discover flow + license/mood/genre tagging
- Public feed with filters
- Public listen page (anonymous reviewer access — `track_comments.target_published_track` arm is scaffolded but unused in v1)
- Public profile pages (`/u/{handle}`)
- Plays / saves / follows counters and events
- Feedback ratings (1–10 ratings + timestamp-pinned interest pins are scaffolded as `track_comments` with `timestamp_seconds`; ratings are not modeled)
- Moderation primitives (report buttons; soft-delete on feedback exists via `deleted_at`)

### AI coach / chatbot

- Conversational chat endpoint (only stub at `POST /coach/{jobId}/chat`)
- Cross-version context in prompts
- Tool-use in chat
- Chat history persistence

### User-facing data

- Password reset / email verification / OAuth
- Usage quotas / billing tier (analyses-this-month/cap, specialist-calls-this-month/cap, plan name)
- Notifications (in-app bell, email-on-event)

---

## Quick lookup index

When auditing, jump-find a field here. If the mock data field is not listed, it's a 🆕 or 🔨.

| Mock field | Where in v2 schema |
|---|---|
| `TRACK.score` | `analyses.final_json.overall_score` |
| `TRACK.grade` | `analyses.final_json.grade` |
| `TRACK.bpm` | `analyses.final_json.phase1.bpm` |
| `TRACK.key` | `analyses.final_json.phase1.detected_key` |
| `TRACK.genre.{name,confidence}` | `analyses.final_json.phase2.{genre,confidence}` |
| `TRACK.loudness.integrated` | `analyses.final_json.phase1.integrated_lufs` |
| `TRACK.loudness.truePeak` | `analyses.final_json.phase1.true_peak_db` |
| `TRACK.loudness.dynamicRange` | derived: `true_peak_db - integrated_lufs` ⚠️ |
| `TRACK.loudness.rms` | derived: `20*log10(phase1.rms + 1e-9)` ⚠️ |
| `TRACK.loudness.shortTermSeries` | **not computed** 🔨 |
| `TRACK.stereo.{width,correlation,monoCompat}` | `analyses.final_json.phase1.{stereo_width,stereo_correlation,mono_compatibility}` |
| `TRACK.frequency.bands` | `analyses.final_json.phase1.bands` |
| `TRACK.frequency.genreMedianBands` | `analyses.final_json.phase6.gaps.band_*` derivation ⚠️ |
| `TRACK.frequency.clarity` | derived ⚠️ |
| `TRACK.percentile` | `analyses.final_json.phase6.percentile` |
| `TRACK.profileSource` | `analyses.final_json.phase6.profile_source` |
| `TRACK.danceScore` | `analyses.final_json.danceability_score` |
| `TRACK.streaming` | derived from `phase1.integrated_lufs` + platform constants ⚠️ |
| `TRACK.arrangement.sections` | `analyses.final_json.phase7.sections` |
| `TRACK.arrangement.issues` | `analyses.final_json.phase7.violations` |
| `TRACK.arrangement.score` | **not computed** ⚠️ (derive: `100 - violations*15`) |
| `TRACK.clashes` | `analyses.final_json.phase4.clashes` |
| `TRACK.gap` | `analyses.final_json.phase6.gaps` |
| `TRACK.fixes` | `analyses.final_json.top_fixes` |
| `TRACK.coach[]` (rich findings) | query `verdicts` WHERE `analysis_id = …` ORDER BY `priority_score` DESC, severity |
| `TRACK.coachSummary` | derivable from top `verdicts` rows ⚠️ |
| `TRACK.dimensionScores` (6 categories + delta) | **not computed** 🔨 (synthesis step) |
| `TRACK.analysisPipeline` (status tracker) | `analyses.phase_durations` + `analysis_jobs.status/phase_pct` ⚠️ |
| `TRACK.tranceDNA.parts` | derivable from `phase2.genre` or **🆕** stored field |
| `TRACK.verdicts` | `verdicts` table rows |
| `TRACK.verdict.fix.steps[]` | `verdicts.fix` jsonb → `steps` array |
| `TRACK.notes[]` (timestamp-pinned notes) | `session_notes` table |
| `LIBRARY[].versions[].current` | `song_versions.is_current` |
| `LIBRARY[].versions[].label/notes/date/grade/score` | `song_versions.{label,notes,created_at}` + latest `analyses.{final_json.grade,final_json.overall_score}` |
| `LIBRARY[].versionCount/scoreDelta` | derivable ⚠️ |
| `LIBRARY[].plays` | **not tracked** 🆕 |
| `LIBRARY[].hue` | **not stored** 🆕 (or derive from genre, ⚠️) |
| `LIBRARY[].defaultReference` | `songs.default_reference_id` → `reference_tracks.{title,artist}` |
| `REFERENCES[]` | `reference_tracks` table |
| `REFERENCE_SETS[]` | `reference_sets` + `reference_set_members` |
| `COMPARE.matchScore` / `subScores` / `deltaMetrics` / `suggestions` | `compare_cache.{match_score,sub_scores,delta_metrics,suggestions}` |
| `SHARE.comments[]` | `track_comments` WHERE `target_share_token = …` AND `deleted_at IS NULL` |
| `SHARE.comments[].timestampSeconds` | `track_comments.timestamp_seconds` |
| `BOOKMARKS[]` | `track_bookmarks` for current user |
| `PROFILE.handle/displayName/bio/avatarHue/bannerHue/accent/link` | `users.{handle,display_name,bio,avatar_hue,banner_hue,accent,public_link}` |
| `PROFILE.uiPrefs` | `users.ui_prefs` |
| `PROFILE.usage.*` | **not tracked** 🆕 (no quotas/billing) |
| `PROFILE.activity[]` | `GET /me/activity` — UNION over jobs/songs/versions (scaffolded) |
| `PROFILE.plan` | **no billing** 🆕 |
| `DISCOVER_TRACKS[]` (publish-to-discover) | **whole concept new** 🆕 (Phase 4) |
| `PUBLIC_USERS[]` (handle, displayName, bio …) | columns exist on `users`; public-profile route is 🆕 |

---

## Endpoints inventory (v2 BFF)

All routes live in `components/bff/src/Spectr.Bff/Endpoints/*.cs`. **Every route currently returns `501 NotImplemented`** in the scaffold; implementations land per-feature.

| File | Family | Surface |
|---|---|---|
| `AuthEndpoints.cs` | auth | register / login / refresh / logout / me |
| `MeEndpoints.cs` | me | profile (GET/PATCH), stats, activity |
| `SongEndpoints.cs` | songs | list / create / detail / rename / archive / restore |
| `VersionEndpoints.cs` | versions | upload-new / detail / patch / delete / analyze / set-current / notes CRUD / audio stream (Range) |
| `JobEndpoints.cs` | jobs | list / detail / SSE stream / results |
| `VerdictEndpoints.cs` | verdicts | list per-analysis / run-one / SSE stream / dismiss / applied / feedback |
| `ReferenceEndpoints.cs` | references + reference-sets | refs CRUD + analyze; sets CRUD; set membership |
| `CompareEndpoints.cs` | compare | GET keyed by `(trackVersionId, referenceId)` |
| `ShareEndpoints.cs` | share | producer-side share token mgmt (POST/PATCH/DELETE on `/analyses/{id}/share`); public `/share/{token}/{report,audio,peaks,comments}` |
| `BookmarkEndpoints.cs` | bookmarks | list / add / remove |
| `FileEndpoints.cs` | files | authenticated fall-through for local-disk `IFileStorage` |
| `CoachEndpoints.cs` | coach | combined report (GET) + chat SSE (POST) |
