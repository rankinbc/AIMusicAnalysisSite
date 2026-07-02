# Story 3.1: Direct-to-R2 Presigned Multipart Upload

Status: review

## Story

As a producer,
I want my 250 MB uploads to go straight to storage with live progress,
So that uploads are fast and never bottleneck on the app server.

## Acceptance Criteria

1. **Given** an R2 bucket (MinIO in dev/CI — AR17), **When** I init an upload, **Then** `POST /uploads/init` runs the entitlement check and returns multipart presigned part URLs (parts ≥16 MB) for files ≤250 MB (AR18).
2. **Given** the browser, **When** parts upload directly to R2 with progress events, **Then** the BFF never proxies file bodies **And** `POST /uploads/complete` finalizes the multipart and enqueues the job.
3. **Given** the existing upload UX, **When** uploading, **Then** chunked percentage progress renders as today (FR1 regression).
4. **Given** a stalled part on a poor connection, **When** the client retries that part, **Then** the upload resumes without restarting from zero (NFR3).
5. **Given** dev parity, **When** compose dev runs, **Then** MinIO exercises the identical code paths.

## Resolved decisions (briefing §8 → decisions of record)

1. **Abstraction**: new `IMultipartObjectStore` (Init/PresignParts/Complete/Abort/GetPresignedReadUrl/DownloadTo) + single `S3ObjectStore` impl on `AWSSDK.S3`. `IFileStorage` untouched — LocalDisk keeps serving the legacy proxy endpoints.
2. **Dev storage**: LocalDisk RETAINED. Presigned path activates only when `Storage:S3:*` is configured; unconfigured `POST /uploads/init` → 501 `presigned_unavailable` and the frontend falls back to the legacy XHR proxy upload. Compose dev adds a MinIO service with S3 config wired → AC5.
3. **Key layout**: adopt AR20 now — `audio/{userId}/{jobId}/source{ext}`. `jobId` (GUID) allocated at `/uploads/init`; DB rows (SongVersion + AnalysisJob) created only at `/uploads/complete` — an abandoned init leaves zero DB residue, only an orphaned multipart (see 8).
4. **Entitlement timing**: `/init` CHECKS (`EntitlementService.ForAsync`, 409 `entitlement_exhausted` when 0 remaining) but never spends; the spend + usage event stays inside `DispatchAnalysisAsync` at `/complete` (AR16 unchanged, no reservation, no double-spend).
5. **Resumability scope**: fixed part size 16 MiB, per-part retry (client re-PUTs the same presigned URL), URL expiry 2 h. No re-sign endpoint in 3.1 — 250 MB / 16 parts inside 2 h covers NFR3's flaky-connection case; re-sign is noted for 3.5 verification if the gate proves otherwise.
6. **Attachments boundary**: 3.1 = MIX ONLY through the presigned path. Stems/reference/.als stay on the legacy proxy endpoints until 3.2. `UnifiedUploadDialog` runs mixed-mode (presigned mix when available + legacy attachments).
7. **Validation handoff**: no BFF byte-sniff possible on the presigned path; magic-byte + duration validation moves to the worker in 3.2 (AR19). Interim: a bad mix fails in `run_pipeline` → job `failed` and the existing AR16 lazy reversal path already refunds credit spends on `invalid_file`. Legacy stem `LooksLikeAudioAsync` untouched.
8. **Abandoned multiparts**: `POST /uploads/abort` for client cancel; unswept orphans deferred to 3.4 retention sweep + R2 lifecycle rule (documented there).
9. **Frontend concurrency**: sequential part PUTs, 3 retry attempts per part with backoff, progress = (completedBytes + inflightPart.loaded) / totalBytes. Parallelism deferred — sequential saturates consumer uplinks and keeps FR1 progress exact.
10. **Worker fetch shim (3.2-forward, minimal)**: dev-parity (AC5) is meaningless if presigned-uploaded jobs can never analyze, so 3.1 ships a minimal worker download shim — when `S3_ENDPOINT` is configured the worker downloads `file_path` key from the bucket to a temp file before `run_pipeline`. Full worker-side validation + attachments + own-credentials hardening remain 3.2 (AR19/AR21).

## Tasks / Subtasks

- [x] Task 1: Infra — MinIO in dev compose + CI (AC 1, 5)
  - [x] 1.1 `docker/docker-compose.yml`: add `minio` service (minio/minio, ports 9000/9001, healthcheck) + `minio-init` one-shot (mc: create bucket `spectr`, set CORS ExposeHeaders ETag)
  - [x] 1.2 Wire BFF + worker env in compose: `Storage__S3__*` (BFF), `S3_*` (worker)
- [x] Task 2: BFF multipart surface (AC 1, 2)
  - [x] 2.1 `Services/IMultipartObjectStore.cs` + `S3ObjectStore` (AWSSDK.S3; ServiceURL, ForcePathStyle for MinIO, `RequestChecksumCalculation.WHEN_REQUIRED` — FOOTGUN #1)
  - [x] 2.2 `S3StorageOptions` (ServiceUrl, AccessKey, SecretKey, Bucket, Region, ForcePathStyle, PartSizeBytes=16 MiB, UrlExpiryMinutes=120) bound from `Storage:S3`; DI registers store only when configured
  - [x] 2.3 `Endpoints/UploadEndpoints.cs`: `POST /api/uploads/init` (auth + entitlement check + size ≤250 MB + uniform 16 MiB parts — FOOTGUN #3), `POST /api/uploads/complete` (ascending PartETags, create SongVersion(+Song) + dispatch via existing helper), `POST /api/uploads/abort`; 501 envelope when S3 unconfigured
  - [x] 2.4 BFF tests: init/complete/abort against fake store; entitlement 409; part math (16 MiB uniform, last part remainder); 501 fallback
- [x] Task 3: Worker fetch shim (AC 5)
  - [x] 3.1 `worker/app/object_store.py`: boto3 client when `S3_ENDPOINT` set; `fetch_to_local(key) -> Path` (temp download)
  - [x] 3.2 `tasks_dramatiq.analyze_audio_job`: resolve source via shim when configured, else LOCAL_ROOT (unchanged); cleanup temp after pipeline
  - [x] 3.3 boto3 into requirements + lock regen
- [x] Task 4: Frontend presigned upload (AC 2, 3, 4)
  - [x] 4.1 `src/hooks/useMultipartUpload.ts`: init → sequential XHR PUTs (per-part progress, ETag capture — FOOTGUN #2 needs CORS ExposeHeaders) → complete; per-part retry ×3 with backoff; abort on cancel
  - [x] 4.2 Capability probe: init 501 → fall back to legacy `useFileUpload` path transparently (mixed-mode per decision 6)
  - [x] 4.3 Wire into `UnifiedUploadDialog` mix upload (attachments stay legacy); preserve 0..1 progress bar (FR1)
  - [x] 4.4 vitest: part-splitting math, retry-then-succeed, progress aggregation, 501 fallback
- [x] Task 5: Gates + story close-out
  - [x] 5.1 All gates green (BFF, frontend ×4, worker pytest, ruff)
  - [x] 5.2 sprint-status.yaml: epic-3 in-progress, 3-1 status updates

## Dev Notes

### The three R2 footguns (verified research — briefing §7, keep verbatim)

1. **SDK auto-checksum breaks browser-direct presigned PUTs.** AWSSDK 4.x defaults `RequestChecksumCalculation` to `WHEN_SUPPORTED` (CRC32) — presigned PUT signature entangles with checksum headers → `SignatureDoesNotMatch`; R2 also rejects CRC32. Fix on the signing config: `RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED` + `ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED` (enum members are UPPER_SNAKE_CASE). Browser must send ONLY chunk bytes — no `x-amz-checksum-*`, no `Content-MD5`, no unsigned `Content-Type` mismatch.
2. **CORS must expose ETag** or the browser can't read per-part ETags and Complete is impossible: `ExposeHeaders: ["ETag"]` on the bucket CORS (MinIO: `mc` policy; R2: dashboard/API).
3. **R2 requires uniform part size** (all parts except last identical). Fixed 16 MiB for every part except the final remainder. S3/MinIO tolerate uneven parts — a works-in-dev/fails-in-prod trap if violated.

### R2 vs MinIO config

- R2: `https://<accountid>.r2.cloudflarestorage.com`, region `auto`, ForcePathStyle FALSE.
- MinIO: `http://minio:9000` (compose) / `http://localhost:9000` (host), creds minioadmin/minioadmin (dev), ForcePathStyle TRUE, region `us-east-1`.
- SDK calls: `InitiateMultipartUploadAsync` → `GetPreSignedURLAsync(new GetPreSignedUrlRequest { Verb = HttpVerb.PUT, UploadId, PartNumber, Expires })` → client PUTs → `CompleteMultipartUploadAsync(PartETags ascending)`; `AbortMultipartUploadAsync` for cleanup.

### Reuse (do not reinvent)

- Entitlement gate + spend + queue routing: `VersionEndpoints.DispatchAnalysisAsync` — `/uploads/complete` must call it (or its extracted equivalent), not copy it.
- Error envelope: `Endpoints/ErrorEnvelope.cs`.
- Upload key convention: AR20 `audio/{userId}/{jobId}/source{ext}` (new layout, this story).
- Frontend XHR pattern: `useFileUpload.ts` shows the XHR-for-progress idiom; the new hook PUTs raw bytes (no FormData) to presigned URLs.

### Regression surface (briefing §9)

FR1 progress identical; UnifiedUploadDialog E2E (mix→stems→confirm→single dispatch); `GET /api/versions/{id}/audio` untouched (3.3 owns playback); legacy endpoints untouched for attachments; worker LOCAL_ROOT path unchanged when S3 unconfigured.

## Dev Agent Record

- 2026-07-02: Story created from briefing `PRPs/3-1-r2-presigned-upload-briefing.md` (decisions §8 resolved above); implementation on branch `release/phase-0-hygiene` (stacked on Phase-0 hygiene PR #2).
- 2026-07-02: Implemented + gates run. BFF: `IMultipartObjectStore`/`S3ObjectStore` (AWSSDK.S3 4.0.25.2), `UploadEndpoints` (init/complete/abort), song/version creation extracted to shared internal helpers in `VersionEndpoints`, 12 new tests (real-Postgres, fake store) all green. Worker: `object_store.py` boto3 fetch shim wired into `analyze_audio_job` (temp download + cleanup), boto3 pinned into lock, 5 new tests, full suite 534 green + ruff clean. Frontend: `multipart-upload-helpers.ts` (planParts/uploadPartsSequential w/ per-part retry) + `useMixUpload` (presigned-first, 501→legacy fallback, abort-on-cancel) wired into `UnifiedUploadDialog`; 11 new vitest, all four gates green (601 tests). Compose: minio + minio-init (bucket + ETag-exposing CORS) + BFF/worker env.
- KNOWN GAPS at review: (1) live browser E2E against MinIO not run (worker compose image needs the 10-1 Dockerfile; presign host-vs-container URL split documented in compose comments); (2) one PRE-EXISTING `StripeWebhookEndpointTests` failure when Postgres is up — BillingReconciliation hosted service fires mid-test against real Stripe with no key + stale sub rows; user directed skip (2026-07-02), not story 3.1 scope; (3) deferred-structure actor reads LOCAL_ROOT only — S3-uploaded sources skip structure detection until 3.2 (allin1 disabled for beta anyway).
