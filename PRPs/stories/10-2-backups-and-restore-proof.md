# Story 10.2: Backups & Restore Proof

Status: review

## Story

As the operator,
I want nightly backups that provably restore,
So that user data survives me breaking things.

## Acceptance Criteria

1. **Given** the nightly job (AR31), **When** it runs, **Then** `pg_dump` lands in R2 `backups/` with 30-day retention.
2. **Given** the weekly restore-test script, **When** it runs, **Then** a restore to a scratch database succeeds and a failure alerts.
3. **Given** the launch gate (NFR15), **When** before launch, **Then** one full restore has been performed and documented in the runbook.

## Decisions of record (2026-07-03)

1. **Host cron + shell scripts, zero new host dependencies**: `infra/backup.sh` runs `docker compose exec -T postgres pg_dump | gzip`, uploads via a dockerized `amazon/aws-cli` (R2 = S3 API; host needs only docker, which it has). No backup logic inside app images.
2. **R2 30-day retention is a BUCKET LIFECYCLE rule on `backups/`** (already in 10.1's R2 checklist), belt-and-braces with a script-side `aws s3 rm` prune of objects older than 30 d (lifecycle rules silently not-configured is the classic backup gotcha).
3. **Restore test restores into a THROWAWAY postgres:16 container** (never near the prod DB), asserts `__EFMigrationsHistory` matches the live DB's applied set and `users` is queryable. Row-count sanity, not byte-diff.
4. **Alerting hook = optional `NTFY_URL` env** (curl on failure; 10.4 formalizes phone-grade alerting — this story just ensures failures are LOUD: non-zero exit + ntfy when configured). Cron mails/logs are the fallback.
5. **Scripts are testable on the DEV stack**: both take `COMPOSE_ARGS`/env overrides so they run against docker/docker-compose.yml locally (validated in this story against dev postgres + minio) — the same code paths prod uses.
6. **Launch-gate (AC3)**: runbook gains the restore-drill procedure + a signed-off log table; the actual drill is executed on the real VPS pre-launch (10.8's checklist references it). Local dev-stack drill executed NOW and recorded as the procedure proof.
7. **Secrets**: R2 creds for backups reuse `R2_WORKER_*`? NO — separate `R2_BACKUP_*` token scoped to `backups/` prefix only (a leaked worker token must not grant backup reads; backups contain the ENTIRE database).

## Tasks / Subtasks

- [x] Task 1 — `infra/backup.sh`: dump (`--no-owner --clean --if-exists`) → gzip → size floor guard (>10 KiB — an empty dump is a failure, not a success) → stdin-streamed upload (no -v mounts; Git Bash mangles them) → prune >30 d by filename stamp → ERR-trap ntfy
- [x] Task 2 — `infra/restore-test.sh`: newest-dump discovery → **staleness gate** (newest >30 h old = the nightly silently died = failure) → scratch postgres:16 → psql replay → asserts migrations ≥1, tables ≥20, users queryable → cleanup; `--dump <file>` local mode
- [x] Task 3 — runbook Backups section (crons, R2_BACKUP scoped token #3 rationale, disaster-restore procedure, drill log w/ launch gate); .env.example additions
- [x] Task 4 — **full cycle EXECUTED against the dev stack** (real postgres w/ 40 migrations + throwaway minio): backup 4.3 MB → upload → restore-test PASS (40 migrations, 42 tables, users queryable); prune verified (planted 2025 object removed); staleness verified (only-old-backup → alert + exit 1)
- [x] Task 5 — no app code touched → gates unaffected; scripts LF-stored (.gitattributes from 10.1)

## Dev Notes

- Dev-stack validation: minio at localhost:9000, bucket `spectr` exists (minio-init), creds minioadmin/minioadmin. `aws --endpoint-url http://localhost:9000 s3 cp` via `docker run --network docker_default amazon/aws-cli`. Compose project name `docker` (dir-derived) — verify network name.
- pg_dump: `--no-owner --clean --if-exists` for clean re-restore; plain SQL (not custom format) keeps restore = psql (no pg_restore version dance).
- Windows dev: run scripts via Git Bash (`bash infra/backup.sh`).
- Bash on host must not require GNU date extensions beyond `date -d` (Debian has GNU date ✓; document).

### References

- [Source: PRPs/epics.md L1187-1197 (ACs), AR31 L212; architecture.md D8 L127]
- [Source: infra/ from story 10.1; docker/docker-compose.yml minio-init CORS/user bootstrap]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Windows Git Bash `-v` mount path-mangling avoided via stdin-streamed `aws s3 cp -` (needs `--expected-size`).
- Pipe `| tail` masked exit code during testing — verified `exit 1` on direct run.

### Completion Notes List

- AC1: nightly dump proven end-to-end on the dev stack (4.3 MB, 40-migration DB); retention = script prune + lifecycle rule.
- AC2: restore test proven (scratch container, 42 tables back); staleness gate doubles as missed-backup detection ahead of 10.4.
- AC3: drill procedure + log table in the runbook; dev-stack drill logged; the VPS drill is 10.8's launch-gate line item.
- Deliberate: backup creds are a THIRD scoped token (dumps = whole DB).

### File List

- `infra/backup.sh` (new), `infra/restore-test.sh` (new)
- `docs/runbook.md` (Backups section), `.env.example` (R2_BACKUP_*/NTFY_URL)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (combined adversarial pass; reviewer EXECUTED the .env-sourcing hypothesis and the date-UTC semantics experimentally). Outcome: **Changes requested → all applied** (11 patches):

- [x] [CRITICAL] **`.env` sourcing was a prod time bomb**: `set -a; . ./.env` explodes on the REQUIRED compose-format `RESEND_FROM=SPECTR <noreply@…>` value (bash parses `<…>` as redirection, aborts sourcing MID-FILE, silently drops every var below — including `R2_BACKUP_*` → every nightly dies at "no credentials", and the dev drill never caught it because infra/.env didn't exist) → literal per-key extraction loop in both scripts; regression-tested with a hostile `.env` planted
- [x] [High] **Scripts were never shipped**: CI scp'd only compose+deploy.sh — the documented crons pointed at files that wouldn't exist → CI ships all four, chmod +x'd; runbook setup updated
- [x] [High] **Scratch container leaked the FULL restored database for up to 7 days** on assertion-failure exits (`exit 1` doesn't fire ERR; cleanup was success-path + ERR only) → `trap cleanup EXIT` + per-run `-$$` name (also fixes concurrent-run mutual sabotage); leak-checked post-run
- [x] [High] **`ON_ERROR_STOP=0` made the proof an attempt** (half-failed COPY still passed the ≥20-tables check) → `=1` + explicit replay-failure alert; no benign-error class exists (--clean --if-exists --no-owner + scratch superuser), verified clean on the real 42-table dump
- [x] [Med] Decision-3 drift: `≥1` migrations was quietly weaker than "matches live applied set" → best-effort live-DB parity check (tolerates one raced deploy; scratch proof stands alone in --dump mode); proven live=40 restored=40
- [x] [Med] Secrets off docker argv (`ps`-visible for the whole multi-minute upload) → exported env + name-only `-e`
- [x] [Med] Runbook disaster-restore was un-runnable as written (no compose flags, no IMAGE_TAG, no ON_ERROR_STOP, no post-verify) → full command block incl. `.deploy-state` tag read + `restore-test.sh --dump` proof + `deploy.sh redeploy`
- [x] [Low] Staleness gate: malformed newest-object now FAILS instead of silently skipping (grep filter + parse-or-die); ` UTC` suffix on date input (experimentally verified equivalent on GNU, explicit anyway); prune failure after successful upload downgraded to a WARN (operator must not believe there's no backup when there is one); grep-empty pipefail guard; AGE_HOURS_MAX/RETENTION_DAYS + logrotate documented; shellcheck disables annotated
- Verified-clean: ERR/EXIT trap coexistence, pipefail through gzip, awk column math + decimal compare, cron spacing headroom (25.25 h max normal age vs 30 h gate).
- Re-validated end-to-end after patches: backup with hostile .env present → upload OK; restore-test → ON_ERROR_STOP=1 replay clean, 40/42/t assertions, live parity ✓, zero leaked containers.

### Change Log

- 2026-07-03: implemented + dev-stack-proven on `ops/10-2-backups`. Status → review.
- 2026-07-03 (review): 11 patches applied incl. the CRITICAL .env-sourcing fix; full cycle re-executed.
