# Story 10.1: Production Deploy Topology

Status: review

## Story

As the operator,
I want one reproducible production deployment,
So that ship and rollback are single commands.

## Acceptance Criteria

1. **Given** `infra/compose.prod.yml` (AR29), **When** deployed on the VPS, **Then** caddy (auto-TLS, funnel statics, `/r/*` proxy), bff, worker-paid (W1), worker-free (W2), postgres:16, and redis:7 run.
2. **Given** EF migrations, **When** the BFF boots, **Then** migrations apply under an advisory lock; Alembic stays frozen.
3. **Given** CI on main (AR30), **When** green, **Then** images build and push to GHCR, the SSH deploy step runs `docker compose pull && up -d`, and `/healthz` smoke checks pass.
4. **Given** a bad deploy, **When** rollback runs, **Then** one command restores the previous image set (NFR29).
5. **Given** secrets (AR31), **When** deployed, **Then** the host `.env` is chmod 600 and no secrets exist in repo or images.

## Decisions of record (recon 2026-07-03)

1. **Caddy REPLACES nginx in prod** (arch L288: "Caddy proxies /r/* to BFF, everything else static/SPA"). One `spectr-web` image: multi-stage — frontend vite build → `caddy:2` with the dist at `/srv` + `infra/Caddyfile`. The Caddyfile reproduces nginx's crawler UA-split on `/r/*` (bots → BFF OG shell, humans → SPA), proxies `/api/*` (SSE-safe `flush_interval -1`), serves `/assets/*` with immutable cache headers (the "funnel statics" duty until Epic 6 adds the static entry). The dev nginx container stays dev-only.
2. **Worker Dockerfile finally lands** (deferred since 1.1): `python:3.11-slim` + libsndfile1/ffmpeg, shared+analysis installed with the lock as constraints, no [ml] extra, CMD mirrors the Procfile (`--processes 1 --threads 1`, queues via `WORKER_QUEUES` env so ONE image serves W1 and W2).
3. **Image set = 3**: `ghcr.io/rankinbc/spectr-{bff,worker,web}` tagged `{sha}` + `latest`. `infra/compose.prod.yml` pins `${IMAGE_TAG}`; **rollback = `./deploy.sh rollback`** (deploy.sh saves `PREVIOUS_TAG` before every repin — one command, NFR29).
4. **`/healthz`** (new, root, anon): DB `SELECT 1` + Redis ping → 200 `{status:"ok"}` / 503 with the failing dependency named. `/api/health/worker` stays as-is (queue depth surface).
5. **Migrations at boot, config-gated**: `Migrations:ApplyAtBoot=true` (prod compose only — dev keeps the CLI/launcher flow): `SELECT pg_advisory_lock(727274)` on a dedicated connection → `MigrateAsync` → unlock. Multi-replica-safe; Alembic untouched.
6. **CI deploy job** on `master` push, `needs` all 4 gates: buildx build+push ×3 (GITHUB_TOKEN, `packages: write`), **trivy scans the built images (CRITICAL = fail)** — the 4.1 deferral lands, SSH step (`VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY` secrets; skips gracefully when unset — repo works before a VPS exists) → `/opt/spectr/deploy.sh {sha}` → deploy.sh curls `/healthz` with retries and AUTO-ROLLS-BACK on failure.
7. **Deferred-pile folded in**: `UseForwardedHeaders` (X-Forwarded-For/Proto, config-gated `ForwardedHeaders:Enabled` — prod only; BFF is never port-published in prod, only caddy egresses, documented); `App:FrontendOrigin` boot-REQUIRED outside Development (the localhost-email-links hole closed); `.dockerignore` ×3 (AR31 "no secrets in images"); `SPECTR_REQUIRE_STRIPE/EMAIL=1` in the prod compose; prod R2 CORS + scoped worker token + tag-based lifecycle = runbook checklist (config on Cloudflare, not code).
8. **Out of scope**: backup.sh (10.2 — the infra/ slot is noted), funnel static vite entry (Epic 6), destructive-migration CI gate (runbook rule now, automation with 10.2's backup step).

## Tasks / Subtasks

- [x] Task 1 — worker Dockerfile lands (deferred since 1.1: python:3.11-slim + libsndfile/ffmpeg, lock-constrained installs, non-root, `WORKER_QUEUES` env so ONE image serves W1+W2; build context = components/, dev+overlay composes updated); `infra/Dockerfile.web` (vite build → caddy:2 + Caddyfile); BFF Dockerfile hardened (non-root uid 10001, curl liveness HEALTHCHECK against `/` — NOT /healthz, a DB blip must not restart-loop the BFF); `.dockerignore` at components/ (worker ctx), bff/, frontend/
- [x] Task 2 — `/healthz` (root anon: DB SELECT 1 + Redis ping → 200/503 naming the failure); `BootMigrator` (pg_advisory_lock 727274 on a dedicated connection, re-check-under-lock, gated `Migrations:ApplyAtBoot`, failure crashes the container by design); ForwardedHeaders gated `ForwardedHeaders:Enabled` (XFF/XFP, ForwardLimit 1, Known* cleared — safe ONLY because prod publishes no BFF port, documented); `App:FrontendOrigin` REQUIRED outside Development (boot throw). Tests: healthz ok, BootMigrator double-run no-op + lock released
- [x] Task 3 — `infra/compose.prod.yml` (6 services, `${IMAGE_TAG:?}` pins, redis AOF — the queue IS durable state per NFR16, worker env anchor for W1/W2, REQUIRE flags = 1, R2 twin scoped tokens); `infra/Caddyfile` (auto-TLS via SPECTR_DOMAIN, crawler UA-split on /r/* ported from nginx.conf, SSE-safe /api proxy, immutable /assets caching); `infra/deploy.sh` (pin → pull → up → /healthz verify → AUTO-rollback; `rollback` = one command via .deploy-state)
- [x] Task 4 — CI `deploy` job (master push, needs all 4 gates): buildx push ×3 to GHCR (`:sha` + `:latest`), trivy CRITICAL/ignore-unfixed on all 3 BUILT images (the 4.1 deferral lands), SSH step ships infra/ + runs deploy.sh — skips gracefully without VPS secrets
- [x] Task 5 — runbook: deploy/rollback section, first-VPS setup, destructive-migration rule (merge==deploy==applied), prod R2 checklist (CORS/twin tokens/no-blanket-lifecycle), secret-rotation expanded to the full AR31 set
- [x] Task 6 — gates: BFF 327/327 (2 new); worker/frontend untouched (Dockerfiles only); dev overlay re-headered as dev-parity; .env.example prod section

## Dev Notes

- nginx.conf bot regex to port: discordbot|slackbot|twitterbot|facebookexternalhit|whatsapp|telegrambot|linkedinbot|googlebot|bingbot|embedly|pinterest|skypeuripreview. OgShareEndpoints serves GET /r/{token} at root.
- BFF Dockerfile exists (sdk:10 → aspnet:10, :5000); publish excludes appsettings.Development.json (4.1).
- Advisory-lock key 727274 ("SPECTR" numerology — any stable int); use `dbContext.Database.GetDbConnection()` raw command around MigrateAsync; unlock in finally; log applied-migration count.
- ForwardedHeaders: KnownNetworks/Proxies cleared + ForwardLimit 1 ONLY when enabled — spoofing is impossible when the BFF has no published port (compose exposes caddy alone).
- CI: default branch is MASTER (not main — AR30 says "main", repo says master; gate on master).
- deploy.sh state at /opt/spectr: `.env` (secrets, chmod 600), `.deploy-state` (CURRENT_TAG/PREVIOUS_TAG), compose file pulled from the repo checkout or scp'd by CI (decide: CI scp's infra/ on every deploy — self-updating).
- Trivy: aquasecurity/trivy-action pinned by sha? action pinning: use full version tag; severity CRITICAL; ignore-unfixed.
- Worker deps: requirements.txt + lock constraints; needs gcc? psycopg2-binary avoids build; librosa needs numba (wheels ok py3.11).

### References

- [Source: PRPs/epics.md L1172-1185; AR29-31 L210-212; NFR29 L156; architecture.md D8 L122-128, L189, L288, L168/239-240]
- [Source: docker/docker-compose{,.prod}.yml; components/{bff/src/Spectr.Bff,frontend-spectr-v2}/Dockerfile; frontend nginx.conf; .github/workflows/ci.yml; docs/runbook.md]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- ASPDEPR005: ForwardedHeadersOptions.KnownNetworks obsolete on .NET 10 → KnownIPNetworks.

### Completion Notes List

- AC1: full 6-service stack at the AR29 path; caddy replaces nginx in prod (nginx stays dev); one worker image, two pools by env.
- AC2: advisory-lock boot migrations, gated to prod; Alembic untouched.
- AC3: GHCR ×3 + trivy + SSH smoke; pipeline green pre-VPS (graceful skip).
- AC4: `deploy.sh rollback` — one command; failed deploys auto-rollback.
- AC5: chmod-600 host .env documented; .dockerignores; publish already excludes Development.json (4.1); gitleaks guards the repo side.
- Deferred-pile paid: ForwardedHeaders, FrontendOrigin boot gate, image scanning, prod R2 checklist, REQUIRE flags.
- NOT verifiable locally: the CI deploy job + Caddyfile against a live VPS — first real deploy is the integration test (runbook's first-VPS section is the procedure). Compose/Caddyfile reviewed by adversarial pass instead.

### File List

- infra/: `compose.prod.yml`, `Caddyfile`, `Dockerfile.web`, `deploy.sh` (all new)
- Worker: `components/worker/Dockerfile` (new), `components/.dockerignore` (new)
- BFF: `src/Spectr.Bff/Dockerfile`, `.dockerignore` (new), `Services/BootMigrator.cs` (new), `Program.cs` (/healthz, migrator gate, ForwardedHeaders, origin gate)
- Frontend: `.dockerignore` (new)
- CI: `.github/workflows/ci.yml` (deploy job)
- Compose: `docker/docker-compose.yml` (worker context), `docker/docker-compose.prod.yml` (context + dev-parity header)
- Tests: `DeployTopologyTests.cs` (new, 2)
- Docs: `docs/runbook.md` (deploy/rollback/VPS/R2/rotation), `.env.example` (prod section)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter ops/security + Edge Case Hunter/Acceptance Auditor; infra is untestable locally so this pass WAS the integration gate — the auditor executed `docker compose config` validation, verified every env name against the reading code, confirmed LF storage via `git ls-files --eol`, and reproduced the 327/327 gate). Outcome: **Changes requested → all applied** (17 patches):

- [x] [CRITICAL] **The health verify was a permanent false positive**: `curl http://localhost/healthz` hit caddy with a Host that matches no site → empty-200/308, curl exits 0 WITHOUT reaching the BFF — AC3's smoke and AC4's auto-rollback were theater → deploy.sh probes the BFF directly inside the compose network (`compose exec bff curl localhost:5000/healthz` + `grep '"status":"ok"'`), retries env-tunable (default 60×5 s for first-boot migrations/ACME)
- [x] [High] `ForcePathStyle=true` contradicted S3StorageOptions' own "R2 must stay FALSE" doc → false in prod compose
- [x] [High] VPS couldn't pull (GHCR private, no login anywhere) → runbook first-time step 3b (read-scoped PAT)
- [x] [High] `worker_models` volume root-owned vs uid-10001 worker → mkdir+chown pre-USER; worker also gains a Redis-ping HEALTHCHECK
- [x] [High] Runbook's rotation procedure would die on the `IMAGE_TAG:?` substitution → `deploy.sh redeploy` verb (re-applies the current pin); runbook corrected
- [x] [Med] Concurrent master merges raced the VPS → CI `concurrency: deploy-production` + `flock` in deploy.sh; same-tag redeploy no longer erases the rollback target; `.env`-missing fails with an actionable message; `sed` replaces GNU-only `grep -oP`
- [x] [Med] **Images were pushed BEFORE trivy scanned them** (a CRITICAL-vuln image would already own `:latest`) → build `load:true` → scan → push post-scan
- [x] [Med] BootMigrator's pre-lock fast path left the lock UNTESTED and dodged the only unexercisable-in-prod code → always-lock (the double-run test now genuinely exercises acquire/release); `CommandTimeout=0` on the acquire (a peer's long migration must not crash-loop waiters); wait-log before the block; unlock failure never masks the migration error
- [x] [Med] Edge hardening: HSTS + www→apex redirect; `443/udp` (h3 was advertised but QUIC-unroutable); log rotation anchor on all 6 services; `RESEND_FROM` now `:?` (sandbox sender in prod = DMARC garbage); caddy pinned 2.8
- [x] [Med] **`Storage__Provider: s3` was DEAD CONFIG** (IFileStorage is hardcoded LocalDisk) — prod would write residual files into the container FS → explicit `local` + `/data` volume + honest comment (S3-backed IFileStorage = 10.x follow-up)
- [x] [Low] Root `.dockerignore` (repo-root web context uploaded .git + Windows node_modules); /healthz 3 s hard timeouts (wedged ≠ refused); BFF start-period 120 s (boot migrations); dropped `chown -R /app` (runtime user must not own its binaries); ssh-keyscan fails loud; compose header doc drift fixed; `.gitattributes` added to File List
- Verified-clean by the review: YAML anchor override (executed via compose config), rollback state math incl. failed-deploy and double-rollback paths, BootMigrator connection semantics (lock session == migration session; serialization holds regardless), worker Dockerfile paths/prompts/PATH all cross-checked, Caddyfile syntax + handle precedence, env names vs reading code (S3_*, SPECTR_REQUIRE_EMAIL, RESEND), CI bff context files, IMAGE_TAG env-over-env-file precedence.
- Known-flake note: `Concurrent_Posts_Converge_On_Same_Conversation_No_500` is bimodal (~1-in-4; "expected 3 enqueues, got 1" under the 3-way race) — pre-existing, unrelated to 10.1 (no coach paths touched), logged for a dedicated fix.
- Honest scope: live-VPS deploy remains the first real integration test (runbook is the procedure); `caddy validate` unavailable locally (syntax desk-checked).

### Change Log

- 2026-07-03: implemented on `ops/10-1-deploy-topology`. Gates: BFF 327/327; others untouched. Status → review.
- 2026-07-03 (review): 17 patches applied incl. the CRITICAL vacuous-health-check fix. Gates: BFF 327/327 re-verified.
