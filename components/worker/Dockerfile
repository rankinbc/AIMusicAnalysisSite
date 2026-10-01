# Story 10.1 — the worker image (deferred since story 1.1).
# ONE image serves both prod pools: W1/W2 differ only by WORKER_QUEUES
# (+ WORKER_THREADS on the interactive pool).
# No [ml] extra — torch/demucs stay out (USE_DEMUCS=False per analysis
# gotchas); allin1 structure detection runs via the separate docker/allin1
# one-shot image, not in this container.
FROM python:3.11-slim

# libsndfile: soundfile; ffmpeg: librosa/audioread decode fallback.
# upgrade first: the deploy gate trivy-scans the built image with
# exit-code=1 on CRITICALs - stale base-layer packages (perl-base CVEs,
# 2026-09-14) fail the push even when nothing in the repo changed.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Lock file is the constraint set for everything (CI parity — see
# requirements.in header).
COPY worker/requirements.txt worker/requirements.lock.txt ./worker/
COPY shared/ ./shared/
COPY analysis/ ./analysis/
RUN pip install --no-cache-dir -e ./shared -c worker/requirements.lock.txt \
    && pip install --no-cache-dir -e ./analysis -c worker/requirements.lock.txt \
    && pip install --no-cache-dir -r worker/requirements.txt -c worker/requirements.lock.txt

COPY worker/app/ ./app/
COPY worker/prompts/ ./prompts/

# Non-root (AR31 hygiene). TORCH_HOME mountpoint pre-created + owned —
# Docker would otherwise create the volume mount root-owned and the first
# model download EACCESes.
RUN useradd --create-home --uid 10001 spectr \
    && mkdir -p /data/models /tmp/dramatiq-prometheus \
    && chown -R spectr /data /tmp/dramatiq-prometheus
USER spectr

# Liveness: a wedged dramatiq master that can't reach Redis is dead weight —
# let compose restart it.
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import os, redis; redis.Redis.from_url(os.environ['REDIS_URL']).ping()"

ENV PYTHONUNBUFFERED=1 \
    TORCH_HOME=/data/models \
    WORKER_QUEUES="coach ai analysis-paid analysis-free maintenance"     WORKER_THREADS=1

# Mirrors the Procfile: single process (Demucs memory profile) — prod scales
# by POOLS (W1/W2 services). WORKER_THREADS defaults to 1 for the batch pool;
# ONLY the interactive pool (`coach ai`, I/O-bound LLM calls, no DSP) raises
# it (compose.prod.yml worker-paid) so a coach reply never waits behind a
# 60 s specialist. Never raise it on a pool that runs analyze_audio_job.
CMD ["sh", "-c", "python -m dramatiq app.dramatiq_app --processes 1 --threads ${WORKER_THREADS:-1} --queues $WORKER_QUEUES"]
