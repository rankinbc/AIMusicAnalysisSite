# SPECTR Launch Checklist (story 10.8)

The go/no-go gate document. Every box gets a date + initials when executed
on the REAL production environment. Nothing ships to paying users with an
unchecked box in "Blocking". Public surface is single-user — see
`PRPs/solo-fork-strip-social.md`.

## Blocking gates

### Infrastructure first boot (the 10.x deferred verifications)

- [ ] VPS provisioned per runbook "First-time VPS setup"; `/opt/spectr/.env`
      populated and `chmod 600` (verify: `stat -c %a /opt/spectr/.env` = 600)
- [ ] `docker login ghcr.io` with the read-only PAT (pull works)
- [ ] First `./deploy.sh <sha>` green: in-network `/healthz` verify passed
- [ ] `https://<domain>/healthz` returns `{"status":"ok"}` (TLS + caddy + BFF)
- [ ] Worker metrics (`worker-paid:9191` is compose-network-internal —
      exec into the container):
      `docker compose -f compose.prod.yml exec worker-paid python -c
      "import urllib.request as u; print(u.urlopen('http://localhost:9191').read().decode()[:2000])"`
      serves dramatiq families AND `spectr_job_duration_seconds`
      (the 10.3 multiproc fix verified live)
- [ ] Grafana (SSH tunnel): SPECTR Ops dashboard renders — all 10 panels
      non-erroring after the grafana RO role SQL
- [ ] Disk rule samples: `node_filesystem_avail_bytes{mountpoint="/"}`
      returns data (else the disk alert pages permanently — 10.4 CRITICAL)
- [ ] EF migrations applied at boot (BFF logs show BootMigrator)
- [ ] One real end-to-end analysis: upload → report renders → verdicts →
      coach reply (proves R2 CORS + presigned flow + worker + LLM key)

### Email (NFR25 — runbook "Email deliverability")

- [ ] SPF TXT verifies (`nslookup -type=TXT send.<domain>`)
- [ ] DKIM TXT verifies (`resend._domainkey.<domain>`)
- [ ] DMARC published (`_dmarc.<domain>`, start `p=none` + rua)
- [ ] Resend domain shows **Verified**; `RESEND_FROM` = the real domain
- [ ] Pipeline test to Gmail: SPF/DKIM/DMARC all PASS in "show original"
- [ ] Bounce webhook configured; a test bounce lands in `email_suppressions`

### Stripe sandbox matrix (NFR23)

Run in TEST mode with test clocks before flipping live keys:

- [ ] Subscribe (monthly) → webhook mirrors `subscriptions` row `active`
- [ ] Proration: monthly → annual upgrade mid-period — invoice prorates,
      row updates, no double-charge
- [ ] Dunning: fail a renewal (test card 4000…0341 + test clock advance) →
      `past_due` mirrored, dunning email sent, `next_payment_attempt` set;
      recovery card → `active` restored
- [ ] Refund via the ADMIN surface (`POST /api/admin/refunds` with a real
      test payment intent) — Stripe refund lands + audit row written
- [ ] Credits pack purchase → ledger `purchase` row; failed analysis →
      `reversal` row (AR16)
- [ ] Webhook signature: a bad-signature POST to `/api/billing/webhook`
      is rejected; a Stripe-dashboard resend of a real event re-processes
- [ ] Flip to LIVE keys; repeat ONE end-to-end subscribe with a real card
      + immediate cancel/refund

### Backups & restore (NFR15)

- [ ] Nightly cron installed; first `backup.sh` run green; object visible
      in R2 `backups/`
- [ ] healthchecks.io dead-man check armed (`HEALTHCHECKS_BACKUP_URL`);
      pause the cron once → the missing-ping alert fires
- [ ] **The VPS restore drill** (`./restore-test.sh`) — PASS logged in the
      runbook drill table (this is the 10.2 launch gate)

### Alerting test-fire (FR49)

- [ ] ntfy topic subscribed on the phone; private topic name recorded in
      the password manager
- [ ] Grafana → ntfy delivery proven: temporarily set a rule threshold to
      trip (e.g. disk > 0.01), receive the buzz, revert (repo-owned rules
      — edit + redeploy, don't UI-edit)
- [ ] DatasourceError path proven: break `GRAFANA_PG_PASSWORD` once →
      distinct error notification arrives → restore
- [ ] healthchecks.io uptime probe on `/healthz` armed + test-failed once
- [ ] Backup dead-man verified (above)

### Security & privacy

- [ ] `ADMIN_API_KEY` set (≥32 chars, generated, in the password manager);
      `/api/admin/audit` reachable with the key, 401 without
- [ ] NFR9 leak test green in CI (`ErrorEnvelopeLeakTests` — runs
      DB-free, so CI-green is a real signal) and a manual prod check:
      force a 404/400 — no stack traces, no schema internals (framework
      404s/400s are empty/ProblemDetails-shaped by design; only
      endpoint-authored errors + unhandled 500s carry the envelope)
- [ ] gitleaks CI green on the launch commit
- [ ] R2: two scoped app tokens + the backups-only token; bucket CORS per
      runbook checklist; NO blanket lifecycle rule
- [ ] Status page published on GitHub Pages (10.4 template) + linked from
      the ntfy incident habit
- [ ] Trust pages copy reviewed + approved by founder (story 6.2 —
      remove the `DRAFT` markers from the three `/trust/*` route files
      AND update the matching BFF shell strings in
      `PublicSiteEndpoints.cs`, which crawlers serve as a second copy);
      real ToS + legal Privacy Policy exist or are consciously deferred

## Non-blocking (first-week follow-ups)

- [ ] PostHog live-event sanity (upload_completed/report_viewed arriving)
- [ ] Sentry DSNs set in all 3 runtimes; one forced error per runtime
      visible with `correlation_id`
- [ ] Log rotation confirmed bounded (`docker system df` after 48 h)
- [ ] Review the known abuse gap: per-phase re-run has no abuse arms
      (10.6 note) — watch the paid queue for loops
- [ ] LRA/momentary stay UNMARKETED until Tech 3342 vectors exist (10.7)

## Sign-off

| Gate group | Date | Initials |
|---|---|---|
| Infrastructure first boot | | |
| Email | | |
| Stripe matrix | | |
| Backups & restore | | |
| Alerting | | |
| Security & privacy | | |
| **LAUNCH GO** | | |
