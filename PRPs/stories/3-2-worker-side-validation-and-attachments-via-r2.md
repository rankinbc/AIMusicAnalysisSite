# Story 3.2: Worker-Side Validation & Attachments via R2

Status: review

## Story

As the operator,
I want file validation at the worker trust boundary and all attachments on the same storage path,
So that spoofed files fail fast without consuming user entitlements.

## Acceptance Criteria

1. **Given** a completed upload, **When** the worker pre-pipeline step fetches the source from R2, **Then** magic-byte + duration validation runs server-side (AR19); an invalid file fails fast with a typed error **And** no entitlement is consumed (compensating reversal per AR16).
2. **Given** attachments (FR2), **When** stems/reference/.als upload, **Then** they follow the same presigned path into `stems/{jobId}/` and `als/{jobId}/` per the key layout (AR20).
3. **Given** the key layout, **When** objects write, **Then** `audio/{userOrDevice}/{jobId}/source.*` and `reports/{jobId}.json` conventions hold.
4. **Given** worker R2 access, **When** the worker reads/writes objects, **Then** it uses its own credentials, not the BFF's (AR21).

## Decisions of record (recon 2026-07-03)

1. **Validation shape (AC1)**: new import-light `worker/app/source_validation.py` — `validate_source(path, ext) `: magic-byte sniff (RIFF+WAVE, fLaC, MP3 ID3/0xFFFx, FORM+AIFF, OggS, ftyp for m4a) + duration probe (`soundfile.info` fast path for wav/flac/aiff/ogg; `librosa.get_duration(path=)` fallback for mp3/m4a) against `MIN_AUDIO_DURATION_SECONDS=3` / `MAX_AUDIO_DURATION_SECONDS=1800` (env-overridable — no constant existed anywhere; 30 min covers a 250 MB WAV). Raises typed `InvalidFileError(reason_code, message)` with reason codes `bad_magic_bytes` / `undecodable` / `too_short` / `too_long`.
2. **Typed failure → reversal (AC1)**: `analyze_audio_job` catches `InvalidFileError` BEFORE `run_pipeline`, writes `error_code='invalid_file'` + `error_message=<reason>` + `failed_at`, and RETURNS (no re-raise — an invalid file is permanent; dramatiq retries would waste two more fetches). The BFF's `JobEndpoints.GetStatus` reversal hook (`error_code=="invalid_file"` → `CreditLedgerService.ReverseAsync`) is ALREADY BUILT and waiting — the worker just never wrote the code. `aimusic_shared.models.AnalysisJob` must grow the `error_code` mirror column (column already exists in DB via EF — mirror only, no migration).
3. **Free/pro tiers**: credits reversal per AR16 as built. Whether the free monthly count also needs compensation depends on how `EntitlementService` counts usage_events — resolve during implementation: if it counts raw `analysis` usage_events, exclude `invalid_file`-failed jobs from the count (or write a compensating event); if it already joins job status, nothing to do. Do NOT touch the append-only ledger invariant.
4. **Attachment presign = single-object PUT** (AC2) — attachments are ≤250 MB and fit one presigned PUT; multipart/resumability was the MIX story (3.1). New `IMultipartObjectStore.PresignPutUrlAsync(key, ct)`.
5. **Keys + trust (AC2/AC3)**: `stems/{jobId}/{stemId}{ext}`, `als/{jobId}/project{ext}`, `reference/{refId}/source{ext}`. jobId is derived SERVER-SIDE from the owned version's `FilePath` (`audio/{userId}/{jobId}/source.*` — parse segment 2), never trusted from the client. Version not presigned-uploaded (legacy `audio/upload/...` path) or S3 unconfigured → 501 `presigned_unavailable` → frontend falls back to the untouched legacy proxy endpoints (mirror of 3.1 decision 2).
6. **Registration endpoints** (attachment metadata still needs DB rows): `POST /versions/{id}/stems/stage-keys` (register uploaded stem keys → `stem_paths_raw`, verify `ObjectExistsAsync` + prefix), JSON variant `POST /versions/{id}/als-key` (`als_file_path=key` + project_json), `POST /references/complete-key` (creates ReferenceTrack with `file_path=key`). Existing multipart-proxy endpoints unchanged (legacy fallback).
7. **Worker fetch generalized (AC2 substance)**: `object_store.resolve_local(path_or_key)` — local under LOCAL_ROOT wins; else S3 fetch to temp. Applied to source (already), `reference_path`, `als_file_path`, `stem_paths` values in `analyze_audio_job` + `rerun_phase_actor` + `classify_stems` + `reference_analyzer_actor` (which currently logs "remote-fetch not yet wired"). All fetches cleaned in `finally`.
8. **AR21 (AC4)**: compose `minio-init` creates a dedicated MinIO user `spectr-worker` (readwrite policy on bucket `spectr`); worker env switches to those creds — BFF keeps `minioadmin`. Prod R2 scoped-token wiring documented for 10.1. Dev-parity proof: worker fetch works with non-root creds.
9. **`reports/{jobId}.json` (AC3)**: writing reports to R2 is story 3.3 AC2 — out of scope here; AC3 is satisfied by the attachment keys following AR20 and the audio key convention holding (3.1).

## Tasks / Subtasks

- [x] Task 1 — Worker validation + typed error (AC: 1)
  - [x] 1.1 `worker/app/source_validation.py` — magic-byte table (wav/flac/mp3±ID3/aiff/ogg/m4a) + soundfile-first duration probe (librosa fallback for mp3/m4a); `InvalidFileError(reason_code)`; env-overridable 3s/1800s limits
  - [x] 1.2 `analyze_audio_job` — validate post-source-resolve, pre-attachments/pre-pipeline; dedicated except arm writes `error_code='invalid_file'` + reason and RETURNS (no dramatiq retry); generic failures unchanged
  - [x] 1.3 `aimusic_shared.AnalysisJob.error_code` mirror added (no migration)
  - [x] 1.4 Leak CONFIRMED: free tier counted raw `analysis` usage_events → `EntitlementService.ComputeAsync` now excludes events whose job has `error_code='invalid_file'` (read-side compensation, no new write path)
  - [x] 1.5 Worker tests: 8 validation + 2 actor-level (spoofed file → typed fail, pipeline never runs, no raise; valid wav → complete, error_code null); BFF reversal hook pre-existing + already tested (JobEndpoints)
- [x] Task 2 — Attachment presign surface (AC: 2, 3)
  - [x] 2.1 `IMultipartObjectStore.PresignPutUrl` + S3 impl (same checksum-off config) + fake-store seam
  - [x] 2.2 `POST /api/uploads/attachments/init` — kind-switched limits/exts, ownership 404, server-derived jobId (`JobIdFromSourceKey` — works for both 3.1 and legacy key layouts; pre-AR20 versions → 501 fallback), reference mints refId
  - [x] 2.3 Registration: `POST /versions/{id}/stems/stage-keys`, `POST /versions/{id}/als-key` (analyze semantics identical to UploadAls), `POST /references/complete-key` — all verify prefix + `ObjectExistsAsync`
  - [x] 2.4 5 BFF tests (key shapes per kind, ownership/limits/kind 400s, stage-keys foreign-prefix + 502 + happy, als-key no-dispatch, reference create + mismatch 400 + duplicate 409)
- [x] Task 3 — Worker attachment fetch (AC: 2)
  - [x] 3.1 `object_store.resolve_local` (local-first → absolute → S3 fetch → legacy join) + `cleanup_all`
  - [x] 3.2 `analyze_audio_job` resolves reference/als/stems (fixes the latent raw-stems CWD-relative bug — analyze now joins like classify did)
  - [x] 3.3 `rerun_phase_actor` + `classify_stems` + `reference_analyzer_actor` (its "remote-fetch not yet wired" warning retired; fetch failure stays log-and-bail)
  - [x] 3.4 4 resolve_local tests (local wins, no-S3 join passthrough, S3 fetch + cleanup, absolute passthrough)
- [x] Task 4 — Frontend presigned attachments (AC: 2)
  - [x] 4.1 `features/upload/attachment-upload-helpers.ts` — `uploadAttachmentPresigned` (init → raw XHR PUT, no headers) as a helper module (no hook needed: the dialog's orchestration calls fetcher directly per the stale-closure rule)
  - [x] 4.2 `UnifiedUploadDialog` — als/reference/stems presigned-first with per-section 501 → legacy FormData fallback; standalone dialogs stay legacy (follow-on)
  - [x] 4.3 4 vitest (raw-PUT no-headers footgun, non-2xx reject, init payload + PUT wiring, 501-propagation contract)
- [x] Task 5 — Worker credentials split (AC: 4)
  - [x] 5.1 `minio-init` creates `spectr-worker` user + readwrite policy; worker env switched off minioadmin
  - [x] 5.2 compose comments document AR21 + prod R2 scoped-token note (10.1)
- [x] Task 6 — Gates + status
  - [x] 6.1 Gates green (see Change Log; one known master-side failure documented)
  - [x] 6.2 sprint-status + Dev Agent Record updated

## Dev Notes

### AC1 wiring facts (verified)

- Worker failure path today (`tasks_dramatiq.py:221-230`): sets `error_message` ONLY, re-raises for dramatiq retry (max_retries=2). `error_code` is never written worker-side.
- BFF reversal hook `JobEndpoints.GetStatus:173-203`: fires when `Status=="failed" && ErrorCode=="invalid_file" && spend-ledger-row exists` → `CreditLedgerService.ReverseAsync` (idempotent via `reversal:{jobId}` partial-unique). `AnalysisJob.ErrorCode` = `[Column("error_code"), MaxLength(64)]` — its doc comment already names this exact contract.
- `StaleJobReaper` deliberately uses `worker_unavailable` so it does NOT refund — don't collide with that.
- Spend site: `VersionEndpoints.DispatchAnalysisAsync:924-1034` (credits: SpendAsync in serializable tx; free/pro: usage_event only).
- 3.1 fetch shim: `worker/app/object_store.py` — bare `os.environ` (`S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET/S3_REGION`), `fetch_to_local` (mkdtemp + download_file, keeps extension), `cleanup_local`. Fetch happens at `tasks_dramatiq.py:191-198` only for the SOURCE and only when the local path is absent.
- No cheap duration probe exists anywhere (phase1 does a full `librosa.load`); `soundfile.info()` is the cheap header read (wav/flac/aiff/ogg — NOT mp3/m4a). `converters.to_wav` = soundfile→librosa fallback decode.
- Magic-byte prior art: BFF `LooksLikeAudioAsync` (`VersionEndpoints.cs:713-723`, RIFF/fLaC only, stems-stage only) + legacy `components/api/app/services/stem_validation.py` (typed `StemValidationError(code=…)` dataclass pattern — the model to mirror in the worker).

### AC2 wiring facts

- Presigned mix (3.1): `UploadEndpoints.cs` — init mints jobId, key `audio/{userId}/{jobId}/source{ext}`; complete has the IDOR guard `key must start with audio/{userId}/{jobId}/`; version row stores the R2 KEY as `FilePath`. The client KNOWS jobId after init — attachments upload after mix complete, so jobId is available; but derive it server-side anyway (decision 5).
- Legacy attachment proxies (all `IFileStorage.WriteAsync` through BFF): stems stage `audio/stems/{versionId}/{stemId}{ext}` (250MB×20, ≤100, wav/flac, LooksLikeAudioAsync); als `audio/als/{versionId}/project{ext}` (50MB, .als/.gz, project_json ≤512KB); reference `audio/reference/{refId}/source{ext}` (250MB). These REMAIN as the fallback — do not modify their behavior.
- Worker attachment resolution today (`tasks_dramatiq.py:201-211`): reference/als joined with LOCAL_ROOT; `stem_paths` passed RAW (phase4 `_coerce_groups` does `Path(p)` directly — CWD-relative!); `classify_stems` DOES join LOCAL_ROOT. This inconsistency is a latent bug — `resolve_local` normalizes all of them.
- `IMultipartObjectStore` (`Services/IMultipartObjectStore.cs`): Initiate/PresignParts/Complete/Abort/ObjectExists — NO single-PUT presign, NO read/download; S3ObjectStore has the checksum-off config on its client (reuse it; presigned PUT single-object has the same footgun).
- `S3ObjectStore` test seam: ctor injects fake IAmazonS3 — existing UploadEndpoints tests show the fake-store pattern to extend.

### AC4 wiring facts

- compose today: BFF `Storage__S3__ServiceUrl: http://localhost:9000` (host-visible for browser presign) + minioadmin; worker `S3_ENDPOINT: http://minio:9000` (compose-internal) + THE SAME minioadmin. `minio-init` one-shot runs `mc` (bucket + CORS w/ ExposeHeaders ETag) — extend it for the user/policy add.
- `reference_analyzer_actor.py` uses `FILE_STORAGE_ROOT` (default `/app/storage`) and does not know object_store — needs the resolve_local treatment (Task 3.3).

### Frontend facts

- `useMixUpload.ts` = the presigned-first + 501-fallback shape to mirror; raw XHR PUT with NO extra headers (checksum footgun), `file.slice` for parts — attachments are ONE PUT of the whole file.
- `UnifiedUploadDialog.tsx`: mix first (`analyze=false`) → versionId known → attachments (als L417-428, reference L435-446, stems stage/classify/poll/confirm L464-497) all via `fetcher` FormData against versionId routes; orchestration deliberately does NOT use the stateful hooks (stale-closure gotcha in CLAUDE.md) — keep calling `fetcher` directly in the async flow.
- Stems review-step polling (`useStemProposals`) is render-driven and stays as-is; only the byte transport changes.

### Regression surface

- FR1/3.1: presigned MIX path untouched; legacy proxy endpoints byte-identical (they ARE the fallback).
- Worker LOCAL_ROOT-only deployments (S3 unconfigured): `resolve_local` must behave exactly like today's join semantics — every existing worker test must stay green without S3 env.
- `analyze=false` deferral + single-dispatch invariants (CLAUDE.md) unchanged.
- Golden-snapshot guarantee: `run_pipeline` output untouched (validation happens BEFORE the pipeline, in the actor).

### Testing standards

- Worker: pytest, sync SQLAlchemy fixtures (db_sync gotcha in memory — restore both sys.modules AND package attr); mock boto3/object_store, never hit real S3 in unit tests.
- BFF: xUnit + WebApplicationFactory, Postgres-gated skip, fake IAmazonS3 seam for store tests.
- Frontend: node-env vitest, pure-helper tests (multipart-upload-helpers precedent).

### References

- [Source: PRPs/epics.md#Story 3.2 (L698-709)]
- [Source: PRPs/stories/3-1-direct-to-r2-presigned-multipart-upload.md] — decisions 6/7/10 hand off to this story; footguns section applies
- [Source: components/worker/app/{tasks_dramatiq.py,object_store.py,rerun_phase_actor.py,reference_analyzer_actor.py}]
- [Source: components/bff/src/Spectr.Bff/Endpoints/{UploadEndpoints,VersionEndpoints,JobEndpoints,ReferenceEndpoints}.cs]
- [Source: components/bff/src/Spectr.Bff/Services/{IMultipartObjectStore.cs,CreditLedgerService.cs}]
- [Source: components/api/app/services/stem_validation.py] — typed-error pattern to mirror

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Full BFF suite on this branch shows 256/257: `StripeWebhookEndpointTests.Webhook_Concurrent_Deliveries_Of_Same_Event_Produce_Exactly_One_Row` fails on MASTER (pre-existing SubscriptionMirrorService read-then-insert race); the fix already exists on PR #4's branch (`social/11-10-activity-feed`, commit 0fc8375) and was deliberately NOT duplicated here to avoid a merge conflict. Every 3.2 surface is green.
- Three existing actor-harness test files (`test_analyze_audio_job_{images,problems,reference}.py`) gained a `validate_source` stub — they exercise mocked pipelines against paths that never exist on disk, and validation now runs pre-pipeline.

### Completion Notes List

- **AC1** — `source_validation.validate_source` runs at the worker trust boundary (post-fetch, pre-pipeline, BEFORE attachment fetches so a bad mix costs nothing). Spoofed/undecodable/too-short/too-long → `InvalidFileError(reason_code)` → job `failed` with `error_code='invalid_file'` and NO dramatiq retry. The BFF reversal hook (`JobEndpoints.GetStatus`) was already built against exactly this contract. Free-tier leak confirmed and closed: `EntitlementService` now excludes invalid_file jobs from the monthly `analysis` usage count (read-side; the append-only meter is untouched). OS-level read errors deliberately stay generic (retryable), never `invalid_file` (never refund a transient).
- **AC2** — attachments ride the presigned path: `POST /uploads/attachments/init` mints AR20 keys (`stems/{jobId}/`, `als/{jobId}/project.*`, `reference/{refId}/source.*`) with jobId derived server-side from the owned version's source key; registration endpoints re-verify prefix + object existence. Worker `resolve_local` generalizes the 3.1 fetch to reference/.als/stems across all four actors — and fixes the latent pre-3.2 bug where `analyze_audio_job` passed stems CWD-relative while `classify_stems` joined LOCAL_ROOT.
- **AC3** — attachment keys follow AR20; `audio/{userId}/{jobId}/source.*` unchanged; `reports/{jobId}.json` is 3.3 (decision 9).
- **AC4** — compose worker now authenticates as `spectr-worker` (minio-init creates the user + readwrite policy); BFF keeps its own creds. Prod R2 scoped token noted for 10.1.
- **Fallback intact** — S3 unconfigured or pre-AR20 version → 501 `presigned_unavailable` → UnifiedUploadDialog falls back per section to the byte-identical legacy proxy endpoints. Standalone dialogs (StemsUploadDialog/AlsUploadDialog/ReferenceUploadDialog) remain legacy-only (follow-on).

### File List

- `components/worker/app/source_validation.py` (new)
- `components/worker/app/object_store.py` (resolve_local + cleanup_all)
- `components/worker/app/tasks_dramatiq.py` (validation + attachment resolution in analyze_audio_job; classify_stems resolution)
- `components/worker/app/rerun_phase_actor.py` (attachment resolution)
- `components/worker/app/reference_analyzer_actor.py` (S3 fetch fallback)
- `components/worker/tests/{test_source_validation,test_resolve_local,test_analyze_invalid_file}.py` (new)
- `components/worker/tests/test_analyze_audio_job_{images,problems,reference}.py` (validate_source stub)
- `components/shared/aimusic_shared/models.py` (AnalysisJob.error_code mirror)
- `components/bff/src/Spectr.Bff/Services/IMultipartObjectStore.cs` (PresignPutUrl)
- `components/bff/src/Spectr.Bff/Services/EntitlementService.cs` (invalid_file exclusion)
- `components/bff/src/Spectr.Bff/Endpoints/UploadEndpoints.cs` (attachments/init + JobIdFromSourceKey)
- `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs` (stems/stage-keys + als-key)
- `components/bff/src/Spectr.Bff/Endpoints/ReferenceEndpoints.cs` (complete-key)
- `components/bff/tests/Spectr.Bff.Tests/UploadEndpointsTests.cs` (fake PresignPutUrl + 5 tests)
- `components/frontend-spectr-v2/src/features/upload/attachment-upload-helpers.ts` (new) + `__tests__/attachment-upload-helpers.test.ts` (new)
- `components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx` (presigned-first attachments)
- `docker/docker-compose.yml` (spectr-worker MinIO user + worker creds)

### Change Log

- 2026-07-03: story created + implemented on `storage/3-2-worker-r2-validation`. Gates: worker 547 + 3 xfail (13 new); BFF build 0-warn, 256/257 (sole failure = pre-existing master webhook race, fixed on PR #4 — see Debug Log), upload tests 17/17; frontend vite build + tsc -b + lint + lint:css + vitest 639/639 (4 new); ruff clean; shared 27. Status → review.
