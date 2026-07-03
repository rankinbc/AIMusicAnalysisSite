# Story 3.3: Signed Playback & Durable Reports

Status: review

## Story

As a producer,
I want playback to just work while my files stay private,
So that nothing I upload is ever publicly reachable.

## Acceptance Criteria

1. **Given** report playback (FR5), **When** the player requests audio, **Then** the BFF issues short-lived presigned GETs — no public objects, no permanent URLs (NFR5).
2. **Given** a completed job, **When** the report persists, **Then** it writes to Postgres JSONB (existing) AND `reports/{jobId}.json` in R2 (AR20).
3. **Given** the Listen page, **When** it loads audio, **Then** the same signed-URL flow applies.
4. **Given** an expired signed URL, **When** playback resumes later, **Then** the client transparently requests a fresh URL.

## Decisions of record (recon 2026-07-03)

1. **Delivery shape = 302 redirect from the EXISTING byte endpoints.** Every current auth model stays exactly where it is (JWT header/`?t=` on `/versions/*`, opaque tokens on `/v/*` + `/share/*`): the endpoint authorizes as today, then — local-first — either proxy-streams the local file (dev parity, S3 unconfigured) or 302-redirects to a short-lived presigned GET. `<audio>`, `<img>`, and `fetch` all follow redirects; S3/MinIO serve Range natively. This simultaneously FIXES the 3.1 known gap: S3-uploaded mixes currently 404 on every playback route (BFF has no S3 read path at all).
2. **`PresignGetUrl(key, fileName?)` on `IMultipartObjectStore`** (HttpVerb.GET; optional `ResponseHeaderOverrides.ContentDisposition` for the als/reference download endpoints). New `S3StorageOptions.ReadUrlExpiryMinutes` default **15** (shorter than the 120-min PUT expiry — playback URLs are minted per request; NFR5 short-lived).
3. **One shared helper, applied to every media route**: `MediaDelivery.ServeAsync(storage, s3, key, contentType, http, ct, downloadName?)` — `storage.ExistsAsync` → proxy stream (unchanged behavior) → else `s3.IsConfigured && ObjectExistsAsync` → 302 presigned → else 404. Routes: `StreamAudio`, `StreamStemAudio`, `DownloadAls`, `DownloadReference` (VersionEndpoints), `StreamVersionAudio` (/v), `StreamShareAudio` + `peaks` (ShareEndpoints), `GetImage` (JobEndpoints).
4. **AC2 = worker uploads the report JSON to `reports/{jobId}.json`** via new `object_store.put_json` (best-effort, alongside `_try_write_artifact`, never fails the job). ALSO upload the result images to S3 under their EXISTING keys (`analysis/images/{jobId}/{kind}.webp`) — without this, prod (worker box ≠ BFF box) has no way to serve images at all; same-key upload means `GetImage` + MediaDelivery just work.
5. **AC4 = bounded media-error retry on the clients.** A presigned URL expires mid-session when the user resumes after >15 min idle; the media element errors. Handler: remember `currentTime` + playing state, re-set `src` to the SAME API URL (fresh `?t=` where applicable) — the API mints a fresh presign — restore position, resume. One retry per error event, min 5 s between retries (no loops on genuine 404s). Apply on listen-rack `<audio>` (replaces the bare toast) and `/v/{token}` `<audio>`; `/r/{token}` gets the same tiny handler. FilesTab fetch-blob downloads follow redirects natively (no change).
6. **CORS**: compose MinIO CORS already allows GET from `localhost:5174`; presigned GETs need no auth headers so redirect-following works cross-origin. R2 prod CORS documented in the compose comment (10.1 owns prod config).
7. **Out of scope**: retiring the `?t=` JWT-in-URL pattern (CLAUDE.md notes it pre-public; the presign redirect actually shortens exposure — the JWT URL is only ever hit at the BFF), peaks pre-compute changes, `/api/files/{**key}` stub (stays stubbed), retention/lifecycle (3.4).

## Tasks / Subtasks

- [x] Task 1 — Presigned GET capability (AC: 1) — `PresignGetUrl(key, downloadName?)` (Verb GET, ContentDisposition override) + `ReadUrlExpiryMinutes = 15` + fake-store impl
- [x] Task 2 — MediaDelivery helper + route adoption (AC: 1, 3) — `Services/MediaDelivery.cs` (local-first proxy → presigned 302 → 404, shared `AudioContentType` map); adopted in StreamAudio / StreamStemAudio / DownloadAls / DownloadReference / StreamVersionAudio (/v) / StreamShareAudio + peaks / GetImage (immutable cache header now local-branch-only — a 302 target expires); auth/ownership untouched; 6 BFF tests
- [x] Task 3 — Durable report + images to R2 (AC: 2) — `object_store.put_json`/`put_file` + `_try_upload_durables` after Phase C (`reports/{jobId}.json` + images under existing keys, best-effort); 4 worker tests
- [x] Task 4 — Client transparent refresh (AC: 4) — `features/listen/media-retry.ts` (`createMediaRetry`: 5 s guard, position + playback restore on `loadedmetadata`, injectable clock); wired on listen-rack `<audio>` (toast only when retry refused), `/v/{token}`, `/r/{token}`; 4 vitest
- [x] Task 5 — Gates + status — all green (see Change Log)

## Dev Notes

### Verified wiring facts (recon)

- **BFF media endpoints all proxy `LocalDiskFileStorage`** (`IFileStorage` sole impl, `Program.cs:92`) — an S3-uploaded version's `FilePath` (`audio/{userId}/{jobId}/source.*`) fails `ExistsAsync` → **404 today** on: `/versions/{id}/audio` (VersionEndpoints:254-287), `/versions/{id}/stems/{stemId}/audio` (:985-1000), `/versions/{id}/als` (:459), `/versions/{id}/reference` (:483), `/v/{token}/audio` (VersionViewEndpoints:130-157), `/share/{token}/audio`+`/peaks` (ShareEndpoints:187+), `/jobs/{id}/images/{kind}` (JobEndpoints:290-316).
- **`?t=` whitelist** (`Program.cs:50-81`): `/api/versions/*` ending `/audio`, and `/api/jobs/*` containing `/images/`. Redirect responses don't change this — auth happens before the redirect.
- **`IMultipartObjectStore` post-3.2**: PresignPutUrl / GetObjectSizeAsync / ObjectExistsAsync / multipart set. NO GET presign. `IFileStorage.GetPresignedReadUrlAsync` returns the unimplemented `/api/files/{key}` stub — do NOT build on it.
- **Fake store** (`UploadEndpointsTests.FakeMultipartObjectStore`) is the test seam — add `PresignGetUrl` there.
- **Worker artifacts are local-only**: `_try_write_artifact` (tasks_dramatiq.py:508-521) → `RESULTS_DIR/{date}_{jobId}.json`; `_render_and_store_images` (:478-505) → `LOCAL_ROOT/analysis/images/{job_id}/{kind}.webp`. BFF never reads the JSON artifact (Postgres `analyses.final_json` canonical). Worker `object_store` has download-only members.
- **Frontend consumers**: listen-rack `audioUrl` memo (`ListenRackPage.tsx:165-173`, dep `[versionId]` ONLY — deliberate, keeps `<audio>` mounted across token rotation; the AC4 handler must mint a fresh URL WITHOUT changing that memo); `stemUrl` (:357-361; StemDeck re-fetches on token rotation by design); `/v` audio (v.$token.tsx:142, no error handler); `/r` audio (r.$token.tsx:144); SpectrumTab/TrackInfoTab `withTok` images; FilesTab fetch-blob downloads. `ResultsPlayer` is a static silhouette — NOT an audio consumer. No WaveSurfer anywhere.
- **Media error handling today**: listen-rack `onErr` = toast only (:419); v/r pages none.

### Redirect gotchas

- `Results.Redirect(url)` → 302; do NOT use 301 (cacheable-permanent violates NFR5).
- Presigned GET uses the SAME checksum-safe client config (footgun #1 handled once in `CreateClient`).
- Browser media stacks may cache the redirect target for the life of the element; a seek/resume after expiry surfaces as a media error — that's exactly the AC4 retry path, not something to prevent server-side.
- `fetch` (FilesTab) follows 302 and drops the Authorization header on cross-origin hops — fine: the presigned URL needs no auth. MinIO CORS (compose) already exposes GET.
- Range: S3/MinIO honor Range on presigned GETs natively; `enableRangeProcessing` stays for the local proxy branch.

### Previous story intelligence (3.2 + review)

- Review patterns to pre-empt: single-segment/`..` key handling (MediaDelivery serves keys READ from the DB, already guarded at write time — resolve_local's traversal guard is the worker mirror; the BFF local branch resolves via LocalDiskFileStorage which Path.Combines — do not pass client-supplied keys to MediaDelivery, only DB-loaded ones), environmental-vs-content error split, temp cleanup, tests that prove claims.
- Worker `put_json`/`put_file` must be import-light (boto3 lazy import like `_client()`), best-effort at call sites (report upload failure NEVER fails a completed analysis).
- `shared`+`worker` pytest must run as separate invocations (package-name collision).
- Known flake: CoachStream parallel-run; webhook race FIXED on master now.
- Branch/PR: `storage/3-3-signed-playback`, PR to master.

### References

- [Source: PRPs/epics.md#Story 3.3 (L711-723)]
- [Source: PRPs/stories/3-2-worker-side-validation-and-attachments-via-r2.md] — object_store/attachment groundwork + review deferrals ("read-path for R2 keys → 3.3")
- [Source: components/bff/src/Spectr.Bff/Endpoints/{VersionEndpoints,VersionViewEndpoints,ShareEndpoints,JobEndpoints}.cs]
- [Source: components/bff/src/Spectr.Bff/Services/{IMultipartObjectStore.cs,IFileStorage.cs,S3StorageOptions.cs}]
- [Source: components/worker/app/{tasks_dramatiq.py,object_store.py}]
- [Source: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx; src/routes/_public/{v.$token,r.$token}.tsx]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

### Completion Notes List

- **AC1/AC3** — every media route (mix, stems, als, reference, /v share, /r share + peaks, result images) now serves via `MediaDelivery.ServeAsync`: unchanged local proxy first (dev parity), else 302 → presigned GET (15 min, `Results.Redirect(permanent: false)` — never a cacheable 301). This also FIXES the 3.1 gap where S3-uploaded versions 404'd on every playback route. Auth models untouched: JWT header/`?t=` and share tokens authorize at the BFF before any redirect; presigned URLs carry no auth and expire.
- **AC2** — `_try_upload_durables` after Phase C uploads `reports/{jobId}.json` (AR20) + both result images under their EXISTING keys (so GetImage + MediaDelivery serve them unchanged in prod where worker/BFF don't share a disk). Best-effort: canonical store stays `analyses.final_json`; failures log-and-continue.
- **AC4** — `createMediaRetry` (pure, injectable clock): on media error, rebuild the API URL (fresh `?t=` on listen-rack), reload, restore position + resume on `loadedmetadata`; 5 s guard so genuine failures surface instead of looping. Wired on listen-rack (toast only when the retry is refused), `/v/{token}`, `/r/{token}`.
- GetImage's immutable Cache-Control now applies ONLY to the local-proxy branch — long-caching a 302 whose Location expires in 15 min would break playback permanently.

### File List

- `components/bff/src/Spectr.Bff/Services/MediaDelivery.cs` (new)
- `components/bff/src/Spectr.Bff/Services/IMultipartObjectStore.cs` (PresignGetUrl)
- `components/bff/src/Spectr.Bff/Services/S3StorageOptions.cs` (ReadUrlExpiryMinutes)
- `components/bff/src/Spectr.Bff/Endpoints/{VersionEndpoints,VersionViewEndpoints,ShareEndpoints,JobEndpoints}.cs` (serve tails)
- `components/bff/tests/Spectr.Bff.Tests/MediaDeliveryTests.cs` (new, 6 tests) + `UploadEndpointsTests.cs` (fake PresignGetUrl)
- `components/worker/app/object_store.py` (put_json/put_file) + `app/tasks_dramatiq.py` (_try_upload_durables)
- `components/worker/tests/test_durable_uploads.py` (new, 4 tests)
- `components/frontend-spectr-v2/src/features/listen/media-retry.ts` (new) + `__tests__/media-retry.test.ts` (new, 4 tests)
- `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx` (AC4 wire)
- `components/frontend-spectr-v2/src/routes/_public/{v.$token,r.$token}.tsx` (AC4 wire)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Outcome: **Approve with patches**; ACs 1-3 PASS, AC4 partial → closed by patches. 13 patches applied same day:

- [x] [High] Immutable-cache race in GetImage (two independent existence checks could stamp an expiring 302 — or 404 — `immutable` for a year) → header decision moved INTO MediaDelivery's single local check (`immutableCacheOnLocal`)
- [x] [High] `createMediaRetry` was non-terminating (dead resource retried forever every 5 s) + leaked its once-listener across sources (phantom seek/autoplay onto a FUTURE src) → attempts cap (3) reset on success, single pending listener, `dispose()` called from all three effect cleanups, `onResumeBlocked` for autoplay-policy rejection
- [x] [High/AC4] Listen-rack retry raced token expiry (>15 min idle = presign AND JWT both dead; rebuilt `?t=` carried the stale token) → async `getSrc` forces a silent refresh via `fetcher('/auth/me')` before rebuilding
- [x] [Med] FilesTab showed "Expired" for every S3-only file (GetFiles probed local storage only — the new download path was unreachable) → availability = local OR `GetObjectSizeAsync`
- [x] [Med] Durable report went stale on ~every job (deferred structure merge + phase re-runs rewrite final_json without re-uploading) → `put_json` refresh in `structure_actor` + `rerun_phase_actor` (best-effort)
- [x] [Med] 302 responses carried no cache directive (CDNs cache redirects; Location is a bearer-equivalent grant) → `Cache-Control: no-store` on every redirect branch
- [x] [Med] Redirected objects served `octet-stream` (attachments were PUT without Content-Type) → `ResponseHeaderOverrides.ContentType` plumbed through PresignGetUrl
- [x] [Med] FilesTab fetch used `credentials:'include'` → credentialed CORS on the S3 hop the bucket rightly refuses → dropped (Authorization is spec-stripped on the cross-origin redirect; presign needs no auth)
- [x] [Med] Content-Disposition sanitization was quote-stripping only → printable-ASCII allowlist (quotes/backslash/CR-LF/non-ASCII → `_`)
- [x] [Med] `put_json` emitted non-strict JSON (NaN/Infinity from audio metrics) → `parse_constant→null` coercion; also compact (no indent) + boto3 `Config(connect_timeout=5, read_timeout=60, retries=2)` so a hanging endpoint can't stall the concurrency-1 worker
- [x] [Low] TOCTOU between ExistsAsync and OpenReadAsync → catch IO/UnauthorizedAccess and fall through to the S3 branch
- [x] [Low] `ReadUrlExpiryMinutes ≤ 0` would mint pre-expired URLs → clamped ≥1; `PresignGetUrl` dropped its never-honored CancellationToken
- [x] [Low] Als redirect test never asserted the download name; audio test now also asserts `no-store` + ContentType override
- Deferred (logged): stem preview elements have no AC4 retry (StemDeck rebuilds URLs on ~15-min token rotation, roughly matching the presign window); per-Range presign/HEAD amplification (cache candidate, beta-scale fine); prod R2 CORS config (10.1); Postgres-gated silent test skips (project-wide convention).
- Rejected: durable report "write-only" (AR20 durability is the point; consumers land with 3.5/10.2 restore proof); guard-state reset on token-rotation effect re-runs (attempts cap bounds each instance).

### Change Log

- 2026-07-03: implemented on `storage/3-3-signed-playback`. Gates: BFF build 0-warn + 274/274 (6 new); worker 554 + 3 xfail (4 new); frontend vite build + tsc -b + lint + lint:css + vitest 669/669 (4 new); ruff clean. Status → review.
- 2026-07-03 (review): 13 code-review patches applied (see Senior Developer Review). Gates after patches: BFF 274/274, worker 554 + 3 xfail, vitest 673/673 (media-retry suite grew to 8), ruff + lint clean.
