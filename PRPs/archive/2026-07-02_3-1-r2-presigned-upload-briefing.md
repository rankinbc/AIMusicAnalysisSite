# Briefing — Story 3.1: Direct-to-R2 Presigned Multipart Upload

> **Status: BRIEFING / REVIEW ONLY.** This is not a story file and not a plan of record.
> No decisions have been made, no code written, sprint-status untouched, Epic 3 still `backlog`.
> Purpose: give enough context to review the shape, risks, and open questions for Story 3.1
> before committing to a build. The verified technical research (section 7) is the highest-value
> part to scrutinize — it contains two footguns that reliably break browser-direct R2 uploads.

---

## 1. Story 3.1 at a glance (verbatim from epics.md)

**As a producer, I want my 250 MB uploads to go straight to storage with live progress, so that uploads are fast and never bottleneck on the app server.**

Acceptance criteria:

1. Given an R2 bucket (MinIO in dev/CI — AR17), when I init an upload, then `POST /uploads/init` runs the entitlement check and returns multipart presigned part URLs (parts ≥16 MB) for files ≤250 MB (AR18).
2. Given the browser, when parts upload directly to R2 with progress events, then the BFF never proxies file bodies **and** `POST /uploads/complete` finalizes the multipart and enqueues the job.
3. Given the existing upload UX, when uploading, then chunked percentage progress renders as today (FR1 regression).
4. Given a stalled part on a poor connection, when the client retries that part, then the upload resumes without restarting from zero (NFR3).
5. Given dev parity, when compose dev runs, then MinIO exercises the identical code paths.

---

## 2. Where 3.1 sits in Epic 3 (Reliable Uploads & Results That Last)

3.1 lays the storage foundation the rest of the epic builds on. One-liners:

| Story | Builds on 3.1 by… |
|-------|-------------------|
| **3.1** (this) | Presigned multipart **mix** upload, browser→R2 direct, BFF never proxies bytes. |
| 3.2 | Worker-side magic-byte + duration validation at the trust boundary; **attachments** (stems/ref/.als) through the same presigned path; worker uses its own R2 creds. |
| 3.3 | Short-lived presigned **GET** for playback; report persisted to R2 (`reports/{jobId}.json`) in addition to Postgres JSONB; expired-URL transparent refresh. |
| 3.4 | Nightly `sweep_retention` actor on the `maintenance` queue (free 30d, lapsed-paid 90d; reports/verdicts/chats never purged). |
| 3.5 | Resilience verification gate (mid-analysis resume, worker-restart job survival, flaky-connection 190 MB FLAC completes). |

This briefing covers **3.1 only**, but flags where a 3.1 decision pre-commits a 3.2/3.3 path.

---

## 3. Binding architecture decision (architecture.md, D3 — quoted)

> **D3 — Object Storage: S3-compatible (Cloudflare R2), presigned direct upload.**
> Decision: R2 (zero egress fees — audio downloads/playback would bleed on S3; S3-compatible API keeps options open). Local dev + CI: MinIO container.
> - **Upload path:** client → BFF `POST /uploads/init` (entitlement check, returns multipart presigned part URLs) → browser uploads parts directly to R2 → `POST /uploads/complete` → BFF enqueues job. BFF never proxies 250 MB bodies. Magic-byte + duration validation moves into the worker's pre-pipeline step; invalid file → job fails fast with typed error, no entitlement consumed.
> - **Layout:** `audio/{userOrDevice}/{jobId}/source.*`, `stems/{jobId}/…`, `als/{jobId}/…`, `reports/{jobId}.json`; reports also persisted in Postgres JSONB (existing) — R2 copy is belt-and-braces.
> - **Access:** BFF issues short-lived presigned GETs; share-page audio = presigned GET scoped to share-token validity; worker uses its own R2 credentials.

Relevant requirements: **AR17** (R2 + MinIO), **AR18** (presigned multipart init/complete, ≥16 MB parts), **AR19** (validation moves to worker — *3.2*), **AR20** (key layout), **AR21** (signed GETs + worker creds — *3.3*), **AR16** (usage event at dispatch; compensating reversal on validation-fail, never UPDATE balances), **NFR3** (250 MB over consumer connections, chunked + progress), **NFR5** (private by default, signed expiring URLs only), **FR1** (upload + live progress).

---

## 4. What changes: current state → target

**Today** (verified by code map): all uploads are **multipart form POSTs to the BFF**, which streams the body to disk via `IFileStorage.WriteAsync` (`LocalDiskFileStorage`). The BFF proxies the full file body. Storage root is local disk (`data/`), resolved by both BFF (`Storage:LocalRoot`) and worker (`STORAGE_LOCAL_ROOT`).

**Target (3.1):** the browser uploads parts **directly to R2/MinIO** using presigned URLs. The BFF only (a) authorizes + signs at `/uploads/init` and (b) finalizes + enqueues at `/uploads/complete`. No file bytes pass through the app server.

This is a genuine architectural shift, not a config swap — the current `IFileStorage` abstraction has **no multipart surface** (no init / presign-part / complete / abort). See section 6.

---

## 5. Current-state code map (what 3.1 touches or must preserve)

All paths under `components/`.

### Storage abstraction
- `bff/src/Spectr.Bff/Services/IFileStorage.cs` — interface: `OpenReadAsync`, `WriteAsync`, `DeleteAsync`, `GetPresignedReadUrlAsync(key, expiry)`, `ExistsAsync`, `GetFileSizeAsync`. **No multipart methods.** `GetPresignedReadUrlAsync` already exists (a seam for 3.3 playback signing).
- Only implementation: `LocalDiskFileStorage` (same file). **No R2/S3 implementation, no AWSSDK.S3 reference anywhere.**
- DI: `Program.cs:83` → `AddSingleton<IFileStorage, LocalDiskFileStorage>()`.
- `bff/src/Spectr.Bff/Endpoints/FileEndpoints.cs` — `/files/{**key}` is a **501 stub** intended as the local-disk presigned-read fallback (R2 mode would hit the signed URL directly).

### Upload endpoints (all in `bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs`)
- `POST /api/versions/` (mix, ≤250 MB) — streams to `IFileStorage.WriteAsync`, key `audio/upload/{jobId}/source{ext}`, then `DispatchAnalysisAsync` unless `analyze=false`.
- `POST /api/versions/{id}/stems/stage` (≤100 stems) — has a **`LooksLikeAudioAsync`** magic-byte check (RIFF/fLaC) today; key `audio/stems/{versionId}/{stemId}{ext}`.
- `POST /api/versions/{id}/stems` (legacy role-keyed), `…/stems/classify`, `…/stems/confirm`, `POST /api/versions/{id}/als`, reference upload — all proxy bytes through the BFF today.
- `GET /api/versions/{id}/audio` — Range-enabled streaming with `?t=` query-param JWT (HTMLMediaElement can't send headers).

### Entitlement-gated dispatch (the gate 3.1's `/uploads/init` must reuse)
- `VersionEndpoints.DispatchAnalysisAsync(...)` — resolves `EntitlementService.ForAsync(userId)`; 409 `entitlement_exhausted` when `AnalysesRemaining == 0`; for `credits` tier inserts the job then `CreditLedgerService.SpendAsync` (Serializable, `InsufficientCreditsException` backstop) writing a `−1` ledger row + `UsageEvent` in one tx (**AR16**); enqueues to `analysis-paid`/`analysis-free` by tier.
- `EntitlementService.ForAsync` — 60 s `IMemoryCache`; tiers pro / credits / free; free `StemsEnabled=false`, `AlsEnabled=false`.

### Compensating reversal (AR16 — relevant to AR19 validation-fail in 3.2)
- `JobEndpoints.cs` GetStatus — **lazy reversal**: on reading a `failed` job with `error_code="invalid_file"` and a prior spend, calls `CreditLedgerService.ReverseAsync` → `+1` row, `idempotency_key="reversal:{jobId}"` (idempotent via partial unique index).

### Frontend
- `frontend-spectr-v2/src/hooks/useFileUpload.ts` — **XHR** (not fetch, for `upload.progress` events), POSTs `FormData` to `/api/versions/`, exposes `progress` 0..1.
- `frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx` — orchestrates mix (`analyze=false`) → optional stems stage/classify/confirm → single dispatch. Uploads mix **and** attachments in one flow today.

### Worker source resolution
- `worker/app/tasks_dramatiq.py` `analyze_audio_job` — reads `song_versions.file_path` (relative key), resolves `Path(LOCAL_ROOT) / file_rel`. **No magic-byte/duration validation today** (relies on `run_pipeline`). `LOCAL_ROOT` = `STORAGE_LOCAL_ROOT` or auto (`/data` container, repo `data/` on Windows).

### Infra / packages
- `docker/docker-compose.yml` — postgres:16, redis:7, bff, worker, frontend. **No MinIO.** `docker-compose.prod.yml` splits worker into W1 (`coach analysis-paid`) / W2 (`analysis-free maintenance`).
- **No `AWSSDK.*` (BFF) and no `boto3`/`minio`/`s3fs` (worker)** anywhere yet.

---

## 6. Shape of the work (illustrative, NOT a task list)

Framed so reviewers can judge scope. Numbers/paths are proposals to challenge, not commitments.

- **New multipart surface.** Either extend `IFileStorage` with `InitiateMultipartAsync`/`PresignPartUrlsAsync`/`CompleteMultipartAsync`/`AbortMultipartAsync`, or introduce a separate `IObjectStore`/`IMultipartUploadService`. (Open decision — section 8.)
- **`R2FileStorage`/S3-compatible implementation** using `AWSSDK.S3` (`IAmazonS3`), registered by config (R2 in prod, MinIO in dev/CI), with `LocalDiskFileStorage` retained or retired (open decision).
- **`POST /uploads/init`** — auth + entitlement check, allocate `jobId`, compute part count for the declared file size (≥16 MB parts, ≤250 MB), `InitiateMultipartUploadAsync`, return `{ uploadId, key, parts:[{partNumber, url}], partSize }`.
- **`POST /uploads/complete`** — accept `{ uploadId, key, parts:[{partNumber, eTag}] }`, `CompleteMultipartUploadAsync`, create the `SongVersion` row, dispatch the job (reusing `DispatchAnalysisAsync`).
- **DI:** register `IAmazonS3` with a custom `AmazonS3Config` (ServiceURL, ForcePathStyle, region, checksum mitigation — section 7).
- **MinIO** service added to `docker/docker-compose.yml` (and CI), bucket auto-created, CORS configured (section 7).
- **Frontend rewire:** `useFileUpload` → init → parallel/sequential part PUTs straight to R2 with per-part progress aggregation + per-part retry → complete. Preserve the existing 0..1 progress bar (FR1) and the UnifiedUploadDialog flow.
- **Config/options:** `StorageOptions`/`R2Options` (ServiceURL, AccessKey, SecretKey, Bucket, ForcePathStyle, Region) via env/user-secrets; never in appsettings.

---

## 7. Verified technical research (R2 + MinIO + AWS SDK for .NET) — review carefully

Verified against AWS SDK for .NET API ref + source, Cloudflare R2 docs, MinIO docs (June 2026). Sources listed at the end of this section.

### Package
- `AWSSDK.S3`, latest stable **4.0.25.2** (ships `net8.0` asset; consumed fine on .NET 10 — no `net10.0` TFM, forward-compatible). Depends on `AWSSDK.Core 4.x`.
- Optional DI helper: `AWSSDK.Extensions.NETCore.Setup` — but an explicit `AddSingleton<IAmazonS3>(...)` is cleaner for a non-AWS (custom ServiceURL) endpoint.

### Exact multipart API (casing matters — these are easy to get wrong)
- Initiate: `s3.InitiateMultipartUploadAsync(new InitiateMultipartUploadRequest { BucketName, Key, ContentType })` → `.UploadId`. (Method keeps the legacy `Initiate…` name even though the wire op is `CreateMultipartUpload`.)
- Presign a part: `await s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest { BucketName, Key, Verb = HttpVerb.PUT, UploadId, PartNumber = n, Expires })` → `string`. **`GetPreSignedURL` (URL all-caps); `PartNumber` and `UploadId` are confirmed present on the presign request type** — this is the linchpin and it checks out.
- Client PUTs the chunk to the URL, reads the **`ETag`** response header.
- Complete: `s3.CompleteMultipartUploadAsync(new CompleteMultipartUploadRequest { BucketName, Key, UploadId, PartETags = List<PartETag> })`; `PartETag(int partNumber, string eTag)` in `Amazon.S3.Model`; parts in **ascending** PartNumber order.
- Abort (cleanup stalled uploads): `s3.AbortMultipartUploadAsync(new AbortMultipartUploadRequest { BucketName, Key, UploadId })`.

### FOOTGUN #1 — SDK auto-checksum breaks browser-direct presigned PUTs
Since the Dec-2024 "default data integrity" change (carried into 4.x), the SDK injects a checksum on uploads by default (`RequestChecksumCalculation` defaults to `WHEN_SUPPORTED`, CRC32). For **presigned** PUTs the checksum headers entangle with the signature → browser PUT fails `SignatureDoesNotMatch`; R2 additionally rejects the CRC32 algorithm it doesn't implement. Mitigation on the signing config:

```csharp
using Amazon.S3;
using Amazon.Runtime;   // RequestChecksumCalculation lives here

var config = new AmazonS3Config {
    ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com",
    AuthenticationRegion = "auto",
    RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,   // THE FIX
    ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,   // same intent
};
```
**Enum members are UPPER_SNAKE_CASE in the actual C# source: `WHEN_REQUIRED` / `WHEN_SUPPORTED`.** `.WhenRequired` will **not compile**. Also: the browser must send only the chunk bytes — no `x-amz-checksum-*`, no `Content-MD5`, and no signed `Content-Type` unless the presign included it (a mismatched signed `Content-Type` is itself a `SignatureDoesNotMatch` trigger on R2).

### FOOTGUN #2 — CORS must expose the ETag header
A browser cannot read the `ETag` from a cross-origin PUT unless the bucket CORS `ExposeHeaders` includes `"ETag"` — and without per-part ETags you cannot call Complete. Bucket CORS needs:
```json
[{ "AllowedOrigins": ["<frontend-origin>"], "AllowedMethods": ["PUT","GET","HEAD"],
   "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

### FOOTGUN #3 — R2 requires uniform part size
R2 (stricter than S3): *all parts except the last must be the same size.* Pick one fixed part size (e.g. 16 MiB) for every part except the final one. S3 tolerates uneven parts; R2 does not — a working-on-S3/failing-on-R2 trap.

### R2 vs MinIO config divergence
- **R2:** endpoint `https://<accountid>.r2.cloudflarestorage.com`, region `"auto"`, **do not** set `ForcePathStyle` (virtual-hosted). Part limits: ≥5 MiB (except last), ≤5 GiB, ≤10,000 parts. 16 MiB fine.
- **MinIO:** image `minio/minio`, default creds `minioadmin`/`minioadmin`, API `:9000`, console `:9001` (needs `--console-address ":9001"`), **`ForcePathStyle = true` REQUIRED**, region conventionally `us-east-1`. Supports the same multipart + presigned flow.

### Sources
AWS SDK .NET API ref (`GetPreSignedUrlRequest`, `PartETag`, `InitiateMultipartUpload`, `HttpVerb`); AWS SDK .NET source (`Enumerations.cs` checksum enum members); AWS data-integrity guide + announcement #3610; Cloudflare R2 docs (multipart, limits, S3 compat, presigned URLs region `auto`, .NET example, CORS); MinIO Docker README + S3 API.

---

## 8. Open decisions to settle before building (the deferred "decisions")

These are exactly what we're **not** deciding now — listed so the review can resolve them.

1. **Abstraction shape:** extend `IFileStorage` with multipart methods, or add a separate `IMultipartUploadService`/`IObjectStore`? (LocalDisk has no natural multipart analogue — affects whether dev keeps a local path at all.)
2. **Dev storage:** retire `LocalDiskFileStorage` and run MinIO for all dev/CI (D3/AR17 implies this), or keep local disk as a no-S3 fallback? Retiring simplifies one code path but adds a hard MinIO dependency to every dev loop.
3. **jobId / key timing:** current key is `audio/upload/{jobId}/source.*`; AR20 target is `audio/{userOrDevice}/{jobId}/source.*` (note `{userOrDevice}` — anticipates Epic 4 anonymous devices). Does 3.1 adopt the AR20 layout now (forward-compatible) or keep `upload/`? When is `jobId` allocated — at `/init`?
4. **Entitlement timing vs double-spend:** entitlement check is at `/init` but dispatch (and the `−1` spend) is at `/complete`. Confirm the spend stays at dispatch (AR16) and `/init` only *checks* (no reservation), and decide how an abandoned upload (init but never complete) is reconciled (no spend occurred — clean, but leaves an orphaned R2 multipart → Abort/lifecycle).
5. **Resumability scope (AC4 / NFR3):** init returns part URLs with a fixed expiry. A 250 MB upload on a slow link can outlive the expiry. Do we need a **re-sign endpoint** (`/uploads/{id}/parts/{n}/sign`) for long uploads, or is a generous expiry + per-part retry enough for 3.1? AC4 says "retry that part… without restarting from zero" — per-part retry covers the stall; URL expiry is the edge case to rule in or out.
6. **Attachments boundary:** 3.1 is the **mix** only; 3.2 does stems/ref/.als through the same path. But `UnifiedUploadDialog` uploads mix + attachments together today. Decide the migration order — does 3.1 leave attachments on the old proxy path temporarily (mixed-mode), or does the dialog wait for 3.2?
7. **Validation handoff:** AR19 moves magic-byte + duration validation to the worker (3.2). The BFF's existing `LooksLikeAudioAsync` (stems) — keep, move, or drop? With no BFF byte-proxy, the BFF can no longer sniff magic bytes at upload, so validation *must* move server-side — confirm 3.1 doesn't regress the current stem check before 3.2 lands.
8. **Abandoned-multipart cleanup:** orphaned multipart uploads (init, never completed) cost storage. R2 lifecycle rule, an `AbortMultipartUploadAsync` sweep, or defer to the 3.4 retention sweep?
9. **Frontend concurrency:** parallel part PUTs (faster, more complex progress/retry) vs sequential (simpler). Affects the progress-aggregation code and retry semantics.

---

## 9. Regression surface (must not break)

- **FR1** — chunked percentage progress must look identical to today (AC3). The progress source changes from one XHR `upload.progress` to aggregated per-part progress.
- **FR8 / NFR16** — job persistence + leave/return via existing SSE/poll (verified in 3.5, but 3.1 must not regress dispatch).
- **UnifiedUploadDialog** end-to-end (mix → stems → confirm → single dispatch) and the standalone dialogs.
- `GET /api/versions/{id}/audio` streaming + Listen page (3.3 reworks to signed GET; 3.1 should leave intact).
- Worker `analyze_audio_job` source resolution (key→object fetch changes from local path to R2 GET — careful coordination with worker creds in 3.2).

---

## 10. Summary for reviewers

- 3.1 is a **real architectural shift** (browser→R2 direct), not a storage config swap: the `IFileStorage` abstraction has no multipart surface and there is zero S3 SDK / MinIO presence today.
- The build is well-bounded by D3 + AR17/18 and reuses the existing entitlement gate (`DispatchAnalysisAsync`) and compensating-reversal pattern (AR16) — those are solved.
- The **highest implementation risk is the three R2 footguns** (checksum default, CORS ExposeHeaders ETag, uniform part size). All three have verified mitigations in section 7. Get these into any future plan's "gotchas" verbatim.
- The **decisions in section 8** (abstraction shape, dev-storage retirement, key layout/jobId timing, resumability scope, attachment migration order) are the things to resolve in review before a story is generated.
