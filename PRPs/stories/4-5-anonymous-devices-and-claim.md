# Story 4.5: Anonymous Devices & Claim

Status: review

## Story

As an anonymous visitor,
I want my free analysis tied to my browser and claimable at registration,
So that trying the product costs nothing and signing up loses nothing.

## Acceptance Criteria

1. **Given** a first anonymous analysis, **When** it starts, **Then** a `devices` row (ULID, ip_hash, ua_hash) is created and a signed httpOnly `spectr_device` cookie is set (AR24).
2. **Given** anonymous jobs/reports/conversations, **When** persisted, **Then** they own `device_id` XOR `user_id`, enforced by a DB CHECK (AR24).
3. **Given** registration with a device cookie present, **When** the account is created, **Then** that device's jobs, reports, and conversations re-parent to the user in one transaction and the device marks claimed — the analysis is never lost (FR28, AR25).
4. **Given** anonymous rate limits (AR26, NFR8), **When** `/uploads/init` is called, **Then** per-device AND per-IP token buckets apply, one active analysis per device is enforced, and anonymous artifacts follow 72 h retention.
5. **Given** the second-analysis gate (AR26), **When** an unverified registered user starts another analysis, **Then** email verification is required — report viewing is never gated.

## Decisions of record (recon 2026-07-03)

1. **Scope = backend foundation ONLY.** The anon upload UI, `/analyze` route, BlurLocked report, and the anon job-creation vertical are Story 6.3's (epics L304/L406/L996-1009: "Epic 6 depends on Epic 4 (devices/claim/verification)"). 4.5 ships what 6.3 consumes: `DeviceService`, schema + XOR CHECKs, claim-on-register, rate-limit wiring, retention purge, verify gate. AC1's cookie-on-first-analysis fires when 6.3 calls `DeviceService.GetOrCreateAsync` — the service + cookie mechanics land and are tested here.
2. **`spectr_device` ≠ `spectr_anon`.** The existing stateless reviewer identity (AnonIdentity.cs, HMAC-SHA256 `{id}.{hexsig}` cookie) stays untouched; the device cookie REUSES its signing scheme and `Anon:SigningKey` but is a separate stateful mechanism (durable row, claimable).
3. **ULID without a new dependency**: 20-line `UlidGen` helper (Crockford base32, 48-bit timestamp + 80-bit CSPRNG) — the BFF only generates, never parses; no C# ULID precedent exists and a NuGet for one id field is overkill. `devices.id` = char(26).
4. **Schema**: `devices` (id ULID PK, ip_hash char(64), ua_hash char(64), claimed_by_user_id Guid?, claimed_at, created_at) + `device_id` (char(26) null) on `analysis_jobs`/`analyses`/`conversations` with `user_id` relaxed to nullable + raw-SQL CHECK exactly-one (the ck_track_* pattern). Songs deliberately NOT device-owned (spec names only jobs/reports/chats; 6.3's anon vertical will use ad-hoc song-less analyses — `analyses.song_id` already nullable for exactly this).
5. **Hashes**: `ip_hash`/`ua_hash` = SHA-256 hex of value + `Anon:SigningKey` as pepper (raw IP/UA never stored — abuse correlation without PII).
6. **Claim** (AC3): inside `Register`, ONE transaction wraps user insert + `ExecuteUpdate` re-parent of the 3 tables (`user_id = new, device_id = NULL WHERE device_id = X`) + `devices.claimed_*` stamp; cookie cleared after commit. Unclaimed-invalid/absent cookie = plain registration (no failure path — claim is best-effort by design, FR28's "never lost" applies when the cookie exists).
7. **AC5 verify gate** in `DispatchAnalysisAsync`: free-tier user with `EmailVerifiedAt == null` AND ≥1 prior analysis job → 403 `email_verification_required` envelope. Pro/credits exempt (they proved a mailbox via Stripe receipts; AR26 targets the free funnel). Report viewing untouched (read paths never check).
8. **AC4**: `/uploads/init` gets `CheckAsync` (per-user actor + IP arms, 10/min) now; the per-DEVICE arm activates when 6.3's anon path calls with `device:{id}` — the limiter API already takes both arms in one call. One-active-per-device enforced in `DeviceService.HasActiveAnalysisAsync` (pending/processing/awaiting_stem_mapping by device_id) for 6.3 + tested. 72 h retention = worker `_purge_unclaimed_anonymous` real implementation: devices `claimed_at IS NULL AND created_at < now-RETENTION_ANON_HOURS` → delete their jobs/analyses/conversations rows + the device rows (NFR20 does NOT protect anon rows — unclaimed means no owner to keep reports for; storage-object deletion noted for 6.3 when the anon key convention lands).
9. **Python mirrors**: `Device` model + `device_id`/nullable `user_id` on the 3 mirrored models.

## Tasks / Subtasks

- [x] Task 1 — schema: `Device` entity + `UlidGen` (26-char Crockford, 48-bit ts + 80-bit CSPRNG, no new dep) + migration `AddDevicesAndDeviceOwnership` (device_id ×3, user_id → nullable ×3, raw-SQL XOR CHECKs `ck_*_owner_xor` + partial device_id indexes); python mirrors (Device + 3 models). EF `Guid?` ripple compiled clean repo-wide
- [x] Task 2 — `DeviceService`: HMAC cookie (AnonIdentity scheme, Anon:SigningKey, constant-time verify, 26-char id shape check), `GetOrCreateAsync` (claimed rows never re-accumulate anon children — fresh identity minted), peppered ip/ua hashes, `HasActiveAnalysisAsync`, `ClearCookie`. Unit tests: ULID shape/sortability, sign/verify matrix
- [x] Task 3 — claim-on-register: ONE transaction wraps user insert + `ExecuteUpdate` re-parent ×3 + claimed stamp (guarded `ClaimedAt == null` — a claimed device is not re-claimable, tested); cookie cleared post-commit; absent/invalid cookie = plain registration. Full roundtrip test incl. second-register-same-cookie no-op
- [x] Task 4 — AC5 verify gate in `DispatchAnalysisAsync` (free tier + unverified + ≥1 prior job → 403 `email_verification_required`; pro/credits exempt; read paths untouched) + test (403 → verify → passes); `/uploads/init` rate limit (10/min actor+IP arms, fail-open, RateLimits:Enabled knob)
- [x] Task 5 — worker purge: `_purge_unclaimed_anonymous` real — devices unclaimed > RETENTION_ANON_HOURS delete WITH jobs/analyses/conversations/coach_messages/verdicts (verdicts have no DB FK — explicit); own session, absent-table tolerant; test proves stale-purged/claimed-survives/fresh-survives + all child tables empty
- [x] Task 6 — gates: BFF 321/321 (5 new), worker 577 + 3 xfail (1 new), shared 27, ruff clean; frontend untouched (Epic 6.3 owns the anon UI)

## Dev Notes

- AnonIdentity.Sign/Verify (HMAC-SHA256, FixedTimeEquals) — copy for device cookie; key = Anon:SigningKey (boot-validated 4.1).
- XOR CHECK SQL: `(user_id IS NOT NULL AND device_id IS NULL) OR (user_id IS NULL AND device_id IS NOT NULL)` — append raw in migration (EF can't express partial/complex CHECK cleanly with the citext columns present; ck_track_* precedent).
- EF ripple: `AnalysisJob.UserId`/`Analysis.UserId`/`Conversation.UserId` → `Guid?`. Existing queries compare `j.UserId == userId` (Guid? == Guid compiles). Watch: `JobEndpoints` owner checks, `CoachConversationEndpoints` get-or-create, EntitlementService reference-exclusion `j.Id.ToString()` query, LifecycleEmailScheduler join (`join u on job.UserId equals u.Id` — Guid? vs Guid join needs `job.UserId == u.Id` where-style or cast).
- Register tx: currently single SaveChanges; wrap user-insert + claim in `db.Database.BeginTransactionAsync` (4.3's ResetPassword precedent).
- Worker purge runs in own sessions (3.4 pattern); RETENTION_ANON_HOURS env read; sqlite tests need devices DDL (not in Base? Device WILL be in Base via mirror → create_all covers).
- test_actor_queues untouched (no new actor).

### References

- [Source: PRPs/epics.md L806-818; AR24 L202; AR25 L203; AR26 L204; architecture.md D5 L110-112, L287]
- [Source: components/bff/src/Spectr.Bff/Services/{AnonIdentity,IRateLimiter}.cs; Endpoints/{AuthEndpoints,UploadEndpoints,VersionEndpoints}.cs; components/worker/app/retention_actor.py]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- None — clean run (nullable-Guid ripple compiled without a single call-site change; runtime anon paths don't exist until 6.3).

### Completion Notes List

- Scope held to backend foundation (decision 1): 6.3 consumes DeviceService.GetOrCreateAsync (AC1's cookie fires there), the per-device limiter arm, HasActiveAnalysisAsync, and the ad-hoc song-less analysis path.
- AC2 CHECK proven by tests inserting both-null and both-set rows.
- AC3: claim is transactional + idempotent (claimed devices are inert); FR28's "never lost" holds whenever the cookie exists.
- AC4: 72 h purge live in the sweep (anon rows are NOT NFR20-protected — unclaimed means no owner; documented); storage-object deletion deferred to 6.3 with the anon key convention (no anon keys exist yet).
- AC5: second-analysis verify gate live for the free tier.

### File List

- BFF: `Entities/{Device.cs (new),AnalysisJob.cs,Analysis.cs,Conversation.cs}`, `AppDbContext.cs`, migration `AddDevicesAndDeviceOwnership` (+CHECKs/indexes), `Services/{UlidGen.cs (new),DeviceService.cs (new)}`, `Endpoints/{AuthEndpoints.cs (claim),VersionEndpoints.cs (verify gate),UploadEndpoints.cs (rate limit)}`, `Program.cs`
- Tests: `DeviceClaimTests.cs` (new, 5)
- Shared: `models.py` (Device + device_id/nullable user_id ×3)
- Worker: `retention_actor.py` (anon purge), `tests/test_retention_sweep.py` (+1)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter data-integrity + Edge Case Hunter/Acceptance Auditor; ULID bit-packing hand-traced clean, ExecuteUpdate-tx-enlistment and claim-race verified clean, every nullable-UserId use-site audited clean). Outcome: **Approve after patches** — the primitives were sound, the transactional choreography had real holes. 12 patches applied:

- [x] [High] **Claim could abort registration**: `uq_conversations_analysis_user` treats NULL users as distinct, so a device with two conversations on one analysis would collide on re-parent and roll back the USER INSERT → registration restructured: user commits first; the claim is its own AR25-single transaction with catch-log (a failed claim leaves the device claimable, never a lost account); new partial-unique `ux_conversations_analysis_device` closes the duplicate source
- [x] [High] **Purge deleted in-flight work**: 72 h sweep keyed on created_at only — a device mid-analysis lost its pending/processing job rows → active-job `NOT EXISTS` exclusion
- [x] [High] **Claim↔purge deadlock + claimed-mid-sweep strand**: purge locked tables in the exact reverse order of the claim tx, and the device DELETE didn't re-check claimed_at → purge now locks device rows FIRST with `FOR UPDATE SKIP LOCKED` (a device mid-claim is simply not this sweep's business; PG-only, dialect-guarded), children delete in claim order, device delete re-checks `claimed_at IS NULL`, batches of 500 (bind-param limit), failures log WARNING (not info — a recurring failure silently breaks the retention promise)
- [x] [High] **The 6.3 XOR landmine defused NOW**: the worker's Analysis insert didn't propagate `device_id` — the first real anon job would have completed its pipeline then died on `ck_analyses_owner_xor` → Phase A captures `job.device_id`, Phase C propagates it when user_id is null; structure follow-up skipped for anon jobs (its progress-vehicle is user-owned by shape; 6.3 revisits)
- [x] [Med] Verify gate no longer counts FAILED jobs (a user whose one free analysis died on infra error can retry unverified). Registering-to-claim counting as the first analysis = intended AR26 semantics, now stated
- [x] [Med] Claim fingerprint telemetry: ip_hash mismatch at claim time logs a warning (never gates — mobile/CGNAT churn would break FR28; the stored hashes finally have a reader)
- [x] [Low] Invalid/garbage device cookie now cleared on register regardless of verification; cookie-clear test asserts the DELETION shape (empty value), not just `expires=`; migration `Down()` deletes device-owned rows before the NOT NULL restore (the zero-GUID backfill was a rollback landmine); `ix_devices_unclaimed_created` partial index (the sweep's only query shape); GetOrCreate branch test added (fresh/valid-unclaimed/claimed/purged — caught an identity-map staleness bug: the claimed check now reads AsNoTracking)
- Verified-clean (no change): UlidGen base32 math + sortability; ExecuteUpdate enlists in the ambient tx; concurrent-claim race (ClaimedAt-null gate, loser registers cleanly); all 8 nullable-UserId BFF use-sites + credit-reversal path (uses the authed principal, not job.UserId); verify-gate choke-point coverage (all 7 dispatch sites route through DispatchAnalysisAsync; rerun/reference/structure correctly excluded).
- Deferred to 6.3 (breadcrumbs recorded): device-creation rate limit at the GetOrCreate call site; anon storage-key deletion in the purge; claim-on-LOGIN (product decision — today only registration claims); worker sites safe-with-None audited (coach/triage/identifiers tolerate; only the two patched sites broke).
- Accepted + documented: cookie theft/fixation = LOW (httpOnly+Secure+Lax; prize is one ≤72 h anon analysis, no PII; ip-binding too brittle — telemetry instead); verify-gate TOCTOU (two concurrent first dispatches — advisory gate); duplicate device rows under concurrent first requests (purged at 72 h).

### Change Log

- 2026-07-03: implemented on `account/4-5-devices-claim`. Gates: BFF 321/321, worker 577 + 3 xfail, shared 27, ruff clean. Status → review.
- 2026-07-03 (review): 12 patches applied (migration amended via rollback/re-apply — dev DB only). Gates after: BFF 322/322 (6 device tests), worker 577 + 3 xfail, ruff clean.
