# Deployment Guide

The operational runbook is **[runbook.md](runbook.md)** — deploys, rollback,
stuck-job triage, first-time VPS setup live there. Launch gates:
**[launch-checklist.md](launch-checklist.md)**. This file is the orientation
layer.

## Production stack

`infra/compose.prod.yml` is THE production compose (do not confuse with
`docker/docker-compose.prod.yml`, a dev prod-parity overlay for the queue
split). Services: caddy (80/443, TLS), bff, **worker-paid** (W1: `coach
analysis-paid`), **worker-free** (W2: `analysis-free maintenance`), postgres,
redis (AOF — queued jobs survive restarts), prometheus + grafana (127.0.0.1)
+ node-exporter.

## Deploy commands (from /opt/spectr on the VPS)

```bash
./deploy.sh <sha>       # deploy a build
./deploy.sh redeploy    # re-apply current tag
./deploy.sh rollback    # repin previous tag
```

EF migrations apply at BFF boot in prod (`Migrations__ApplyAtBoot=true`,
advisory-lock serialized). Health: `GET /healthz` (liveness),
`GET /api/health/worker` (heartbeat + queue depth — see STARTUP.md #3 for the
half-dead-worker caveat).

## Environment

Root `.env.example` is the canonical secret inventory (JWT_KEY,
ANON_SIGNING_KEY, ANTHROPIC_API_KEY, Stripe, Resend, R2 S3 creds, Grafana).
Prod worker uses the SDK/API key path (`USE_CLAUDE_CLI` is dev-only) and
per-tier LLM budget ceilings via feature flags. Storage in prod is R2 via
presigned URLs (`Storage__S3__ServiceUrl` switches it on).

## CI

GitHub workflows under `.github/workflows/` run the validation gates
(frontend four gates, dotnet build/test, pytest, ruff; axe accessibility check
in the frontend suite). Images build from `components/bff/src/Spectr.Bff/Dockerfile`
and `components/worker/Dockerfile` (worker CMD honors `$WORKER_QUEUES`).
