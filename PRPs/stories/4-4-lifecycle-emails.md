# Story 4.4: Lifecycle Emails (Completion, Dunning, Retention)

Status: review

## Story

As a user,
I want timely, relevant emails about my analyses and billing,
So that I never miss a finished report or a billing problem.

## Acceptance Criteria

1. **Given** an analysis completes (FR44), **When** the user has notifications enabled (opt-out flag), **Then** an analysis-complete email sends with a deep link to the report.
2. **Given** a `past_due` transition (Epic 2 states), **When** dunning fires, **Then** the dunning notice email sends through the same pathway (FR33 email half).
3. **Given** an approaching retention purge (Epic 3 sweep), **When** the warning is due, **Then** the retention-warning email sends with the purge date and keep options.
4. **Given** suppression, **When** any lifecycle email targets a suppressed address, **Then** it skips and logs.

## Decisions of record (recon 2026-07-03)

1. **AC1 trigger = BFF poller** (`LifecycleEmailScheduler`, StaleJobReaper pattern: 60 s PeriodicTimer, fresh scope, internal RunOnceAsync seam). The worker flips complete but cannot render (registry is BFF-only) and no worker→BFF mechanism exists; architecture names only the pathway components. Scan: `analysis_jobs.status='complete' AND completed_at > now - 2h` (catch-up window) joined to `analyses` (song_id NOT NULL — ad-hoc analyses have no deep link) + `users.notify_analysis_complete`. **Send-ledger = notifications digest row** `analysis_complete:{jobId}` (3.4's warning-ledger precedent: partial-unique digest_key = cross-replica dedupe + a free in-app notification).
2. **Opt-out flag** = `users.notify_analysis_complete` (bool, default TRUE) + migration + python mirror + `MeProfileDto`/`PatchMeProfileRequest` + a toggle in profile SettingsTab (the analysis-complete template already promises "turn these off in your profile").
3. **AC2 trigger = the `invoice.payment_failed` webhook branch** (the only place that knows the retry schedule; SubscriptionMirrorService sees only current status, no transition hook). Dedupe per invoice via digest `dunning:{invoiceId}`. Data: `nextAttempt` (already extracted there), `billingUrl = {FrontendOrigin}/billing`.
4. **AC3 = fix a real bug**: the 3.4 warning omits `billingUrl` — the template's KEEP MY FILES button renders `href=""` today. Add it.
5. **AC4 already holds structurally** (single pathway: QueueEmailSender suppression skip+log, 4.2-tested; worker send-time recheck) — story adds no code, records the verification.
6. **Carried 4.3 commitment**: new `password-changed` template (informational, no links — phishing-resistant) sent best-effort post-commit in ResetPassword.
7. **Template tweaks**: AnalysisComplete grade line renders only when a grade is provided (the poller doesn't parse final_json for grade at beta — follow-up when a grade column lands); registry gains PasswordChanged.

## Tasks / Subtasks

- [x] Task 1 — `users.notify_analysis_complete` (default true) + migration + mirror + MeProfileDto/PatchMeProfileRequest (null = unchanged) + Settings-tab "Emails" card checkbox (`.toggleRow` class, no inline styles) + roundtrip test
- [x] Task 2 — `password-changed` template (deliberately LINK-FREE — phishing hygiene, tested `<a`-absent); AnalysisComplete grade line conditional (tested both ways)
- [x] Task 3 — `LifecycleEmailScheduler`: 60 s poller, 90 s initial delay (3.4 lesson), 2 h lookback, single LEFT-JOIN-filtered query capped at 200/tick, ledger-FIRST insert (unique digest = the send decision; crash between ledger and send loses one email, never spams — documented direction); tests: sends once w/ deep link + ledger row + second-sweep no-dup; opt-out skips
- [x] Task 4 — dunning email in the invoice.payment_failed branch: per-INVOICE digest (`dunning:{invoiceId}` — Stripe re-fires per Smart-Retry attempt), email failure never 5xxes the webhook (ledger already claimed); test proves once-per-invoice by clearing webhook_events dedupe and replaying
- [x] Task 5 — retention billingUrl fix (KEEP MY FILES button had `href=""` since 3.4); IConfiguration threaded through WarnOneAsync
- [x] Task 6 — password-changed sent best-effort post-commit in ResetPassword; end-to-end test (register → forgot → reset → PasswordChanged recorded)
- [x] Task 7 — gates: BFF 316/316 (7 new), shared 27, vitest 677, tsc/lint/lint:css/ruff clean

## Dev Notes

- Phase C facts: worker writes analyses (job_id/user_id/song_id/song_name) + completed_at on jobs; no notification/email signal. JobEndpoints GET-hook is the only existing BFF-reacts-to-worker precedent (reactive, poll-dependent — a user who never returns still deserves the email, hence the poller).
- notifications digest ledger: insert Notification{DigestKey}, catch DbUpdateException(23505) → already sent (RetentionSweepScheduler.WarnOneAsync L157-176 is the copy-paste source).
- invoice.payment_failed branch: BillingEndpoints L1059-1109; NextPaymentAttempt extracted there; subscription row → UserId → users.email.
- ResetPassword insertion: post `tx.CommitAsync` (L523), IEmailSender not currently injected.
- SettingsTab: profile.tsx L286-353; usePatchMe → PATCH /me/profile (MeEndpoints PatchProfile).
- Scheduler disable knob for tests: follow Retention:Enabled precedent → `Lifecycle:Enabled` + InitialDelay (the 3.4 lesson: an immediate startup enqueue polluted every test factory).

### References

- [Source: PRPs/epics.md L793-804; FR44 prd L368; FR33 prd L348; architecture.md L116/L266]
- [Source: components/bff/src/Spectr.Bff/Services/{RetentionSweepScheduler,StaleJobReaper,QueueEmailSender,EmailTemplates,TableNotificationSink}.cs; Endpoints/{BillingEndpoints,AuthEndpoints,MeEndpoints}.cs; Entities/{Notification,Subscription,Analysis,AnalysisJob,User}.cs]
- [Source: components/frontend-spectr-v2/src/routes/_app/profile.tsx]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- None — clean run.

### Completion Notes List

- AC1: BFF poller (worker can't render); ledger-first = at-most-once email per completion, cross-replica safe, with a free in-app notification. Song-less ad-hoc analyses skipped (no deep link). Grade omitted at beta (template hides the line).
- AC2: dunning fires once per failed INVOICE, not per retry attempt.
- AC3: was silently broken since 3.4 — billingUrl now flows.
- AC4: verified structural (single pathway, 4.2-tested suppression at enqueue + send time); no new code.
- 4.3 commitment paid: password-changed containment email, link-free.

### File List

- BFF: `Entities/User.cs` + migration `AddNotifyAnalysisComplete`, `Services/{LifecycleEmailScheduler.cs (new),EmailTemplates.cs,RetentionSweepScheduler.cs}`, `Endpoints/{BillingEndpoints.cs,AuthEndpoints.cs,MeEndpoints.cs}`, `DTOs/MeDtos.cs`, `Program.cs`
- Tests: `LifecycleEmailTests.cs` (new, 6), `StripeWebhookEndpointTests.cs` (dunning test + BuildConfigured services hook)
- Shared: `models.py` (notify_analysis_complete mirror)
- Frontend: `api/types.ts`, `routes/_app/profile.tsx` + `profile.module.css`

### Change Log

- 2026-07-03: implemented on `account/4-4-lifecycle-emails`. Gates: BFF 316/316, shared 27, vitest 677, all linters clean. Status → review.
