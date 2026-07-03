# Story 4.2: Transactional Email Foundation (Resend)

Status: done

## Story

As the operator,
I want one email pathway with templates, retries, and suppression,
So that every product email is deliverable and brand-consistent.

## Acceptance Criteria

1. **Given** `IEmailSender` + a template registry (AR27), **When** any email sends, **Then** it enqueues through the `send_email` actor on the `maintenance` queue for retry semantics.
2. **Given** the EmailShell kit (UX-DR37), **When** templates render, **Then** system fonts + dark header band apply, with verification, reset, analysis-complete, dunning, and retention-warning templates registered.
3. **Given** bounces/complaints, **When** Resend webhooks arrive, **Then** addresses append to the suppression table **And** future sends to suppressed addresses are skipped.
4. **Given** deliverability (NFR25), **When** DNS is configured, **Then** SPF/DKIM/DMARC pass verification (checklist lives in the runbook).

## Decisions of record (recon 2026-07-03)

1. **Render in the BFF, send in the worker.** The template registry is BFF-side per AR27 ("Resend via BFF IEmailSender + template registry"); the worker must not duplicate it. `QueueEmailSender : IEmailSender` (replaces `LoggingEmailSender` as the DI registration): checks suppression → renders via `EmailTemplates` → enqueues `send_email(to, subject, html, template)` on `maintenance`. The worker actor is deliberately dumb: POST to Resend's HTTP API; without `RESEND_API_KEY` it logs the send (masked) and succeeds — dev stays zero-config.
2. **Retry semantics** live on the actor: `max_retries=3` (dramatiq exponential backoff); 5xx/429/network → raise (retry); 4xx → log + swallow (a bad address must not spin the queue). Producers never block on SMTP/HTTP latency (architecture D6). *(Review amendment: the From address rides as the 5th actor arg from `ResendOptions.FromAddress` — single source of truth — rather than a worker `EMAIL_FROM` env as originally drafted.)*
3. **Template registry** = `EmailTemplates.Render(template, data) -> (subject, html)`: the 5 AR27 templates (`verification`, `reset`, `analysis-complete`, `dunning`, `retention-warning`), EmailShell wrapper (dark header band, system-font stack, mono accents — UX-DR37 "consistent in spirit, not in tokens"), all data values HTML-encoded (injection guard), unknown template → throw (producer bug, fail loud).
4. **Suppression** = new `email_suppressions` table (email PK lowercase, reason, source event id, created_at). Checked in the BFF at enqueue time — a bounce landing between enqueue and send is a negligible race vs. a per-send worker DB query; documented. No python mirror needed (worker never reads it).
5. **Webhook** = `POST /api/email/webhook` (AllowAnonymous): Resend signs via Svix — custom constant-time HMAC-SHA256 verifier over `"{svix-id}.{svix-timestamp}.{body}"` with the base64 `whsec_` secret, ±5 min timestamp window (no in-repo Svix helper; Stripe's `EventUtility` doesn't apply). Dedupe via the existing `webhook_events` pattern (INSERT ON CONFLICT DO NOTHING + conditional `processed_at` skip — story 2.1 rule). Handles `email.bounced` + `email.complained` → suppression upsert. 503 when `Resend:WebhookSecret` unconfigured (Stripe precedent).
6. **Config**: `ResendOptions` (`Resend:` ApiKey, WebhookSecret, FromAddress default `SPECTR <onboarding@resend.dev>` — Resend's sandbox sender, real domain lands with DNS/10.1) + `SPECTR_REQUIRE_EMAIL=1` boot-gate (SPECTR_REQUIRE_STRIPE precedent). Worker: `RESEND_API_KEY`, `EMAIL_FROM` flat env (retention_actor style). `httpx` promoted to a declared dep in `requirements.in` (already in the lock via anthropic).
7. **AC4** = new `docs/runbook.md` (the file architecture.md L168 already anticipates): SPF/DKIM/DMARC checklist, Resend webhook setup, secret rotation stub. Verification against live DNS is a launch task (10.1) — the checklist is the 4.2 deliverable, honestly scoped.
8. **No frontend work** (confirmed — EmailShell is backend HTML; auth UI is 4.3). Retention warnings keep flowing through the unchanged `IEmailSender` seam — 3.4's scheduler now transparently goes through the actor.

## Tasks / Subtasks

- [x] Task 1 — templates (AC: 2): `EmailTemplates.cs` — EmailShell (dark band `#0b0e14`, system-font stack, ui-monospace cyan accents) + 5 templates; all data HTML-encoded; unknown → throws. Tests: Theory over all 5 asserting shell markers, encoding test, throw test
- [x] Task 2 — queue path (AC: 1): `ResendOptions` (+`SPECTR_REQUIRE_EMAIL` boot-gate incl. WebhookSecret) + `QueueEmailSender` (render → suppression check → enqueue `[to, subject, html, template, from]` on maintenance) replaces `LoggingEmailSender` (deleted — actor stubs without key instead); `DramatiqTasks.SendEmail`. Tests: enqueue args/queue asserted; RetentionSweepScheduler unchanged (interface seam held)
- [x] Task 3 — suppression + webhook (AC: 3): `email_suppressions` (email PK lowercase, reason, source_event_id) + migration `AddEmailSuppressions`; `EmailWebhookEndpoints` — svix constant-time HMAC verify + ±5 min window, webhook_events dedupe (ON CONFLICT + conditional processed_at), bounced/complained → suppression upsert, 503 unconfigured, sanitized processing_error + rethrow. Tests: 503, bad-sig 401, bounce→suppression+dedupe-duplicate, unit verifier tamper matrix, suppressed-address skip (case-insensitive)
- [x] Task 4 — worker actor (AC: 1): `send_email_actor.py` (maintenance, max_retries=3, time_limit 60 s): no key → masked stub log; httpx POST; 5xx/429 raise (retry), 4xx swallow (`rejected`). dramatiq_app import + test_actor_queues (11 actors). 8 worker tests (stub+mask, success payload, transient-raise ×3, permanent-swallow ×3). `httpx` declared in requirements.in/txt (already in lock via anthropic — no regen needed)
- [x] Task 5 — runbook (AC: 4): `docs/runbook.md` (new — the file architecture.md anticipates): Resend setup, SPF/DKIM/DMARC checklist w/ verification commands, webhook registration, prod boot-gate, secret-rotation stub
- [x] Task 6 — config: .env.example (Resend BFF block + worker RESEND_API_KEY), compose worker passthrough, gitleaks allowlist for the svix test fixture. Gates: BFF 300/300 (13 new; known CoachStream flake re-ran green), worker 575 + 3 xfail (8 new), ruff clean, frontend untouched

## Dev Notes

- IEmailSender seam: `SendAsync(to, template, IReadOnlyDictionary<string,string> data, ct)`; sole producer RetentionSweepScheduler (`"retention-warning"`, purgeDate/daysLeft). Tests inject RecordingEmailSender fakes — unaffected by DI swap.
- IJobQueue: positional `args` only (`kwargs` hardcoded empty) → actor signature `send_email(to, subject, html, template)`.
- webhook_events dedupe: PK id, payload_hash (SHA-256 hex, never raw body), conditional processed_at skip on duplicates, SanitizeProcessingError + rethrow for 5xx retry (BillingEndpoints.PostStripeWebhook L843+ is the template).
- Svix: headers svix-id/svix-timestamp/svix-signature; sig list is space-delimited `v1,<base64>`; secret is `whsec_` + base64 key; constant-time compare (`CryptographicOperations.FixedTimeEquals`).
- Worker httpx: raise for status >= 500 or 429; 4xx logs. `load_dotenv` already runs in dramatiq_app before imports.
- Maintenance queue: consumed in dev (Procfile all-queues) and prod W2. sweep_retention is the only current rider.
- gitleaks: any new test webhook secrets must use the allowlisted `whsec_unit` / `whsec_test_secret` forms or extend the anchored allowlist.

### References

- [Source: PRPs/epics.md L767-778 (ACs); AR27 L208; NFR25 L149; UX-DR37 L282]
- [Source: PRPs/architecture.md D6 L114-116; L168 (runbook); L184 (webhook dispatch)]
- [Source: components/bff/src/Spectr.Bff/Services/{IEmailSender,RetentionSweepScheduler,IJobQueue,DramatiqTasks}.cs; Endpoints/BillingEndpoints.cs L843+; Entities/WebhookEvent.cs]
- [Source: components/worker/app/{dramatiq_app,retention_actor}.py; tests/test_actor_queues.py; requirements.in]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- CS9007 raw-string interpolation brace conflict in a test JSON literal — replaced with `.Replace()`.
- `dotnet ef` honors launchSettings (Development) — migrations work post-4.1 key policy.

### Completion Notes List

- **AC1**: one pathway — `IEmailSender` → `QueueEmailSender` (render + suppress + enqueue) → `send_email` actor on maintenance (max_retries=3 backoff). Producers never block on provider latency; dev is key-less (actor stubs). RetentionSweepScheduler flows through unchanged.
- **AC2**: EmailShell + verification/reset/analysis-complete/dunning/retention-warning registered; data HTML-encoded; unknown template fails loud.
- **AC3**: svix-verified webhook (constant-time HMAC, ±5 min window, webhook_events dedupe per story 2.1 rule) appends `email_suppressions`; QueueEmailSender skips suppressed addresses (case-insensitive). Enqueue-vs-send race documented as negligible (decision 4).
- **AC4**: `docs/runbook.md` SPF/DKIM/DMARC checklist + webhook setup. Live DNS verification is a launch task (10.1) — checklist is the deliverable.
- LoggingEmailSender deleted (stub moved to the actor); `SPECTR_REQUIRE_EMAIL=1` boot-gate for prod.

### File List

- BFF: `Services/{EmailTemplates,QueueEmailSender}.cs` (new), `Services/IEmailSender.cs` (LoggingEmailSender removed), `Services/DramatiqTasks.cs`, `Options/ResendOptions.cs` (new), `Endpoints/EmailWebhookEndpoints.cs` (new), `Program.cs`, `Spectr.Data/Entities/EmailSuppression.cs` (new) + `AppDbContext.cs` + migration `AddEmailSuppressions`
- Tests: `EmailPipelineTests.cs` (new, 13)
- Worker: `app/send_email_actor.py` (new), `app/dramatiq_app.py`, `tests/{test_send_email.py (new),test_actor_queues.py}`, `requirements.{in,txt}`
- Config/docs: `.env.example`, `docker/docker-compose.yml`, `.gitleaks.toml`, `docs/runbook.md` (new)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter security-mindset + Edge Case Hunter/Acceptance Auditor combined; auditor ran BFF 13/13 + worker 11/11 live). Outcome: **Approve after patches** — svix verifier itself judged sound (constant-time, per-spec), but the pathway had real gaps. 14 patches applied:

- [x] [High] **Prod gate validated the key nobody uses**: `SPECTR_REQUIRE_EMAIL` checked the BFF's `Resend__ApiKey`, but the WORKER sends via `RESEND_API_KEY` (ungated) — a configured-BFF/unconfigured-worker deploy would silently stub every prod email → worker-side gate in dramatiq_app (startup RuntimeError when `SPECTR_REQUIRE_EMAIL=1` without `RESEND_API_KEY`); runbook documents BOTH gates
- [x] [High] Signed payload without `"type"` (schema drift) threw KeyNotFoundException pre-dedupe → 500 + infinite Resend retry loop → TryGetProperty + non-object/empty-type → 400
- [x] [Med] No Resend idempotency → timeout-after-accept could double-send on retry → content-derived `Idempotency-Key` (SHA-256 of to|template|subject|html — stable across dramatiq retries AND same-day duplicate enqueues; Resend dedupes 24 h)
- [x] [Med] Subject built from RAW user songName (comment claimed "everything encoded") → subject slot strips control chars (CR/LF header hygiene) + fallback subject when absent; misleading comment rewritten; tests
- [x] [Med] `href="{HtmlEncode(url)}"` passes `javascript:` untouched → URL slots require absolute http(s) (`Uri.TryCreate`) or render empty — never a DKIM-signed phishing link; test
- [x] [Med] Suppression checked only at enqueue → send-time recheck in the actor (SQLAlchemy text(), FAIL-OPEN with logged warning — a DB blip must not eat a password reset; BFF check is primary)
- [x] [Low] Absurd unix timestamp → FromUnixTimeSeconds throw → 500; malformed base64 secret → FormatException storm; oversize svix-id (>64) and recipient (>320) → Postgres error retry loops — all now clean 401/400/skip paths; headers checked BEFORE the body read; 256 KB RequestSizeLimit (app-wide Kestrel cap is 250 MB for audio)
- [x] [Low] 4xx branch logged `resp.text` (Resend validation bodies echo the address — defeating the masking) → status only; transient raise already status-only
- [x] [Low] Tests added: stale-timestamp 401, missing-headers 401, absurd-timestamp 401 (not 500), subject sanitization, javascript: rejection
- [x] [Low] Runbook: dead-letter `dramatiq:maintenance.XQ` (7-day TTL, monitoring hook 10.2), maintenance-lane latency note (REVISIT before 4.3 puts expiring reset links here), queue-payload visibility (outbox-pattern decision deferred to 4.3 — today's producers carry no secrets), suppressed-=-unreachable support diagnosis
- [x] [Low] Story decision 6 corrected (From rides as actor arg, not worker env)
- Deferred: outbox/reference pattern for secret-bearing emails (4.3 — its producers don't exist yet, decision recorded); `email = lower(email)` CHECK constraint (both writers normalize + tested; revisit if a third writer appears); `email_sends` audit table (10.2 observability); payload_hash-consulting drift detection (matches billing's pattern — consistent by design).
- Rejected: scoped-DI captive-dependency concern (verified: scheduler resolves per-scope; full app boot in tests passes DI validation).

### Change Log

- 2026-07-03: implemented on `account/4-2-email-foundation`. Gates: BFF 300/300, worker 575 + 3 xfail, ruff clean. Status → review.
- 2026-07-03 (review): 14 patches applied. Gates after: BFF 303/303 (16 email tests), worker 575 + 3 xfail, ruff clean.
