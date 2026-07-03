# SPECTR Operations Runbook

Operational checklists the architecture references (architecture.md "Repo
additions"). Sections land with the story that creates the concern.

## Production deploy & rollback (story 10.1)

Topology (AR29): single VPS, `infra/compose.prod.yml` — caddy (auto-TLS,
SPA/funnel statics, `/api` + crawler-`/r/*` proxy), bff, worker-paid (W1:
coach + analysis-paid), worker-free (W2: analysis-free + maintenance),
postgres:16, redis:7 (AOF on — the queue IS durable state). Only caddy
publishes ports; the BFF has no direct ingress (which is what makes
`ForwardedHeaders__Enabled=true` safe).

### First-time VPS setup

1. Docker + compose plugin; `mkdir -p /opt/spectr`.
2. Copy `infra/{compose.prod.yml,deploy.sh,backup.sh,restore-test.sh}` (CI
   re-ships all four on every deploy); `chmod +x *.sh`.
3. Create `/opt/spectr/.env` — **chmod 600** (AR31). Required keys are
   listed in the compose header; generate signing keys with
   `openssl rand -base64 48`. `SPECTR_REQUIRE_STRIPE=1` and
   `SPECTR_REQUIRE_EMAIL=1` are baked into the compose — boot fails on
   missing billing/email config by design.
3b. **GHCR pull auth** — the images are private by default:
   `docker login ghcr.io -u <github-user> -p <read-only PAT (read:packages)>`
   once on the VPS (credentials persist in ~/.docker). Without this the
   first `deploy.sh` dies at `pull` with `denied`.
4. Point DNS at the VPS; `SPECTR_DOMAIN` drives Caddy's auto-ACME.
5. GitHub repo secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (deploy key,
   `/opt/spectr` writable). Until set, CI pushes images and skips the
   deploy step gracefully.
6. First boot applies EF migrations automatically
   (`Migrations__ApplyAtBoot=true`, advisory-lock-serialized).

### Deploy + rollback (NFR29)

- CI on master: gates → images pushed to GHCR (`spectr-{bff,worker,web}`,
  `:sha` + `:latest`) → trivy CRITICAL scan → SSH →
  `/opt/spectr/deploy.sh <sha>` (pin, pull, up, `/healthz` verify with
  AUTO-rollback on failure).
- Manual rollback — one command: `ssh <vps> '/opt/spectr/deploy.sh rollback'`
  (repins the previous image set from `.deploy-state`).
- Prompt rollback needs NO deploy: flip the `prompt_versions` flag row.

### Destructive-migration rule (architecture L189)

A migration that DROPS or rewrites data requires: (1) a runbook entry
below describing the change, (2) a confirmed fresh backup (10.2's
`backup.sh`) BEFORE merging to master. No exceptions — boot-time
migration means merge == deploy == applied.

### Prod R2 checklist (the 3.x deferrals)

- [ ] Bucket CORS: `PUT/GET/HEAD` from `https://<domain>`, `ExposeHeaders:
      ETag` (mirror of the minio-init dev rule — multipart Complete needs it).
- [ ] TWO scoped API tokens (AR21): BFF token (`R2_BFF_*`) and a separate
      worker token (`R2_WORKER_*`) — never share.
- [ ] Lifecycle: NO blanket prefix expiry (paid content is age-unbounded —
      3.4's lesson). Optional tag-based rule: expire objects tagged
      `spectr-purge-residue` after 30 d once the sweep starts tagging
      failed deletes (future).
- [ ] `backups/` prefix: 30-day expiry (10.2 wires the nightly pg_dump).

## Observability (story 10.3 / AR32 / NFR30)

- **.env additions with 10.3** (all have safe defaults — nothing
  deploy-blocks): `SENTRY_DSN_BFF`, `SENTRY_DSN_WORKER`,
  `GRAFANA_ADMIN_PASSWORD` (defaults to `changeme` — tunnel-only, but SET
  IT), `GRAFANA_PG_PASSWORD`.
- **Grafana read-only DB role — run BEFORE first up** (or the 5 Postgres
  panels error until you do; they self-heal after, no restart needed):
  see the SQL block below.
- **Sentry** (all optional, DSN-gated): create 3 projects → set
  `SENTRY_DSN_BFF`, `SENTRY_DSN_WORKER` in `.env`; `VITE_SENTRY_DSN` as a
  CI repo secret (baked into the web bundle at build). Correlation tags:
  the ANALYZE lane correlates by **job id**, the verdict/triage/rerun
  lanes by **analysis id** — every event carries BOTH where known
  (`correlation_id` + the `job_id`/`analysis_id` stitch tag; coach adds
  `analysis_id` to its conversation-id correlation), so search either id
  to assemble the full upload → job → actors → LLM → render trace.
  `llm_calls.correlation_id` stores the analysis id on verdict lanes.
- **Prometheus** (internal-only): scrapes BFF `:5000/metrics`
  (prometheus-net HTTP metrics + `spectr_queue_depth{queue}` — LIST + .DQ
  delay queue, all four lanes; `spectr_queue_depth_scrape_errors_total`
  rising = the gauge is stale) and both workers `:9191` (dramatiq
  middleware + `spectr_job_duration_seconds`, `spectr_llm_cost_usd_total`,
  `spectr_verdict_validation_rejects_total`). 30 d retention.
  `PROMETHEUS_MULTIPROC_DIR` MUST stay in the worker compose env — set
  after import it's ignored and `:9191` serves an empty registry. Note:
  in dev the BFF listens on localhost:5000 with `/metrics` anonymous
  (prod: port unpublished, caddy never routes it — the catch-all serves
  the SPA shell for `/metrics`).
- **Grafana**: `127.0.0.1:3000` only — reach it with
  `ssh -L 3000:localhost:3000 <vps>`. Login admin / `GRAFANA_ADMIN_PASSWORD`.
  The `SPECTR / SPECTR Ops` dashboard is file-provisioned (10 panels:
  queue depth, job p90, success rate, hourly outcomes, LLM spend vs budget,
  spend rate, helpful/wrong, validation rejects, MRR proxy, HTTP p95).
- **Grafana read-only DB role** (run once on the VPS):
  ```sql
  CREATE ROLE grafana LOGIN PASSWORD '<GRAFANA_PG_PASSWORD>';
  GRANT CONNECT ON DATABASE spectr TO grafana;
  GRANT USAGE ON SCHEMA public TO grafana;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana;
  ```
- **PostHog** (EU): project key = CI secret `VITE_POSTHOG_KEY`. Product
  events: `upload_completed` (attachment flags), `report_viewed`,
  `coach_message_sent`, `verdict_feedback`. Epic 6 adds the landing/funnel
  events.
- **KPI table → source mapping** (PRD Measurable Outcomes):

| KPI row | Source |
|---|---|
| Time-to-first-insight | `analysis_jobs` timestamps (+ `report_viewed`) |
| Free→paid conversion | Stripe + PostHog signup cohorts (Epic 6 funnel) |
| Same-track re-analysis | SQL: `song_versions` per user |
| Paid churn | Stripe dashboard |
| Verdict helpful/wrong | `verdict_user_state.feedback` (Grafana panel 7) |
| Coach follow-up rate | `coach_message_sent` + `coach_messages` rows |
| .als attach rate | `upload_completed.als_attached` |
| LLM cost / analysis | `llm_calls` (Grafana panel 5) |
| Share-link k-factor | Epic 6 share instrumentation (not yet) |
| Failed-payment recovery | `subscriptions.next_payment_attempt` + Stripe |

## Admin surface (story 10.5 / FR46 / NFR7)

Elevated auth = `X-Admin-Key` header (env `ADMIN_API_KEY`, generate with
`openssl rand -base64 48`; ≥32 chars boot-enforced outside Development).
UNSET = every `/api/admin/*` route 404s (surface invisible). Rotation:
edit `.env` → `./deploy.sh redeploy`. curl console (no UI in v1):

```bash
# Keep the key OUT of argv/history: put it in a file once.
printf 'header = "X-Admin-Key: %s"\n' "$ADMIN_API_KEY" > ~/.spectr-admin; chmod 600 ~/.spectr-admin
A() { curl -sK ~/.spectr-admin "$@"; }
# Billing trail (id or email) — the refund-decision evidence
A https://<domain>/api/admin/users/user@example.com/billing | jq
# Refund: credits back and/or a FULL Stripe payment-intent refund
# (ownership-checked against the user's Stripe customer; idempotent per intent)
A -X POST https://<domain>/api/admin/refunds -H 'Content-Type: application/json' \
  -d '{"userId":"<uuid>","credits":2,"paymentIntentId":"pi_...","reason":"double charge #1234"}'
# Ban / unban
A -X POST https://<domain>/api/admin/users/<uuid>/ban -H 'Content-Type: application/json' -d '{"reason":"scripted abuse"}'
# Feature flag (BFF cache evicted instantly; worker TTL <=60s; llm_budget_* must be numeric)
A -X PUT https://<domain>/api/admin/flags/llm_budget_global_usd -H 'Content-Type: application/json' -d '{"value":"250","reason":"raise ceiling"}'
# Prompt rollback without redeploy (worker pin TTL <=60s; null = live version)
A -X PUT https://<domain>/api/admin/prompts/low_end -H 'Content-Type: application/json' -d '{"pinnedVersion":"1.2.0","reason":"v1.3 regression"}'
# The evidence trail
A "https://<domain>/api/admin/audit?target=<uuid>" | jq
```

- Every mutation REQUIRES a reason (≤300 chars) and writes an `audit_log`
  row (actor `00000000-…` = the operator sentinel) in the same transaction.
- **Bans**: live sessions die ≤60 s for current tokens (≤15 min worst case
  for pre-4.6 tokens without the tver claim, until they age out); login +
  refresh return 403 `account_banned`.
- **Refund 5xx**: retry the IDENTICAL call — the Stripe leg is idempotent
  per intent (≈24 h key lifetime); the CREDITS leg is NOT — check the
  trail endpoint before retrying a credits refund. Stripe refunds are
  full-amount only in v1. Credits are capped at 1000/call (the ledger is
  append-only; correct a mistake with a compensating entry, never a purge).
- **One human per key era**: the audit actor is a shared sentinel — if a
  second person ever gets the key, rotate to per-person keys first or the
  trail can't attribute actions.
- `audit_log` and `credit_ledger` are TRIGGER-enforced append-only
  (UPDATE, DELETE, and TRUNCATE all raise). Deliberate escape hatch for a
  court-ordered purge: `SET spectr.allow_purge = '1'` in the session
  first (greppable act). NEVER set `No Reset On Close=true` on the Npgsql
  connection string — the pool's session reset is what confines the hatch.
- `webhook_events` carries no user_id (payload hashes only) — the trail
  endpoint returns the user's Stripe ids + recent events for correlation.
- Exposure posture: the surface rides the public edge, protected by the
  key alone (404-invisible unconfigured, ≥32-char boot gate,
  constant-time compare). For defense-in-depth add a Caddy IP allowlist:
  `@adminOutside { path /api/admin/* not remote_ip <your-ip>/32 }` +
  `handle @adminOutside { respond 403 }` — deliberately NOT shipped by
  default (a moving operator IP would lock you out mid-incident).

## Alerting & status (story 10.4 / FR49 / NFR16)

**Phone pushes**: install the ntfy app, subscribe to a PRIVATE topic
(`ntfy.sh/<long-random-string>` — the topic name IS the secret), set
`NTFY_URL=https://ntfy.sh/<topic>` in `.env`. Grafana's provisioned
contact point + the backup/restore scripts all push there.

**The six FR49 conditions**:

| Condition | Mechanism |
|---|---|
| Job failure spike (>3 failed / 15 m) | Grafana rule `spectr-failure-spike` (prom) |
| LLM budget ≥80% (global, month) | Grafana rule `spectr-llm-budget-80` (SQL vs `feature_flags.llm_budget_global_usd`; a missing/NULL flag keeps it silent — set the flag row, env-fallback ceilings aren't DB-visible) |
| Billing/email webhook failures | Grafana rule `spectr-webhook-failures` (stuck >15 m or errored, 30 m window) |
| Verdict wrong-rate >10% (7 d, n≥10) | Grafana rule `spectr-wrong-rate` |
| Disk >80% | Grafana rule `spectr-disk-80` via node_exporter (noData = ALERTING — exporter down is an incident). `--path.rootfs=/host` strips the prefix, so the host root is `mountpoint="/"` — first-boot sanity: `node_filesystem_avail_bytes{mountpoint="/"}` must return a sample or this rule pages permanently |
| Backup missed | healthchecks.io dead-man check — `backup.sh` pings `HEALTHCHECKS_BACKUP_URL` on success; a missing ping alerts EXTERNALLY (a dead cron can't report itself) |

**healthchecks.io setup** (independent of the VPS by construction):
1. Check "spectr-backup": period 24 h, grace 3 h → copy the ping URL into
   `.env` as `HEALTHCHECKS_BACKUP_URL`.
2. Uptime probe on `https://<domain>/healthz` (healthchecks.io supports
   scheduled HTTP checks via cronless monitors; UptimeRobot free tier is
   the fallback) → alert on non-200 / body ≠ `{"status":"ok"}`.
3. Point both integrations at the same ntfy topic (healthchecks.io has a
   native ntfy integration) — one buzz channel.

**Status page (NFR16)**: template at `infra/status/index.html`. Publish it
OUTSIDE the VPS: create public repo `spectr-status`, copy the file as
`index.html`, enable GitHub Pages (main branch, root). Incident procedure:
edit the status card + incident log, commit — from any device. Never serve
the status page from the VPS.

**Tuning**: rules live in `infra/grafana/provisioning/alerting/rules.yml`
(re-provisioned on every deploy — edit in the repo, not the UI; UI edits
to provisioned rules don't persist). CAUTION: deploys `scp -r` OVER the
VPS copy — a deleted/renamed rule file lingers there and Grafana keeps
provisioning it (renamed uid = zombie duplicate). When removing a rule,
also delete the stale file on the VPS (or add a `deleteRules:` entry).

**execErrState = Error everywhere**: a broken datasource (wrong grafana
DB password, revoked grant) pushes a DatasourceError notification —
alerting failing must itself alert, with an honest label.

## Backups & restore proof (story 10.2 / AR31 / NFR15)

Nightly `pg_dump` → R2 `backups/` (30 d retention, script-side prune +
bucket lifecycle belt-and-braces). Weekly restore test into a THROWAWAY
postgres:16 container with schema/data assertions + a staleness gate
(newest dump older than 30 h = the nightly silently died = failure).
Failures exit non-zero and push to `NTFY_URL` when configured (10.4
formalizes alerting).

### Setup (VPS)

1. Create a THIRD R2 token `R2_BACKUP_*` scoped to `backups/` ONLY —
   dumps contain the entire database; the BFF/worker tokens must never
   read them. Add to `/opt/spectr/.env` (+ optional `NTFY_URL`).
2. Cron (as the deploy user):
   ```
   15 03 * * *  cd /opt/spectr && ./backup.sh >> backup.log 2>&1
   30 04 * * 0  cd /opt/spectr && ./restore-test.sh >> restore-test.log 2>&1
   ```
3. R2 lifecycle rule: `backups/` prefix, expire after 30 d (the script
   prunes too — either alone suffices, together they're safe).
4. Knobs (optional, in `.env`): `RETENTION_DAYS` (default 30),
   `AGE_HOURS_MAX` (staleness gate, default 30). Add logrotate for
   `backup.log`/`restore-test.log` or truncate quarterly — cron `>>` grows
   unbounded.

### Restore drill (the launch gate, NFR15)

Procedure (identical to what `restore-test.sh` automates — run manually
once pre-launch and log it below):

1. `./restore-test.sh` on the VPS — fetches newest dump, restores into a
   scratch container, asserts `__EFMigrationsHistory` ≥ 1, tables ≥ 20,
   `users` queryable.
2. For a REAL disaster restore (all commands from `/opt/spectr`):
   ```
   docker compose -f compose.prod.yml --env-file .env down
   docker volume rm spectr_postgres_data     # verify name: docker volume ls
   IMAGE_TAG=$(sed -n 's/^CURRENT_TAG=//p' .deploy-state) \
     docker compose -f compose.prod.yml --env-file .env up -d postgres
   gunzip -c dump.sql.gz | docker compose -f compose.prod.yml --env-file .env \
     exec -T postgres psql -U spectr -d spectr -v ON_ERROR_STOP=1
   ./restore-test.sh --dump dump.sql.gz      # prove it before serving traffic
   ./deploy.sh redeploy                      # bring the full stack back
   ```
   Dumps are `--clean --if-exists` — idempotent replay.
3. Log the drill:

| Date | Dump | Result | Notes |
|------|------|--------|-------|
| 2026-07-03 | spectr-20260703-222012.sql.gz (dev-stack drill) | PASS — 40 migrations, 42 tables, users queryable | Full cycle: backup.sh → minio → restore-test.sh scratch container. VPS drill pending first deploy (10.8 gate). |

## Email deliverability (story 4.2 / NFR25)

The email pathway: producer → `IEmailSender` (BFF: template render +
suppression check) → `send_email` dramatiq actor (`maintenance` queue,
3 retries) → Resend HTTP API. Without `RESEND_API_KEY` the actor logs
instead of sending (dev default).

### Resend account setup

1. Create the Resend account; generate an API key (`re_...`).
   - Worker env: `RESEND_API_KEY=re_...`
   - BFF env: `Resend__ApiKey=re_...` (gating/visibility only — the BFF never
     calls Resend directly).
2. Add the sending domain in Resend (Domains → Add). Until DNS verifies,
   keep the default `Resend__FromAddress` (`onboarding@resend.dev` sandbox —
   sends only to the account owner's address).

### DNS checklist (SPF / DKIM / DMARC — complete BEFORE launch)

Resend shows the exact records under Domains → your domain. Verify each:

- [ ] **SPF**: TXT on the Resend-provided `send` subdomain, value
      `v=spf1 include:amazonses.com ~all` (Resend rides SES). Verify:
      `nslookup -type=TXT send.<domain>`
- [ ] **DKIM**: the `resend._domainkey.<domain>` TXT record (p=... public key).
      Verify: `nslookup -type=TXT resend._domainkey.<domain>`
- [ ] **DMARC**: TXT at `_dmarc.<domain>`, start with
      `v=DMARC1; p=none; rua=mailto:<ops-address>` and tighten to
      `p=quarantine` after 2 clean weeks of reports.
- [ ] Resend dashboard shows the domain **Verified** (it checks SPF+DKIM).
- [ ] Send a test through the pipeline (`send_email` actor with a real key)
      to a Gmail address; confirm `PASS` for SPF, DKIM, and DMARC in the
      "show original" headers.
- [ ] Update `Resend__FromAddress` to the real domain sender
      (e.g. `SPECTR <noreply@spectr.app>`) in prod env only.

### Bounce/complaint webhook

1. Resend dashboard → Webhooks → Add endpoint:
   `https://<prod-host>/api/email/webhook`, events `email.bounced`,
   `email.complained`.
2. Copy the signing secret (`whsec_...`) → BFF env `Resend__WebhookSecret`.
   Unconfigured secret → the endpoint answers 503 and Resend retries.
3. Suppressions land in the `email_suppressions` table; `QueueEmailSender`
   skips suppressed addresses at enqueue time. Rows are never auto-deleted —
   remove manually only with the user's explicit re-consent.

### Prod boot gate

Set `SPECTR_REQUIRE_EMAIL=1` on BOTH services in prod:
- BFF: boot fails unless `Resend__ApiKey` AND `Resend__WebhookSecret` are set.
- Worker: dramatiq startup fails unless `RESEND_API_KEY` is set — the worker
  is the component that actually sends; without this gate a configured-BFF /
  unconfigured-worker deploy silently stubs every email.

### Operational notes

- **Dead letters**: after `max_retries=3` transient failures, dramatiq moves
  the message to the `dramatiq:maintenance.XQ` dead-letter queue (7-day TTL).
  A lost dunning/retention email is recoverable from there — check XQ depth
  when Resend has an outage. (Monitoring hook: 10.2.)
- **Latency**: `send_email` shares the maintenance lane with `sweep_retention`
  on a 1-process worker — an email enqueued mid-sweep waits. Fine for today's
  producers (retention warnings); REVISIT before 4.3 puts time-sensitive
  reset links ("expires in N minutes") on this lane.
- **Queue payload visibility**: enqueued messages carry recipient + rendered
  HTML in Redis until consumed, and dramatiq failure logs include actor args.
  Today's producers embed no secrets; 4.3 (verification/reset links) must
  either accept short-token-expiry exposure or move to an outbox-reference
  pattern. Decision recorded in story 4.2 review.
- **Suppressed = unreachable**: a suppressed address silently receives
  NOTHING — including password resets. Support diagnosis: check
  `email_suppressions` for the user's address; removal only with the user's
  explicit re-consent (complaints especially).

## GDPR: export, deletion, and the retention policy (story 4.6)

- **Export**: `GET /api/me/export` — synchronous JSON (account, songs,
  versions, reports, verdicts, conversations) + media manifest with 15-min
  presigned links. Rate-limited 2/hour per user.
- **Deletion**: `POST /api/me/delete` (password re-auth; typed confirmation
  in the UI). Synchronous: audit row (`audit_log`, action=account_delete),
  token-version bump, refresh/auth-token revocation, user-row delete (fires
  the social FK cascades). Asynchronous: the `delete_account_data` actor
  (maintenance queue) removes the content subtree + storage objects —
  idempotent, safe to replay by re-enqueuing with the user id.
- **Active subscription**: deletion cancels the Stripe subscription
  IMMEDIATELY (no refund for the remaining period) and only after the user
  explicitly confirms (409 → confirmCancel round-trip).
- **RETENTION POLICY (the "detached per policy" definition)**: Stripe-side
  customer/invoice records are RETAINED (Tax/NFR23 — financial records,
  legitimate interest). Local billing tables — `subscriptions`,
  `credit_ledger`, `usage_events`, `webhook_events`, `llm_calls` — are
  RETAINED keyed by the orphaned user id, which is pseudonymous once the
  user row is gone (no PII in those tables). `audit_log` rows are permanent.
  Everything content-shaped (audio, stems, .als, reports, verdicts, chats,
  reference library, social rows) deletes.
- **Token-versioning**: `users.token_version` + the `tver` JWT claim.
  Password reset and account deletion bump it; OnTokenValidated rejects
  stale tokens within a 60 s cache window (instant same-process). A support
  "kill all sessions for user X" = bump the column manually.

## Secret rotation (story 10.1 expansion)

All prod secrets live in `/opt/spectr/.env` (chmod 600). Rotation =
edit `.env` → `./deploy.sh redeploy` (re-applies the CURRENT image tag —
`IMAGE_TAG` is deploy-state-managed, never in `.env`, so a bare
`docker compose up -d` would refuse on the `:?` substitution).

- `JWT_KEY` (`Jwt__Key`): invalidates all access tokens (≤15 min blast
  radius); refresh tokens are DB-hashed and unaffected. For a
  kill-all-sessions instead, bump `users.token_version` (4.6).
- `ANON_SIGNING_KEY`: rotation orphans anon device + reviewer cookies —
  anon analyses in their 72 h window become unclaimable. Rotate only on
  suspected compromise.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: create the new key in the
  dashboard first, swap, then revoke the old (webhook secret: roll the
  endpoint secret in Stripe → update env → restart — a mismatch window
  5xxes webhooks, which Stripe retries).
- `ANTHROPIC_API_KEY`: rotate freely; only the workers read it.
- `R2_BFF_*` / `R2_WORKER_*`: create replacement token, swap, revoke.
  Presigned URLs signed by the old token die at revocation (≤2 h upload /
  ≤15 min read windows).
- `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET`: rotate freely; update env and
  restart worker + BFF.
