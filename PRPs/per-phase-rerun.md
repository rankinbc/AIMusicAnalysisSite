name: "Per-phase re-run — re-run a single analysis phase in place"
description: |
  Let the user re-run one DSP phase (stem clash / reference / als, or retry any failed phase)
  from the Analysis tab. The re-run runs only that phase, merges it into the existing
  `analyses.final_json`, re-derives the rollups, and refreshes the same report in place.
  Design source: PRPs/per-phase-rerun-design.md.

## Goal

Add per-phase re-run: a per-row **Re-run** button on Stem clash (4) / Reference (5) / Ableton (8)
and a **Retry** on any failed phase. It dispatches a lightweight re-run job that runs just that
phase, merges the result into the existing analysis, re-derives the top-level rollups, and the
report updates in place — no whole-pipeline re-run, no duplicate report.

## Why

- Today the only DSP dispatch is `analyze_audio_job` → `run_pipeline` (all 7–8 phases). Re-running
  one phase (e.g. after adding stems, or to retry a failed step) means recomputing everything.
- Phases are modular functions with a known dependency chain; any phase 2–8 can be re-run from the
  stored phase-1 output + genre (both already in `final_json`).

## What

Per-row Re-run/Retry on the Analysis tab → `POST /api/reports/{jobId}/phases/{phase}/rerun` →
re-run `AnalysisJob` (progress vehicle) → worker `rerun_phase` actor runs the single phase, merges
into the existing `analyses.final_json`, re-derives rollups, flips the re-run job complete →
frontend polls the re-run job and refetches the report.

### Success Criteria
- [ ] Re-run button on phase rows 4, 5 and the Ableton (8) row; Retry on any `failed` phase row; no button on phase 1.
- [ ] A re-run runs **only** the requested phase; all other phases in `final_json.phases[]` are byte-identical afterward.
- [ ] Rollups (`overall_score`, `grade`, `top_fixes`, `danceability_score`, `coach_*`) are re-derived from the merged phase set.
- [ ] The re-run updates the **existing** analysis row (same report URL); **no** new `analyses` row is created.
- [ ] Re-run progress is visible (re-run `AnalysisJob` goes pending→processing→complete; `current_phase`/`phase_pct` surface via the existing job status/SSE).
- [ ] On re-run failure the re-run job is marked `failed` with an error; the existing report is **not** corrupted.
- [ ] **`run_pipeline` output is unchanged** after the refactor (golden snapshots pass).
- [ ] All validation gates pass.

## All Needed Context

### Decisions (from PRPs/per-phase-rerun-design.md)
- Scope **exposed in UI** = asset-driven (4/5/8) + retry-failed; **server** accepts phase ∈ [2,8] (rejects 1 and out-of-range — phase 1 = full re-run only).
- Trigger = per-row button. Result = update report in place. No cascading re-runs, no DB migration.

### Verified code patterns (quote-accurate; projects checkout)

```yaml
analysis — components/analysis/src/audio_analysis/pipeline.py:
  imports (L14–23): to_wav, generate_coached_fixes, danceability_score, PhaseResult, PipelineResult,
                    phase1_universal..phase7_arrangement, phase8_als.analyze_als
  run_pipeline(L38–): sig (file_path, reference_path=None, als_file_path=None, genre_hint=None,
       progress_cb=None, stem_paths=None, reference_stem_paths=None, stem_mode="grouped") -> PipelineResult
    L62–64: wav_path = to_wav(file_path)
    L65–66: phase_results: list[PhaseResult] = []; phase_data: dict[int,dict] = {}
    L68–138: loop over PHASE_DEFS (1..7). Per phase try/except builds PhaseResult(status ok|failed);
       on ok: phase_data[n]=data. Dispatch args (EXACT):
         1: phase1_universal.analyze(wav_path, progress_cb)
         2: phase2_genre.classify(wav_path, phase_data.get(1,{}), progress_cb, genre_hint=genre_hint)
         3: genre=phase_data.get(2,{}).get("genre","other"); phase3_genre_specific.score(wav_path, genre, phase_data.get(1,{}), progress_cb)
         4: phase4_stems.analyze(wav_path, progress_cb, stem_paths=stem_paths, stem_mode=stem_mode)
         5: genre=...; phase5_reference.compare(wav_path, reference_path, phase_data.get(1,{}), progress_cb, genre=genre, user_stem_paths=stem_paths, reference_stem_paths=reference_stem_paths)
         6: genre=...; phase6_gap.analyze(wav_path, genre, phase_data.get(1,{}), progress_cb)
         7: structure=phase_data.get(1,{}).get("structure",{}); genre=...; bpm=float(phase_data.get(1,{}).get("bpm",128.0)); duration_seconds=float(phase_data.get(1,{}).get("duration_seconds",0.0)); phase7_arrangement.advise(structure, genre, progress_cb, bpm=bpm, duration_seconds=duration_seconds)
    L140–146: phase 8 appended OUTSIDE loop: progress_cb(8,"ALS Analysis",0.0); phase8=analyze_als(als_file_path); phase_results.append(PhaseResult(**phase8)); progress_cb(8,...,1.0)
    L148–195: AGGREGATION TAIL → ok_phases; overall_score (phase_data[3].total_score or 50*ok/len);
       grade=_score_to_grade; top_fixes=_extract_fixes(phase_data); danceability via danceability_score(...);
       coaching=generate_coached_fixes({**p1,"top_fixes":top_fixes}); return PipelineResult(file_path, phases,
       overall_score, grade, top_fixes, danceability_score, coach_name, coach_intro, coached_fixes)
    helpers: _score_to_grade (L~204), _extract_fixes (L~216)
  schemas.py: PhaseResult TypedDict{phase:int,name:str,status:Literal[ok,failed,skipped],data:dict,error:str|None};
              PipelineResult TypedDict{file_path,phases,overall_score,grade,top_fixes,danceability_score,coach_name,coach_intro,coached_fixes}

worker — components/worker/app:
  tasks_dramatiq.py analyze_audio_job: @dramatiq.actor(actor_name="analyze_audio_job", queue_name="default",
     max_retries=2, time_limit=3_600_000). 3-phase tx; Phase C inserts Analysis(id=uuid4(), job_id, user_id,
     version_id, song_id, song_name, final_json=result_dict, phase_durations={}, created_at=_utc_now()).
     final_json coercion: result_dict = json.loads(json.dumps(pipeline_result, default=str)).
     _report_progress(phase,name,pct) writes job.current_phase/phase_pct in its own SessionFactory.begin().
     LOCAL_ROOT/_default_local_root; paths joined: file_abs=str((Path(LOCAL_ROOT)/version.file_path).resolve()),
     reference/als joined as (str(Path(LOCAL_ROOT)/x) if x else None); stem_paths=version.stem_paths; stem_mode=version.stem_analysis_mode or "grouped".
  triage_actor.py / verdict_actor.py: PATTERN for an actor that LOADS+UPDATES an existing Analysis row:
     with SessionFactory.begin() as s: row=s.get(Analysis, aid); row.<jsonb col>=value  (e.g. routing_plan).
     verdict_actor._persist_fail_marker shows fail handling pattern.
  db_sync.py: SessionFactory=sessionmaker(bind=engine, expire_on_commit=False, future=True); use `with SessionFactory.begin() as s:`.
  dramatiq_app.py: registers actors by importing modules. ADD `from . import rerun_phase_actor  # noqa: E402,F401`.
  shared/aimusic_shared/models.py Analysis: id, job_id, user_id, version_id, song_id, song_name,
     final_json(JSONB,nonnull), phase_durations(JSONB), routing_plan(JSONB,null), created_at. SongVersion: file_path,
     reference_path, als_file_path, stem_paths(JSONB), stem_analysis_mode. AnalysisJob: id,user_id,version_id,status,current_phase,phase_pct,...

bff — components/bff/src/Spectr.Bff:
  Endpoints/VerdictEndpoints.cs RunSpecialist (L152–183) is the MIRROR: group MapGroup("/reports/{jobId:guid}/verdicts");
     ownership via db.Analyses.AsNoTracking().Where(a=>a.JobId==jobId && a.UserId==userId).Select(a=>new{a.Id}).FirstOrDefaultAsync;
     queue.EnqueueAsync(DramatiqTasks.X, new object[]{...}, ct); return Results.Accepted(value: new RunSpecialistResponse("queued")).
     Registration: api.MapVerdictEndpoints() in Program.cs (api = app.MapGroup("/api")).
  Endpoints/JobEndpoints.cs GetResults (L222–255): db.Analyses ... a.FinalJson (string jsonb) parsed via JsonDocument.Parse.
  Endpoints/VersionEndpoints.cs Reanalyze (L96–123): AnalysisJob creation + enqueue pattern (copy for the re-run job).
  Spectr.Data/Entities/Analysis.cs: FinalJson is `string` ([Column("final_json", TypeName="jsonb")]).
  Services/DramatiqTasks.cs: consts. Services/IJobQueue.cs: EnqueueAsync(taskName, object[] args, ct).
  DTOs: ReanalyzeResponse(Guid JobId) in VersionDtos.cs; RunSpecialistResponse(string Status) in VerdictDtos.cs.

frontend — components/frontend-spectr-v2/src:
  features/results/AnalysisTab.tsx: derivePipeline builds PipelineRow[] (ids: phase-1..phase-7, plus virtual
     specialists/stems/reference/als). PipelineRowItem (L646) renders row + a `row.cta` button → onCta.
     hasStemData/hasAlsData helpers already added. Phase rows map id `phase-{n}`; the `als` virtual row = phase 8.
  api/hooks.ts: useReanalyzeVersion (POST /versions/{id}/analyze) + useJob(jobId,{pollMs}) (stops at complete/failed)
     + useRunSpecialist — mirror these for useRerunPhase. Results query: useJobResults(jobId) — invalidate it on done.
  routes/_app/songs.$songId.results.$jobId.tsx: renders AnalysisTab inside ReportView; useJob polling lives here.
  api/types.ts: add RerunPhaseResponse { jobId: string }.

CRITICAL gotchas:
  - REFACTOR MUST NOT CHANGE OUTPUT: run_pipeline must return byte-identical PipelineResult. Guard with golden
    snapshots in components/analysis/tests (e.g. phase4_with_stems.json). Run with/without UPDATE_SNAPSHOTS to confirm zero diff.
  - final_json write coercion: when writing merged result back, use json.loads(json.dumps(merged, default=str)) before
    assigning to Analysis.final_json (same as analyze_audio_job) so JSONB serializes cleanly.
  - Update the EXISTING analysis row (s.get(Analysis, analysis_id)); NEVER s.add a second Analysis (uq_analyses_job_id).
  - Re-run job is a separate AnalysisJob (progress only) — the actor does NOT insert an Analysis for it.
  - EF Analysis.FinalJson is a string; in C# only the existence/ownership matters here (don't parse phases server-side).
  - Worker actors are sync def + SessionFactory (psycopg2). Wrap any async with asyncio.run (none needed here).
  - Phase 1 re-run is rejected server-side (400/409) — it's a full re-analyze.
```

## Implementation Blueprint

### Component: analysis (behavior-preserving refactor + re-run helper)

```yaml
Task A1 — REFACTOR components/analysis/src/audio_analysis/pipeline.py:
  - EXTRACT `run_single_phase(phase_num, *, wav_path, phase_data, reference_path, als_file_path,
      stem_paths, reference_stem_paths, genre_hint, stem_mode, progress_cb) -> PhaseResult`:
      contains the per-phase try/except + dispatch for phases 1–7 EXACTLY as in the loop (read genre/
      structure from phase_data inside). Returns a PhaseResult (status ok|failed). Does NOT mutate phase_data.
  - EXTRACT `finalize_result(phase_data: dict[int,dict], phase_results: list[PhaseResult], file_path: str)
      -> PipelineResult`: lines 148–195 verbatim (overall_score, grade, top_fixes, danceability, coaching, assembly).
  - REWRITE run_pipeline to: convert wav; loop PHASE_DEFS calling run_single_phase, append result, and on
      status=="ok" set phase_data[n]=pr["data"]; append phase 8 as today; `return finalize_result(phase_data, phase_results, file_path)`.
  - VERIFY: golden snapshots unchanged (this is the acceptance gate for A1).

Task A2 — ADD `rerun_single_phase(phase_num, file_path, prior_result, *, reference_path=None,
    als_file_path=None, stem_paths=None, reference_stem_paths=None, stem_mode="grouped", progress_cb=None)
    -> PipelineResult` (new function in pipeline.py, exported):
  - phase_results = list(prior_result["phases"]); phase_data = {p["phase"]: p["data"] for p in phase_results if p["status"]=="ok"}
  - if phase_num == 8: new_pr = PhaseResult(**analyze_als(als_file_path))
    else: wav = to_wav(file_path); new_pr = run_single_phase(phase_num, wav_path=wav, phase_data=phase_data,
       reference_path=reference_path, als_file_path=als_file_path, stem_paths=stem_paths,
       reference_stem_paths=reference_stem_paths, genre_hint=None, stem_mode=stem_mode, progress_cb=progress_cb)
  - replace the phase_results entry whose ["phase"]==phase_num with new_pr (append if none existed)
  - if new_pr["status"]=="ok": phase_data[phase_num]=new_pr["data"] else phase_data.pop(phase_num, None)
  - return finalize_result(phase_data, phase_results, str(file_path))
  - Export run_single_phase, finalize_result, rerun_single_phase from the package __init__ if run_pipeline is exported there.

Task A3 — TESTS components/analysis/tests:
  - test_refactor_snapshot: run_pipeline output equals the committed golden (no diff).
  - test_rerun_single_phase: given a prior_result fixture, rerun_single_phase(4,...) replaces ONLY phase 4,
    leaves phases 1–3/5–7 identical, and re-derives rollups; rerun of a phase whose dep (phase1) exists works;
    phase 8 path replaces/【appends】 the als phase.
```

### Component: worker (rerun_phase actor)

```yaml
Task W1 — CREATE components/worker/app/rerun_phase_actor.py:
  @dramatiq.actor(actor_name="rerun_phase", queue_name="default", max_retries=1, time_limit=600_000)
  def rerun_phase(rerun_job_id: str, analysis_id: str, phase: int) -> None
  - Phase A (tx): job=s.get(AnalysisJob, rerun_jid); job.status="processing"; job.started_at=now;
      job.current_phase="starting"; job.phase_pct=0.0. Load Analysis(analysis_id) → capture final_json (dict),
      version_id, user_id. Load SongVersion(version_id) → file_path/reference_path/als_file_path/stem_paths/stem_mode.
      Resolve abs paths against LOCAL_ROOT (reuse helpers from tasks_dramatiq — import LOCAL_ROOT or factor a shared helper).
  - Phase B (NO tx): _report_progress writes to the RERUN job (current_phase=phase name, phase_pct overall=pct for
      a single phase → 0..1). merged = rerun_single_phase(phase, file_abs, prior_final_json,
      reference_path=ref_abs, als_file_path=als_abs, stem_paths=stem_paths, stem_mode=stem_mode, progress_cb=_report_progress).
      merged_safe = json.loads(json.dumps(merged, default=str)).
  - Phase C (tx): row=s.get(Analysis, aid); row.final_json=merged_safe.  job=s.get(AnalysisJob, rerun_jid);
      job.status="complete"; job.phase_pct=1.0; job.current_phase="complete"; job.completed_at=now.
  - On exception: tx → set rerun job status="failed", error_message=str(exc)[:2000], failed_at=now, current_phase="failed".
      Do NOT touch the Analysis row. (Mirror analyze_audio_job's failure handling.)
  NOTE: reuse LOCAL_ROOT + _utc_now from tasks_dramatiq (import them) to avoid drift.

Task W2 — REGISTER in components/worker/app/dramatiq_app.py:
  add `from . import rerun_phase_actor  # noqa: E402,F401`

Task W3 — TESTS components/worker/tests/test_rerun_phase.py:
  - rerun_phase merges only the target phase + re-derives rollups (mock rerun_single_phase or use a real prior_result),
    updates the existing Analysis row, flips the rerun job complete.
  - exception path marks the rerun job failed and leaves Analysis.final_json untouched.
  (Match the existing worker test conventions; mock heavy audio where needed.)
```

### Component: bff (endpoint + DTO + constant)

```yaml
Task B1 — components/bff/src/Spectr.Bff/Services/DramatiqTasks.cs:
  add: public const string RerunPhase = "rerun_phase";

Task B2 — DTO (DTOs/VersionDtos.cs or JobDtos.cs):
  add: public sealed record RerunPhaseResponse(Guid JobId);

Task B3 — ENDPOINT (add to VerdictEndpoints.cs report group, OR a small ReportPhaseEndpoints.cs mapped under /api):
  Route: POST /api/reports/{jobId:guid}/phases/{phase:int}/rerun  → RerunPhase handler.
  Handler (mirror RunSpecialist):
    - userId = user.UserId().
    - if (phase < 2 || phase > 8) return Results.BadRequest(new { error = "Phase 1 is full re-analyze only; phase must be 2–8." });
    - analysis = db.Analyses.AsNoTracking().Where(a=>a.JobId==jobId && a.UserId==userId).Select(a=>new{a.Id, a.VersionId}).FirstOrDefaultAsync; if null → NotFound.
    - create re-run AnalysisJob { Id=rerunJobId, UserId=userId, VersionId=analysis.VersionId, Status="pending" }; SaveChanges.
    - queue.EnqueueAsync(DramatiqTasks.RerunPhase, new object[] { rerunJobId.ToString(), analysis.Id.ToString(), phase }, ct);
      (dramatiq args are positional → phase as int is fine; worker signature is (rerun_job_id, analysis_id, phase).)
    - return Results.Accepted(value: new RerunPhaseResponse(rerunJobId)).
  If using a new endpoints file: add MapReportPhaseEndpoints() and call it in Program.cs next to MapVerdictEndpoints().

Task B4 — TEST (components/bff/tests/Spectr.Bff.Tests, mirror UploadDeferralTests + RecordingJobQueue):
  - rerun phase 4 on an owned analysis → 202, RerunPhaseResponse.JobId set, exactly one EnqueueAsync(RerunPhase),
    a new pending AnalysisJob created.
  - phase 1 → 400; phase 99 → 400; unknown/unowned jobId → 404 (no enqueue).
```

### Component: frontend-spectr-v2 (hook + per-row button)

```yaml
Task F1 — api/types.ts: add `export interface RerunPhaseResponse { jobId: string }`.

Task F2 — api/hooks.ts: add
  export function useRerunPhase(jobId: string) {
    return useMutation({ mutationFn: (phase: number) =>
      fetcher<RerunPhaseResponse>({ url: `/reports/${jobId}/phases/${phase}/rerun`, method: 'POST' }) });
  }

Task F3 — features/results/AnalysisTab.tsx:
  - Add optional `rerunPhase?: number` to PipelineRow. In derivePipeline, set it:
      * real phase rows (id `phase-${n}`): rerunPhase=n when n∈{4,5} OR status==='failed' (n>=2).
      * als row: rerunPhase=8 (when status 'ok' → Re-run, 'failed' → Retry).
  - PipelineRowItem: when row.rerunPhase != null, render a small button — label 'Retry' if status==='failed'
      else 'Re-run' — calling a new onRerun(row.rerunPhase) prop. Disable while a re-run is in flight.
  - In AnalysisTab: const rerun = useRerunPhase(jobId); track the active rerun job id in state; on click →
      rerun.mutateAsync(phase) → setRerunJobId(res.jobId). Poll with useJob(rerunJobId ?? '', {pollMs:1500}).
      When that job's status === 'complete' → invalidate the results query (queryKey used by useJobResults(jobId),
      e.g. ['jobs', jobId, 'results']) and ['songs']; toast success; clear rerunJobId. On 'failed' → toast error; clear.
  - Show the active row as 're-running…' while rerunJobId is set and matches.

Task F4 — TESTS:
  - unit: derivePipeline sets rerunPhase on phase-4/phase-5/als and on failed rows; not on phase-1.
    (Add to an AnalysisTab helper test or export a tiny pure helper for the gating decision and test it.)
  - all four gates green.
```

### Inter-component ordering
1. analysis A1–A3 first (refactor + helper); golden snapshot MUST pass before proceeding.
2. worker W1–W3 (depends on rerun_single_phase).
3. bff B1–B4.
4. frontend F1–F4.
5. e2e last.

## Validation Loop

### Level 1 — Python (analysis + worker)
```bash
ruff check components/analysis/src/ components/worker/
pytest -q components/analysis/tests/      # golden snapshot proves run_pipeline unchanged
pytest -q components/worker/tests/        # 3 pre-existing verdict_pipeline DB-auth failures are unrelated
```

### Level 2 — BFF
```bash
# stop the running BFF first (Windows file lock)
cd components/bff && dotnet build && dotnet test
```

### Level 3 — Frontend (all four gates, --max-warnings 0)
```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```

### Level 4 — Integration (in-place re-run proof)
```bash
docker compose -f docker/docker-compose.yml up -d   # Postgres + Redis (or use the running native ones)
# BFF + worker running. Script:
#  register → upload+analyze a track (full run) → capture jobId + final_json.phases hashes
#  POST /api/reports/{jobId}/phases/4/rerun → poll the returned re-run jobId to complete
#  GET /api/jobs/{jobId}/results → assert: phases[4] changed/refreshed, phases {1,2,3,5,6,7} byte-identical,
#    rollups present, and SELECT count(*) FROM analyses WHERE job_id={jobId} == 1 (no duplicate analysis).
```

## Anti-Patterns to Avoid
- ❌ Changing `run_pipeline`'s output during the refactor — golden snapshots must show zero diff. Extract, don't alter.
- ❌ Inserting a second `Analysis` row for the re-run — update the existing one (`uq_analyses_job_id` would also block it). The re-run `AnalysisJob` is progress-only.
- ❌ Re-running the whole pipeline in the actor — call `rerun_single_phase`, not `run_pipeline`.
- ❌ Putting phase/merge logic in the worker — keep it in the analysis package (`rerun_single_phase`); the actor only loads paths, calls it, writes `final_json`.
- ❌ Forgetting the `final_json` JSON-coercion (`json.loads(json.dumps(..., default=str))`) before writing JSONB.
- ❌ Cascading re-runs (re-running phase 2 must NOT auto-re-run 3/6/7) — out of scope.
- ❌ Allowing phase 1 re-run — reject server-side; it's a full re-analyze.
- ❌ Parsing `final_json` server-side to gate "failed only" — the server guard is just the 2–8 range; the UI gates which buttons show.
- ❌ Re-registering the new actor anywhere but `dramatiq_app.py` imports — that's how dramatiq discovers it.

## Confidence: 8/10
Every pattern is verified against the running code (pipeline internals, actor/registration, BFF report-endpoint
mirror, frontend rows/hooks). Main risk is the behavior-preserving pipeline refactor — fully de-risked by the
existing golden snapshots (any diff = stop and fix). The actor/endpoint/UI are straight mirrors of existing,
working patterns (run_specialist / Reanalyze / useReanalyzeVersion).
