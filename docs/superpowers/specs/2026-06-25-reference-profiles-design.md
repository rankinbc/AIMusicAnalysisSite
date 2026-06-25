# Reference Profiles — Upload, Analyze, Aggregate & Compare

**Date:** 2026-06-25
**Status:** Design — approved for planning
**Branch context:** `listen-ui-overhaul` (feature is backend + worker + analysis + v2 frontend)

---

## 1. Goal & concept

Let a producer build **reference profiles** — named collections of their own
uploaded reference tracks — and have an analysis compare their track against a
chosen profile.

- A **profile = a `ReferenceSet`**: a named, user-chosen collection of *any
  subset* of their uploaded reference tracks. The join is many-to-many, so one
  reference track can belong to multiple profiles. A track is analyzed **once**
  on upload; profiles only reference it. Building/editing a profile is pure
  membership management — no re-upload, no re-analyze.
- **Genre presets** are a parallel, built-in profile kind exposing the *same
  shape*, so user profiles and genre presets are interchangeable downstream.

### What already exists (do not rebuild)

- `ReferenceTrack`, `ReferenceSet`, `ReferenceSetMember` entities + EF mappings.
- `ReferenceEndpoints.cs`: upload / list / get / patch / delete / analyze for
  references; CRUD + membership for reference-sets.
- `run_reference_analyzer` dramatiq actor → runs phase 1 and persists per-track
  metrics (BPM, LUFS, true peak, DR, stereo width/correlation, `band_levels`).
- `phase6_gap` — gap analysis against a **statistical profile**
  (`feature_statistics: {feature: {mean, std}}` + `track_count`) loaded from
  `data/reference_library/profiles/<genre>_profile.json`. Its
  `_analyze_with_profile(profile, phase1)` produces the percentile gaps that the
  results **`ReferenceTab`** renders.
- v2 frontend: `ReferenceLibrarySection`, `ReferenceCard`, upload/edit dialogs,
  `ReferenceProfileSelect` (the picker), `genrePresets.ts`, results `ReferenceTab`.

### Scope boundary (important)

This spec does **not** add the `Song.reference_profile` columns or the
create/edit picker wiring — those belong to the **new-song-creation** doc
(`PRPs/design_handoffs/new-song-creation-requirements.md`). Within this spec, the
profile reaches an analysis via the **phase-6 re-run override** (user re-runs the
gap phase against a chosen profile). The dispatch-time auto-apply of a *song
default* is built as a resolver that activates once the new-song work lands the
column; until then it resolves to "none" (today's behavior). This keeps the spec
self-contained and fully testable.

Also out of this spec: results `ReferenceTab` gets only a **minimal** update
(label + states + consuming a user profile) — not a full redesign (that's the
separate updated-results-UI work, which these doc patches feed).

---

## 2. Aggregation model (the heart)

A profile aggregates its **analyzed** members into the **exact statistical-profile
shape `phase6_gap` already consumes** — not a bespoke format:

```jsonc
{
  "schema_version": 1,
  "member_count": 5,        // total members
  "analyzed_count": 3,      // members with analyzed == true (only these aggregate)
  "track_count": 3,         // == analyzed_count; the name phase 6 reads
  "feature_statistics": {
    "lufs":             { "mean": -8.2, "std": 1.1 },
    "true_peak":        { "mean": -0.9, "std": 0.5 },
    "dynamic_range":    { "mean":  8.4, "std": 1.0 },
    "stereo_width":     { "mean": 0.62, "std": 0.05 },
    "stereo_correlation": { "mean": 0.41, "std": 0.05 },
    "bpm":              { "mean": 138.0, "std": 2.0 },
    "band_sub_bass":    { "mean": -6.1, "std": 2.0 },
    "band_bass":        { "mean": -4.0, "std": 2.0 },
    "band_low_mid":     { "mean": -7.2, "std": 2.0 },
    "band_mid":         { "mean": -5.5, "std": 2.0 },
    "band_upper_mid":   { "mean": -6.8, "std": 2.0 },
    "band_presence":    { "mean": -9.1, "std": 2.0 },
    "band_air":         { "mean": -12.0, "std": 2.0 }
  }
}
```

- **`mean`** = arithmetic mean of the metric across analyzed members.
- **`std`** = `max(sample_stddev, per-metric floor)`. The floor stops a tight
  2-track set (std ≈ 0) from flagging everything; for `analyzed_count == 1` the
  std is exactly the floor.
- Phase 6's existing `acceptable_range = mean ± 2·std` convention then applies
  unchanged, and `ReferenceTab` renders it unchanged.

### Per-metric tolerance floors (initial values — tune later)

| Feature | Floor on `std` |
|---|---|
| `lufs` | 1.0 LU |
| `true_peak` | 0.5 dB |
| `dynamic_range` | 1.0 LU |
| `stereo_width` | 0.05 |
| `stereo_correlation` | 0.05 |
| `bpm` | 2.0 |
| `band_*` (each) | 2.0 dB |

Source metrics map from `ReferenceTrack` columns: `lufs`, `true_peak_db`,
`dynamic_range_lu`, `stereo_width`, `stereo_correlation`, `bpm`, and
`band_levels.{sub_bass,bass,low_mid,mid,upper_mid,presence,air}` → `band_*`.
Features are aggregated over the **intersection** of keys present on all analyzed
members (a member missing a band is excluded from that band's stats, not the
whole profile).

---

## 3. Where it's computed — BFF, lazy, fingerprint-cached (no worker, no audio)

Member metrics are already persisted, so aggregation is **pure arithmetic in the
BFF** — microseconds over a handful of rows. No audio decode, no worker.

**New columns on `reference_sets`:**

- `profile_json` JSONB — the cached aggregate (§2 shape), nullable.
- `profile_fingerprint` text — invalidation key.

**Fingerprint** = hash over each member's `(id, analyzed, lufs, true_peak_db,
dynamic_range_lu, stereo_width, stereo_correlation, bpm, band_levels)`, sorted by
id. It changes whenever a member is added/removed **or** a member's metrics change
(re-analyze) — no `updated_at`/`analyzed_at` column needed, and it self-invalidates.

**Lazy compute:** on any set read or analysis dispatch, the BFF compares the live
fingerprint to `profile_fingerprint`; on mismatch it recomputes `profile_json` +
`profile_fingerprint` and persists. Only `analyzed == true` members contribute.

**Readiness:** `analyzed_count == 0` ⇒ profile is **not ready** (can't be used as a
comparison target). The DTO surfaces `analyzedCount / memberCount` so the UI can
show "3 of 5 analyzed".

**Aggregation lives in one place** (BFF, C#). The worker only *reads* the resolved
profile from the job payload — it never joins reference tables or re-aggregates.

---

## 4. Analysis wiring — phase 6 is the integration point

`phase6_gap` already does gap analysis against a statistical profile and feeds
`ReferenceTab`. A user profile is the same object. So:

- **Phase 6 gains an injected-profile path.** `run_single_phase` /
  `rerun_single_phase` gain a `reference_profile: dict | None` param threaded to
  `phase6_gap.analyze(...)`. When a profile dict is provided, phase 6 **skips the
  by-genre disk load** and calls the existing `_analyze_with_profile(profile,
  phase1)` path. When `None`, behavior is unchanged (load by genre / fallback).
- **Phase 6 output gains UI labels:** `profile_kind` (`"user" | "genre" |
  "genre_statistical"`), `profile_name` (display string), and `profile_hue`
  (int | null, for user profiles' chip). These ride alongside the existing
  `genre`, `percentile`, `gaps`.
- **Phase 5 (single-ref-file delta + `genre_context`) is left untouched** as
  legacy. This feature does not route through phase 5.

### Dispatch resolution (BFF)

Effective profile, in priority order:

1. **Re-run override** (explicit profile on the re-run request) — the in-spec path.
2. **Song default** — once the new-song work adds `Song.reference_profile_*`.
   Until then this resolves to nothing.
3. **None** — current behavior (phase 6 falls back to by-genre).

Resolution produces a job-payload value:

```jsonc
// user profile (BFF embeds the aggregate so the worker needs no DB):
{ "kind": "user", "name": "Festival Trance", "hue": 280,
  "feature_statistics": { … }, "track_count": 3 }

// genre preset → worker loads the genre statistical profile from disk as today:
{ "kind": "genre", "genre": "trance" }

// none:
null
```

The worker maps `kind:"user"` → pass `feature_statistics` (+meta) to phase 6 as the
injected profile; `kind:"genre"` → pass the genre (existing disk path);
`null` → unchanged.

### Re-run override endpoint

`POST /api/reports/{jobId}/phases/6/rerun` with optional body
`{ "referenceProfile": { "kind": "user", "setId": "…" } | { "kind": "genre",
"preset": "trance" } }`. The server resolves it exactly like dispatch (refreshing
the set's `profile_json` first for user profiles), then enqueues `rerun_phase`
with the resolved payload → `rerun_single_phase(6, …, reference_profile=…)`.
The server already accepts phases 2–8 for re-run; we expose phase 6 in the UI.

---

## 5. Upload & analyze

### Batch / multi-file upload

- **New endpoint** `POST /api/references/batch` (multi `IFormFile`, same 250 MB
  per-file cap, same magic-byte/extension rules as single upload). Creates one
  `ReferenceTrack` row per file (status `pending`), returns the created DTOs.
  Does **not** auto-enqueue analysis.
- **Analyze stays an explicit action.** A **"Analyze all"** affordance enqueues
  the pending references. To avoid N frontend round-trips, add a small
  `POST /api/references/analyze` taking `{ ids: [...] }` that enqueues
  `run_reference_analyzer` for each (skips already-analyzed). Single
  `POST /api/references/{id}/analyze` stays.
- Mirrors the existing `StemsUploadDialog` multi-file pattern (drag-drop, local
  blob preview, per-row rows).

### Per-reference analyze status + retry

The actor today only `analyzed: bool` + logs on failure, so pending vs failed is
indistinguishable. Add:

- **`reference_tracks.analysis_status`** text — `"pending" | "analyzed" |
  "failed"`, default `"pending"`. `analyzed` bool stays in sync (`true` iff
  status `analyzed`) for back-compat with the aggregation filter.
- **`reference_tracks.analysis_error`** text, nullable — short failure reason.
- **Actor change:** on success set `analysis_status="analyzed"`, clear error; on
  failure set `analysis_status="failed"` + `analysis_error` (it must **not** raise
  — persist the marker, like `run_specialist` does). Retry (re-enqueue via the
  analyze endpoint) resets status to `pending` first.

`ReferenceDto` gains `analysisStatus` + `analysisError`. The card/grid renders
pending / analyzed / failed and a **Retry** on failed (and stale) rows.

---

## 6. Frontend (this spec)

All under `components/frontend-spectr-v2/src/features/references/`.

1. **Profile detail / aggregate view** (the main new UI). For a reference set:
   - The aggregated `feature_statistics` as a **band curve** + LUFS / DR / width /
     correlation / BPM **range readouts** (`mean ± 2·std`).
   - **Member list** with per-member analyze status; **add/remove** members.
   - **`X of Y analyzed`** indicator; a **not-ready** state when 0 analyzed.
   - Reuses the existing reference-card + set chip (hue) visual language.
   - Backed by a **new `GET /api/reference-sets/{setId}`** returning the set DTO +
     `profileJson` + member summaries (today there's only list/create/patch/delete).

2. **Batch upload dialog + per-ref status/retry.** Multi-file dialog (mirrors
   `StemsUploadDialog`); "Analyze all"; per-reference `pending/analyzed/failed`
   badges + retry in `ReferenceCard` / `ReferenceLibrarySection`.

3. **Minimal `ReferenceTab` update** (results page). Data shape is already the
   phase-6 gap shape, so:
   - Render the comparison against a **user profile** (no shape change to gap rows).
   - Add a **profile label/chip** from the new `profile_kind` / `profile_name` /
     `profile_hue` fields.
   - Handle **no-profile** (empty + CTA) and **profile-not-ready** states.
   - *Not* a full redesign — that's the separate updated-results-UI work.

Out of this spec's frontend: song-create/edit picker wiring; full `ReferenceTab`
redesign.

---

## 7. Design-handoff doc updates (fold into this work)

These three docs currently frame the reference tab as **disabled/"coming soon"**
and pinned to **phase 5**. This spec makes it live via **phase 6**. Patch them so
the separate updated-results-UI design works from accurate handoff:

### `PRPs/design_handoffs/analysis-page-states.md` — Tab 5 (lines ~58–63)
Replace "Disabled (now)" with the real states:
- **No profile attached** → empty + CTA to pick/build a profile.
- **Profile attached & ready** → populated gap view (phase-6 gap rows), labeled
  with profile name/source.
- **Profile attached but not ready** → "this profile has no analyzed reference
  tracks yet" (`analyzed_count == 0`).
- **User profile vs genre preset** → label/grouping difference.
- **Re-run override** → indicate which profile a re-run compared against vs the
  song default.

### `PRPs/design_handoffs/analysis-page-datapoints.md` — Tab 5 (~271–290) + phase-6 row (~113)
- Tab 5 is no longer "build disabled for now."
- Phase 6 `gaps` gains UI-facing fields: **`profile_kind`**, **`profile_name`**,
  **`profile_hue`**, and the **`track_count`** ("based on N tracks").
- Clarify phase 6 is the engine for **both** genre and user-profile comparison;
  phase 5 is legacy single-ref.

### `PRPs/design_handoffs/analysis-page-mock.json` (~83–96)
- Add a populated **user-profile** example: `phase6` with `profile_kind:"user"`,
  `profile_name`, `profile_hue`, `track_count`, and realistic `gaps` — so the UI
  designer has a loaded reference state (today phase 5 is skipped, phase 6 is genre).

### Open design fork to pin down in the docs
Phase-6 gaps currently sit in **General Stats** as the *genre* gap. Decide one
model: (a) genre gap stays in General Stats and the *user-profile* gap owns
Tab 5, or (b) Tab 5 hosts whichever profile is attached and General Stats drops
the genre gap. Document the chosen model so all three docs describe it
consistently.

---

## 8. Testing

- **Aggregation (BFF):** mean/std math; floor behavior; `analyzed_count == 1`
  (std == floor); mixed analyzed/unanalyzed (only analyzed contribute); band
  key intersection; readiness (0 analyzed ⇒ not ready); fingerprint invalidation
  on add member / remove member / member re-analyze.
- **Phase 6 (analysis):** injected user profile produces gaps with correct
  `acceptable_range = mean ± 2·std`; in-range vs out-of-range; `profile_kind` /
  `profile_name` / `profile_hue` surfaced; `None` path unchanged (golden snapshot
  byte-identical for genre/no-profile runs).
- **Worker:** failed-marker persistence (actor does not raise on phase-1 failure);
  retry resets to pending then succeeds; batch analyze enqueues per id, skips
  already-analyzed.
- **BFF endpoints:** batch upload creates N rows status `pending`;
  `GET /reference-sets/{id}` returns fresh `profileJson`; re-run override
  resolves user vs genre vs none and dispatches the right payload; ownership /
  IDOR (`WHERE user_id = current_user`).
- **Frontend (vitest):** profile detail renders ranges + member statuses +
  not-ready; batch dialog + Analyze-all + retry; `ReferenceTab` user-profile
  label + no-profile + not-ready states.

---

## 9. Out of scope

- URL / streaming reference import (`source_url` stays unused).
- Auto-analyze on upload (analyze is an explicit action).
- `Song.reference_profile_*` columns + create/edit picker wiring (→ new-song doc).
- Full `ReferenceTab` redesign (→ updated-results-UI work; this spec only patches
  the handoff docs + does the minimal tab change).
- Multiple profiles per song.
- Hi-res averaged spectrum curve (v1 uses the stored 7 bands only).
- Phase 5 changes (left as legacy single-ref).

---

## 10. Dependencies & sequencing

- **Self-contained:** aggregation, phase-6 injected path, re-run override, batch
  upload, status/retry, profile detail view, and the minimal `ReferenceTab` change
  are all buildable and testable now (override is the profile-attach path).
- **Soft dependency on the new-song work:** the dispatch-time *song-default*
  auto-apply only activates once `Song.reference_profile_*` columns exist. Build
  the resolver to no-op gracefully until then.
- **Schema:** new columns on `reference_sets` (`profile_json`,
  `profile_fingerprint`) and `reference_tracks` (`analysis_status`,
  `analysis_error`) — add to `aimusic_shared/models.py` **and** the parallel EF
  Core entities + an EF migration (BFF owns the canonical schema).
```
