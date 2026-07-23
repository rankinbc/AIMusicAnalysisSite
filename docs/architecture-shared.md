# Architecture: shared (`aimusic-shared` package)

Component root: `C:\Users\badmin\projects\AIMusicAnalysisSite\components\shared`
Install: `pip install -e components/shared` (setuptools build; package `aimusic_shared`).

## Purpose

Python-side single source for the database ORM used by the dramatiq worker (and residual legacy-api imports). It is explicitly a **mirror, not the owner**: the header of `aimusic_shared/models.py` states that the EF Core entities in `components/bff/src/Spectr.Data/Entities/` are canonical and EF Core owns all schema migrations. The rule is one-directional — add a column in C# first, run the EF migration, then mirror it here; never introduce a column or table in this package that does not exist in an EF entity. The package also carries the Pydantic wire models and deterministic scoring for the verdict pipeline, shared so the worker, legacy api, and tests all validate/score verdicts identically.

Dependencies (`pyproject.toml`): `sqlalchemy>=2.0.0`, `psycopg2-binary`, `python-ulid>=2.2`, `pydantic>=2.7,<3`. No async driver — the worker uses sync sessions.

## Package layout

- `aimusic_shared/models.py` (~1370 lines) — SQLAlchemy 2.0 declarative mirror of the EF schema. `Base`, string job-status constants (`JOB_STATUS_PENDING/PROCESSING/COMPLETE/FAILED/AWAITING_STEM_MAPPING`, `JOB_STATUS_ALL` — the former `JobStatus` enum is gone), and mapped classes covering:
  - Core: `User`, `RefreshToken`, `Song`, `SongVersion`, `AnalysisJob` (nullable `user_id`/`device_id` for the anon funnel, `file_path` for song-less anon jobs, `tier` stamped by the BFF at dispatch, `error_code`, `retry_of_job_id`), `Analysis` (`final_json`, `phase_durations`, `routing_plan`, `degradation_notice`, share fields, result-image paths).
  - Verdicts: `Verdict` (ULID string PK `vrd_...`, priority/severity/evidence/fix JSONB, plus the 8 IDENTIFY-tier Problem columns: `problem_id`, `kind`, `source`, `data_tier`, `fixable`, `suspected`, `where`, `refines`), `VerdictUserState`.
  - Coach/LLM: `Conversation`, `CoachMessage`, `PromptVersion`, `LlmCall`, `Device`.
  - Listening-room pivot tables: `SessionNote`, `RackPreset`, `RackDraft`, `VizPreset`, `ShareSetting`, `Invite`, `ListeningSession`, `ControlGrant`, `ReferenceTrack`, `ReferenceSet(+Member)`, `CompareCache`, `TrackComment`, `ReviewerSuggestion`, `TrackBookmark`, `Notification`, `FollowRelation`.
  - Note: `__all__` in `aimusic_shared/__init__.py` re-exports only the core subset; import the rest from `aimusic_shared.models` directly.
- `aimusic_shared/verdicts/` — verdict domain package (`from aimusic_shared import verdicts` works via re-export):
  - `models.py` — Pydantic v2 wire models with `extra="forbid"`: `Verdict` (with the optional IDENTIFY Problem fields defaulted so old constructors still work), `Evidence`, `Fix`, `DspOp` (per-DSP-type param whitelists + numeric ranges, e.g. `peaking_eq.gain_db` in [-24, 24] — the guard against hallucinated LLM fix params), `UserState`, `SpecialistRoutingPlan`, and the `Severity`/`Category`/`DspType`/`ProblemSource`/`DataTier`/`ProblemKind` literals. Hand-mirrored to the frontend `types/verdicts.ts`.
  - `scoring.py` — the authoritative priority formula: `compute_priority_score(severity, category, scope) = round(base * category_weight * scope_multiplier)` with base severity {critical 200, severe 120, moderate 70, minor 30, win 20}, category weights {clipping 1.5, loudness 1.4, mono_compatibility 1.4, low_end 1.3, default 1.0}, scope multipliers {full_track 1.0, multi_section 0.9, single_section 0.7, single_stem 0.6}; and `severity_from_score` bands (>=200 critical, >=100 severe, >=50 moderate, >=25 minor, else win). LLM-supplied scores are never trusted — the worker validator (`components/worker/app/verdict_lib/validator.py`) overwrites `priority_score` with this formula and applies the **moderate-baseline severity downgrade**: the band ceiling for an unjustified severity claim is computed from `compute_priority_score("moderate", category, scope)`, because otherwise a category weight like `low_end=1.3` would inflate any claim back into the critical band and defeat the downgrade.
  - `ulid_helpers.py` — `new_verdict_id()` / `new_fix_id()` / `new_llm_call_id()` (`vrd_`/`fix_`/`llm_` + 26-char ULID) and the `is_*_id` validators. `Verdict.id` in the ORM is `String(40)`, not a Guid, to preserve these.

## Install order requirement

`components/worker/requirements.txt` (and the legacy `components/api/requirements.txt`) declare `aimusic-shared>=0.1.0`, and `audio_analysis` sits alongside it — in any fresh environment install shared FIRST:

```bash
pip install -e components/shared
pip install -e components/analysis
```

The legacy api re-exports `Base` from here (`components/api/app/db.py`); never define a second `Base` or duplicate ORM models in api or worker.

## What must stay in sync, and how drift is caught

Sync chain for any schema change: EF entity + migration (`Spectr.Data`) -> `aimusic_shared/models.py` mirror -> worker persistence mappers (`degraded._to_row`, `verdict_actor._persist_verdict`) -> BFF DTOs -> frontend hand-mirrored TS types.

Drift guards (all in `components/shared/tests/`, run with `pytest -q components/shared/tests/`):

- `test_verdict_orm_problem_columns.py` — the `Verdict` ORM must carry all 8 Problem columns from EF migration `AddVerdictProblemFields`, with defaults on the non-null ones and nullability on `problem_id`/`where`/`refines`.
- `test_analysis_job_orm.py` — `AnalysisJob.tier` must exist as nullable `String(16)` (mirrors EF `AnalysisJob.Tier`; the worker gates the LLM-identifier stage on it).
- `test_rack_preset_orm.py` — pins the `RackPreset` mirror.
- `test_verdict_schema.py` / `test_problem_fields.py` — Pydantic `Verdict` shape, `extra="forbid"` rejection, Problem-field defaults.
- `test_verdict_scoring.py` — pins the priority formula and severity bands.

These tests pin the Python mirror to specific EF migrations; there is no automated EF-to-SQLAlchemy diff, so the column-presence tests plus the "C# first" rule in the `models.py` header are the enforcement mechanism. A runtime symptom of missed mirroring is the worker failing to persist (unknown column) or silently dropping new fields.
