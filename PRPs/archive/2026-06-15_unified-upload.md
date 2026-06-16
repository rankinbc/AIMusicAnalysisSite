name: "Unified 'New track' upload — mix + stems + .als + reference, analyzed once"
description: |
  One dialog to provide the song/mix (required) plus stems, .als, and a reference
  (all optional) and have the 7-phase analysis run EXACTLY ONCE. Frontend orchestrates
  existing endpoints; BFF gains a single `analyze` deferral flag on two upload routes.
  Design source: PRPs/unified-upload-design.md.

## Goal

Replace the piecemeal upload flow (mix → separately add stems → add .als → add reference,
each firing its own `analyze_audio_job`) with one **"New track"** dialog. The mix is the only
required file. Stems, `.als`, and a reference are optional. Submitting runs the pipeline
**exactly once** with everything attached.

## Why

- Producers want to "drop everything at once," not re-run analysis 2–3× per track.
- Each of `POST /versions/`, `POST /versions/{id}/als` currently dispatches its own job.
  Today a mix + .als + stems upload = 3 analyses. Goal: 1.
- All the building blocks already exist (stems stage/classify/confirm, reference endpoints,
  `/versions/{id}/analyze`). This feature wires them together; it does NOT add pipeline,
  worker, or DB-schema changes.

## What

A new `UnifiedUploadDialog` opened by the library "+ New song" and song-detail "+ Add version"
entry points. It collects: mix (required), optional stems (drag-drop, reuse the built
staging/classify/confirm UI), optional `.als`, optional reference (title/artist/genre + file),
a genre hint, and a **"Review stem roles before analyzing"** checkbox (default OFF). On submit
the frontend sequences the existing endpoints so exactly one `analyze_audio_job` is enqueued
for the new version.

### Success Criteria

- [ ] One unified dialog opens from both library "+ New song" and song-detail "+ Add version".
- [ ] Mix is required; stems/`.als`/reference are each optional and independently omittable.
- [ ] Uploading mix + .als + stems results in **exactly one** `AnalysisJob` for the version.
- [ ] With stems + review OFF: roles auto-confirmed from `detectedRole`, one analysis dispatched.
- [ ] With stems + review ON: user confirms roles in-dialog, then one analysis dispatched.
- [ ] With no stems: one analysis dispatched via `POST /versions/{id}/analyze`.
- [ ] Reference (if provided) becomes a `ReferenceTrack` + its own `run_reference_analyzer`;
      it does NOT create or alter this track's `analyze_audio_job`.
- [ ] `analyze` flag defaults to true → all existing callers/tests unchanged.
- [ ] Partial failure after the version is created surfaces a toast; no silent pending job; no
      double-dispatch.
- [ ] All BFF + frontend validation gates pass.

## All Needed Context

### Decisions locked in brainstorming (see PRPs/unified-upload-design.md)
- Only the mix is required.
- Stem review is optional (checkbox, default OFF → analyze immediately on auto-detected roles).
- Reference = library-only (Compare page); it does NOT wire a per-version `reference_path` into
  this analysis. (Non-goal: per-version reference wiring, zip/folder drop, pipeline/worker/DB
  changes, removing the standalone add-stems/als/reference dialogs.)
- Approach A: defer dispatch + frontend orchestration of existing endpoints (NOT one giant
  multipart request).

### Known Gotchas & current behavior (VERIFIED against the projects checkout)

```yaml
BFF — components/bff/src/Spectr.Bff:
  Endpoints/VersionEndpoints.cs:
    UploadVersion  (POST /versions/):
      sig (≈L280): ([FromForm] IFormFile file, [FromForm(Name="song_id")] string? songId,
                    [FromForm(Name="genre_hint")] string? genreHint, ClaimsPrincipal, AppDbContext,
                    IFileStorage, IJobQueue queue, CancellationToken ct)
      Creates Song(if songId null) + SongVersion + AnalysisJob, then:
        (≈L364) await queue.EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, new object[]{ jobId.ToString() }, ct);
        (≈L366) return Results.Ok(new UploadResponse(songGuid, versionId, jobId));
    UploadAls (POST /versions/{id}/als):
      sig (≈L506): (Guid versionId, [FromForm] IFormFile file, ClaimsPrincipal, AppDbContext,
                    IFileStorage, IJobQueue queue, CancellationToken ct)
      Sets version.AlsFilePath, creates AnalysisJob, enqueues AnalyzeAudioJob (≈L549),
        returns AlsUploadResponse(versionId, key, jobId) (≈L551).
    Reanalyze (POST /versions/{id}/analyze) (≈L92): creates AnalysisJob, enqueues AnalyzeAudioJob,
        returns Results.Accepted(new ReanalyzeResponse(jobId)).  # REUSE for no-stems path
    ConfirmStems (POST /versions/{id}/stems/confirm) (≈L672): persists StemPaths + StemPathsRaw +
        StemAnalysisMode, creates AnalysisJob, enqueues AnalyzeAudioJob, returns
        ConfirmStemsResponse(versionId, reanalysisJobId).  # REUSE for stems path (single dispatch)
  Endpoints/ReferenceEndpoints.cs:
    Upload (POST /references/): creates ReferenceTrack only, NO job. Returns Created(ToDto).
    Analyze (POST /references/{id}/analyze): enqueues DramatiqTasks.RunReferenceAnalyzer
        (separate actor, no AnalysisJob row).  # REUSE unchanged
  DTOs/VersionDtos.cs:
    UploadResponse(Guid SongId, Guid VersionId, Guid JobId)         # JobId currently NON-nullable
    AlsUploadResponse(Guid VersionId, string AlsPath, Guid ReanalysisJobId)  # also non-nullable
    ReanalyzeResponse(Guid JobId); ConfirmStemsResponse(Guid VersionId, Guid ReanalysisJobId)
  Services/IJobQueue.cs: Task EnqueueAsync(string taskName, object[] args, CancellationToken ct=default)
  Services/DramatiqTasks.cs: AnalyzeAudioJob="analyze_audio_job", RunReferenceAnalyzer="run_reference_analyzer", ...

CRITICAL .NET gotchas:
  - Minimal-API [FromForm] value types: an ABSENT form field binds a non-nullable bool to
    default(false), NOT to the C# parameter default. To keep backward compat (existing callers
    omit `analyze` and MUST still analyze), declare `[FromForm] bool? analyze` and compute
    `bool shouldAnalyze = analyze ?? true;`. NEVER use `bool analyze = true`.
  - Reanalyze() uses db.SongVersions.AsNoTracking()/db.Songs.AsNoTracking() but only READS the
    version then db.AnalysisJobs.Add(newJob) — Add tracks the new entity regardless, so the
    INSERT works. Do NOT "fix" this; it is correct. (The AsNoTracking footgun only bites when
    you mutate a queried-and-tracked entity — see CLAUDE.md / the OwnedVersion fix.)
  - File-lock on bin/.../Spectr.Bff.exe blocks `dotnet build` while the BFF runs. Stop the BFF
    process before building (CLAUDE.md Windows note).

Frontend — components/frontend-spectr-v2/src:
  components/UploadVersionDialog.tsx: props {open,onOpenChange,songId?,triggerLabel?}; single mix
     file (.wav/.flac/.mp3 ≤250MB); uses useFileUpload(); on success navigates to
     /songs/$songId/results/$jobId.  # entry-point dialog being superseded for NEW uploads
  hooks/useFileUpload.ts: upload(file, fields:{song_id?,genre_hint?}) → POST /api/versions/ (XHR,
     Bearer header, upload-progress). Posts FormData: file, song_id, genre_hint. No analyze flag.
  components/AlsUploadDialog.tsx + api/hooks.ts useUploadAls(versionId): mutationFn(file:File) →
     POST /versions/{id}/als, FormData {file}. Returns AlsUploadResponse.
  components/ReferenceUploadDialog.tsx + hooks useUploadReference()/useAnalyzeReference():
     upload({file,title?,artist?,genre?}) → POST /references/; analyze(refId) → POST /references/{id}/analyze.
  hooks/useStemStaging.ts useStemStaging(versionId): stage(files:File[]) → POST /api/versions/{id}/stems/stage
     (XHR, FormData repeated `files`), returns StageStemsResponse{versionId,stems:StemRawDto[]}.
  api/hooks.ts:
     useClassifyStems(versionId): POST /versions/{id}/stems/classify (202, no body).
     useStemProposals(versionId, enabled): GET /versions/{id}/stems, refetchInterval 1500 until
        data.classified===true. Returns StemProposalsResponse{versionId,classified,stems[]}.
     useConfirmStems(versionId): mutationFn(body:ConfirmStemsRequest) → POST /versions/{id}/stems/confirm,
        returns ConfirmStemsResponse{versionId,reanalysisJobId}.
  api/types.ts:
     UploadResponse{songId,versionId,jobId:string}     # make jobId string|null
     AlsUploadResponse{versionId,alsPath,reanalysisJobId:string}   # make reanalysisJobId string|null
     StemRawDto{id,originalFilename,detectedRole:StemRole|null,confidence,evidence,confirmedRole}
     ConfirmStemItem{id,confirmedRole:StemRole}; ConfirmStemsRequest{stems,mode:'grouped'|'per_stem'}
     ConfirmStemsResponse{versionId,reanalysisJobId}
     StemRole + STEM_ROLES (kick,snare,hats,drums,bass,vocals,lead,pad,fx,other)
  Entry points:
     routes/_app/library.tsx (≈L168 "+ New song" → NewSongDialog → openUpload(id) → UploadVersionDialog songId)
     routes/_app/songs.$songId.tsx (≈L129 "+ Add version" → UploadVersionDialog songId={song.id})
  Test pattern: components/__tests__/StemsUploadDialog.test.tsx + components/stems-upload-helpers.ts
     (pure helper unit-tested with vitest; sonner + @tanstack/react-router mocked).
```

## Implementation Blueprint

### Component: bff (small — deferral flag + nullable job ids)

```yaml
Task B1 — MODIFY components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs:
  - CHANGE: UploadResponse(Guid SongId, Guid VersionId, Guid JobId)
        TO:  UploadResponse(Guid SongId, Guid VersionId, Guid? JobId)
  - CHANGE: AlsUploadResponse(Guid VersionId, string AlsPath, Guid ReanalysisJobId)
        TO:  AlsUploadResponse(Guid VersionId, string AlsPath, Guid? ReanalysisJobId)
  - LEAVE ReanalyzeResponse / ConfirmStemsResponse unchanged.

Task B2 — MODIFY components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs UploadVersion:
  - ADD param: [FromForm(Name="analyze")] bool? analyze   (place before ClaimsPrincipal).
  - COMPUTE: var shouldAnalyze = analyze ?? true;
  - WRAP the AnalysisJob creation + queue.EnqueueAsync in `if (shouldAnalyze) { ... }`.
    When deferred: do NOT create an AnalysisJob row and do NOT enqueue.
  - RETURN: new UploadResponse(songGuid, versionId, shouldAnalyze ? jobId : (Guid?)null)
  - Keep Song + SongVersion creation + SaveChanges exactly as-is (version must persist regardless).

Task B3 — MODIFY components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs UploadAls:
  - ADD param: [FromForm(Name="analyze")] bool? analyze
  - COMPUTE shouldAnalyze = analyze ?? true.
  - Always set version.AlsFilePath + UpdatedAt + SaveChanges.
  - WRAP job creation + enqueue in `if (shouldAnalyze)`.
  - RETURN: new AlsUploadResponse(versionId, key, shouldAnalyze ? jobId : (Guid?)null)

Task B4 — TEST (mirror existing BFF endpoint tests; locate the *.Tests project and the
  IJobQueue fake/mocking pattern already used by version/stems tests):
  - UploadVersion analyze=false → 200, version row exists, NO AnalysisJob row, EnqueueAsync NOT called,
    response JobId == null.
  - UploadVersion default (analyze absent) → 200, AnalysisJob created, EnqueueAsync called once.
  - UploadAls analyze=false → AlsFilePath set, no job, EnqueueAsync not called, ReanalysisJobId null.
  - UploadAls default → job + enqueue once (existing behavior preserved).
```

### Component: frontend-spectr-v2 (new dialog + orchestration + analyze flag threading)

```yaml
Task F1 — MODIFY src/api/types.ts:
  - UploadResponse.jobId:        string  ->  string | null
  - AlsUploadResponse.reanalysisJobId: string  ->  string | null

Task F2 — MODIFY src/hooks/useFileUpload.ts:
  - EXTEND UploadFields: add `analyze?: boolean`.
  - In upload(): when fields.analyze !== undefined, form.append('analyze', String(fields.analyze)).
  - Default (omitted) behavior unchanged — BFF treats absent as true.

Task F3 — MODIFY src/api/hooks.ts useUploadAls:
  - CHANGE mutationFn from (file: File) to (input: { file: File; analyze?: boolean }).
  - Append `file`; when input.analyze !== undefined, fd.append('analyze', String(input.analyze)).
  - UPDATE the one existing caller AlsUploadDialog.tsx to pass `{ file }` (behavior unchanged → analyze true).

Task F4 — MODIFY src/components/UploadVersionDialog.tsx (keep the dialog; satisfy new nullable type):
  - Guard navigation: `if (res.jobId) navigate({ to:'/songs/$songId/results/$jobId',
      params:{ songId: res.songId, jobId: res.jobId }});` (standalone dialog never sets analyze=false,
      so jobId is non-null at runtime; the guard satisfies TS strict).

Task F5 — CREATE src/components/unified-upload-helpers.ts (PURE, unit-testable):
  - export type DispatchPath = 'stems' | 'analyze';
  - export function decideDispatchPath(opts: { hasStems: boolean }): DispatchPath
        => opts.hasStems ? 'stems' : 'analyze';
  - export function buildAutoConfirmPayload(
        stems: ReadonlyArray<{ id: string; detectedRole: StemRole | null }>,
    ): ConfirmStemItem[]
        => stems.map(s => ({ id: s.id, confirmedRole: s.detectedRole ?? 'other' }));
  (Import types via `import type`. NO React import — pure module so react-refresh lint stays happy.)

Task F6 — CREATE src/components/UnifiedUploadDialog.tsx:
  Props: { open; onOpenChange; songId?: string; defaultGenre?: string; triggerLabel?: string }.
  Fields:
    - Mix file (required): .wav/.flac/.mp3 ≤250MB.
    - Genre hint (optional text; prefilled from defaultGenre).
    - Stems drop-zone (optional): reuse the row/preview/role UI built in StemsUploadDialog
      (drag-drop, ACCEPT .wav/.flac, ≤100, local-blob preview). Collect File[] only at this stage
      (do NOT stage to server until submit, because staging needs the versionId).
    - "Review stem roles before analyzing" checkbox (default false).
    - .als file (optional): .als/.gz.
    - Reference (optional): file + title/artist/genre (genre prefilled from defaultGenre).
  Submit orchestration (sequential; each guarded with try/catch + toast on failure):
    1. mixRes = useFileUpload().upload(mix, { song_id: songId, genre_hint, analyze: false })
       -> { songId, versionId }.   // version persists, NO job yet
    2. if als: useUploadAls(mixRes.versionId).mutateAsync({ file: als, analyze: false })  // attach only
    3. if reference.file: ref = useUploadReference().mutateAsync({file,title,artist,genre});
         useAnalyzeReference().mutate(ref.id)   // independent actor; fire-and-forget
    4. path = decideDispatchPath({ hasStems: stemFiles.length > 0 })
       - path === 'analyze':  jobId = (await fetcher<ReanalyzeResponse>(
             { url:`/versions/${versionId}/analyze`, method:'POST' })).jobId  // SINGLE dispatch
             -> navigate to results/$jobId.
       - path === 'stems':
           a. stage stems (useStemStaging(versionId).stage(stemFiles)) -> staged ids
           b. classify (useClassifyStems(versionId).mutateAsync())
           c. if review ON: transition dialog to a "review" step (reuse role <select> rows fed by
                useStemProposals(versionId, enabled) until classified), user edits roles, then
                confirm(buildConfirmPayload(rows), mode) -> reanalysisJobId.   // SINGLE dispatch
              if review OFF: poll useStemProposals until classified, then
                confirm(buildAutoConfirmPayload(proposals.stems), mode:'grouped') -> reanalysisJobId.
              -> navigate to results/$reanalysisJobId.
  EXACTLY-ONCE invariant: dispatch happens in step 4 ONLY (confirm XOR /analyze). Steps 1–2 use
  analyze:false; step 3 is the separate reference actor. Never call both confirm and /analyze.
  Failure after step 1: toast "Track created — analysis didn't start, retry from the song page";
  close dialog; do not retry-dispatch automatically.

Task F7 — WIRE entry points:
  - src/routes/_app/songs.$songId.tsx: replace UploadVersionDialog with UnifiedUploadDialog,
    pass songId={song.id} and defaultGenre={song.genreHint ?? undefined}.
  - src/routes/_app/library.tsx: open UnifiedUploadDialog from the new-song flow (keep NewSongDialog
    producing {songId, genre}; pass songId + defaultGenre). "+ Add version" parity preserved.
  - KEEP StemsUploadDialog / AlsUploadDialog / ReferenceUploadDialog wired in AnalysisTab for
    adding assets to an already-analyzed version.

Task F8 — CREATE src/components/__tests__/unified-upload-helpers.test.ts (mirror
  stems-upload-helpers tests):
  - decideDispatchPath: hasStems true -> 'stems'; false -> 'analyze'.
  - buildAutoConfirmPayload: maps id + detectedRole; null detectedRole -> 'other'; empty -> [].
  - (optional) UnifiedUploadDialog shape test: `expect(typeof UnifiedUploadDialog).toBe('function')`
    with sonner + @tanstack/react-router mocked.
```

### Inter-component ordering
1. BFF B1–B4 first (adds the `analyze` deferral the frontend depends on); `dotnet build && dotnet test`.
2. Frontend F1–F8; run all four gates.
3. Integration e2e last.

## Validation Loop

### Level 1 — BFF
```bash
# stop the running BFF first (Windows file lock), then:
cd components/bff && dotnet build && dotnet test
```

### Level 2 — Frontend (all four gates, --max-warnings 0)
```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```

### Level 3 — Integration (exactly-one-job proof)
```bash
# infra + services (projects checkout is canonical)
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &           # :5000
cd components/worker && python -m dramatiq app.dramatiq_app &
# Scripted sequence (register/login → upload mix analyze=false → als analyze=false →
#   stems stage/classify/confirm) then assert the version has exactly ONE analysis_jobs row.
# Verify in psql:
#   SELECT count(*) FROM analysis_jobs WHERE version_id = '<versionId>';   -- expect 1
# Repeat for the no-stems path (mix analyze=false → POST /versions/{id}/analyze)  -- expect 1
# Repeat with a reference attached: assert reference analysis is separate (no extra analysis_jobs row).
```

## Final Validation Checklist
- [ ] `cd components/bff && dotnet build && dotnet test` green
- [ ] Frontend: `tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run` all green
- [ ] e2e: mix+als+stems → exactly one `analysis_jobs` row for the version
- [ ] e2e: no-stems path → exactly one row; reference path → no extra `analysis_jobs` row
- [ ] Existing UploadVersionDialog / AlsUploadDialog / standalone flows still work (analyze defaults true)
- [ ] README updated if upload UX docs change (CLAUDE.md component notes for bff + frontend-spectr-v2)

## Anti-Patterns to Avoid
- ❌ `bool analyze = true` on the form param — absent field binds to false. Use `bool? analyze` + `?? true`.
- ❌ One giant multipart request for all files — fragile, no per-file progress. Orchestrate existing endpoints.
- ❌ Dispatching analysis on the mix or .als upload in the unified flow — they MUST pass analyze:false.
- ❌ Calling both `/stems/confirm` and `/versions/{id}/analyze` — that's two jobs. Pick one (Task F6 step 4).
- ❌ Wiring a per-version `reference_path` into this analysis — explicitly out of scope this pass.
- ❌ Removing/altering the standalone add-stems/als/reference dialogs — they stay for existing versions.
- ❌ "Fixing" the AsNoTracking in Reanalyze() — it only reads then Adds a new job; it's correct.
- ❌ Staging stems to the server before the version exists — staging needs the versionId from step 1.

## Confidence: 8/10
Building blocks all exist and are verified (endpoints, DTOs, hooks, entry points, test patterns). The
only genuinely new code is one pure helper, one dialog (composed from already-built stem UI), and a
nullable-flag tweak on two BFF handlers. Main risk is the in-dialog stem-review step flow and TS-strict
nullable threading — both contained and gated by the four frontend checks.
