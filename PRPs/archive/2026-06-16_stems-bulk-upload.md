name: "Bulk stem upload + audio-content auto-classification"
description: |
  Replace the one-file-per-role stems upload with a single drag-and-drop zone for up to 100 stems.
  The worker classifies each stem by audio content (feature-based, no ML model weights). The user
  previews each stem in the browser, confirms/corrects the auto-detected role, then analysis runs —
  grouped-by-role by default, with an opt-in per-stem mode.

  Source design: PRPs/stems-bulk-upload-design.md (read it for rationale; this PRP is the build spec).

## Goal

A producer drops a whole folder of stems (≤100 WAV/FLAC) onto one spot. The app uploads them, a
worker guesses each stem's role from its **sound** (kick/snare/hats/drums/bass/vocals/lead/pad/fx),
and the user verifies by **listening in-browser** and fixing wrong guesses before committing. On
confirm, re-analysis runs over the confirmed stem set.

## Why

- Current `StemsUploadDialog` forces one `<input type=file>` per role (10 inputs) → "uploading 1 by 1
  is a huge pain" (user's words). Real sessions have many stems with arbitrary names.
- Audio-content classification means cryptically-named files ("Audio 01.wav") still get categorized.
- Keeps the role-based analysis valuable while supporting many stems per role.

## What

User-visible: a new drag-drop dialog with a file table (filename, ▶ preview, detected-role pill +
confidence, editable role dropdown, remove), a "analyze every stem individually" toggle, upload
progress, and a Confirm button that dispatches re-analysis and navigates to results.

### Success Criteria
- [ ] Drag/select up to 100 `.wav`/`.flac` onto one drop zone; each appears as a row instantly.
- [ ] Files upload (with progress); worker auto-classifies each by audio content.
- [ ] Each row shows detected role + confidence; user can play it (local preview) and change the role.
- [ ] `python -m audio_analysis.stems.classify <dir>` prints role/confidence/evidence per file (tuning CLI).
- [ ] Confirm → grouped-by-role analysis by default; "individually" toggle → per-stem analysis.
- [ ] No-stems flow and existing single-mix upload are unchanged.
- [ ] All validation gates green (see Validation Loop).

## All Needed Context

### Documentation & References
```yaml
- file: PRPs/stems-bulk-upload-design.md
  why: Design rationale, decisions, data-model shapes, risks. This PRP implements it.

- file: CLAUDE.md
  why: Authoritative gotchas — cite, don't re-derive. Key sections: "bff" (EF migration partial-index +
       NuGetAuditMode), "worker" (dramatiq wire format, sync sessions, STORAGE_LOCAL_ROOT resolution),
       "analysis" (numpy<2 pin, pyloudnorm axis order, singleton model loading), "Stems integration".

# ── analysis / worker (Python) ──────────────────────────────────────────────
- file: components/analysis/src/audio_analysis/pipeline.py
  why: run_pipeline(file_path, reference_path, als_file_path, genre_hint, progress_cb, stem_paths,
       reference_stem_paths) — lines 38-46. ADD a stem_mode param here.
- file: components/analysis/src/audio_analysis/phases/phase4_stems.py
  why: USE_DEMUCS=False (line 27). Stem coercion `dict[str,str] -> dict[StemRole,Path]` (lines 61-64) —
       MUST widen to accept str|list[str]. Calls `from ..stems import analyze as analyze_stems`;
       result["stems"] = {status, per_stem, clash_matrix, balance_flags}.
- file: components/analysis/src/audio_analysis/phases/phase5_reference.py
  why: user_stem_paths/reference_stem_paths coercion + compare_stems; result["per_stem_reference_deltas"].
- file: components/analysis/src/audio_analysis/stems/role_detector.py
  why: UPGRADE target. _filename_match (keyword patterns), _band_energy_ratios, _spectral_classify
       (currently only bass/hats/vocals/other — NO kick), detect_role(path, audio).
- file: components/analysis/src/audio_analysis/stems/matcher.py
  why: propose_mapping calls detect_role(f) WITHOUT audio (filename-only today). validate_confirmed_mapping
       REJECTS duplicate roles (line 62-65) — must relax for many-stems-per-role.
- file: components/analysis/src/audio_analysis/stems/analyzer.py
  why: analyze(stem_paths: dict[StemRole, Path], genre_profile, sample_rate) -> StemAnalysisResult (line 165).
       Grouped mode sums each role group to one buffer then reuses this.
- file: components/analysis/src/audio_analysis/stems/types.py
  why: StemRole enum, RoleProposal(role, confidence, evidence), StemMappingProposal, ConfirmedMapping,
       StemMetrics. ADD a StemProposal (file + role + confidence + evidence) for classify output.
- file: components/analysis/tests/stems/conftest.py
  why: synth_stem_files -> {kick,bass,hats,vocals} FLAC stereo 44.1k 4s; synth_stems_dir. Use for
       classifier tests. Existing tests: tests/stems/test_role_detector.py, test_matcher.py.
- file: components/worker/app/tasks_dramatiq.py
  why: analyze_audio_job actor + 3-phase tx pattern; LOCAL_ROOT resolution (_resolve_local_root);
       passes version.stem_paths straight to run_pipeline; persists final_json. ADD classify_stems actor;
       teach analyze_audio_job the stem_mode.
- file: components/worker/app/dramatiq_app.py
  why: Broker + actor registration. New actor module must be imported so dramatiq registers it.
- file: components/shared/aimusic_shared/models.py
  why: SongVersion.stem_paths_raw + stem_paths (JSONB, both EXIST). Analysis.stem_metrics (exists, unused).
       ADD SongVersion.stem_analysis_mode column (mirror EF).

# ── bff (.NET) ──────────────────────────────────────────────────────────────
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs
  why: MapVersionEndpoints group (lines 17-42); UploadVersion streaming-to-disk pattern (269-356,
       MaxUploadBytes=250MB line 15, OpenReadStream→storage.WriteAsync, RequestSizeLimitAttribute);
       UploadStems (418-489, the legacy role-keyed endpoint — keep as-is, add NEW routes alongside);
       StreamAudio (233-266, Results.File(stream, ct, enableRangeProcessing:true)).
- file: components/bff/src/Spectr.Bff/Program.cs
  why: JWT ?t= handling — OnMessageReceived only injects token when path CONTAINS "/audio" (lines 52-62).
       Per-stem audio route MUST contain "/audio". CORS localhost:5174 (152-157). Endpoint group wiring (173-189).
- file: components/bff/src/Spectr.Bff/Services/IFileStorage.cs
  why: WriteAsync(key, Stream, contentType, ct), OpenReadAsync, DeleteAsync, ExistsAsync.
- file: components/bff/src/Spectr.Bff/Services/IJobQueue.cs
  why: EnqueueAsync(taskName, object[] args, ct). DramatiqTasks.AnalyzeAudioJob = "analyze_audio_job"
       (Services/DramatiqTasks.cs). ADD DramatiqTasks.ClassifyStems = "classify_stems".
- file: components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs
  why: StemUploadResponse(VersionId, Dictionary<string,string> StemPaths, ReanalysisJobId). ADD new DTOs.
- file: components/bff/src/Spectr.Data/Entities/SongVersion.cs
  why: stem_paths_raw + stem_paths [Column(TypeName="jsonb")] string? props. ADD stem_analysis_mode.
- file: components/bff/src/Spectr.Data/Entities/AnalysisJob.cs
  why: status enum strings (pending|processing|complete|failed|awaiting_stem_mapping), version_id, user_id.
- file: components/bff/src/Spectr.Data/Migrations/
  why: pattern for `dotnet ef migrations add`. Commands in components/bff/README.md.

# ── frontend (React/TS) ─────────────────────────────────────────────────────
- file: components/frontend-spectr-v2/src/components/StemsUploadDialog.tsx
  why: REWRITE target. Current role-grid dialog.
- file: components/frontend-spectr-v2/src/components/UploadVersionDialog.tsx
  why: Pattern: Radix Dialog + useFileUpload (XHR progress) + navigate to results.
- file: components/frontend-spectr-v2/src/hooks/useFileUpload.ts
  why: XHR upload with progress (lines 19-93), getAccessToken() Bearer header, withCredentials. Mirror for stems.
- file: components/frontend-spectr-v2/src/api/hooks.ts
  why: useUploadStems (214-233) FormData+fetcher+invalidate pattern. ADD useStageStems/useClassifyStems/
       useStemProposals (poll)/useConfirmStems.
- file: components/frontend-spectr-v2/src/api/fetcher.ts
  why: fetcher({url,method,data,body,params}); FormData via `body` (no Content-Type); 401 refresh-retry;
       getAccessToken()/setAccessToken().
- file: components/frontend-spectr-v2/src/api/types.ts
  why: StemRole union + STEM_ROLES (156-179), VersionDto, StemUploadResponse (144-148). ADD new types.
- file: components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx
  why: Authenticated audio URL pattern (138-143): `/api/versions/${id}/audio?t=${encodeURIComponent(token)}`,
       crossOrigin="anonymous". (Per-stem preview primarily uses local blob URLs — see below.)
- file: components/frontend-spectr-v2/src/features/results/AnalysisTab.tsx
  why: Integration point — handleRowCta('stems') opens StemsUploadDialog (64-78, 238-256).
- file: components/frontend-spectr-v2/src/features/billing/__tests__/CancelDialog.test.tsx
  why: Vitest pattern: env=node, no jsdom; mock sonner/router; assert function shape/arity; pure logic in .test.ts.
- file: components/frontend-spectr-v2/src/styles/forms.module.css
  why: .dialogOverlay/.dialogContent/.dialogTitle/.dialogDescription/.dialogActions/.button/.buttonPrimary/.field/.label
- file: components/frontend-spectr-v2/src/components/UploadVersionDialog.module.css
  why: .stemGrid/.stemRow/.fileInput/.progress/.stemRole — extend with a drop-zone + table styles.
```

### Known Gotchas & Library Quirks
```text
# CRITICAL: BFF is .NET, the classifier is Python. Classification CANNOT run in-process in the BFF.
#           It MUST be a dramatiq worker actor (classify_stems). BFF stages files + enqueues; frontend polls.
# CRITICAL: stem_paths value shape changes from {role: "path"} (str) to {role: ["path", ...]} (list).
#           phase4_stems.py:61-64 + phase5 coercion MUST accept BOTH str and list[str] (wrap str -> [str])
#           so any pre-existing rows don't break.
# CRITICAL: The classifier path must stay import-light — librosa/numpy/soundfile/pyloudnorm ONLY.
#           NEVER import demucs/torchopenl3/allin1 from classify.py or role_detector.py. (Confirmed: the
#           stems module already has no heavy imports; models.get_model() is on-demand only.)
# CRITICAL: JWT ?t= is only injected when the request path CONTAINS "/audio" (Program.cs:52-62).
#           Name the per-stem preview route .../stems/{stemId}/audio so the token is honored.
# CRITICAL: BFF multipart MUST stream to disk (file.OpenReadStream() -> storage.WriteAsync). For many/large
#           files, raise BOTH the endpoint RequestSizeLimitAttribute AND Kestrel/FormOptions
#           MultipartBodyLengthLimit. NEVER buffer whole files in memory.
# CRITICAL: dramatiq actors are sync `def`; use the worker's sync SQLAlchemy session (db_sync.py). Wrap any
#           async with asyncio.run(). (CLAUDE.md "worker".)
# CRITICAL: EF Core migration: `dotnet ef migrations add <Name> --project src/Spectr.Data --startup-project
#           src/Spectr.Bff` then `database update`. Stop the running BFF first (file lock on Spectr.Bff.exe).
#           NuGetAuditMode=direct already set. stem_paths/stem_paths_raw columns ALREADY EXIST — only the new
#           stem_analysis_mode column needs a migration.
# CRITICAL: IDOR — every version query MUST join songs and filter s0.user_id == currentUser (existing pattern).
# CRITICAL: Magic-byte audio validation (first bytes), not Content-Type (CLAUDE.md "api"). MP3 ID3/FFFB,
#           FLAC fLaC, WAV RIFF. Stems are WAV/FLAC.
# CRITICAL: Vitest runs env=node (no jsdom). Test function shape + pure helpers; do NOT assert Radix render.
# CRITICAL: numpy<2 pin; pyloudnorm needs (samples, channels) float64 — audio.T.astype(float) (CLAUDE.md).
```

## Implementation Blueprint

### Data shapes (canonical)
```jsonc
// song_versions.stem_paths_raw (jsonb) — the raw stem list, fidelity for confirm UI + per-stem mode
[
  { "id": "<guid>", "original_filename": "Kick 1.wav",
    "path": "audio/stems/<versionId>/<id>.wav",
    "detected_role": "kick", "confidence": 0.82, "evidence": "low-band dominant + transient",
    "confirmed_role": "kick" }
]
// song_versions.stem_paths (jsonb) — role -> [paths] groups, written at confirm; consumed by grouped analyzer
{ "kick": ["audio/stems/<versionId>/<id>.wav"], "drums": ["...","..."] }
// song_versions.stem_analysis_mode (varchar, default 'grouped') — 'grouped' | 'per_stem'
```

### Tasks (ordered; each independently validatable)

```yaml
# ============================== PHASE A — analysis (classifier) ==============================
Task A1 — UPGRADE classifier (audio-content, feature-based):
  MODIFY components/analysis/src/audio_analysis/stems/types.py:
    - ADD @dataclass StemProposal: file: Path; role: StemRole; confidence: float; evidence: str
  MODIFY components/analysis/src/audio_analysis/stems/role_detector.py:
    - REPLACE _spectral_classify body with a feature-based classifier (pseudocode below). Keep
      _filename_match as the high-confidence fast path inside detect_role.
    - KEEP detect_role(path, audio) signature; when audio is None and filename misses, low-confidence OTHER.
  CREATE components/analysis/src/audio_analysis/stems/classify.py:
    - def classify_stems(paths: list[Path], sample_rate: int = 44100) -> list[StemProposal]:
        load each file (librosa, mono or stereo->mono, full or first ~10s window), call detect_role(p, audio).
    - CLI: `if __name__ == "__main__":` parse a dir/glob, print f"{name:40} {role:8} {conf:.2f}  {evidence}".
  GOTCHA: import-light only. Decode with soundfile/librosa; cap window length for speed.

Task A2 — many-stems analyzer (grouped + per-stem):
  MODIFY components/analysis/src/audio_analysis/stems/matcher.py:
    - propose_mapping: load audio per file before detect_role (today it's filename-only).
    - validate_confirmed_mapping: REMOVE the duplicate-role rejection (many stems per role are valid now);
      keep the missing-file check.
  MODIFY components/analysis/src/audio_analysis/stems/analyzer.py:
    - ADD analyze_grouped(groups: dict[StemRole, list[Path]], ...) -> StemAnalysisResult: sum each group's
      audio into one role buffer, then reuse existing per-role measurement + clash + balance.
    - ADD analyze_per_stem(stems: list[tuple[str, StemRole, Path]], ...) -> dict: one StemMetrics per stem id;
      pairwise clash CAPPED (e.g. ≤ MAX_PAIRS, default 600) — if exceeded, analyze clashes on the top-N by level
      and record a truncation note. Reuse existing metric helpers.

Task A3 — pipeline plumbing:
  MODIFY components/analysis/src/audio_analysis/phases/phase4_stems.py:
    - Coercion: accept value as str OR list[str] (wrap str -> [str]); build dict[StemRole, list[Path]].
    - Branch on stem_mode: grouped -> analyze_grouped; per_stem -> analyze_per_stem (emit under result["stems"]
      with a "mode" field; per_stem adds result["stems"]["per_stem_list"]).
  MODIFY components/analysis/src/audio_analysis/phases/phase5_reference.py:
    - Same str|list[str] coercion. Grouped: compare role buses vs reference role buses (unchanged downstream).
      per_stem: reference deltas remain role-group-level (document this; per-stem ref-delta is out of scope).
  MODIFY components/analysis/src/audio_analysis/pipeline.py:
    - ADD param `stem_mode: str = "grouped"`; thread into phase4/phase5 calls.

# ============================== PHASE B — shared + DB migration ==============================
Task B1 — SQLAlchemy model:
  MODIFY components/shared/aimusic_shared/models.py:
    - SongVersion: ADD stem_analysis_mode: Mapped[str] = mapped_column(String(16), default="grouped",
      server_default="grouped"). (stem_paths_raw/stem_paths already present.)

Task B2 — EF entity + migration (BFF owns canonical schema):
  MODIFY components/bff/src/Spectr.Data/Entities/SongVersion.cs:
    - ADD [Column("stem_analysis_mode"), MaxLength(16)] public string StemAnalysisMode { get; set; } = "grouped";
  RUN (stop BFF first): dotnet ef migrations add AddStemAnalysisMode --project src/Spectr.Data --startup-project src/Spectr.Bff
    - Verify generated Up() adds the column with default 'grouped'; database update.

# ============================== PHASE C — worker ==============================
Task C1 — classify_stems actor:
  MODIFY components/worker/app/tasks_dramatiq.py:
    - @dramatiq.actor(actor_name="classify_stems", queue_name="default", max_retries=1)
      def classify_stems(version_id: str): load version (sync session), read stem_paths_raw list,
      resolve each path against LOCAL_ROOT, call audio_analysis.stems.classify_stems(paths),
      write detected_role/confidence/evidence back into each raw entry, commit.
    - On error per file: detected_role="other", confidence=0, evidence="classify failed: ...". Never leave null
      forever (frontend treats null as "still classifying").
  ENSURE components/worker/app/dramatiq_app.py imports the actor module (tasks_dramatiq) so it registers.

Task C2 — analyze_audio_job stem_mode:
  MODIFY analyze_audio_job: read version.stem_analysis_mode; pass stem_mode to run_pipeline. stem_paths is the
    role->[paths] groups (already correct shape post-confirm).

# ============================== PHASE D — BFF endpoints ==============================
Task D1 — DTOs:
  MODIFY components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs:
    - StemRawDto(string Id, string OriginalFilename, string? DetectedRole, double Confidence, string? Evidence, string? ConfirmedRole)
    - StageStemsResponse(Guid VersionId, List<StemRawDto> Stems)
    - StemProposalsResponse(Guid VersionId, bool Classified, List<StemRawDto> Stems)
    - ConfirmStemItem(string Id, string ConfirmedRole); ConfirmStemsRequest(List<ConfirmStemItem> Stems, string Mode)
    - ConfirmStemsResponse(Guid VersionId, Guid ReanalysisJobId)
  MODIFY components/bff/src/Spectr.Bff/Services/DramatiqTasks.cs: ADD ClassifyStems = "classify_stems".

Task D2 — new routes (add to MapVersionEndpoints group; KEEP legacy /stems endpoint):
  POST  /versions/{versionId:guid}/stems/stage     -> StageStems   (.DisableAntiforgery().WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes * 20)))
  POST  /versions/{versionId:guid}/stems/classify  -> ClassifyStems (enqueue)
  GET   /versions/{versionId:guid}/stems           -> GetStems     (poll proposals)
  POST  /versions/{versionId:guid}/stems/confirm   -> ConfirmStems
  GET   /versions/{versionId:guid}/stems/{stemId}/audio -> StreamStemAudio  (optional preview; route contains "/audio")
  - StageStems: read multipart (ReadFormAsync), enforce ≤100 files total (incl. already-staged), per-file ≤250MB,
    magic-byte check, ext .wav/.flac. For each: stemId=Guid; key=$"audio/stems/{versionId}/{stemId}{ext}";
    storage.WriteAsync(key, file.OpenReadStream(), ct). Append to stem_paths_raw (detected_role=null). Save.
    Authz: version belongs to currentUser (join songs). Returns StageStemsResponse.
  - ClassifyStems: queue.EnqueueAsync(DramatiqTasks.ClassifyStems, [versionId.ToString()], ct); return 202.
  - GetStems: return stem_paths_raw deserialized; Classified = all rows have detected_role != null.
  - ConfirmStems: validate each ConfirmedRole in ValidStemRoles; set confirmed_role on raw rows; build
    stem_paths groups (role -> [path]); set stem_analysis_mode = (Mode=="per_stem"?"per_stem":"grouped");
    persist raw+groups+mode; create AnalysisJob(status="pending"); EnqueueAsync(AnalyzeAudioJob,[jobId]); return jobId.
  - StreamStemAudio: resolve stemId in raw list (authz), storage.OpenReadAsync, Results.File(stream, ct, enableRangeProcessing:true).
  GOTCHA: also raise FormOptions.MultipartBodyLengthLimit (Program.cs builder.Services.Configure<FormOptions>)
          to >= MaxUploadBytes*20 so ReadFormAsync accepts the batch.

Task D3 — Program.cs:
  - Configure<FormOptions>(o => o.MultipartBodyLengthLimit = MaxUploadBytes * 20). Confirm CORS already covers it.

# ============================== PHASE E — frontend ==============================
Task E1 — types + hooks:
  MODIFY components/frontend-spectr-v2/src/api/types.ts: ADD StemRawDto, StageStemsResponse,
    StemProposalsResponse, ConfirmStemItem, ConfirmStemsRequest, ConfirmStemsResponse (mirror BFF DTOs).
  CREATE components/frontend-spectr-v2/src/hooks/useStemStaging.ts:
    - XHR-based sequential/batched upload to /api/versions/{id}/stems/stage with aggregate progress
      (mirror useFileUpload.ts; getAccessToken() Bearer, withCredentials). Default batch: send files in
      small groups (e.g. 4) or one-by-one to keep each request modest.
  MODIFY components/frontend-spectr-v2/src/api/hooks.ts: ADD useClassifyStems (POST classify),
    useStemProposals(versionId) (useQuery polling GET /stems with refetchInterval until Classified),
    useConfirmStems (POST confirm, invalidate ['versions',id]+['songs'], return job id).

Task E2 — rewrite dialog:
  REWRITE components/frontend-spectr-v2/src/components/StemsUploadDialog.tsx:
    - Single drop zone (native onDragOver/onDrop + hidden multi <input accept=".wav,.flac,audio/*" multiple>).
    - Local File[] state; per row: filename, ▶ preview via URL.createObjectURL(file) (revoke on cleanup),
      detected-role pill + confidence (from proposals once classified; "classifying…" until then),
      editable <select> of STEM_ROLES (defaults to detected_role, user can override), remove.
    - "Analyze every stem individually" checkbox (default off -> mode 'grouped').
    - Flow: stage(files) -> classify() -> poll useStemProposals -> user edits -> confirm({stems:[{id,confirmedRole}],mode})
      -> navigate({to:'/songs/$songId/results/$jobId', params:{songId, jobId: res.reanalysisJobId}}).
    - Enforce ≤100 client-side; toast on reject. Reuse forms.module.css + extend UploadVersionDialog.module.css.
  CSS: add .dropZone (dashed, hover cyan), .stemTable, table row layout to UploadVersionDialog.module.css.

Task E3 — tests:
  CREATE src/components/__tests__/StemsUploadDialog.test.tsx: vitest function-shape (export is function, prop arity),
    mock sonner + router + hooks.
  CREATE src/<helpers>/stem-grouping.test.ts: pure helper that builds the confirm payload + groups from rows.
```

### Classifier pseudocode (Task A1 — tune thresholds via the CLI)
```python
# role_detector._spectral_classify(audio, sr=44100) -> RoleProposal
# Features (librosa, import-light):
#   r = band energy ratios (existing _band_energy_ratios): sub,bass,low_mid,mid,high_mid,presence,air
#   centroid = spectral_centroid mean ; zcr = zero_crossing_rate mean
#   perc = percussive energy / (harmonic+percussive) via librosa.effects.hpss
#   crest = peak / (rms + eps)
#   onset_rate = len(onset_detect) / duration_s
# Rules (first strong match wins; confidence ~ margin):
#   low = r.sub + r.bass
#   if low > 0.55 and perc > 0.5 and crest high and onset_rate moderate: KICK   (transient + low end)
#   if low > 0.5  and perc < 0.4 and zcr low:                            BASS   (sustained low end)
#   if r.presence + r.air > 0.5 and zcr high and onset_rate high:        HATS
#   if r.mid + r.high_mid > 0.5 and perc > 0.5 and onset_rate high:      SNARE
#   if perc > 0.6 and onset_rate high (broadband):                       DRUMS
#   if 0.4 < r.mid + r.low_mid and perc < 0.5 and mid centroid:          VOCALS
#   if r.mid + r.high_mid dominant and perc < 0.5 and onset_rate low:    LEAD / PAD (PAD if very low onset+crest)
#   if noisy/atonal (high zcr + flat spectrum) and onset_rate low:       FX
#   else:                                                                OTHER (low confidence)
# Return RoleProposal(role, confidence, evidence="…human readable feature summary…")
```

## Integration Points
```yaml
DATABASE:
  - migration: AddStemAnalysisMode (only new column; stem_paths/stem_paths_raw already exist)
WORKER:
  - new actor classify_stems; ensure dramatiq_app imports it
  - analyze_audio_job reads version.stem_analysis_mode
BFF:
  - new routes under MapVersionEndpoints; new DramatiqTasks.ClassifyStems; FormOptions limit raised
FRONTEND:
  - StemsUploadDialog rewrite reachable from AnalysisTab handleRowCta('stems') (unchanged trigger)
LEGACY:
  - keep POST /versions/{id}/stems (role-keyed) until the new flow is verified; then remove in a follow-up
CLEANUP (follow-up, not blocking): purge abandoned audio/stems/{versionId}/ staging on stale versions
  (reuse the v1 hourly-purge idea from CLAUDE.md "Stems integration").
```

## Validation Loop

### Level 1 — Syntax & Style
```bash
ruff check components/analysis/src/ components/worker/ components/shared/
mypy components/worker/app/ --ignore-missing-imports
cd components/bff && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
```

### Level 2 — Unit tests
```bash
# Classifier (use synth_stem_files fixture): assert kick/bass/hats/snare separation + confidence>0.5
pytest -q components/analysis/tests/stems/
# Worker actor (mock run_pipeline + classify): classify_stems writes roles back; analyze_audio_job passes mode
pytest -q components/worker/tests/
# Shared model round-trip for stem_analysis_mode
pytest -q components/shared/tests/
# BFF endpoints (auth, ≤100, role enum, IDOR, confirm builds groups)
cd components/bff && dotnet test
# Frontend
cd components/frontend-spectr-v2 && npx vitest run
```

### Level 3 — Integration (manual, real stack)
```bash
# Stack already runs locally: BFF :5000, worker, frontend :5174 (docker compose for pg/redis).
# 1) Tuning CLI sanity:
python -m audio_analysis.stems.classify data/audio/upload   # prints role/confidence/evidence per file
# 2) In the UI: open a version -> Stems -> drag 5-10 stems -> see them upload + auto-classify ->
#    play a couple to confirm -> fix a wrong role -> Confirm -> lands on results; phase4.stems present.
# 3) Toggle "analyze every stem individually" and confirm per-stem output appears.
```

## Final Validation Checklist
- [ ] All Level 1/2 gates green (commands above).
- [ ] CLI classifies the synth fixtures correctly (kick≠bass≠hats≠snare).
- [ ] Drag-drop up to 100 files works; >100 rejected client+server.
- [ ] Auto-classify populates roles; user can preview + override; confirm dispatches re-analysis.
- [ ] Grouped (default) and per-stem modes both produce results.
- [ ] No-stems + single-mix flows unchanged.
- [ ] Pre-existing stem_paths rows (str values) still analyze (str|list coercion).

## Anti-Patterns to Avoid
- ❌ Trying to classify in the BFF (.NET) — it MUST be the Python worker actor.
- ❌ Importing demucs/torch/openl3/allin1 anywhere on the classify path (keeps it fast + dependency-light).
- ❌ Buffering 100 files in memory — stream each to disk; raise RequestSizeLimit AND MultipartBodyLengthLimit.
- ❌ Changing stem_paths to list without making the pipeline coercion accept the old str shape.
- ❌ Fetching per-stem audio without "/audio" in the path (JWT ?t= won't be injected).
- ❌ Asserting Radix Dialog render in vitest (env=node) — test function shape + pure helpers; rely on manual/Playwright for UI.
- ❌ Re-introducing the duplicate-role rejection in validate_confirmed_mapping (many stems per role is the point).
- ❌ Fetch-all-then-filter on versions (IDOR) — always join songs + filter user_id.

---
## Confidence score: 7.5/10
Strong existing scaffolding (types, role_detector, matcher, analyzer, audio-streaming + upload patterns,
DB columns already present) and a single forced architecture (classify = worker actor) reduce risk. The two
areas needing iteration: (1) classifier accuracy/threshold tuning — mitigated by the standalone CLI + synth
fixtures; (2) many-files multipart limits on .NET — mitigated by batched staging + explicit limit raises.
Recommend executing in the A→B→C→D→E order; each phase is independently testable.
