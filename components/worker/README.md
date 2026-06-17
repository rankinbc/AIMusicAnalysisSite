# worker

**Purpose**: Dramatiq worker that orchestrates the 7-phase audio analysis pipeline.
Pulls jobs from Redis-backed queues (see **Queue topology** below), calls
`audio_analysis.run_pipeline()`, writes the result to the `analyses` table, and
flips `analysis_jobs.status` to `complete` (or `failed` with `error_message` on
exception). Pre-loads the Demucs model at worker startup, not per-task. Job state
is the single source of truth in Postgres — Redis is only the queue medium.

**Inputs**: file paths in `analysis_jobs.version_id → song_versions.file_path`, resolved against `$STORAGE_LOCAL_ROOT` (default `/data`).

**Outputs**: PostgreSQL `analyses` table (canonical) + optional JSON dump under `$RESULTS_DIR` (default `/data/output/analysis_results`).

**Stack**: Python 3.11+, dramatiq 1.16+ (replaces Celery in v2), Redis (broker), SQLAlchemy 2 (sync/psycopg2), Demucs.

## How to run

```
python -m dramatiq app.dramatiq_app
```

The Procfile is the canonical entrypoint and is wired into the docker-compose
`worker` service.

## Queue topology (AR23 — story 2.5)

Paying users' analyses must never starve behind the free-tier flood (FR34). The
guarantee is **structural, by process separation** — two worker pools, not
intra-worker priority (Dramatiq's `--queues` is an unordered set with no
cross-queue precedence within one worker).

| Queue           | Actor(s)                                                                                   | Consumed by |
|-----------------|--------------------------------------------------------------------------------------------|-------------|
| `analysis-paid` | `run_triage`, `run_specialist`, `run_reference_analyzer`, `classify_stems`, `rerun_phase`  | W1          |
| `analysis-free` | `analyze_audio_job` *(sole declarer — see below)*                                          | W2          |
| `coach`         | `coach_reply`                                                                              | W1          |
| `maintenance`   | *(provisioned-but-empty; Epic 3/4 add `sweep_retention` / `send_email`)*                   | W2          |

- **`analyze_audio_job` is tier-routed by the BFF, not by its decorator.** The BFF
  enqueues it to `analysis-paid` for pro/credits users and `analysis-free` for
  free/anonymous (`DispatchAnalysisAsync`). The actor itself **declares**
  `analysis-free` because it is the *sole declarer* of that queue, and a Dramatiq
  consumer only attaches to a queue some actor has declared. Dispatch is by
  `actor_name`, so the one actor is consumed from **both** lanes. Do **not** change
  its decorator to `analysis-paid` — that would orphan every free job.
- **No `default` queue in prod.** Nothing enqueues or declares `default` after
  story 2.5. An enforcement test (`tests/test_actor_queues.py`) asserts this.
- `maintenance` is explicitly declared in `app/dramatiq_app.py` so W2 gets a live
  (empty) consumer today; it self-populates when Epic 3/4 add their actors.

### Launch commands

```bash
# Dev — ONE worker drains all four queues (functionally identical to prod):
python -m dramatiq app.dramatiq_app --processes 1 --threads 1 \
    --queues coach analysis-paid analysis-free maintenance   # = the Procfile

# Prod — two pools (W1 paid + coach, W2 free + maintenance):
docker compose -f docker/docker-compose.yml -f docker/docker-compose.prod.yml up
#   worker-paid (W1): --queues coach analysis-paid
#   worker-free (W2): --queues analysis-free maintenance
```

## Environment

| Env var               | Purpose                                                                                    |
|-----------------------|--------------------------------------------------------------------------------------------|
| `DATABASE_URL`        | Postgres URL — accepts `+asyncpg` (auto-converted to `+psycopg2`) or `+psycopg2` directly. |
| `REDIS_URL`           | Dramatiq broker URL (matches BFF `Redis:ConnectionString`).                                |
| `STORAGE_LOCAL_ROOT`  | Where audio files live on disk. Mounted from `data/` in docker-compose.                     |
| `RESULTS_DIR`         | Optional artifact dump directory. Failure is non-fatal.                                     |

## Actors

### `analyze_audio_job(job_id: str)`

Runs the 7-phase pipeline for a freshly-uploaded audio file. 3-phase tx
pattern (commit → run pipeline → commit again) so the long-running
phase 4 (Demucs) doesn't hold a transaction open while it runs.

Partial-failure tolerant: each phase has its own try/except; failed
phases are recorded but don't abort the job.

### `run_specialist(analysis_id: str, specialist_slug: str, focus: str)`

On-demand AI verdict generation. Wraps the Anthropic `claude` CLI via
`subprocess.run` inside `asyncio.to_thread` (CLI is not concurrency-safe,
gated by `asyncio.Semaphore(1)`). Validates the returned JSON via
Pydantic + the moderate-baseline severity downgrade in
`aimusic_shared.verdicts.scoring`. Writes verdicts to
`analyses.verdicts_payload` as a JSONB list.

If the CLI fails or the response doesn't validate, writes a sentinel
**fail-marker verdict** (`headline='Specialist failed'`) so the
frontend's `data-failed` card state has something to render. The actor
itself never raises.

Specialist slug → prompt file mapping lives in
`app/verdict_lib/prompt_loader.py::SLUG_TO_FILENAME` (slugs are
snake_case, files are PascalCase).

## Structure

```
components/worker/
├── README.md          # This file
├── Procfile           # python -m dramatiq app.dramatiq_app
├── requirements.txt   # dramatiq[redis], SQLAlchemy, psycopg2, anthropic-cli, etc.
├── prompts/
│   └── experts/       # 27 specialist prompts (LowEnd.md, Loudness.md, etc)
├── app/
│   ├── __init__.py
│   ├── dramatiq_app.py    # Broker wiring + actor module import
│   ├── tasks_dramatiq.py  # analyze_audio_job actor (3-phase tx pattern)
│   ├── verdict_actor.py   # run_specialist actor (calls llm.gateway)
│   ├── triage_actor.py    # run_triage actor (Triage routing plan)
│   ├── llm/
│   │   ├── gateway.py          # SOLE anthropic SDK touchpoint — metered calls
│   │   ├── settings.py         # pydantic-settings (keys, concurrency, models)
│   │   ├── pricing.py          # versioned price table → cost_usd
│   │   └── fake.py             # LLM_FAKE=1 canned replay
│   ├── verdict_lib/
│   │   ├── prompt_loader.py    # SLUG_TO_FILENAME mapping + frontmatter parse
│   │   ├── json_extraction.py  # tolerant JSON extraction from model output
│   │   ├── validator.py        # Pydantic + severity downgrade
│   │   └── flatten_analysis.py # final_json → prompt-ready context
│   └── db_sync.py         # Sync SQLAlchemy session factory (actors are sync)
└── tests/
    └── …                   # mocks analysis package and DB
```

---

**To extend this component**: edit `PRPs/source/INITIAL.md` and run `/generate-prp`. Don't modify files here directly for new work — let the PRP drive it.
