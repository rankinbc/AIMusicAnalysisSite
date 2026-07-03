# Story 3.4: Retention Sweep

Status: review

## Story

As the operator,
I want retention policy enforced by an authoritative nightly job,
So that storage costs stay bounded while reports survive forever.

## Acceptance Criteria

1. **Given** the `sweep_retention` actor on the `maintenance` queue (AR22), **When** it runs nightly, **Then** free-tier raw audio older than 30 days purges and lapsed-paid raw audio older than 90 days post-lapse purges, **And** reports/verdicts/chats are NEVER deleted (test asserts NFR20).
2. **Given** an approaching lapsed-paid purge, **When** notice is due, **Then** a retention-warning email enqueues via `IEmailSender` (logs until Epic 4 wires Resend).
3. **Given** anonymous-owned rows, **When** unclaimed for >72 h, **Then** the sweep purges them — the guard no-ops safely before Epic 4 introduces devices.
4. **Given** R2 lifecycle rules on `audio/` prefixes, **When** configured, **Then** they backstop the sweep.
5. **Given** repeated runs, **When** the sweep re-executes, **Then** it is idempotent.

## Decisions of record (recon 2026-07-03)

1. **Trigger** — BFF `RetentionSweepScheduler` BackgroundService (PeriodicTimer 24 h do-while, BillingReconciliation pattern, `internal RunOnceAsync` test seam): (a) sends due retention warnings via `IEmailSender`, (b) enqueues `sweep_retention` on `maintenance` via `IJobQueue` (`DramatiqQueues.Maintenance` already exists; add `DramatiqTasks.SweepRetention`). Worker has no scheduler — this is the established nightly precedent.
2. **Tier decisions in the worker via SQLAlchemy Core `text()`** (feature_flags.py precedent — billing tables have no Python mirror and don't need one for read-only aggregates). Tier rules: user has subscription with status ∈ {active, trialing, past_due} OR credit balance > 0 → PAID (never purged); user has a LAPSED subscription (status ∈ {canceled, unpaid, incomplete_expired}) → 90-days-post-lapse rule keyed on `current_period_end` (guard the SubscriptionMirrorService far-future sentinel: skip `current_period_end > now + 5y`, same as BillingReconciliation); otherwise FREE → 30-days-per-version rule on `song_versions.created_at`. **Fail-CLOSED**: if the billing queries error (missing tables, drift), the sweep purges NOTHING that run.
3. **"Purged" representation** — new `song_versions.raw_audio_purged_at` (`DateTimeOffset?`, EF migration `AddRawAudioPurgedAt` + python mirror). `file_path` is NOT NULL so paths stay; the marker is the idempotency key (AC5) and the audit trail. Playback/downloads of purged audio 404 via the existing missing-object paths; `analyses.final_json`, verdicts, conversations/coach_messages, notifications, rendered result images, and `reports/{jobId}.json` are NEVER touched (NFR20 — images/reports serve the surviving report).
4. **What gets deleted per purged version**: storage objects for `file_path`, `reference_path`, `als_file_path`, every key in `stem_paths` + `stem_paths_raw` — local (under LOCAL_ROOT) AND S3 (new `object_store.delete_object`, best-effort, missing-ok both sides).
5. **AC2 shape** — new BFF `IEmailSender` (`SendAsync(to, template, data)`) + `LoggingEmailSender` (structured log; Epic 4 swaps Resend). Warnings sent by the SCHEDULER (EF access to subscriptions/users) at exactly `daysUntilPurge ∈ {7, 1}` — nightly cadence makes the schedule itself the dedupe (no send-ledger needed pre-Epic-4).
6. **AC3** — `_purge_unclaimed_anonymous()` probes for a `devices` table via information_schema; absent → log + return 0. No-op safe until Epic 4 story 4.5.
7. **AC4** — `minio-init` adds `mc ilm rule add ... --expire-days 180 --prefix` for `audio/`, `stems/`, `als/` (backstop ≫ policy windows, never ahead of the sweep); compose comment documents the equivalent R2 lifecycle rule (prod config itself is 10.1).
8. **Config** — worker env `RETENTION_FREE_DAYS=30`, `RETENTION_LAPSED_DAYS=90`, `RETENTION_ANON_HOURS=72` (AR40); BFF `Retention:WarnAtDays=[7,1]`, `Retention:Enabled=true` bound options.
9. **Out of scope**: reference-library tracks (`reference_tracks` are user library assets, not per-version raw audio — a follow-on policy), orphaned-unregistered-object sweep (needs object listing — noted for 3.5/10.x with the lifecycle backstop covering it), real email + suppression (Epic 4).

## Tasks / Subtasks

- [x] Task 1 — Schema marker (AC: 5) — `RawAudioPurgedAt` + migration `AddRawAudioPurgedAt` + python mirror
- [x] Task 2 — Worker sweep actor (AC: 1, 3, 5) — `object_store.delete_object` (local unlink missing-ok + traversal guard, S3 delete when enabled); `retention_actor.py` (`sweep_retention` on maintenance, max_retries=0, `run_sweep` with Core-`text()` classification, fail-closed billing guard, anon no-op guard, cross-dialect value coercion for sqlite tests); registered in dramatiq_app + test_actor_queues; **9 worker tests** — a test caught a real logic bug during dev: lapsed-in-grace users were falling through to the 30-day free rule → classification now returns `protected` incl. the grace window
- [x] Task 3 — Email seam + scheduler (AC: 2) — `IEmailSender` + `LoggingEmailSender` (`EmailStub:` structured log); `RetentionSweepScheduler` (24 h PeriodicTimer, **5-min initial delay** — an immediate startup ENQUEUE fired into every WebApplicationFactory test host's recording queue and broke unrelated suites; the delay preserves the redeploy-reset property while keeping tests deterministic); warning at exactly WarnAtDays boundaries (schedule-as-dedupe); `DramatiqTasks.SweepRetention`; 3 BFF tests (boundary send/skip, maintenance enqueue, disabled short-circuit, resubscribed-no-warning)
- [x] Task 4 — Lifecycle backstop (AC: 4) — minio-init `mc ilm rule add` 180 d on `audio/` `stems/` `als/`; comment documents NFR20 exclusions (`reports/`, `analysis/`) + prod R2 rule (10.1). Comment placed OUTSIDE the block scalar (YAML absorbs same-indent `#` lines into the entrypoint string)
- [x] Task 5 — Gates + status — BFF 271/271 (3 new), worker 557 + 3 xfail (9 new), shared 27, ruff clean; frontend untouched (no gate run needed)

## Dev Notes

### Verified wiring facts (recon)

- `maintenance` declared at `dramatiq_app.py:56` ("carries no actor yet — Epic 3/4 add sweep_retention/send_email"); actor modules register via import side-effect (lines 42-50). `test_actor_queues.py`: EXPECTED_QUEUES dict + no-default-queue enforcement — new actor must appear in both.
- `DramatiqQueues.Maintenance` EXISTS (BFF, `DramatiqQueues.cs:19`); `DramatiqTasks` has no SweepRetention constant yet. `IJobQueue.EnqueueAsync(taskName, args, queueName)` supports arbitrary queues.
- Scheduler precedents: `BillingReconciliationService.cs` (24 h PeriodicTimer do-while — runs once at startup then daily; singleton + fresh scope per run; `internal` work method as test seam; registered `AddHostedService` Program.cs:180) and `StaleJobReaper.cs` (same shape, set-based ExecuteUpdate).
- Billing tables are EF-ONLY (no python mirror): `subscriptions` (PK user_id, status ∈ incomplete|incomplete_expired|trialing|active|past_due|canceled|unpaid, current_period_end — beware the `AddYears(10)` sentinel `SubscriptionMirrorService` writes on missing period_end; BillingReconciliation skips rows `> now+5y`), `credit_ledger` (balance = SUM(amount)). Worker Core-`text()` precedent: `app/feature_flags.py`.
- `AnalysisJob.tier` is dispatch-time-historical — NOT usable for "current tier" decisions.
- NFR20 survivors: `analyses` (final_json + image paths), `verdicts`, `conversations` + `coach_messages`, `notifications`. Also NOT touched: `reports/{jobId}.json`, `analysis/images/**` (they serve the surviving report — PR #7's durable-report story reinforces this).
- `object_store.py` (this branch = post-3.2 master): s3_enabled/_client/fetch_to_local/resolve_local/cleanup_* — NO delete member, NO put_json (that's PR #7; don't collide — name the new member `delete_object` only).
- No IEmailSender/EmailSender/send_email anywhere (AR27 says BFF-side IEmailSender; Epic 4 wires Resend + the send_email actor). This story introduces the interface + logging impl ONLY.
- No Device entity / anon-owned uploads exist (`AnalysisJob.user_id` NOT NULL; the Listen-V3 `*_anon_id` columns are comment/bookmark identities, NOT uploads) — AC3 guard is a documented no-op.
- No lifecycle rules exist in `minio-init` (bucket + CORS + spectr-worker user only). No RETENTION_* env anywhere.
- Storage key families to purge: `audio/{userId}/{jobId}/source.*` | `audio/upload/{jobId}/source.*` (mix), `reference_path`, `als/{jobId}/…` | `audio/als/{versionId}/…`, `stems/{jobId}/…` | `audio/stems/{versionId}/…` (from stem_paths `{role:[keys]}` AND stem_paths_raw `[{path:…}]`).

### Safety invariants (write them into the code)

- Fail-CLOSED on billing-query failure — an unreadable subscriptions table must never make everyone "free".
- Purge marks `raw_audio_purged_at` ONLY after the delete loop for that version ran (best-effort per key; a partially-failed delete still marks — the next lifecycle backstop + idempotent re-run cover residue; do NOT leave the marker unset on partial failure or the row re-purges forever).
- Delete helpers are missing-ok on both stores (AC5).
- Never delete by prefix — only exact keys read from the version row.
- The sweep must skip versions whose song/user rows are gone mid-run (LEFT JOIN discipline).

### Worker test conventions

- sqlite in-memory via `tests/conftest.py` JSONB shim + `Base.metadata.create_all`; billing tables created with raw `text()` DDL in the test (they're not in Base). `DATABASE_URL` setdefault BEFORE importing app modules. Real files under tmp_path for delete assertions; fake boto3 client records delete_object calls.
- Run shared + worker pytest as SEPARATE invocations (package-name collision).

### Previous story intelligence (3.2/3.3 reviews)

- Patterns reviewers will check: fail-open vs fail-closed direction argued explicitly; idempotency proven by a second-run test; no unbounded queries (sweep batches or bounded per run acceptable at beta); tests named honestly; `..` traversal guard already lives in the local delete path (reuse resolve-style guard); bounded boto3 timeouts (PR #7 adds Config to `_client` — this branch does NOT have it; add the same bounded Config here or accept merge dedupe with PR #7, noting it).
- PR #7 (3-3) touches `object_store.py` (put_json/put_file + `_client` Config). This branch adds `delete_object` — keep additions append-only/disjoint so the eventual merge is clean.
- Known flake: CoachStream parallel-run (passes isolated).

### References

- [Source: PRPs/epics.md#Story 3.4 (L724-736); NFR20 L138; NFR26 L150; AR22 L194; AR27 L208; AR40 L224]
- [Source: components/worker/app/{dramatiq_app.py,feature_flags.py,object_store.py}; tests/test_actor_queues.py; tests/conftest.py]
- [Source: components/bff/src/Spectr.Bff/Services/{BillingReconciliationService,StaleJobReaper,DramatiqQueues,DramatiqTasks,IJobQueue}.cs]
- [Source: components/bff/src/Spectr.Data/Entities/{Subscription,CreditLedgerEntry,SongVersion}.cs]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Full-suite run initially failed 5 unrelated BFF tests: the scheduler's immediate startup run enqueued `sweep_retention` into other suites' RecordingJobQueue fakes. Root cause + fix documented in Task 3 (InitialDelayMinutes).

### Completion Notes List

- **AC1** — `sweep_retention` (maintenance queue) purges raw-audio objects (mix/reference/.als/stems from both stem JSON shapes, exact keys only, local + S3, missing-ok) for FREE versions >30 d and ALL versions of users lapsed >90 d; `raw_audio_purged_at` is the idempotency marker. Lapsed-in-grace users are PROTECTED from the free rule (bug caught by tests). Sentinel `current_period_end` (mirror's +10 y) and unanchorable lapses are treated as paid (fail-safe). NFR20 test proves analyses/verdicts/conversations/coach_messages survive a sweep that deleted the audio.
- **AC2** — `IEmailSender` seam + `LoggingEmailSender`; `RetentionSweepScheduler` warns lapsed users at exactly 7/1 days before purge (nightly cadence = dedupe) and enqueues the sweep. Paid signals (re-subscribe, credits) suppress warnings.
- **AC3** — `_purge_unclaimed_anonymous` probes `to_regclass('public.devices')` (exception-tolerant) → logged no-op until Epic 4.
- **AC4** — MinIO ilm 180-day rules on `audio/`/`stems/`/`als/` (backstop ≫ policy; `reports/`+`analysis/` excluded per NFR20); R2 equivalent documented for 10.1.
- **AC5** — marker-filtered candidates + missing-ok deletes; second-run test asserts zero work.
- Billing reads are Core `text()` (feature_flags precedent) and FAIL-CLOSED: any read error purges nothing that run.

### File List

- `components/bff/src/Spectr.Data/Entities/SongVersion.cs` + migration `AddRawAudioPurgedAt` (+ snapshot)
- `components/bff/src/Spectr.Bff/Services/{IEmailSender,RetentionSweepScheduler}.cs` (new)
- `components/bff/src/Spectr.Bff/Services/DramatiqTasks.cs` (SweepRetention)
- `components/bff/src/Spectr.Bff/Program.cs` (registrations)
- `components/bff/tests/Spectr.Bff.Tests/RetentionSweepSchedulerTests.cs` (new)
- `components/worker/app/retention_actor.py` (new)
- `components/worker/app/object_store.py` (delete_object)
- `components/worker/app/dramatiq_app.py` (import)
- `components/worker/tests/{test_retention_sweep.py (new),test_actor_queues.py}`
- `components/shared/aimusic_shared/models.py` (raw_audio_purged_at mirror)
- `docker/docker-compose.yml` (ilm rules + comments)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor; auditor independently ran the worker tests). Outcome: **Approve after patches** — all 5 ACs met, but the blind/edge layers found real data-safety issues in a feature that deletes user files. 12 patches applied same day:

- [x] [High] Absolute-path keys escaped `local_root` (`Path(root)/abs` DISCARDS the root — a poisoned row could delete files anywhere) → `delete_object` rejects absolute/drive/`..` keys AND verifies containment via `is_relative_to`; test proves an outside file survives
- [x] [High] Marker was stamped even when EVERY delete failed → all-failed versions stay unmarked and retry nightly (test); partial failure still marks (documented residue policy)
- [x] [High] Single long transaction held across S3 deletes + one end-commit (crash/time-limit lost every marker after files were gone; anon probe could poison the tx) → per-version short transactions, classification/candidates/probe each in their own session, deletes outside any tx
- [x] [High] **Blanket 180-day lifecycle rules would delete PAID users' content** (`audio/`/`stems/`/`als/` hold age-unbounded paid mixes AND `audio/reference/` library assets) → ilm rules REMOVED; compose comment documents why prefix-expiry is unsafe and defers the correct TAG-based backstop to 10.1 (AC4 honestly downgraded to documented-config)
- [x] [High] One failing email aborted remaining warnings AND the sweep enqueue → sweep enqueued FIRST; per-user try/catch
- [x] [Med] Exact-equality warn boundaries skipped notices across downtime and duplicated them on redeploys/replicas → `daysLeft <= tier` semantics + a digest-keyed `notifications` row as the send-ledger (partial-unique index = cross-replica dedupe, plus an in-app notice for free); second-run test asserts zero duplicates
- [x] [Med] Unknown/new Stripe statuses (paused, incomplete) fell to the 30-day free rule → any non-lapsed status is PROTECTED (test)
- [x] [Med] Policy defined twice (BFF `LapsedDays` vs worker env) → BFF passes `LapsedDays` as the actor arg; env is fallback only
- [x] [Med] Unbounded unpurged-table scan → candidates bounded in SQL (free window OR lapsed-user IN list)
- [x] [Med] User who pays mid-sweep (prompted by the warning) still purged → per-user paid re-check at purge time (test simulates credits bought after classification)
- [x] [Low] Silent-no-op detection: stats split deleted/missing; loud warning when purges marked but ZERO objects actually deleted (LOCAL_ROOT drift signal); legacy string-list `stem_paths_raw` shape handled
- [x] [Low] PII: LoggingEmailSender masks addresses; Procfile maintenance comment updated; Dev Record test count corrected (7→ now 12 worker tests)
- Deferred: N+1 queries in the warning pass (beta scale); tag-based lifecycle backstop + prod R2 config (10.1); free-tier users get no warning email (per epic — only lapsed-paid notice is specified; flagged for product review in Epic 4's lifecycle-email story); credits-spent-to-zero users fall to the free window (product sign-off item, noted).
- Rejected: legacy v1 `upload_jobs` shared-file concern (v1 excluded from release); compose worker Dockerfile reference (pre-existing; dev runs via Procfile).

### Change Log

- 2026-07-03: implemented on `storage/3-4-retention-sweep`. Gates: BFF build 0-warn + 271/271 (3 new); worker 557 + 3 xfail (9 new); shared 27; ruff clean; frontend untouched. Status → review.
- 2026-07-03 (review): 12 code-review patches applied (see Senior Developer Review). Gates after patches: BFF 271/271, worker 561 + 3 xfail (12 sweep tests), ruff clean.
