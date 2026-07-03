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

### Change Log

- 2026-07-03: implemented on `ops/10-1-deploy-topology`. Gates: BFF 327/327; others untouched. Status → review.
