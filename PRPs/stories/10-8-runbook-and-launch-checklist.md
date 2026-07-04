# Story 10.8: Runbook & Launch Checklist

Status: review

## Story

As the operator,
I want every failure mode pre-documented and the launch gates checklisted,
So that 3 a.m. incidents have a script (NFR31).

## Acceptance Criteria

1. **Given** `docs/runbook.md`, **When** complete, **Then** it covers: stuck job, webhook backlog, LLM budget breach, restore-from-backup, abuse response, secrets rotation, and prompt rollback.
2. **Given** the launch checklist, **When** executed, **Then** SPF/DKIM/DMARC are verified, the Stripe sandbox matrix (dunning/refund/proration — NFR23) has passed, the restore test is done, and alerting has been test-fired.
3. **Given** production error responses (NFR9), **When** errors occur, **Then** no stack traces or internals leak (test asserts the envelope).

## Decisions of record (2026-07-03)

1. **AC1 inventory**: restore-from-backup (10.2 ✓), abuse response (10.6 ✓), secrets rotation (10.1 ✓) exist; **stuck job, webhook backlog, LLM budget breach are MISSING** — this story writes them from the real machinery (reaper/error codes/XQ/budget flags). Prompt rollback gets its own visible section (it was a bullet inside Admin).
2. **Launch checklist = `docs/launch-checklist.md`** (a signed-off gate document, not runbook prose): email DNS, Stripe sandbox matrix (NFR23: dunning via test clocks, refund via the 10.5 admin surface, proration monthly↔annual), the VPS restore drill (10.2's deferred line item), alert test-fire (every ntfy path), plus the ACCUMULATED first-boot verifications every 10.x story deferred to "the first deploy": :9191 exporter serves families, Grafana renders, disk rule returns a sample, GHCR login, healthchecks dead-man, R2 checklist, admin key, `.env` chmod 600.
3. **NFR9 is a CODE change, not just a doc**: the BFF has NO exception handler — prod unhandled exceptions return a BLANK 500 (no stack leak, but no envelope either; framework-shaped 400s leak schema internals). `UseExceptionHandler` registered in ALL environments mapping unhandled → the shared `ErrorEnvelope` 500 `internal_error` (message generic; correlation id included for support). Test: a Development-gated `GET /api/dev/throw` (dev-login precedent) exercises THE SAME unconditional handler prod uses; asserts envelope shape, no `at Spectr.` frames, no exception message text.
4. **Out of scope**: executing the VPS-dependent checklist items (no VPS yet — the checklist IS the deliverable; execution signs off at launch), status-page publish (10.4 procedure), admin UI.

## Tasks / Subtasks

- [x] Task 1 — `UseExceptionHandler` (ALL environments — the test exercises the exact prod path): 500 `internal_error` envelope + traceId, never a frame/message; dev-only `/api/dev/throw` detonator (throws a message containing a fake connection string + password — the leak test proves NONE of it escapes); the handler outranks the auto dev-exception-page (registered closer to the endpoint)
- [x] Task 2 — runbook sections written FROM the real machinery: Stuck job (health endpoint triage → pool restart w/ NFR16 queue survival → reaper patience → XQ inspection → product-level re-runs), Webhook backlog (the 10.4 alert's own SQL; dashboard-resend IS the designed recovery — dedupe skips only processed rows), LLM budget breach (spend-by-purpose SQL, audited ceiling raise, abuse fork, the 100% degraded-mode explanation), Prompt rollback promoted to its own section
- [x] Task 3 — `docs/launch-checklist.md`: sign-off gate doc — infrastructure first boot (ALL the 10.x deferred verifications collected: :9191 multiproc, dashboard, disk-rule sample, GHCR, crawler split, e2e analysis), email DNS PASS-in-headers, Stripe sandbox matrix (subscribe/proration/dunning-with-test-clocks/ADMIN-refund/credits-reversal/signature-reject + one live-key smoke), VPS restore drill (the 10.2 gate), alert test-fire (incl. the DatasourceError path), security (admin key, NFR9, gitleaks, R2 tokens), non-blocking first-week list, sign-off table
- [x] Task 4 — gates: BFF 340/340 (1 new); worker/frontend untouched

## Dev Notes

- Stuck-job play: reaper (3.5) auto-fails after heartbeat staleness; manual: check /api/health/worker queue depth + heartbeat age, `docker compose logs worker-paid`, requeue = re-dispatch via re-analyze; XQ inspection commands (`redis-cli LRANGE dramatiq:*.XQ`).
- Webhook backlog: webhook_events unprocessed query (the 10.4 alert's SQL), Stripe dashboard resend, svix/Resend retry behavior.
- Budget breach: 10.4 alert at 80%; hard stop (FR16 API mode); admin flag raise + llm_calls spend query; degraded-mode explanation (rule-engine verdicts).
- Exception handler: `app.UseExceptionHandler(b => b.Run(...))` BEFORE other middleware consumers; include HttpContext.TraceIdentifier or the correlation id.

### References

- [Source: PRPs/epics.md L1262-1272, NFR9, NFR23, NFR31; runbook TOC (7-section inventory)]
- [Source: 10.1-10.7 deferred first-boot items; SecretsHardeningTests Production-boot precedent; dev-login env-gate precedent]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- none — clean first-run (build + leak test + full suite).

### Completion Notes List

- AC1: all 7 required plays now exist as visible sections (3 written new, prompt rollback promoted, 3 pre-existing).
- AC2: the checklist is the DELIVERABLE — execution happens on the real VPS at launch (no VPS exists yet; every 10.x story's "verify on first boot" deferral is now a checkbox that can't be skipped silently).
- AC3: the BFF previously had NO exception handler (prod = blank 500 — no leak but no envelope); now the shared envelope in every environment, leak-proven.
- Epic 10 closes with this story.

### File List

- BFF: `Program.cs` (UseExceptionHandler + dev detonator), `tests/ErrorEnvelopeLeakTests.cs` (new, 1)
- Docs: `docs/runbook.md` (4 sections), `docs/launch-checklist.md` (new)

### Change Log

- 2026-07-03: implemented on `ops/10-8-launch`. Gates: BFF 340/340. Status → review.
