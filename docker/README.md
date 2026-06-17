# docker

Docker Compose configuration for local development. Wires up PostgreSQL, Redis, and the allin1 structure-detection container.

The allin1 model requires Docker on Windows — NATTEN (its dependency) has no native Windows wheels.

Start all services: `docker compose up -d`
Stop all services: `docker compose down`

## Worker topology: dev vs prod (AR23 — story 2.5)

- **Dev** — `docker compose up`: a single `worker` service drains all four queues
  (`coach analysis-paid analysis-free maintenance`). Functionally identical to
  prod since one process still handles every message.
- **Prod** — `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`:
  the `docker-compose.prod.yml` overlay adds two dedicated pools to prove the
  AR23 queue split (FR34 starvation-proofing):
  - `worker-paid` (W1) → `coach analysis-paid`
  - `worker-free` (W2) → `analysis-free maintenance`

  The overlay moves the single dev `worker` service to the `dev-only` profile so
  it does **not** start under the prod overlay (only default-profile services
  start unless `--profile dev-only` is passed). `deploy.replicas: 0` is **not**
  used — plain `docker compose up` ignores it (swarm-only); the profile mechanism
  is honored by compose v2.

**Scope note:** the full production stack (caddy/TLS, image registry, etc.) is
owned by Epic 10 story 10.1. This overlay only ships the W1/W2 queue split.
