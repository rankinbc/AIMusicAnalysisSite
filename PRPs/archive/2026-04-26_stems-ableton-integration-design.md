# Stems & Ableton Integration — Design Spec

**Date:** 2026-04-26
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** Add advanced per-stem audio analysis to AIMusicAnalysisSite by porting AbletonAIAnalysis's `StemAnalyzer` / `ReferenceComparator` and exposing user-uploaded stems as an optional input that ties findings back to specific tracks in an uploaded `.als` project.

---

## 1. Goal & Non-Goals

### Goal
Let users optionally upload the individual stems for the mix they are analyzing. When stems are present, the pipeline produces per-stem findings (frequency balance, cross-stem clash matrix, stereo width, balance vs. genre profile, deltas vs. reference stems) that surface as prescriptive verdicts in the existing report. When an `.als` project file is also uploaded, findings are tied to the specific track names from that project.

### Non-Goals
- Replacing the existing full-mix analysis. Stems are pure addition.
- Running Demucs at request time on user-uploaded references. Stem-vs-stem reference comparison only happens when (a) the curated reference library has a pre-computed cache, or (b) the user uploads reference stems explicitly.
- A "stems-only" upload mode in v1. The mastered mix remains required; metrics like LUFS, mono compatibility, and clipping are meaningful only on the master.
- Auto-rendering stems from the `.als` server-side. We do not load Ableton sessions; we only parse track names from the `.als` archive.

## 2. Decisions Locked During Brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Integration shape | **D** — Stems + .als integration; both optional; stems unlock per-stem analysis |
| 2 | Stem ↔ track matching | **C** — Server-side auto-match with confirmation UI |
| 3 | Reference comparison | **B + D** — Pre-Demucs curated library offline; users may also upload reference stems |
| 4 | Stems uploaded without .als | **C** — Auto-detect role + same confirmation UI |
| 5 | Verdict pipeline | **C** — Hybrid: extend `FrequencyCollisionDetection` / `FrequencyBalance`; add new `StemBalance`, `StemStereoWidth`, `StemReferenceDelta` specialists |
| 6 | Mix relationship | **A** — Mix stays required; stems are pure addition |
| 7a | Upload limits | Per-file ≤100 MB, total ≤1 GB, 1–16 stems |
| 7b | Curated library pre-Demucs | Offline admin-run script; never blocks user requests |
| 7c | Stem file formats | FLAC and WAV only (lossy stems give garbage band-energy numbers) |
| Arch | Where stem logic lives | **A** — A `stems/` module called by existing phases 4 and 5; no new phase numbers |

## 3. Architecture

A new `audio_analysis.stems` package is the import boundary. Phases 4 and 5 conditionally call into it when `stem_paths` is present on the job and merge richer fields into their existing output schemas. Verdict specialists keep reading one canonical phase4/phase5 payload — it is just optionally richer when stems exist.

### New code

```
components/analysis/src/audio_analysis/stems/
  __init__.py
  analyzer.py              # port of AbletonAIAnalysis StemAnalyzer
  matcher.py               # stem ↔ .als-track / role auto-matching
  reference_comparator.py  # port; per-stem deltas vs. reference stems
  role_detector.py         # filename + spectral fingerprint → role

components/analysis/src/audio_analysis/reference_library/
  pre_demucs.py            # offline CLI: Demucs-and-cache curated refs

components/api/app/routers/stems.py   # /uploads/{job_id}/stems/* endpoints

components/api/app/verdict_pipeline/specialists/
  StemBalance.md
  StemStereoWidth.md
  StemReferenceDelta.md

components/frontend/src/components/
  StemUploader.tsx
  StemMappingTable.tsx
```

### Existing code touched

```
components/analysis/src/audio_analysis/phases/phase4_stems.py
  → consume stems module when stem_paths present;
    merge per_stem_metrics + stem_clash_matrix into result

components/analysis/src/audio_analysis/phases/phase5_reference.py
  → per-stem deltas when both sides have stems;
    merge per_stem_reference_deltas into result

components/api/app/routers/uploads.py
  → accept stem files alongside mix/ref/.als;
    validate; build proposed_mapping;
    set job to AWAITING_STEM_MAPPING when stems present

components/shared/aimusic_shared/models.py
  → UploadJob.stem_paths_raw  JSONB (list of paths)
  → UploadJob.stem_paths      JSONB (dict role → path; populated on confirm)
  → UploadJob.status enum gains AWAITING_STEM_MAPPING
  → AnalysisResults.stem_metrics JSONB (denormalized for UI)

migrations/
  → new revision adding the columns and enum value above

components/api/app/verdict_pipeline/specialists/
  FrequencyCollisionDetection.md
  FrequencyBalance.md
  → extended templates: "if stem_clash_matrix present, use it; else fall back"

components/worker/app/tasks.py
  → pass stem_paths through to run_analysis_pipeline
```

### Worker timing
Stem analysis adds ~30–90s per job. No Demucs at runtime — the user provided the stems. Soft time limit stays at 3600s. Pre-Demucs of the curated library is offline and never blocks a user request.

## 4. Data Flow (end-to-end)

1. **Frontend (UploadPage)** — drag-drop zone for stems alongside existing mix / reference / .als inputs.
2. **API `POST /uploads/`** — magic-byte validation, size & count caps, persist files via `StorageService`, create `UploadJob`. If stems present: status `AWAITING_STEM_MAPPING`, return proposed mapping in response. If not: status `PENDING`, dispatch Celery (existing flow).
3. **Server-side auto-match** (synchronous in upload request) — `stems.matcher.propose_mapping(stem_paths_raw, als_track_names)` returns a list of `StemMappingProposal` rows.
4. **Frontend (StemMappingTable)** — pre-filled dropdowns; user clicks "Looks right".
5. **API `POST /uploads/{job_id}/stems/confirm`** — validate confirmed mapping, persist `UploadJob.stem_paths = {role: path, ...}`, transition to `PENDING`, dispatch Celery.
6. **Worker `run_analysis_pipeline`** — phases 1–3 unchanged; phase 4 calls `stems.analyzer.analyze` when `stem_paths` present and adds `per_stem_metrics` + `stem_clash_matrix` to its result; phase 5 calls `stems.reference_comparator.compare` when both sides have stems and adds `per_stem_reference_deltas`; phases 6–8 unchanged.
7. **Verdict pipeline (on demand)** — extended specialists use richer payload when present; new specialists run only when `stem_metrics` non-empty; all flow through existing ranker/dedupe/triage.
8. **Frontend (ReportPage)** — three new collapsible cards render only when `stem_metrics` present: Per-Stem Balance, Stem Clash Matrix, Stem-vs-Reference Deltas. Existing sections unchanged.

### Reference-comparison cache lookup

Phase 5 checks for reference stems in this order:
1. **User uploaded reference stems** (symmetric to their own upload) — use those.
2. **Curated reference selected by ID and pre-Demucs cache hit** at `data/reference_library/_stems_cache/<track_id>.stems.json` — load cached `StemAnalysisResult`.
3. **Neither** — record `stem_reference_comparison: "unavailable"`. Full-mix reference comparison still runs as today.

## 5. Stems Module API

All public callables re-exported from `audio_analysis.stems`. Phases never import submodules directly. Pure functions where possible; dataclasses for return types; no DB or HTTP knowledge in this package.

### `stems/role_detector.py`

```python
class StemRole(StrEnum):
    DRUMS = "drums"; KICK = "kick"; SNARE = "snare"; HATS = "hats"
    BASS = "bass"; VOCALS = "vocals"; LEAD = "lead"; PAD = "pad"
    FX = "fx"; OTHER = "other"

@dataclass(frozen=True)
class RoleProposal:
    role: StemRole
    confidence: float        # 0.0 – 1.0
    evidence: str

def detect_role(file_path: Path, audio: np.ndarray | None = None) -> RoleProposal: ...
```

Filename keyword pass first (~20 regexes). If confidence ≥0.8, return. Otherwise compute fast spectral fingerprint (centroid, low/mid/high band ratios, transient density) on first 30s and classify with a lookup table. No ML — heuristics only. `audio` arg is opt-in to avoid double-decoding when caller already has it.

### `stems/matcher.py`

```python
@dataclass
class StemMappingProposal:
    file: Path
    proposed_role: StemRole
    proposed_als_track: str | None
    confidence: float

@dataclass
class ConfirmedMapping:
    file: Path
    role: StemRole
    als_track: str | None

def propose_mapping(
    stem_files: list[Path],
    als_track_names: list[str] | None,
) -> list[StemMappingProposal]: ...

def validate_confirmed_mapping(mappings: list[ConfirmedMapping]) -> None:
    """Raise on duplicate roles without _2/_3 suffix, missing files, etc."""
```

Calls `role_detector.detect_role` for every file. If `als_track_names` provided, runs RapidFuzz token-set match between stem filename and each .als track name; pairs greedily best-first. Pure function — no IO beyond reading audio for spectral fingerprint.

### `stems/analyzer.py` *(direct port of AbletonAIAnalysis StemAnalyzer)*

```python
@dataclass
class StemMetrics:
    role: StemRole
    duration_s: float
    peak_db: float
    rms_db: float
    lufs_integrated: float
    dynamic_range_db: float
    band_energy_db: dict[FreqBand, float]    # 7 bands
    spectral_centroid_hz: float
    dominant_frequencies_hz: list[float]
    stereo_width: float                       # -1 (mono) → 1 (wide)
    pan_estimate: float                       # -1 (L) → 1 (R)
    is_mono: bool

@dataclass
class StemClash:
    stem_a: StemRole
    stem_b: StemRole
    band: FreqBand
    overlap_severity: float                   # 0–1
    severity_tier: Literal["info", "warning", "critical"]

@dataclass
class StemAnalysisResult:
    per_stem: dict[StemRole, StemMetrics]
    clash_matrix: list[StemClash]             # all pairs above threshold
    balance_flags: list[BalanceFlag]          # vs. genre profile

def analyze(
    stem_paths: dict[StemRole, Path],
    genre_profile: GenreProfile | None = None,
    sample_rate: int = 44100,
) -> StemAnalysisResult: ...
```

Direct port of `projects/music-analyzer/src/stem_analyzer.py:54-119` from AbletonAIAnalysis. Replace its dict-based outputs with strict dataclasses. Loads each stem once with `librosa.load(..., sr=44100, mono=False)` (keep stereo for width). Clash detection threshold + severity tiers ported as-is (overlap >0.3 → info, >0.5 → warning, >0.7 → critical). `genre_profile` optional — when `None`, `balance_flags` returns empty.

### `stems/reference_comparator.py`

```python
@dataclass
class StemReferenceDelta:
    role: StemRole
    metric: str                                # "rms_db" | "lufs_integrated" | "stereo_width" | "band_energy_db.bass" | ...
    user_value: float
    reference_value: float
    delta: float
    interpretation: str                        # "+3.2 dB louder than reference"
    severity_tier: Literal["info", "warning", "critical"]

def compare(
    user: StemAnalysisResult,
    reference: StemAnalysisResult,
) -> list[StemReferenceDelta]: ...
```

Both sides are already-analyzed `StemAnalysisResult`; comparator is pure number-crunching, no audio loading. Only compares roles present in both. Skips silently when reference lacks a role the user has.

### `reference_library/pre_demucs.py`

Standalone CLI script, not part of the runtime pipeline:

```bash
python -m audio_analysis.reference_library.pre_demucs \
    --library data/reference_library/ \
    --out     data/reference_library/_stems_cache/ \
    [--track <id>]
```

Iterates curated reference tracks, runs Demucs, writes separated stems plus a `<track_id>.stems.json` cache containing the pre-computed `StemAnalysisResult` (so phase 5 never re-analyzes). Idempotent — skips tracks whose cache file is newer than the source. Documented in `components/analysis/README.md` as an admin runbook.

## 6. HTTP API Changes

### `POST /uploads/` — extended

Multipart form additions:
- `stems[]` — 1 to 16 files, each FLAC or WAV, ≤100 MB
- `reference_stems[]` — same constraints, optional, only meaningful with a `reference` upload

Existing fields (`mix`, `reference`, `als_file`, `genre_hint`, `track_name`) unchanged.

**Response when stems present:**
```json
{
  "job_id": "...",
  "status": "AWAITING_STEM_MAPPING",
  "proposed_mapping": [
    {"file": "01_Kick.flac", "proposed_role": "drums", "proposed_als_track": "Kick", "confidence": 0.92},
    ...
  ],
  "als_track_names": ["Kick", "Bass", "Lead Vox", ...]
}
```

**Response when no stems present:** unchanged from today.

### `POST /uploads/{job_id}/stems/confirm` — new

```json
{
  "mappings": [
    {"file": "01_Kick.flac", "role": "drums", "als_track": "Kick"},
    {"file": "02_Bass.flac", "role": "bass", "als_track": "Bass"},
    ...
  ]
}
```

Validates, persists `UploadJob.stem_paths`, transitions to `PENDING`, dispatches Celery. Returns `{"job_id": "...", "status": "PENDING"}`.

### `GET /uploads/{job_id}` — extended

When `status == AWAITING_STEM_MAPPING`, response includes `proposed_mapping` and `als_track_names` (re-served verbatim) so the frontend can recover state if the user navigated away.

## 7. Database Changes

New Alembic migration adds:

```
upload_jobs.stem_paths_raw  JSONB  NULL   -- list of original file paths as uploaded
upload_jobs.stem_paths      JSONB  NULL   -- dict {role: path}, populated on confirm
upload_jobs.status enum gains 'AWAITING_STEM_MAPPING'

analysis_results.stem_metrics JSONB NULL  -- denormalized snapshot for UI
```

`stem_metrics` is denormalized (instead of always re-deriving from `phase_results`) so the report page can render quickly without re-parsing the whole phase tree.

## 8. Verdict Pipeline Changes

### New specialist prompts (run only when `stem_metrics` non-empty)
- `StemBalance.md` — flags stems too loud/quiet vs. genre profile
- `StemStereoWidth.md` — flags stems narrower/wider than genre norms or reference
- `StemReferenceDelta.md` — translates per-stem reference deltas into prescriptive language

### Extended prompts (gracefully degrade when stems absent)
- `FrequencyCollisionDetection.md` — uses `stem_clash_matrix` for stem-pair specificity when present; falls back to spectral inference when not
- `FrequencyBalance.md` — same pattern with per-stem band energies

All produced verdicts conform to the existing verdict JSON schema. Existing validator / ranker / dedupe / triage code is untouched. Empty `stem_metrics` causes the new specialists to return `[]` without invoking the LLM (cost guard).

## 9. Error Handling

### Validation gates (synchronous, reject before Celery dispatch)

| Trigger | Check | Response |
|---|---|---|
| Stem upload | Magic-byte = FLAC or WAV | 415 `unsupported_stem_format` (per file) |
| Stem upload | Per-file size ≤100 MB | 413 `stem_file_too_large` |
| Stem upload | Total upload ≤1 GB | 413 `total_upload_too_large` |
| Stem upload | 1 ≤ stem count ≤ 16 | 422 `stem_count_out_of_range` |
| Stem upload | Sample rate ∈ {44100, 48000, 88200, 96000} | 422 `unsupported_sample_rate` |
| Stem upload | All stems same length (±1s tolerance for tail trim) | 422 `stem_length_mismatch` |
| Confirm mapping | Every uploaded file has a role | 422 `unmapped_stems` |
| Confirm mapping | Duplicate roles only with `_2`/`_3` suffix | 422 `duplicate_role` |
| Confirm mapping | Confirmed within 24 h | After 24 h → auto-fail with `mapping_timeout`; files purged |

### Pipeline-time failures (job survives)

| Failure | Behavior |
|---|---|
| One stem won't decode | Skip that stem; record `phase4.stem_decode_errors`; continue; if <2 stems remain, treat as "stems unavailable" |
| `stems.analyzer.analyze` raises | Record `stem_analysis_status: "failed"`; phase 4 still emits its existing spectral clash; downstream phases run normally; UI hides stem cards |
| Reference has no stems cache and user uploaded no reference stems | Record `stem_reference_comparison: "unavailable"`; full-mix reference comparison still runs; `StemReferenceDelta` specialist skipped |
| Pre-Demucs cache file corrupt or old format | Treat as cache miss; log warning; continue without stem reference comparison |
| Genre profile missing for detected genre | `analyze(genre_profile=None)`; `balance_flags` empty; `StemBalance` runs with weaker findings |
| Worker exceeds soft time limit | Existing 3600s soft limit unchanged; stem analysis budget ~90s — overrun captured in phase 4 status, job completes with stems marked failed |

### UI behavior on failure

- Mapping screen errors render inline next to the offending row.
- Confirmation timeout: while job is `AWAITING_STEM_MAPPING`, `GET /uploads/{job_id}` re-serves the proposed mapping for state recovery.
- Stem cards check for non-empty data and skip silently when missing — never render an empty card or "stems unavailable" placeholder. The verdicts list is the user-facing signal that stem analysis happened.
- Partial stem failure: render only successful stems; show a small subdued note like "2 of 4 stems couldn't be analyzed."

### Observability

New structured-log events: `stem.upload.received`, `stem.mapping.proposed`, `stem.mapping.confirmed`, `stem.analyze.completed`, `stem.analyze.failed`, `stem.reference_compare.completed`, `stem.reference_compare.unavailable`.

New metrics: `stem_analysis_duration_seconds`, `stem_count_per_job`, `stem_role_distribution_total`, `stem_reference_compare_cache_hit_total`, `stem_reference_compare_cache_miss_total`.

Pre-Demucs cache hit rate is the leading indicator for whether the curated library needs to grow.

## 10. Testing Strategy

### Layered approach

| Layer | What it covers | Where it lives |
|---|---|---|
| Unit | Pure functions: role detection, fuzzy match, clash math, reference delta math, validation rules | `components/analysis/tests/stems/` |
| Phase | Phase 4/5 with real audio fixtures, both stem-present and stem-absent paths | `components/analysis/tests/phases/` |
| Pipeline | Full `run_analysis_pipeline` end-to-end with golden output snapshot | `components/analysis/tests/integration/` |
| API | Upload + mapping + confirm + Celery dispatch (Celery mocked) | `components/api/tests/` |
| Verdict | New + extended specialists against frozen phase outputs (LLM mocked) | `components/api/tests/verdict_pipeline/` |
| Frontend | StemUploader + StemMappingTable component tests; one E2E happy path | `components/frontend/src/components/__tests__/` and Playwright |

### Audio fixtures

Stored under `components/analysis/tests/fixtures/audio/stems/`:
- `synth_clean/` — 8 generated stems (sine kick, white-noise hat, etc., 8 bars at 120 BPM). Deterministic; generated in a `conftest.py` fixture rather than committed.
- `real_short/` — 4 real stems (CC0 source), trimmed to 16 bars. Used by the integration test for realism.
- `bad_inputs/` — wrong sample rate, mismatched length, corrupted header, MP3 mislabeled as `.flac`. Drives validation tests.
- `reference_pre_demucs/` — one curated reference plus its pre-computed `.stems.json` cache. Drives the cache-hit path in phase 5.

Total fixture footprint budget: <30 MB committed.

### Snapshot tests

`test_pipeline_with_stems.py` runs the full pipeline on `real_short/` and asserts the final JSON matches `golden_with_stems.json`. The same test without stems asserts against `golden_no_stems.json` — guarantees the no-stems path is bit-for-bit unchanged. Snapshots regenerated via `pytest --snapshot-update`; reviewer eyeballs the diff in PR.

### Specialist tests

For each new specialist (`StemBalance`, `StemStereoWidth`, `StemReferenceDelta`):
- **Frozen-input test**: hand-crafted `phase_results` dict; mock LLM returns known JSON; assert validator passes and verdict has the expected severity, slug, prescriptive text.
- **Empty-input test**: feed `phase_results` *without* `stem_metrics`; assert specialist returns `[]` and never calls the LLM.
- **Schema test**: assert produced verdicts conform to the existing verdict JSON schema.

For extended specialists (`FrequencyCollisionDetection`, `FrequencyBalance`): one new test each verifying the prompt includes `stem_clash_matrix` when present and falls back cleanly when absent.

### API tests

- `POST /uploads/` happy path with mix only → existing behavior preserved
- `POST /uploads/` with mix + 4 stems → returns proposed_mapping; job in `AWAITING_STEM_MAPPING`
- `POST /uploads/{job_id}/stems/confirm` → job transitions to `PENDING`, Celery dispatched (mock asserts call)
- Each validation-gate row → parametrized test asserting HTTP status and error code
- Confirmation-timeout cleanup → time-travel fixture, assert auto-fail after 24h

### Frontend tests

- `StemUploader` — drag-drop multi-file, count validation, type rejection, total-size warning
- `StemMappingTable` — pre-fill from proposed_mapping, dropdown changes, "looks right" enabled only when every row has a role, duplicate-role inline error
- One Playwright E2E: upload mix + 4 stems → confirm mapping → see report with 3 stem cards. Runs against the dev stack via `start-dev.ps1`.

### Performance regression guard

A `@pytest.mark.perf` test asserts on CI: stem analysis <90s on `real_short/`; total pipeline with stems <5min. Bumping these thresholds requires explicit PR justification.

### Deliberately not tested

- LLM output quality of new specialists — caught by existing `verdict_validation_failures` ops table and human review.
- Demucs separation accuracy in pre-Demucs script — Demucs is an external dependency; we test that we *call* and *cache* it, not that it separates well.

## 11. Out of Scope (for this spec)

- Multi-tenant Demucs farm for on-demand reference separation.
- Real-time stem upload streaming (HTTP chunked).
- Visual diff of user vs. reference waveforms.
- Re-mixing recommendations that mutate the user's `.als` file.
- Synthesizing a "virtual mix" by summing stems for users who don't have a master.

## 12. Open Questions

None blocking. The brainstorm answered every design fork. Items deferred to implementation discretion:
- Exact RapidFuzz token-set threshold for filename ↔ .als track matching.
- Whether to surface confidence values from `propose_mapping` in the UI (vs. internal-only).
- Exact JSON shape of `stem_metrics` denormalization — to be settled when the frontend cards are built.
