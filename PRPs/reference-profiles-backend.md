name: "Reference Profiles — Backend: aggregate, status, batch & phase-6 wiring"
description: |
  Build the backend half of reference profiles so the designed v2 References UI
  (PRPs/design_handoffs/references-ui-requirements.md) has real data to render. A profile = a ReferenceSet
  aggregated (mean±std per metric) into the EXACT statistical-profile shape phase 6 already consumes. Adds
  per-reference analyze status/retry, batch upload + bulk analyze, lazy fingerprint-cached aggregation in the
  BFF (pure arithmetic — no worker, no audio), and a phase-6 injected-profile path reached via the phase-6
  re-run override. Single-track reference comparison already ships; this adds the *set-aggregate* layer.
  UI is a separate PRP. Confidence: 8/10.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Reuse the existing phase-6 statistical-profile shape — do NOT invent a second profile format.

**Design spec (authoritative):** `docs/superpowers/specs/2026-06-25-reference-profiles-design.md`
**UI requirements (downstream consumer, separate build):** `PRPs/design_handoffs/references-ui-requirements.md`

---

## Goal
A `ReferenceSet` becomes a usable comparison target:
- **Aggregate** its *analyzed* members into `feature_statistics: {feature: {mean, std}}` + `track_count`, lazily computed in the BFF and fingerprint-cached on the set row.
- **Per-reference status**: `pending | analyzed | failed` (+ short error) — today only `analyzed: bool` exists (pending vs failed indistinguishable).
- **Batch upload** + **bulk analyze** endpoints (analyze stays an explicit action — no auto-analyze).
- **Phase 6 injected-profile path**: a user profile is the same object as a genre profile; phase 6 gains a `reference_profile` param and emits `profile_kind`/`profile_name`/`profile_hue` labels. Reached via the **phase-6 re-run override**.

## Scope boundary (from spec §1, §9 — do NOT exceed)
- ❌ NO song-create/edit picker wiring. `Song.reference_profile_id`/`reference_profile_kind`/`default_reference_id` columns already EXIST (migration `20260625222006`) but no flow populates them; the dispatch song-default resolver reads them and naturally resolves to "none" until the new-song doc wires the picker. Build the resolver; do not build the picker.
- ❌ NO full results `ReferenceTab` redesign — only the 3 handoff-doc patches in Task 6.
- ❌ NO phase-5 changes (legacy single-ref delta left alone).
- ❌ NO auto-analyze on upload, NO URL/streaming import, NO multiple profiles per analysis.

## Decisions
- **Spec §7 fork → model (a)** (2026-06-26): the **genre** gap stays in **General Stats**; the **user-profile** gap owns results **Tab 5** (Reference). General Stats does NOT drop the genre gap. Task 6 documents this across the three analysis-page handoff docs.

---

## Context — files to read & why (with anchors)

### Already-shipped surface (reuse, do not rebuild)
| File | Why read |
|---|---|
| `components/bff/src/Spectr.Bff/Endpoints/ReferenceEndpoints.cs` | Route group `MapGroup("/references").RequireAuthorization()` (:19); `MaxUploadBytes = 250L*1024*1024` (:15) + `[RequestSizeLimit]` (:23); upload `storage.WriteAsync(key, src, contentType, ct)` (:91–98); owner-scope `.Where(r => r.UserId == userId)` (:48); analyze enqueue `queue.EnqueueAsync(DramatiqTasks.RunReferenceAnalyzer, new object[]{ id.ToString() }, DramatiqQueues.AnalysisPaid, ct)` (:208). Extend here. |
| `components/bff/src/Spectr.Bff/DTOs/ReferenceDtos.cs` | `ReferenceDto`/`PatchReferenceRequest`/`ReferenceSetDto`/`CreateReferenceSetRequest`/`AddReferenceToSetRequest` records (:9–50). Extend here. |
| `components/bff/src/Spectr.Data/Entities/{ReferenceTrack,ReferenceSet}.cs` | EF entities (canonical schema). Add columns here. |
| `components/shared/aimusic_shared/models.py:881–951` | `ReferenceTrack`/`ReferenceSet`/`ReferenceSetMember` (worker mirror). Add columns here too. |
| `components/worker/app/reference_analyzer_actor.py` | `@dramatiq.actor(actor_name="run_reference_analyzer", queue_name="analysis-paid", max_retries=1, time_limit=180_000)` (:36); 4-phase A/B/C/D; persist in Phase D (:90–116) inside `with SessionFactory.begin()`. Add status writes here. |
| `components/worker/app/verdict_actor.py:88–123` | `_persist_fail_marker` — the try/except-swallow fail pattern to mirror (write marker, never raise). |
| `components/worker/app/rerun_phase_actor.py:49` | `rerun_phase(rerun_job_id, analysis_id, phase)` actor; Phase B calls `rerun_single_phase(phase, file_abs, prior_final, reference_path=…, …)` (:116). Add `reference_profile` arg + kwarg. |
| `components/worker/app/tasks_dramatiq.py:142–154,182–192` | Pattern: resolve `job.reference_id → ReferenceTrack.file_path`, pass to `run_pipeline(reference_path=…)`. |
| `components/worker/app/db_sync.py` | `SessionFactory = sessionmaker(expire_on_commit=False, …)`; `with SessionFactory.begin() as s:` auto-commit context. |
| `components/analysis/src/audio_analysis/phases/phase6_gap.py:62,161` | `_analyze_with_profile(profile, phase1)` (:62) + `analyze(wav_path, genre, phase1_result, progress_cb)` (:161). The integration point. |
| `components/analysis/src/audio_analysis/genre_profile_loader.py:44` | On-disk genre profile JSON shape — **already carries per-feature `acceptable_range`** (so the new mean±2·std branch is additive, not a regression). |
| `components/analysis/src/audio_analysis/pipeline.py:44,94,263` | `run_single_phase(...)` (:44) phase-6 branch `phase6_gap.analyze(wav_path, genre, phase_data.get(1,{}), progress_cb)` (:94–98); `rerun_single_phase` (:263) dispatches through `run_single_phase`. Thread `reference_profile` here. |
| `components/bff/src/Spectr.Bff/Endpoints/ReportPhaseEndpoints.cs:18,35,57` | Group `/reports/{jobId:guid}/phases`; `MapPost("/{phase:int}/rerun")`; phase validation `2..9` (:35); enqueue `EnqueueAsync(DramatiqTasks.RerunPhase, new object[]{ rerunJobId, analysisId, phase.ToString() }, AnalysisPaid, ct)` (:57). Add optional `referenceProfile` body + embed resolved profile as a 4th positional arg. |
| `components/bff/src/Spectr.Bff/Services/IJobQueue.cs:13,18` | `EnqueueAsync(string taskName, object[] args, [string queueName,] ct)` — args are JSON-serialized positional dramatiq args; a dict embeds fine as one `object`. |
| `components/bff/src/Spectr.Bff/Program.cs:115` | `builder.Services.AddScoped<EntitlementService>()` — mirror for `ReferenceProfileAggregator`. |
| `components/bff/src/Spectr.Data/Migrations/20260616031132_AddCreditLedgerAndUsageEvents.cs:74` | `migrationBuilder.Sql(@"…")` raw-SQL pattern in `Up()`/`Down()` — use for the status backfill. |

### Gotchas (CLAUDE.md + this feature)
- **BFF owns canonical schema; mirror in shared.** Add columns to EF entities + an EF migration AND `aimusic_shared/models.py`. Worker only READS the resolved profile from the job payload — never joins reference tables.
- **EF migration command:** `dotnet ef migrations add ReferenceProfiles --project src/Spectr.Data --startup-project src/Spectr.Bff`. Raw SQL backfill goes in `Up()` after scaffolding (the library can't fluently express the conditional backfill).
- **Worker sync sessions only** (`db_sync`, psycopg2) — never the async api pattern.
- **`run_reference_analyzer` must NOT raise** on a bad file — persist a `failed` marker (mirror `_persist_fail_marker`). `rerun_phase` DOES re-raise on failure (it already writes a job-fail status first) — keep that.
- **Disk genre profiles already carry `acceptable_range`** → the new `mean±2·std` derivation only fires for injected aggregates lacking it. The `reference_profile=None` path must stay **byte-identical** (golden snapshot).
- **Keep `analyzed` bool in sync** with `analysis_status` (`true` iff `'analyzed'`) — the aggregator filters on it.

---

## Data model

Add to **`reference_tracks`**:
- `analysis_status` text NOT NULL default `'pending'` — `pending | analyzed | failed`.
- `analysis_error` text NULL — short reason (≤500 chars).

Add to **`reference_sets`**:
- `profile_json` jsonb NULL — cached aggregate.
- `profile_fingerprint` text NULL — invalidation key.

**Migration backfill (raw SQL in `Up()`):**
```sql
UPDATE reference_tracks SET analysis_status = CASE WHEN analyzed THEN 'analyzed' ELSE 'pending' END;
```

### Aggregate shape (`profile_json`) — what phase 6 consumes
```jsonc
{ "schema_version": 1, "member_count": 5, "analyzed_count": 3, "track_count": 3,
  "feature_statistics": {
    "lufs": {"mean":-8.2,"std":1.1}, "true_peak": {"mean":-0.9,"std":0.5},
    "dynamic_range": {"mean":8.4,"std":1.0}, "stereo_width": {"mean":0.62,"std":0.05},
    "stereo_correlation": {"mean":0.41,"std":0.05}, "bpm": {"mean":138.0,"std":2.0},
    "band_sub_bass":{…}, "band_bass":{…}, "band_low_mid":{…}, "band_mid":{…},
    "band_upper_mid":{…}, "band_presence":{…}, "band_air":{…} } }
```
Source map (`ReferenceTrack` col → feature): `lufs`, `true_peak_db`→`true_peak`, `dynamic_range_lu`→`dynamic_range`, `stereo_width`, `stereo_correlation`, `bpm`, `band_levels.{sub_bass,bass,low_mid,mid,upper_mid,presence,air}`→`band_*`.

**Std floors** (spec §2; `std = max(sample_stddev, floor)`; `analyzed_count==1` ⇒ std==floor):
`lufs 1.0 · true_peak 0.5 · dynamic_range 1.0 · stereo_width 0.05 · stereo_correlation 0.05 · bpm 2.0 · band_* 2.0`.

**Job-payload values** (BFF → worker, resolved at dispatch):
```jsonc
{ "kind":"user", "name":"Festival Trance", "hue":280, "track_count":3, "feature_statistics":{…} }
{ "kind":"genre", "genre":"trance" }
null
```

---

## Implementation blueprint (ordered)

Build order: **Task 1 (schema) → 2 (aggregator) → 3 (status/endpoints) → 4 (phase 6) → 5 (dispatch/rerun) → 6 (doc patches)**. Tasks 2 & 4 are independent and can be parallel after 1.

### Task 1 — Schema + DTOs
- [ ] EF: add `analysis_status` + `analysis_error` to `ReferenceTrack.cs`; `profile_json` + `profile_fingerprint` to `ReferenceSet.cs`.
- [ ] `dotnet ef migrations add ReferenceProfiles …`. Add the backfill `migrationBuilder.Sql(...)` to `Up()` (see Data model). `Down()` drops the columns (EF scaffolds this).
- [ ] Mirror all 4 columns in `aimusic_shared/models.py` (`ReferenceTrack`, `ReferenceSet`).
- [ ] DTOs (`ReferenceDtos.cs`): `ReferenceDto` += `AnalysisStatus`, `AnalysisError`; `ReferenceSetDto` += `AnalyzedCount`; NEW `ReferenceSetDetailDto { Id, Name, Hue, MemberCount, AnalyzedCount, ProfileJson (JsonElement?), Members (ReferenceSummaryDto[]), CreatedAt }`; NEW `BatchAnalyzeRequest { Guid[] Ids }`.
- [ ] Tests: migration applies + backfills (`dotnet test`); DTO serialization round-trip.

### Task 2 — Aggregation service (BFF, pure C#)
- [ ] `Services/ReferenceProfileAggregator.cs` (scoped). `Compute(IEnumerable<ReferenceTrack> members) → ProfileJson`: over members with `analyzed==true`, per feature compute `mean` (arithmetic) + `std = max(sampleStdDev, floor)`; aggregate each band over the **intersection** of members that HAVE that band (a member missing a band is excluded from that band only). `analyzed_count==0` ⇒ profile not ready (`profile_json` may still be written with empty `feature_statistics`; readiness derived from `analyzed_count`).
- [ ] `Fingerprint(members)` = stable hash (SHA-256 hex) over each member's `(id, analyzed, lufs, true_peak_db, dynamic_range_lu, stereo_width, stereo_correlation, bpm, band_levels-json)` sorted by id.
- [ ] `EnsureFresh(ReferenceSet set, members)`: if `Fingerprint(members) != set.ProfileFingerprint`, recompute `ProfileJson` + set `ProfileFingerprint`, persist. Call from `GET /reference-sets/{id}` and from dispatch resolution.
- [ ] Register: `builder.Services.AddScoped<ReferenceProfileAggregator>()` (Program.cs near :115).
- [ ] Tests (`Spectr.Bff.Tests`): mean/std math; floor; `analyzed_count==1` (std==floor); mixed analyzed/unanalyzed (only analyzed contribute); band key intersection; readiness (0 analyzed); fingerprint invalidation on add/remove/re-analyze.

### Task 3 — Per-reference status + retry + endpoints
- [ ] Worker `reference_analyzer_actor.py` Phase D: inside the existing `with SessionFactory.begin()` try/except, on success set `ref.analysis_status='analyzed'`, `ref.analysis_error=None`, `ref.analyzed=True`; on exception set `ref.analysis_status='failed'`, `ref.analysis_error=str(exc)[:500]`, `ref.analyzed=False` and **return (no raise)**.
- [ ] `GET /reference-sets/{id}` → `ReferenceSetDetailDto`: load set + members (owner-scoped), `aggregator.EnsureFresh(...)`, return DTO incl. `ProfileJson` + member summaries.
- [ ] `POST /references/batch` (multi `IFormFile`): same 250 MB/file cap + magic-byte/extension validation as single upload; create one `pending` `ReferenceTrack` per file; return `ReferenceDto[]`. Does NOT enqueue.
- [ ] `POST /references/analyze` body `BatchAnalyzeRequest`: for each owned id with `analysis_status != 'analyzed'`, reset to `'pending'` and `queue.EnqueueAsync(DramatiqTasks.RunReferenceAnalyzer, new object[]{ id.ToString() }, DramatiqQueues.AnalysisPaid, ct)`; skip already-analyzed. Single `/references/{id}/analyze` stays.
- [ ] Tests: actor failed-marker persistence (monkeypatch phase1 to throw → status `failed`, no raise; mirror `tests/test_*actor*`); retry resets `failed`→`pending`→`analyzed`; batch creates N pending; bulk analyze enqueues per id + skips analyzed; ownership/IDOR on all new routes.

### Task 4 — Phase 6 injected-profile path (analysis pkg)
- [ ] `phase6_gap._analyze_with_profile` (:81): replace the single `acc_range = stats.get("acceptable_range", [p10,p90])` with a derive-fallback:
  ```python
  acc_range = stats.get("acceptable_range")
  if acc_range is None:
      mean, std = stats.get("mean"), stats.get("std")
      acc_range = ([mean - 2*std, mean + 2*std] if std is not None and mean is not None
                   else [stats.get("p10"), stats.get("p90")])
  ```
- [ ] `phase6_gap.analyze(...)` += `reference_profile: dict | None = None`. Branch at top:
  - `kind=="user"` (has `feature_statistics`) → `r = _analyze_with_profile(reference_profile, phase1_result)`; set `r["profile_kind"]="user"`, `r["profile_name"]=reference_profile.get("name")`, `r["profile_hue"]=reference_profile.get("hue")`.
  - `kind=="genre"` → `genre = reference_profile["genre"]` then existing `load_profile(genre)` path; labels `profile_kind="genre"`, `profile_name=genre`, `profile_hue=None`.
  - `None` → unchanged detected-genre path; still stamp `profile_kind="genre_statistical"|"genre"`, `profile_name`, `profile_hue=None` for UI parity (additive keys; values for the genre path).
- [ ] `pipeline.py`: add `reference_profile: dict | None = None` to `run_single_phase` (:44) + `rerun_single_phase` (:263); thread into the phase-6 call (:94) → `phase6_gap.analyze(wav_path, genre, phase_data.get(1,{}), progress_cb, reference_profile=reference_profile)`.
- [ ] Tests: NEW `tests/phases/test_phase6_gap.py` — injected user profile → `acceptable_range == [mean-2σ, mean+2σ]`; in/out-of-range gap; labels surfaced; bad-shape profile handled. NEW golden `tests/integration/` snapshot for an injected profile; **assert the existing genre/no-profile snapshots stay byte-identical** (`reference_profile=None` unchanged).

### Task 5 — Dispatch resolution + re-run override
- [ ] BFF `Services/ReferenceProfileResolver.cs` (or inline in the endpoint): effective profile priority — (1) explicit re-run override; (2) `Song.reference_profile_*` (inert until new-song wiring populates it; resolves null today); (3) none. For a `user` set: `aggregator.EnsureFresh(...)` then build `{kind:"user", name, hue, track_count, feature_statistics}`. For `genre`: `{kind:"genre", genre}`. Else `null`.
- [ ] `ReportPhaseEndpoints.RerunPhase`: accept optional body `{ referenceProfile: { kind:"user", setId } | { kind:"genre", preset } }`. Resolve → embed as a 4th positional arg: `EnqueueAsync(DramatiqTasks.RerunPhase, new object[]{ rerunJobId, analysisId, phase.ToString(), resolvedProfileOrNull }, AnalysisPaid, ct)`. Expose phase 6 in the UI-facing re-run set (server already accepts 2–9).
- [ ] Worker `rerun_phase(rerun_job_id, analysis_id, phase, reference_profile=None)`: forward `reference_profile` into `rerun_single_phase(phase, file_abs, prior_final, …, reference_profile=reference_profile)`.
- [ ] Tests: resolver picks user vs genre vs none → correct payload; user path embeds a FRESH aggregate (fingerprint refresh before embed); BFF enqueue carries the 4th arg; worker forwards it (monkeypatch `rerun_single_phase`, assert kwarg).

### Task 6 — Handoff doc patches (decision (a))
- [ ] `PRPs/design_handoffs/analysis-page-states.md` Tab 5 (~58–63): replace "Disabled" with no-profile / ready / not-ready (`analyzed_count==0`) / user-vs-genre-preset / re-run-override states. Note: **General Stats keeps the genre gap; Tab 5 hosts the user profile** (model a).
- [ ] `PRPs/design_handoffs/analysis-page-datapoints.md` Tab 5 (~271–290) + phase-6 row (~113): Tab 5 is live; phase-6 gaps gain `profile_kind`/`profile_name`/`profile_hue`/`track_count`; phase 6 is the engine for both genre + user comparison; phase 5 legacy.
- [ ] `PRPs/design_handoffs/analysis-page-mock.json` (~83–96): add a populated `phase6` user-profile example (`profile_kind:"user"`, name/hue/track_count + realistic gaps).

---

## Validation gates (executable)
```bash
# Schema + BFF (aggregator, endpoints, resolver)
cd components/bff && dotnet build && dotnet test
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff

# Shared + analysis + worker
pip install -e components/shared && pip install -e components/analysis
ruff check components/worker/ components/analysis/src/ components/shared/
mypy components/worker/app/ --ignore-missing-imports
pytest -q components/analysis/tests/        # phase-6 injected path + golden snapshots (None path byte-identical)
pytest -q components/worker/tests/           # actor status/retry + rerun payload forwarding
pytest -q components/shared/tests/
```

## Error handling patterns
- **Bad reference file** → `run_reference_analyzer` writes `analysis_status='failed'` + truncated `analysis_error`, returns (never raises). Retry via `/references/analyze` resets to `pending`.
- **Profile not ready** (`analyzed_count==0`) → resolver still produces a payload but with empty `feature_statistics`; phase 6 with empty stats yields empty gaps (no crash). UI gates on readiness.
- **Deleted set / non-owner** on re-run override → 404/403, owner-scoped (`WHERE user_id = current_user`).
- **Genre preset with no disk profile** → existing phase-6 fallback (`percentile 50, gaps {}`) — unchanged.

## Anti-patterns
- ❌ Don't invent a second profile format — emit the exact `feature_statistics`/`track_count` shape.
- ❌ Don't aggregate in the worker or decode audio — aggregation is pure BFF arithmetic over stored metrics.
- ❌ Don't let `run_reference_analyzer` raise — persist the `failed` marker.
- ❌ Don't break genre/no-profile golden snapshots — `reference_profile=None` stays byte-identical.
- ❌ Don't add the song-create picker or auto-analyze here.
- ❌ Don't use `db.Songs.AsNoTracking()` in any write-path lookup (CLAUDE.md: poisons the whole query → silent dropped update).

## Success criteria
- [ ] 4 columns live (EF migration + shared mirror); existing rows backfilled.
- [ ] Aggregator computes mean/std with floors, intersection bands, readiness; fingerprint invalidates on add/remove/re-analyze.
- [ ] `GET /reference-sets/{id}` returns fresh `profileJson` + member statuses; owner-scoped.
- [ ] Batch upload creates N `pending`; bulk analyze enqueues per id, skips analyzed.
- [ ] References show `pending|analyzed|failed`; actor never raises; retry works.
- [ ] Phase 6 accepts an injected user profile → gaps with `acceptable_range = mean±2·std` + `profile_kind/name/hue`; `None` path byte-identical (snapshots green).
- [ ] Re-run override resolves user/genre/none → correct 4-arg enqueue → worker forwards to `rerun_single_phase`.
- [ ] 3 handoff docs patched to model (a).
- [ ] All validation gates pass.

## Confidence: 8/10
Strong: every integration point has a verified anchor + snippet; the aggregate reuses an existing consumed shape; disk profiles already carry `acceptable_range` so the phase-6 change is additive. Risk: EF migration raw-SQL backfill on Windows + getting the `rerun_phase` 4th positional arg through the dramatiq wire format exactly right (validate with the worker test that monkeypatches `rerun_single_phase`).
