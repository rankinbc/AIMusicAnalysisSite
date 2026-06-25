# docker

Docker Compose configuration for local development. Wires up PostgreSQL, Redis,
the BFF, the worker, and the frontend.

Start all services: `docker compose up -d`
Stop all services: `docker compose down`

## allin1 structure-detection image (`allin1/`)

Phase 1 runs the `allin1` music-structure analyzer **inside a container**
(`allin1:latest`) rather than importing it in-process — NATTEN/madmom (its
deps) have no native Windows wheels and pin an old toolchain. The worker stays
on the host and calls the container per track via `DockerAllin1`
(`components/analysis/src/audio_analysis/structure/docker_allin1.py`).

Build the image (CPU; ~10 min first time, downloads PyTorch + builds natten):

```
docker build -t allin1:latest docker/allin1
```

It is **not** a compose service — it's a one-shot `docker run` per analysis, so
the worker host just needs Docker running and the image built. Without it,
structure detection reports "unavailable" (logged once) and Phase 7 renders
"not assessed" rather than failing the track.

- **CPU**: allin1 runs demucs source-separation first → minutes per track, scaling
  with length (~10-20 min for a full 5-8 min song). The `docker/allin1/Dockerfile`
  here is CPU-only.
- **GPU**: ~10-15 s/track. Build the CUDA variant and set `ALLIN1_USE_GPU=1`
  (and `ALLIN1_IMAGE` if tagged differently) so the worker passes `--gpus all`.

**Env knobs** (read by `DockerAllin1` / the `detect_structure_job` actor):
- `ALLIN1_TIMEOUT` — per-track analysis timeout in seconds (default **1800**).
  Generous so CPU runs on full-length tracks complete instead of timing out to
  "not assessed"; the actor's dramatiq time-limit tracks this automatically. Lower
  it on GPU. (The old hard-coded 300 s silently failed real songs.)
- `ALLIN1_USE_GPU` / `ALLIN1_IMAGE` — see GPU note above.

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
