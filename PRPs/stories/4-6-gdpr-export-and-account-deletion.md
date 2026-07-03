# Story 4.6: GDPR Export & Account Deletion

Status: review

## Story

As a user,
I want to export everything I own and delete my account completely,
So that my unreleased music and data remain under my control.

## Acceptance Criteria

1. **Given** an export request (FR27), **When** processed, **Then** I receive machine-readable JSON (account, songs, versions, reports, verdicts, conversations) plus a media manifest with signed download links.
2. **Given** account deletion, **When** I confirm, **Then** user rows, audio/stems/.als objects in R2, reports, and chat logs cascade-delete, **And** the Stripe customer is detached per policy.
3. **Given** an active subscription, **When** I attempt deletion, **Then** the flow explains that cancellation happens first and proceeds only after confirmation.
4. **Given** the deletion cascade, **When** it executes, **Then** an audit row records the action (actor = user).

## Decisions of record (recon 2026-07-03)

1. **The cascade is MANUAL and ordered** — the Initial migration created ZERO foreign keys; only post-Initial social tables cascade off users. The `user → songs → versions → {jobs, analyses, verdicts, conversations, coach_messages}` subtree needs explicit ordered deletes (the `_purge_unclaimed_anonymous` / migration-Down pattern is the template).
2. **Split: BFF = identity + audit + tokens, worker = content + objects.** The BFF cannot delete R2 objects (IMultipartObjectStore has no delete) and shouldn't block a request on N object deletes. `POST /me/delete` synchronously: re-auth (password), AC3 gate, audit row, token-version bump, refresh/auth-token revocation, user-row delete (fires the social FK cascades), enqueue `delete_account_data(userId)` on `maintenance`. The worker actor (sweep_retention template) deletes the content subtree + authored-social rows + storage objects (`_version_keys` + analysis images + `reports/{jobId}.json` + reference files), idempotent, batched.
3. **"Detached per policy" — POLICY DEFINED HERE**: Stripe-side customer/invoice records are RETAINED (NFR23 Tax; financial-records legitimate interest) — we do NOT call Customer.Delete. Locally, billing tables (`subscriptions`, `credit_ledger`, `usage_events`, `webhook_events`, `llm_calls`) are RETAINED keyed by the now-orphaned user_id (pseudonymous once the user row is gone — no PII in them; documented in the runbook). Everything content/PII deletes.
4. **AC3**: active/trialing/past_due subscription → deletion requires `confirmCancel: true` in the request; the BFF then cancels the Stripe subscription IMMEDIATELY (new `IStripeSubscriptionClient.CancelImmediatelyAsync` — cancel-at-period-end makes no sense for an account that's about to not exist; no refunds, stated in the confirm copy). Without the flag → 409 `subscription_active` envelope carrying the explanation.
5. **AC4**: minimal `audit_log` table NOW (id, actor_user_id, action, target, reason, created_at) — 4.6 is its first writer (`account_delete`, actor = user); 10.5 extends with admin actions. Audit row commits BEFORE the destructive work, in the same tx as the user delete.
6. **4.3 commitment — JWT token-versioning**: `users.token_version` (int, default 1) + `tver` claim + `OnTokenValidated` check against a 60 s IMemoryCache of the DB value (EntitlementService cache precedent; same-process bumps also evict). Bumped on password reset AND account deletion. Post-reset stale-access-token window drops from ≤15 min to ≤60 s cross-replica / instant same-process.
7. **Export = synchronous JSON download** (`GET /me/export`, 2/hour rate limit): account + songs + versions + analyses(final_json) + verdicts + conversations/messages + media manifest (storage keys + presigned GET links where S3 is configured, 15-min expiry via the existing PresignGetUrl). Beta scale fits in one response; async export = post-MVP note.
8. **Frontend**: wire the SettingsTab danger-zone placeholders — Export downloads the JSON; Delete opens a confirm dialog (password + typed DELETE), handles the 409-subscription branch with the cancel-first explanation, logs out on success.

## Tasks / Subtasks

- [x] Task 1 — `users.token_version` (default 1 — the 4.4 defaultValue lesson caught PRE-review this time: EF scaffolded 0, fixed via rollback/edit/re-apply) + `audit_log` (no FK on actor — the audited actor may be the row being deleted); migration `AddGdprPrimitives`; python token_version mirror (audit_log BFF-only, no mirror)
- [x] Task 2 — `tver` claim + `OnTokenValidated` (60 s IMemoryCache; pre-4.6 tokens without tver honored to natural expiry — one-time rollout window); bumped in ResetPassword (+cache evict) and delete; end-to-end test proves the OLD access token 401s immediately after reset while a fresh login works
- [x] Task 3 — `GET /me/export`: 6 AC1 categories + media manifest (keys + PresignGetUrl when configured; purged versions' keys excluded), 2/hour limit, `spectr-export/v1` format tag; test asserts every category + manifest
- [x] Task 4 — `POST /me/delete`: password re-auth (401), AC3 409 → `confirmCancel` → `CancelImmediatelyAsync` (new interface member, idempotent on already-canceled; fakes updated); ONE tx = audit row + token revocations + device-attribution severing + user delete (FK cascades fire); enqueue `delete_account_data`; failure of the Stripe cancel ABORTS deletion (502 — never delete an account still being billed). Tests: wrong-password, 409-then-confirm roundtrip incl. immediate-cancel recorded, audit row, refresh gone, billing rows retained, enqueue args
- [x] Task 5 — `delete_account_data` actor (maintenance, 3 retries): keys collected first (versions/stems/als/reference + analysis images + `reports/{jobId}.json`), 17 ordered DELETE statements deepest-first (version-scoped FK cascades fire from the songs/versions deletes), dialect-aware uid binding; registered + test_actor_queues (12 actors); test proves full cascade + billing retained + other users untouched + objects gone + idempotent replay
- [x] Task 6 — frontend: `DangerZone`/`DeleteAccountDialog` (password + typed DELETE, 409 cancel-first branch with escalated button copy, export blob download); placeholders replaced
- [x] Task 7 — runbook GDPR section (endpoints, retention POLICY definition, kill-all-sessions ops note). Gates: BFF 325/325 (3 new), worker 578 + 3 xfail (1 new + queue lock), vitest 677, shared 27, all linters clean

## Dev Notes

- FK reality: manual-delete list = songs, song_versions, analysis_jobs, analyses, verdicts, verdict_user_state, conversations, coach_messages, session_notes, reference_tracks/sets/members, compare_cache, refresh_tokens, auth_tokens, version_user_ratings, version_compare_notes, track_comments(author), track_bookmarks(bookmarker), devices.claimed_by_user_id (SetNull manually). FK-cascade-on-user (automatic): viz_presets, listening_sessions(host), control_grants(granted_by), notifications, follow_relations, invites(created_by). Version-scoped cascades (song_tags, rack_*, share_settings, suggestions, comments-on-own-tracks…) fire when the worker deletes song_versions rows — order: deepest first.
- Storage keys: `_version_keys()` enumerator precedent + `analyses.{spectrogram,waveform_image,waveform_peaks}_path` + `reports/{jobId}.json` + `reference_tracks.file_path`. `object_store.delete_object` (idempotent, guarded).
- JwtBearer: only OnMessageReceived hooked today; add OnTokenValidated (resolve scoped services via ctx.HttpContext.RequestServices).
- Stripe: PostCancel precedent (idempotency keys, mirror update); SubscriptionService.CancelAsync for immediate.
- Export presign: PresignGetUrl(key, downloadName?, contentType?) exists (3.3).
- Audit-before-delete ordering: audit row + user delete in ONE tx (actor row must exist even though the user row won't).

### References

- [Source: PRPs/epics.md L820-831; FR27 prd L339; NFR23; architecture.md L31/L54/L102; 10.5 L1224-1234]
- [Source: components/worker/app/retention_actor.py (_version_keys, _purge_unclaimed_anonymous); components/bff/src/Spectr.Bff/{Auth/JwtTokenService.cs,Program.cs L75-123,Endpoints/BillingEndpoints.cs PostCancel,Services/IMultipartObjectStore.cs}]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- token_version migration scaffolded defaultValue 0 (4.4 lesson applied pre-review — fixed via rollback/edit/re-apply).
- sqlite can't bind uuid.UUID in raw text() params → dialect-aware `_uid_param`.
- Mirror column-name mismatches caught pre-test (session_notes.user_id not author_user_id; track_bookmarks.user_id not bookmarker_user_id).

### Completion Notes List

- AC1: sync JSON export + signed-link manifest; async export = post-MVP note.
- AC2: BFF (identity, audit, tokens, cascades) + worker actor (content + objects); retention POLICY defined in the runbook — Stripe + local billing rows retained pseudonymously (Tax/NFR23).
- AC3: 409 explanation → confirmCancel → IMMEDIATE Stripe cancel; cancel failure aborts deletion.
- AC4: audit_log created (10.5's shape); row commits in the same tx as the user delete.
- 4.3 commitment paid: token-versioning live; old access tokens die ≤60 s cross-replica / instantly same-process, tested end-to-end.

### File List

- BFF: `Entities/{AuditLog.cs (new),User.cs}`, `AppDbContext.cs`, migration `AddGdprPrimitives`, `Auth/JwtTokenService.cs`, `Program.cs` (OnTokenValidated + mapping), `Endpoints/{AccountEndpoints.cs (new),AuthEndpoints.cs}`, `Services/{IStripeSubscriptionClient.cs,DramatiqTasks.cs}`
- Tests: `AccountGdprTests.cs` (new, 3), `TestSupport.cs` (Password const), Billing fakes (+CancelImmediatelyAsync)
- Worker: `app/account_deletion_actor.py` (new), `dramatiq_app.py`, `tests/{test_account_deletion.py (new),test_actor_queues.py}`
- Shared: `models.py` (token_version mirror)
- Frontend: `features/account/DangerZone.tsx` (new), `routes/_app/profile.tsx`
- Docs: `docs/runbook.md` (GDPR section)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter GDPR/data-integrity + Edge Case Hunter/Acceptance Auditor; auditor traced JwtBearer exception semantics, verified all 4 jwt.Issue sites carry tver, confirmed llm_calls stores metering only — no PII hole, and ran all suites live). Outcome: **Approve after patches** — 13 patches applied:

- [x] [High] **Object purge was unrecoverable**: rows (the only key manifest) deleted BEFORE objects — a storage blip left audio orphaned forever and "safe to replay" was false → objects delete FIRST; any failure raises (dramatiq max_retries becomes real) with rows intact; replay idempotent
- [x] [High] **Enqueue-after-delete dead end**: a Redis blip 500'd a user whose account was already gone, with no retry handle → try/catch + LogCritical + still 204; PLUS a self-heal: `sweep_retention` detects songs whose user row is gone and re-enqueues `delete_account_data` nightly (also covers crash windows); session teardown (cache evict + cookie) moved BEFORE the enqueue
- [x] [High] **Threaded-comment FK dead-letter**: another user's reply (parent_id NO ACTION) aborted the entire single-tx purge → replies detached (parent_id NULL) before the authored-comment delete
- [x] [High] **Right-to-access parity**: export gained referenceTracks, ratings, compareNotes, sessionNotes, comments, bookmarks, and a billing section (retained rows are still the user's data under Art. 15); manifest gained stem + reference keys; final_json embedded as REAL JSON (was double-encoded string)
- [x] [Med-High] **OnTokenValidated DB blip = full-site 500s** (exception escapes the bearer event; even anonymous endpoints carrying a token) → fail-OPEN try/catch (argued: degrades to the pre-4.6 15-min TTL status quo; fail-closed would mass-logout via refresh calls that also need the down DB; matches the 4.3 limiter direction)
- [x] [Med] Wrong-password 401 collided with the fetcher's refresh-and-RETRY contract (auto-replaying the deadliest POST) → 403 `invalid_password`; dialog branches on `ApiError.status` (the 502 stripe-failure copy contained "subscription" and the substring sniff would have coached users into hammering a failing destructive endpoint)
- [x] [Med] Stripe cancel now loops EVERY sub row with a Stripe id regardless of local status (stale mirror must never leave a live sub invoicing a deleted account; idempotent on canceled)
- [x] [Med] PII scrubs the FK graph can't do: `invites.invited_email` (the user's email in others' rows), `control_grants.grantee_display_name`, and claimed devices' ip/ua hashes — all cleared in the delete tx; email_suppressions retention declared in the runbook
- [x] [Med] `/me/delete` rate-limited 5/15 min (password oracle for an access-token thief)
- [x] [Low] Deleted-user access token 401 asserted in the delete test; overlay click disabled while pending; `ix_audit_log_actor_created`; export/manifest gaps closed above
- Deferred: async export for heavy users (sync fits beta; size noted); `SkippableFact` semantics (project-wide convention); missing-tver bypass sunset (tracked for 10.x — flip to fail-closed once pre-4.6 tokens age out); audit_log DB-level append-only enforcement (10.5's story).
- Verified-clean: tver on all 4 issue paths (refresh mints fresh versions); deletion's row-gone ≡ version-bump (equivalent semantics, noted); devices/claim interaction gap-free; llm_calls PII-free (metering only); enqueue-AFTER-commit direction correct (before-commit could purge a live account on rollback).

### Change Log

- 2026-07-03: implemented on `account/4-6-gdpr`. Gates: BFF 325/325, worker 578 + 3 xfail, vitest 677, shared 27, all linters clean. Status → review.
- 2026-07-03 (review): 13 patches applied. Gates after: BFF 325/325, worker 579 + 3 xfail, vitest 677, all linters clean.
