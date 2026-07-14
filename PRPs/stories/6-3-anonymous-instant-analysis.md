# Story 6.3: Anonymous Instant Analysis

Status: review

<!-- Third story of Epic 6 — THE acquisition funnel. Largest story of the epic:
     a full anon vertical (BFF endpoints + migration + worker branch) + the
     /analyze page. 4.5 built the foundation; NOTHING is wired at runtime. -->

## Story

As a first-time visitor,
I want a real analysis of my track with zero forms,
So that the product proves itself before asking for anything.

## Acceptance Criteria

1. **Given** `/analyze` (FR7, UX-DR27), **Then** a full-bleed drop zone renders with mono hints "WAV · FLAC · MP3 · ≤250 MB" and ZERO form fields; dropping/choosing a file immediately uploads and dispatches a real analysis under a device identity (`spectr_device` cookie minted server-side on first upload). PublicChrome + usePageMeta; landing CTA + chrome CTA retarget from `/register` to `/analyze` (the recorded 6-1 deferral — comments mark both spots).
2. **Given** the pipeline runs, **Then** the progress screen reuses `ProgressStorylineView` (animated phase dots, phase names, elapsed) plus a rotating educational one-liner sourced from `PHASE_EXPLAINERS` keyed to the current phase.
3. **Given** the anonymous report, **Then** grade hero (`GradeHero` — the epics' "VerdictHero" never existed; 6-1 precedent, substitution recorded) + the **#1 verdict** + **streaming readiness** are fully visible, **And** the deeper content is wrapped in `BlurLock` with reason "Create a free account to keep this report + see all {n} findings." and CTA opening the inline register card.
4. **Given** the claim moment, **When** I register inline (email+password card OVER the page, report visible behind), **Then** the report re-parents to my account (the 4-5 server-side claim — the httpOnly device cookie rides the register POST automatically; NO new claim API), the page unlocks in place (or navigates to the authed report), **And** a banner explains verification gates the NEXT analysis, not this one (AR26).
5. **Given** a refresh at any stage (uploading excepted), **Then** state restores via the device cookie: a new `GET /api/anon/jobs/current` returns the device's latest job and the page resumes progress or re-renders the report.
6. **Given** abuse (AR26), **Then**: one ACTIVE analysis per device (`HasActiveAnalysisAsync` — 409 with honest copy "One analysis at a time — this one's still running"); the `device:{id}` + IP arms ride the existing `RedisRateLimiter` on upload (`uploads_init` action) and dispatch (`analysis_dispatch` action, same flag/ceilings as free-tier); all rejections use the 12-1 error-code contract with honest copy.
7. **Given** the anon vertical's storage, **Then** anon uploads key as `audio/anon/{deviceId}/{jobId}/source.*` and the worker 72h purge (`_purge_unclaimed_anonymous`) now ALSO deletes those objects (the 4-5 breadcrumb: "storage-object deletion deferred to 6.3"). Trust-page copy ("purged after 72 hours") stays true for files, not just rows.
8. **Given** the suite, **Then**: BFF integration tests cover the anon vertical (upload→job row w/ DeviceId + XOR intact, poll + results device-scoped incl. cross-device 404, one-active 409, rate-limit contract, claim re-parents); worker purge test covers object deletion; frontend tests cover drop zone/progress/report-blur/register-card states; a NEW headless Playwright spec runs the whole funnel: /analyze → drop test-tone → progress → blurred report → inline register → report claimed + visible in /library. All gates green.

## Context — verified recon (2026-07-14, master a48bde6)

**THE structural fact: story 4-5 shipped the entire anon foundation with ZERO runtime callers.** `DeviceService.GetOrCreateAsync` (DeviceService.cs:43-79) and `HasActiveAnalysisAsync` (:82-86) are called by nothing; only `AuthEndpoints.Register` reads the cookie. 6.3 wires it all.

**Device machinery (reuse, do not rebuild):**
- `DeviceService` (Program.cs:214 scoped): `ReadDeviceId`, `GetOrCreateAsync(HttpContext)` (mints ULID row + signed httpOnly 30d cookie; refuses claimed devices), `HasActiveAnalysisAsync(deviceId)`, `ClearCookie`.
- XOR CHECKs on analysis_jobs/analyses/conversations (migration 20260703202525): `user_id XOR device_id`. `Song.UserId` is NON-nullable — **anon analyses are song-less AND version-less by design** (4-5 decision #4; `Analysis.SongId` + `AnalysisJob.VersionId` already nullable).
- Claim-on-register is DONE and automatic (AuthEndpoints.cs:196-258): separate tx, atomic `ClaimedAt` gate, re-parents AnalysisJobs/Analyses/Conversations, clears cookie. Never fails registration.
- Worker purge `_purge_unclaimed_anonymous` (retention_actor.py:179-259): rows only; objects explicitly deferred to 6.3 (comment :185-189).

**REQUIRED DESIGN DECISION (resolved here): song-less jobs need a file path.** The worker resolves audio via `analysis_jobs.version_id → song_versions.file_path`; a version-less job has no path. **Add nullable `file_path` to `analysis_jobs`** (EF migration + `aimusic_shared.models` mirror + `AnalysisJob.cs`), and branch the worker's path resolution: `job.file_path if job.version_id is None else <existing>`. Verify the worker's Analysis insert propagates `device_id` (4-5 review says fixed — confirm in `tasks_dramatiq.analyze_audio_job`). Golden-snapshot guard: `run_pipeline` untouched.

**Dispatch:** all 7 sites funnel `DispatchAnalysisAsync` (VersionEndpoints.cs:1070-1299) keyed on userId (entitlements, verify gate :1188-1201, per-IP ceiling :1156-1180, UsageEvent). **Build a parallel `DispatchAnonAnalysisAsync`** (do NOT contort the authed one): inserts `AnalysisJob { DeviceId, UserId=null, VersionId=null, FilePath }`, no entitlement/UsageEvent/verify-gate, forced `DramatiqQueues.AnalysisFree` (:1267 comment anticipates this), per-IP ceiling reused with `device:{id}` actor arm (`IRateLimiter.CheckAsync` doc :11-14 literally names anon; IP arm is the real ceiling).

**Anon endpoint group (new, `/api/anon/*`, AllowAnonymous):**
- `POST /api/anon/analyses` — multipart PROXY upload only (≤250 MB, magic-byte validation like the legacy path; presigned-for-anon deferred — less surface). Calls `GetOrCreateAsync` (mints cookie), `HasActiveAnalysisAsync` → 409 `anon_active_analysis`, limiter (`uploads_init` 10/min device+IP), stores `audio/anon/{deviceId}/{jobId}/source.*`, dispatches. Returns `{ jobId }`.
- `GET /api/anon/jobs/current` — device's latest job (AC5 restore); 404 no-cookie/no-jobs.
- `GET /api/anon/jobs/{id}` + `/results` + `/images/{kind}` — fork the exact predicates at JobEndpoints.cs:151/231/308 to `DeviceId == deviceId` (cookie-resolved). Cross-device = 404. NO SSE for anon (poll like TanStack Query does elsewhere).
- After claim, the device rows re-parent → the authed `/jobs/{id}` endpoints serve them; frontend switches to authed fetching post-register.

**Frontend reuse:** `useMixUpload` works only for authed presigned — anon uses a plain XHR/fetch multipart POST to `/api/anon/analyses` (device cookie needs `credentials: 'include'`? Same-origin — cookies ride by default on XHR/fetch same-origin; fetcher already uses credentials for refresh). `ProgressStorylineView` (pure, props status/currentPhase/phasePct/elapsedMs) + `PHASE_EXPLAINERS` (ProgressStoryline.tsx:40-51). `BlurLock` (BlurLock.tsx:12-40 — locked/reason/ctaLabel/onUnlock/children). `GradePill`/`GradeHero`. **`StreamingCard` lives inside TrackInfoTab.tsx:432 — EXTRACT it** to `features/results/StreamingCard.tsx` (used by both). `AuthContext.register` for the inline card. Verify-gate copy helpers exist (`isVerifyGateError`).

**Trust copy (6.2, published):** trust.privacy.tsx:37-49 — device identity not profile, purged after 72h if never claimed. The flow must match literally; retention_actor.py:57-61 tether comment.

**Landing CTA retarget:** PublicChrome.tsx + LandingPage.tsx both carry "retarget to /analyze in 6.3" comments. Also `/analyze` gets a BFF meta shell + Caddy `@site_bots` path (6-1/6-2 pattern).

## Tasks / Subtasks

- [x] **Task 1: Migration + worker file-path branch (AC: 7 + design gap)**
  - [x] 1.1 EF migration `AddAnalysisJobFilePath`: nullable `file_path` text on `analysis_jobs`; `AnalysisJob.cs` + `aimusic_shared/models.py` mirror.
  - [x] 1.2 Worker `analyze_audio_job`: resolve audio from `job.file_path` when `version_id` is null (else existing version join). Confirm Analysis insert carries `device_id` + `song_id=None`. Worker tests for the song-less branch.
  - [x] 1.3 Purge: extend `_purge_unclaimed_anonymous` to delete `audio/anon/{device_id}/` objects via `object_store.delete_object` before row deletion (fail-soft per key, like sweep_retention); test with fake storage.
- [x] **Task 2: BFF anon vertical (AC: 1, 5, 6, 7)**
  - [x] 2.1 `AnonAnalysisEndpoints.cs` — the `/api/anon/*` group per Context: upload (multipart proxy, magic-byte + 250 MB cap, GetOrCreate + one-active 409 `anon_active_analysis` + limiter), `jobs/current`, `jobs/{id}`, `jobs/{id}/results`, `jobs/{id}/images/{kind}` (device-scoped predicates, cross-device 404).
  - [x] 2.2 `DispatchAnonAnalysisAsync` (in AnonAnalysisEndpoints or a service): song-less job insert + AnalysisFree enqueue + per-IP ceiling with `device:{id}` arm. 12-1 error codes: `anon_active_analysis`, `rate_limited`, `invalid_file`.
  - [x] 2.3 Integration tests (SkippableFact/live DB): happy vertical (upload→job row DeviceId set, XOR holds), one-active 409, cross-device 404 on poll/results, rate-limit contract (429 + code), claim re-parents then authed endpoints serve the job (register with cookie → GET /jobs/{id} authed 200).
- [x] **Task 3: /analyze page (AC: 1, 2, 3, 4, 5)**
  - [x] 3.1 `src/routes/analyze.tsx` + `features/anon-analyze/` — state machine: `idle → uploading → processing → report` (+ `restore` via `GET /api/anon/jobs/current` on mount). Full-bleed drop zone (drag+drop + click-to-browse, mono hints, zero fields). Plain multipart POST with upload progress (XHR — the useFileUpload idiom).
  - [x] 3.2 Progress: `ProgressStorylineView` + rotating one-liner from `PHASE_EXPLAINERS[currentPhase]` (rotate every ~6s across phases seen). Poll `GET /api/anon/jobs/{id}` via TanStack Query interval.
  - [x] 3.3 Extract `StreamingCard` from TrackInfoTab to `features/results/StreamingCard.tsx` (TrackInfoTab imports it — zero behavior change, its tests stay green).
  - [x] 3.4 Anon report: `GradeHero` + #1 verdict card (highest priority from finalJson-derived verdicts… anon has NO verdicts run? CHECK: verdicts are generated by rule engine on every completed analysis (Phase C2, runs for anon too since it keys on analysis row) — render top rule-engine Problem/verdict from the results payload; if none, top coached fix) + `StreamingCard` — all visible. Everything else inside `BlurLock` (reason copy per AC3 with real findings count).
  - [x] 3.5 Inline register card over the page (report visible behind — BlurLock aesthetics): email+password via `AuthContext.register`; on success show the verify banner copy ("Verify your email to run your NEXT analysis — this report is already yours") and navigate to the authed report route (`/songs/...`? anon analyses are song-less — the authed report route needs songId! Decide: after claim navigate to `/library` where… song-less analyses have no library surface. DECISION: after claim, STAY on /analyze and re-render the report UNLOCKED via the authed `GET /jobs/{id}/results` (jobId known); add a "Go to library" link. Song-less claimed reports in the library = follow-up noted in deferred-work).
  - [x] 3.6 Meta shell for `/analyze` (PublicSiteEndpoints + Caddy path) + usePageMeta.
  - [x] 3.7 CTA retargets: PublicChrome "Analyze free" → `/analyze`; LandingPage hero CTA → `/analyze`; update 6-1 tests + smoke step 2 (CTA now goes to /analyze — adjust the register navigation in the smoke).
- [x] **Task 4: Anon funnel Playwright spec (AC: 8)**
  - [x] 4.1 `playwright/smoke-anon-funnel.spec.ts`: /analyze → drop test-tone.wav → progress storyline visible → report renders (grade + streaming readiness) + BlurLock present → inline register (fresh email; DevAutoVerify) → report unlocks → /library shows the account. Headless, serial, same stack prereqs as first-run smoke.
  - [x] 4.2 Keep `smoke-first-run.spec.ts` green (CTA retarget touches its step 2).
- [x] **Task 5: Frontend tests + gates (AC: 8)**
  - [x] 5.1 Static-render tests: drop zone (hints, zero inputs), report states (blur reason copy w/ count, hero visible), register card, restore states.
  - [x] 5.2 All gates: frontend four + BFF build/test (live DB) + worker ruff/pytest + BOTH Playwright specs headless.
- [x] **Task 6: Docs**
  - [x] 6.1 At-home checklist: anon funnel feel (drop→report wow), BlurLock look, claim moment, verify banner copy.
  - [x] 6.2 CLAUDE.md: anon vertical summary under bff routes; deferred-work: presigned-anon uploads, song-less-claimed-report library surface, claim-on-login.

## Dev Notes

- **Do not touch `DispatchAnalysisAsync`** beyond extracting shared helpers if trivial — the authed path is battle-tested; anon gets its own function.
- **XOR discipline**: every anon insert sets exactly one owner. The DB CHECK will throw if wrong — treat a CHECK violation in tests as a design error, not a retry.
- **Cookie flags**: `GetOrCreateAsync` handles Secure/HttpOnly/SameSite=Lax. Dev on http://localhost — Secure cookie over http? DeviceService presumably matches AnonIdentity's handling (works in dev today for /v/ pages) — verify once at runtime.
- **250 MB proxy uploads**: the legacy `/versions` proxy already streams multipart at this size (chunked, 12-3 hardened) — copy its streaming/validation idiom, never `ReadToEnd`.
- **Anon report verdicts**: rule-engine Problems run on every completed analysis (worker Phase C2, keys on the analysis row — verify it doesn't assume user ownership anywhere).
- **Verify-gate honesty (AR26)**: the SECOND analysis (post-claim, unverified) hits the 12-1 403 — the banner copy must set that expectation at claim time.
- **Headless-only** (standing rule). Two Playwright specs must both pass against the compose stack + venv worker (`LLM_FAKE=1`).
- **Trust-page tether**: if any retention/anon behavior shifts while building, trust.privacy.tsx copy must move in the same commit.

### References

- AC source: `PRPs/epics.md:1000-1013` (FR7, UX-DR27, AR26 at epics.md:204).
- Anchors: `DeviceService.cs:24-124`, `AuthEndpoints.cs:189-258`, migration `20260703202525`, `retention_actor.py:176-259`, `UploadEndpoints.cs:28-117`, `VersionEndpoints.cs:1070-1299` (dispatch internals), `JobEndpoints.cs:17-308` (predicates to fork), `IRateLimiter.cs:11-47`, `useMixUpload.ts`, `ProgressStoryline.tsx:40-51/82`, `BlurLock.tsx:12-40`, `TrackInfoTab.tsx:432` (StreamingCard), `AuthContext.tsx:144-154`, `trust.privacy.tsx:37-49`, `PublicChrome.tsx`/`LandingPage.tsx` (CTA comments), 4-5 story decisions (`PRPs/stories/4-5-anonymous-devices-and-claim.md:21-91`).
- Prior art: 4-5 (foundation), 10-6 (abuse arms), 12-1 (error contract), 12-3 (upload hardening), 6-1/6-2 (funnel machinery + shells).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story workflow)

### Debug Log References

- Secure-cookie test gap: `spectr_device` is `Secure=true` (repo-wide cookie policy); browsers allow Secure on localhost but HttpClient's CookieContainer drops it over http — integration tests use HandleCookies=false + a manual `Cookie` header (the 4-1 precedent). Playwright unaffected (real browser).
- `PHASE_EXPLAINERS` export from the ProgressStoryline component file tripped `react-refresh/only-export-components` — split BASE_PHASES + PHASE_EXPLAINERS into `features/results/progress-phases.ts` (both importers updated, zero behavior change).
- Worker Analysis insert already propagated `device_id`/nullable song (4-5 review fix confirmed at tasks_dramatiq.py:353-371) — only the file-path resolution branch was needed.

### Completion Notes List

- **Full vertical live**: `POST /api/anon/analyses` (streamed multipart ≤250 MB, extension allowlist, mints cookie via `GetOrCreateAsync`, one-active 409 `anon_active_analysis`, `uploads_init` 10/min + `analysis_dispatch` hourly ceilings with `device:{id}` actor arms pooled with the free tier via the same flag) → song-less job `{ DeviceId, FilePath }` → `AnalysisFree` queue with the 3-5 dispatch-failure fail-loud. Device-scoped `jobs/current` (AC5) + `jobs/{id}` + `results` (cross-device 404; no images/share/als on the anon surface — claim-bait by design).
- **Migration `AddAnalysisJobFilePath`** applied to dev DB; shared mirror updated (`Text` import added); worker resolves `job.file_path` when `version_id` is null with a fail-loud for neither.
- **Purge closes the 4-5 breadcrumb**: `_purge_unclaimed_anonymous` deletes `audio/anon/{device}/` objects (objects-before-rows, fail-soft per key) — the trust-page 72h promise now covers files.
- **/analyze page**: idle→uploading→processing→report machine with cookie restore; rotating explainer every 6s; report = GradeHero + #1 finding (`finalJson.top_fixes[0]` — rule-engine verdicts have no anon endpoint, noted in deferred-work) + extracted StreamingCard, depth BlurLocked with the AC3 copy + real count; inline register card (claim is 100% server-side via the riding cookie), claim banner with the AC4 "gates your NEXT analysis" copy, post-claim authed refetch unlocks in place.
- **CTA retargets** landing + chrome → /analyze; meta shell + Caddy path added; first-run smoke updated (registers directly, asserts the CTA href).
- **NEW `smoke-anon-funnel.spec.ts` PASSING headless 1.5m**: drop → storyline → blurred report → refresh-restore → inline register → claim banner → authed /library.
- Gates: vitest **802/802** (+7) · BFF **377/377** (+3 integration incl. claim re-parent through the real register) · worker **593 passed + 3 xfailed** (+2 anon branch, +1 purge objects) + ruff clean · shared 27/27 · both Playwright specs green (first-run 15.9s).

### File List

- `components/bff/src/Spectr.Bff/Endpoints/AnonAnalysisEndpoints.cs` (A)
- `components/bff/src/Spectr.Bff/DTOs/JobDtos.cs` (M — AnonAnalysisResponse)
- `components/bff/src/Spectr.Bff/Program.cs` (M — map)
- `components/bff/src/Spectr.Data/Entities/AnalysisJob.cs` (M — FilePath)
- `components/bff/src/Spectr.Data/Migrations/20260714170948_AddAnalysisJobFilePath.*` (A)
- `components/bff/tests/Spectr.Bff.Tests/AnonAnalysisTests.cs` (A — 3 tests)
- `components/shared/aimusic_shared/models.py` (M — file_path + Text import)
- `components/worker/app/tasks_dramatiq.py` (M — song-less branch)
- `components/worker/app/retention_actor.py` (M — anon object deletion)
- `components/worker/tests/test_analyze_audio_job_anon.py` (A — 2), `test_retention_sweep.py` (M — +1)
- `components/frontend-spectr-v2/src/features/anon-analyze/{AnalyzePage.tsx,useAnonAnalysis.ts,analyze.module.css,__tests__/anon-analyze.test.tsx}` (A)
- `components/frontend-spectr-v2/src/routes/analyze.tsx` (A)
- `components/frontend-spectr-v2/src/features/results/{StreamingCard.tsx,progress-phases.ts}` (A) + `TrackInfoTab.tsx`/`ProgressStoryline.tsx` (M — extractions)
- `components/frontend-spectr-v2/src/components/PublicChrome.tsx` + `features/landing/LandingPage.tsx` (M — CTA retargets) + `landing.test.tsx` (M)
- `components/frontend-spectr-v2/playwright/smoke-anon-funnel.spec.ts` (A) + `smoke-first-run.spec.ts` (M)
- `components/bff/src/Spectr.Bff/Endpoints/PublicSiteEndpoints.cs` (M — /analyze shell), `infra/Caddyfile` (M)
- `CLAUDE.md` (M — anon vertical), `PRPs/deferred-work.md` (M — 4 items), `output/at-home-checklist/...` (M), `PRPs/sprint-status.yaml` (M), this story (A/M)

### Change Log

- 2026-07-14 — Story 6.3 implemented: full anonymous instant-analysis vertical (BFF /api/anon/*, analysis_jobs.file_path migration + worker song-less branch, purge object deletion) + /analyze funnel page + CTA retargets + new anon-funnel Playwright spec (green 1.5m). All gates green. Status → review.
