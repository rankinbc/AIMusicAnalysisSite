# Story 10.4: Phone-Grade Alerting & Status

Status: review

## Story

As the operator,
I want my phone to buzz when the business breaks,
So that incidents never wait for me to look.

## Acceptance Criteria

1. **Given** Grafana alert rules (FR49), **When** job failures spike, LLM budget hits ≥80%, billing webhooks fail, wrong-rate exceeds 10%, disk exceeds 80%, or a backup is missed, **Then** ntfy.sh pushes reach the operator's phone.
2. **Given** external uptime probing, **When** `/healthz` fails, **Then** healthchecks.io alerts independently of the VPS.
3. **Given** an incident (NFR16), **When** it occurs, **Then** a status page (static acceptable) is updateable.

## Decisions of record (2026-07-03)

1. **Grafana-provisioned alerting** (`infra/grafana/provisioning/alerting/`): one ntfy contact point (webhook POST to `${NTFY_URL}` — ntfy renders the JSON body; ugly-but-buzzes, zero middleware), root policy routes everything there, 5 rule groups. 10.3 built the signals; this story only adds rules.
2. **The six FR49 conditions map to**: (a) failure spike — `increase(spectr_job_duration_seconds_count{status="failed"}[15m]) > 3`; (b) LLM budget ≥80% — Postgres: month spend vs `feature_flags.llm_budget_global_usd` (NULL ceiling ⇒ rule stays OK — env-fallback ceilings aren't DB-visible, documented); (c) billing webhook failures — `webhook_events` rows with `processed_at IS NULL AND received_at < now()-15min` or `processing_error IS NOT NULL` in 30 m; (d) wrong-rate — 7 d `verdict_user_state` wrong% > 10 with n ≥ 10 guard; (e) disk >80% — **node_exporter joins the stack** (no other way to see the host); (f) missed backup — NOT a Grafana rule: `backup.sh` pings `HEALTHCHECKS_BACKUP_URL` on success and healthchecks.io alerts on a missing ping (the VPS can't reliably report its own cron death; external dead-man's switch is the correct shape).
3. **healthchecks.io**: two checks — uptime probe on `https://<domain>/healthz` (their cron-less HTTP monitor or UptimeRobot equivalent; runbook) + the backup dead-man ping. Independent of the VPS by construction.
4. **Status page = external + static**: `infra/status/index.html` template published to GitHub Pages (public repo `spectr-status` or the repo's Pages — operator procedure in the runbook; updating = edit + push from anywhere, including a phone). NOT served by caddy — a status page on the VPS dies with the VPS.
5. **No-data handling**: all rules `noDataState: OK` except disk (node_exporter down IS an incident → Alerting). Alert evaluation interval 1 m, `for:` dampening per rule (failure spike 5 m, budget 15 m, others 10 m).

## Tasks / Subtasks

- [x] Task 1 — `provisioning/alerting/{contact-points,rules}.yml`: ntfy webhook contact point + root policy (30 s wait / 4 h repeat), 5 rules with per-rule `for:` dampening; NTFY_URL interpolated into grafana env with a parseable placeholder default
- [x] Task 2 — node_exporter v1.8.1 (rootfs mount, pid host, unpublished) + prometheus `node` scrape job
- [x] Task 3 — backup.sh success-only dead-man ping (fail-soft; key added to the literal .env extraction list) + .env.example
- [x] Task 4 — `infra/status/index.html` template (ok/warn/down cards + incident log; EXPLICITLY never served from the VPS) + runbook: six-condition mapping table, healthchecks.io setup, GitHub Pages procedure, provisioned-rules-not-UI tuning warning
- [x] Task 5 — compose config VALID, all provisioning yaml parse-checked, bash -n on all 3 scripts; app code untouched (no BFF/worker/frontend gate churn)

## Dev Notes

- Grafana unified-alerting provisioning schemas: `contactPoints:`/`policies:`/`groups:` (apiVersion 1). Env interpolation works in alerting yaml as in datasources.
- ntfy webhook: Grafana webhook POSTs JSON; ntfy publishes raw body as the notification text. Set `Title` via ntfy topic defaults; acceptable for v1 (a readable-message proxy is a 10.x nicety).
- node_exporter: `prom/node-exporter` w/ `--path.rootfs=/host` + `/:/host:ro,rslave` mount; prometheus scrapes `node-exporter:9100`; disk expr `(1 - node_filesystem_avail_bytes{mountpoint="/host",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes) > 0.8` — verify mountpoint label on the VPS (runbook note).
- webhook_events columns confirmed: id, event_type, payload_hash, received_at, processed_at, processing_error.
- Rules reference datasource UIDs `spectr-prom` / `spectr-pg` (10.3's fixed uids — that's why they were pinned).

### References

- [Source: PRPs/epics.md L1212-1222 (ACs), FR49 L104, AR32 L213, NFR16]
- [Source: 10.3 — metrics families, datasource uids, provisioning layout; 10.2 — backup.sh/NTFY pattern]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- none — infra-only story; validations were compose config + yaml parse + bash -n.

### Completion Notes List

- AC1: five in-stack conditions as provisioned Grafana rules; the sixth (missed backup) is a healthchecks.io dead-man ping by design — the VPS can't report its own cron death.
- AC2: /healthz probed externally (healthchecks.io / UptimeRobot); same ntfy channel.
- AC3: status TEMPLATE + GitHub Pages procedure — nothing is auto-published; the operator performs the Pages setup once (runbook). Never the VPS.
- Known limits (documented): budget rule sees only the feature_flags ceiling (env fallback invisible); ntfy shows raw Grafana JSON (readable, ugly — later nicety); alert rules render live only on the VPS (same class as 10.3's dashboard).

### File List

- `infra/grafana/provisioning/alerting/contact-points.yml` (new), `rules.yml` (new)
- `infra/compose.prod.yml` (node-exporter service, grafana NTFY_URL env)
- `infra/prometheus/prometheus.yml` (node scrape job)
- `infra/backup.sh` (dead-man ping), `infra/status/index.html` (new)
- `docs/runbook.md` (Alerting & status), `.env.example`

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (combined adversarial pass; schemas verified against Grafana 11 provisioning knowledge + every SQL column cross-checked against EF entities + obs.py metric names). Outcome: **Changes requested → all applied** (9 patches):

- [x] [CRITICAL] **Disk rule matched NOTHING**: `--path.rootfs=/host` STRIPS the prefix — the host root exports as `mountpoint="/"`, so `mountpoint="/host"` = empty vector = noData = Alerting = a PERMANENT false page from first boot with zero real disk coverage → `mountpoint="/"` + runbook first-boot sanity check
- [x] [High] **Placeholder ntfy default was a live public topic**: unset NTFY_URL would have POSTed business telemetry (spend %, failure counts) to a guessable public topic while delivery LOOKED healthy → unroutable `http://127.0.0.1:9/ntfy-unconfigured` (parseable; fails loudly in the notification log)
- [x] [High] **Webhook rule auto-resolved still-broken events**: the 24 h clamp sent a "Resolved" push at hour 24 for an event still unprocessed — the worst money-path failure mode → clamp dropped (repeat_interval 4 h is the nag governor; abandonment is an operator decision, not a timer's)
- [x] [High] **`execErrState: OK` silently disabled 3 of 5 conditions on a broken Postgres datasource** (wrong grafana password / revoked grant / cast error = budget+webhook+wrong-rate dark forever) → `Error` on all five (DatasourceError pushes with honest labels; alerting failing must itself alert)
- [x] [Med] Budget annotation promised a 100% hard stop that CLI-transport mode disables → reworded ("API-transport mode only"); completion note overclaim fixed (template + procedure, nothing auto-published); stale-rule-file zombie warning in the runbook (scp overlays, provisioning doesn't delete)
- [x] [Low] `rawQuery: true` + `editorMode: code` on the pg models (export-shape insurance); month boundary pinned to timestamptz UTC; wrong-rate updated_at drift + increase() extrapolation noted as accepted
- Verified-clean: contactPoints+policies single-file valid; groups/relativeTimeRange/threshold-model shapes; env interpolation in alerting provisioning; every metric/column reference (spectr_job_duration_seconds_count, feedback='wrong', outcome='ok', webhook_events columns); dead-man ping semantics (set -e guarantees no ping on failure; prune-warn doesn't block it); CI scp -r covers alerting/.

### Change Log

- 2026-07-03: implemented on `ops/10-4-alerting`. Compose/yaml/bash validated; app code untouched. Status → review.
- 2026-07-03 (review): 9 patches incl. the CRITICAL dead disk rule. Yaml re-validated.
