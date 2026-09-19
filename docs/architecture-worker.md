# Architecture — Worker (Python dramatiq consumer)

Component root: `components/worker/` (package `app/`). Entry point: `python -m dramatiq app.dramatiq_app` (canonical form in `components/worker/Procfile`, wired into the docker-compose `worker` service).

## Executive Summary

The worker is the asynchronous compute half of SPECTR. The .NET BFF never runs analysis or LLM work in-process; it enqueues dramatiq messages onto Redis and the worker consumes them. Everything user-visible that "takes time" happens here:

- **Audio analysis** — `analyze_audio_job` runs the 7-phase `audio_analysis.run_pipeline()` (8 phases with an .als project), persists the report to `analyses.final_json`, then runs the deterministic Problem engine and (paid tiers) LLM identifiers on the result. Heavy allin1 structure detection is deferred to a background follow-up job so it never blocks the report.
- **AI verdicts** — `run_triage` produces a specialist routing plan; `run_specialist` runs one on-demand specialist prompt against a completed analysis and persists validated `verdicts` rows (fail-marker row on failure, never a silent gap).
- **Coach** — `coach_reply` generates one grounded, evidence-cited coach chat turn, streamed token-by-token over Redis pub/sub to the BFF's SSE endpoint.
- **Fix rack** — `generate_fix_rack` re-runs the Problem engine, synthesizes a DSP rack chain (`coach_mix.synthesize`, arbiter + optional LLM, fail-open) and saves it as a system `RackPreset(source='analysis')`.
- **Maintenance** — `sweep_retention` (nightly raw-audio purge), `send_email` (Resend retry arm), `delete_account_data` (async half of account deletion).

All DB writes go to the same Postgres the BFF owns (schema is EF-Core-canonical; the worker uses the mirrored SQLAlchemy models in `components/shared/aimusic_shared/models.py` — see `docs/data-models.md`).

## Technology Stack

From `components/worker/requirements.txt` (lockfile `requirements.lock.txt`):

| Concern | Package | Notes |
|---|---|---|
| Job queue | `dramatiq[redis] >= 1.16` | Redis broker; replaces the legacy Celery worker |
| ORM | `sqlalchemy >= 2.0` + `psycopg2-binary >= 2.9` | Sync sessions only (actors are sync `def`) |
| Shared models | `aimusic-shared >= 0.1.0` | `pip install -e components/shared` first |
| Analysis pipeline | `audio_analysis` (via `pip install -e components/analysis`) | Imported guardedly; actor raises if missing |
| LLM SDK | `anthropic >= 0.69, < 1` | Only importable inside `app/llm/gateway.py` (AR39, lint-enforced by `tests/test_enforcement_lints.py`) |
| Config | `pydantic-settings >= 2.0` | All env via `BaseSettings` (`app/llm/settings.py`) |
| Object storage | `boto3 >= 1.34` | S3/R2/MinIO fetch shim (`app/object_store.py`), local-first |
| Email | `httpx >= 0.27` | `send_email` actor calls the Resend HTTP API |
| Observability | `prometheus-client >= 0.20`, `sentry-sdk >= 2.19` | `app/obs.py`; both optional-by-config |
| Redis client | `redis >= 5.0` | Coach stream publisher |
| Tests | `pytest >= 8`, `pytest-asyncio >= 0.23` | `components/worker/tests/` |

Runtime: Python 3.11+, `--processes 1 --threads 1` always (Demucs memory + per-loop LLM client constraints; see Procfile comment).

## Actor Inventory

12 actors, all registered by import side effect in `app/dramatiq_app.py`. Dispatch from the BFF is by `actor_name` (wire contract: `components/bff/src/Spectr.Bff/Services/IJobQueue.cs`).

| Actor | File | Queue | Retries / time limit | Purpose | Rough duration |
|---|---|---|---|---|---|
| `analyze_audio_job` | `app/tasks_dramatiq.py` | declares `analysis-free` (BFF tier-routes the enqueue) | 2 / 60 min | Full 7/8-phase pipeline -> `analyses` row -> Problem engine -> LLM identifiers -> enqueue structure follow-up | ~75 s for an 8-min track (structure deferred) |
| `classify_stems` | `app/tasks_dramatiq.py` | analysis-paid | 1 / 10 min | Audio-content role classification of staged stems; writes proposals to `song_versions.stem_paths_raw` | seconds–minutes (per stem count) |
| `run_triage` | `app/triage_actor.py` | analysis-paid | 1 / 3 min | One LLM call -> `analyses.routing_plan` (specialist routing) | ~5–30 s |
| `run_specialist` | `app/verdict_actor.py` | analysis-paid | 1 / 3 min | One specialist prompt -> validated `verdicts` rows (or fail marker) | ~10–60 s (LLM timeout 120 s) |
| `run_reference_analyzer` | `app/reference_analyzer_actor.py` | analysis-paid | 1 / 3 min | Phase-1-only analysis of a saved reference track -> metrics on `reference_tracks` | ~10–30 s |
| `rerun_phase` | `app/rerun_phase_actor.py` | analysis-paid | 1 / 10 min | Re-run ONE phase (2–8), merge into the existing `analyses.final_json` in place | ~5–60 s |
| `detect_structure_job` | `app/structure_actor.py` | analysis-paid | 1 / (ALLIN1_TIMEOUT+300) s, default 35 min | Deferred allin1 structure detection; folds sections into Phase 1/7 of the SAME analysis row | ~6–7 min CPU (Docker allin1) |
| `generate_fix_rack` | `app/fix_rack_actor.py` | analysis-paid | 1 | Problem engine + `coach_mix.synthesize` -> `rack_presets` row (`source='analysis'`) | seconds (LLM arbiter optional) |
| `coach_reply` | `app/coach_actor.py` | **coach** | 1 / 3 min | Grounded streaming coach turn; updates the pending `coach_messages` assistant row | first tokens in seconds; full turn ~10–45 s |
| `sweep_retention` | `app/retention_actor.py` | **maintenance** | 0 (nightly re-run IS the retry) | Purge raw audio past retention (free 30 d / lapsed 90 d / anon 72 h); stamps `raw_audio_purged_at`; FAIL-CLOSED on billing-query errors | minutes |
| `send_email` | `app/send_email_actor.py` | **maintenance** | 3 (backoff) | Resend HTTP send; no API key -> stub log; 5xx/429 raise (retry), 4xx swallow; send-time suppression recheck | < 5 s |
| `delete_account_data` | `app/account_deletion_actor.py` | **maintenance** | 3 | Content-subtree + storage deletion for a deleted user (financial records retained); idempotent | seconds–minutes |

Not in the roster: `run_llm_identifiers` is NOT an actor — the identifier stage (`app/verdict_lib/identifiers.py`) runs inline inside `analyze_audio_job` Phase C3.

## Queue Topology (AR23 / story 2.5)

Four queues, **no `default`** (enforced by `tests/test_actor_queues.py`: no actor and no BFF enqueue site may target `default`).

- `coach` — `coach_reply` only (interactive latency).
- `analysis-paid` — pro/credit analyses (tier-routed enqueue) + all auxiliary actors listed above.
- `analysis-free` — free/anon analyses. `analyze_audio_job` is the **sole declarer** of this queue; its decorator MUST stay `queue_name="analysis-free"` even though paid jobs are enqueued onto `analysis-paid` — a dramatiq consumer only attaches to a *declared* queue, and dispatch is by actor name so the one actor drains both lanes. Changing the decorator to `analysis-paid` orphans every free job.
- `maintenance` — `sweep_retention`, `send_email`, `delete_account_data`. Also explicitly declared in `dramatiq_app.py` so W2's whitelist always resolves.

Tier routing lives in the BFF (`DispatchAnalysisAsync`): pro/credits -> `analysis-paid`, free/anon -> `analysis-free`. The BFF stamps `analysis_jobs.tier` at dispatch so the worker never reads billing tables.

**Dev**: one worker drains all four queues (Procfile line: `--queues coach analysis-paid analysis-free maintenance`).
**Prod** (`docker/docker-compose.prod.yml`): two pools — W1 `worker-paid` consumes `coach analysis-paid`; W2 `worker-free` consumes `analysis-free maintenance`. Process separation is the starvation guarantee (FR34); `--queues` is an unordered set, not a priority list.

## Execution Patterns

- **Sync SQLAlchemy sessions** — `app/db_sync.py`: coerces `DATABASE_URL` `+asyncpg` -> `+psycopg2`, `create_engine(pool_pre_ping=True)`, `sessionmaker(expire_on_commit=False)`. Actors use `with SessionFactory.begin() as s:` short transactions. The async pattern from the legacy FastAPI api does not work here.
- **3-phase transaction pattern** (`analyze_audio_job`, mirrored by `rerun_phase`, `detect_structure_job`, `classify_stems`): (A) short tx — load job, flip to `processing`, capture paths; (B) run the pipeline with NO transaction held (progress updates are their own short standalone transactions via `progress_cb`); (C) fresh tx — insert `analyses`, flip job to `complete`. Prevents a long CPU phase from holding a Postgres connection.
- **Redelivery / idempotency guards** — every actor is safe under dramatiq redelivery: `analyze_audio_job` no-ops on `complete` or `failed+worker_unavailable` jobs (story 3.5); `run_triage` bails if `routing_plan` or `degradation_notice` already set; the Problem engine keys on any existing `verdicts.source == 'rule_engine'` row; `coach_reply` only touches assistant rows still in `status='pending'`; `sweep_retention` keys on `raw_audio_purged_at`; `delete_account_data` re-runs cleanly against an already-purged id.
- **Typed failure + credit reversal** — a spoofed/broken upload fails fast with `error_code='invalid_file'` (`app/source_validation.py`, magic-byte + duration check at the trust boundary, before attachments are fetched). No retry; the BFF's `GET /api/jobs/{id}` hook observes the code and reverses the credit spend (AR16).
- **Partial-failure tolerance** — post-persist stages (image render, JSON artifact, durable R2 upload, Problem engine, LLM identifiers, run trace, structure enqueue) are each individually try/except'd: a failure logs a warning and never undoes a completed analysis.
- **Fail-marker verdicts** — `run_specialist` never leaves a silent hole: any failure in load/prompt/LLM/validate/persist writes a sentinel Verdict (`headline='Specialist failed'`, severity minor) so the frontend tile renders a failure state. Exception: `LlmBudgetExceeded` writes the degradation notice + rule-engine verdicts instead (the banner is the UX, not a per-tile failure).
- **Ownership re-read on completion** — Phase C re-reads `user_id`/`device_id` from the CURRENT job row, not the Phase-A capture, so an anon device claimed mid-pipeline (registration during analysis) produces an Analysis owned by the new user, not an orphaned device.
- **Anon jobs** — when `analysis_jobs.version_id` is null the audio key comes from `analysis_jobs.file_path` (`audio/anon/{deviceId}/{jobId}/…`); no song/version/reference/stems context, and the structure follow-up is skipped.

## LLM Gateway (`app/llm/`)

`gateway.py` is the single Anthropic touchpoint (AR39). Public API: `complete()` / `complete_sync()` / `stream_complete_sync()` (streaming lives in `streaming.py`, used by the coach).

- **Transports** — three, resolved from `LlmSettings` (`settings.py`, env-sourced):
  1. SDK (`AsyncAnthropic`, `max_retries=0` — the gateway owns retries). Default model `claude-sonnet-4-5`, fallback `claude-haiku-4-5` (env-overridable). Client is built fresh per call because `complete_sync` runs each call under its own `asyncio.run` loop.
  2. `USE_CLAUDE_CLI=1` (dev-only) — shells out to the local `claude` CLI (subscription auth) via `subprocess.run` in `asyncio.to_thread`, serialized process-wide by a `threading.Lock` (the CLI is not concurrency-safe). Token counts unavailable -> metered as 0, model label `claude-cli`. Takes precedence over `LLM_FAKE`.
  3. `LLM_FAKE=1` — canned replay from `fake.py`, zero network/spend; the docker dev stack default.
- **Concurrency (AR6)** — per-event-loop semaphores: global pool (`llm_max_concurrency=5`) + coach sub-pool (`llm_coach_concurrency=2`). Coach acquires global-then-coach (weighted; coach can't starve verdicts).
- **Metering (AC3)** — exactly one `llm_calls` row per call, every outcome, via `record_llm_call` (lazy DB import, fail-open — a metering failure never masks the result). Cost from the versioned price table (`pricing.py`); Prometheus `spectr_llm_cost_usd_total` mirrors the row.
- **Retry policy (AC5/AC6)** — retryable errors (timeout/rate-limit/5xx) get `llm_max_retries=2` with exponential backoff, then fall to the fallback model; 4xx/auth errors give up without burning fallback calls. Exhaustion raises `LlmInvocationError` carrying the error row's `llm_call_id`.
- **Budget guards (`budget.py`, story 1.4 / AR8)** — all PRE-call, raising `LlmBudgetExceeded`:
  1. Circuit breaker: in-process, opens after 5 consecutive error outcomes, 300 s cooldown, single-probe recovery. Applies in CLI mode too.
  2. Per-tier monthly USD ceiling (defaults free $5 / pro $100), summed from `llm_calls.cost_usd` (calendar month, `outcome='ok'`), overridable live via `feature_flags` (`llm_budget_{free,pro,global}_usd`, None-checked so 0 hard-stops a tier).
  3. Global operator cap (default $1000).
  Spend guards are skipped in CLI mode (flat-rate subscription; enforcing a dollar ceiling on notional $0 costs would falsely degrade — see `memory/reference_coach-offline-free-tier-budget.md`). Aggregation is fail-open ($0 on DB failure). On budget exhaustion the calling actor stamps `analyses.degradation_notice` and ensures rule-engine verdicts exist (`verdict_lib/degraded.py`).
- **Prompts** — `components/worker/prompts/`: 26 specialist prompts (`experts/*.md`, PascalCase files mapped from snake_case slugs by `verdict_lib/prompt_loader.py::SLUG_TO_FILENAME`), `Triage.md`, coach prompts (`coach/CoachGrounded.md`, `coach/TeachCoach.md`), arbiter (`MasteringEngineer.md`), and 3 identifier prompts (`identifiers/`). Version + optional model pin ride in frontmatter; pinned versions can be served from an archive.

## Rule Engine / Problem Engine (`app/verdict_lib/rule_engine.py`)

Deterministic IDENTIFY-tier engine emitting Problem records (pydantic Verdicts with `fix=None`), ~1240 lines.

- **Two-pass evaluation** (`evaluate_problems`): pass 1 runs every `@single` rule (29 registered; tiers A=audio 19, B=audio-secondary 4, S=stems 2, P=project/.als 4 — one metric -> one Problem); pass 2 runs the 7 `@composite` rules (`loudness_war`, `congested_mix`, `phantom_width`, `thin_and_bright`, `lost_transients`, `untreated_low_end`, `lifeless_at_source`) which corroborate multiple metrics; then `suppression.apply` lets each fired composite absorb its child singles (audit trail in `related_verdict_ids`). Per-rule isolation: a raising rule is logged and skipped, never wipes the batch.
- **Genre-relative thresholds** — resolved from `verdict_lib/config/genre-profiles.json` via `genre_config.py` (`rule-bindings.json` maps rule -> profile path + genre_map). The same measured value yields different severities per genre. `suspected=True` marks placeholder thresholds pending a measured corpus.
- **Data-tier guards** — every rule carries `data_tier` (audio_only / stems / project_midi) and returns `None` when its inputs are absent: absent data is never graded.
- **Runs on EVERY completed analysis** — `analyze_audio_job` Phase C2 calls `degraded.run_rule_engine_for_analysis(analysis_id)` (idempotent via the `source='rule_engine'` guard; best-effort). The same function is the FR16 degraded path when the LLM budget trips. It flattens `final_json` (`{"phases": [...]}` -> `{"phaseN": {...}}`), evaluates, runs the deterministic SOLVE merge (`app/solve_lib/router.py` attaches parameter-exact fixes to fixable Problems — no LLM), validates each verdict (`validator.py` recomputes `priority_score`, caps severity), and persists rows with the 8 IDENTIFY columns (`problem_id`, `kind`, `source`, `data_tier`, `fixable`, `suspected`, `where`, `refines`).
- **LLM identifiers** (Phase C3, `identifiers.py`) — judgment-only findings (`source='llm_identifier'`) a rule can't make. Paid-tier gated (`identifiers_paid_only`, cap `max_identifiers_per_analysis=3`); roster: `trance_arrangement` (live, audio-only), `section_contrast` / `chord_harmony` (.als-gated, deferred).
- The legacy flat `@rule` / `evaluate_rules` registry (11 rules) was RETIRED 2026-07-23 (v3 closeout): `evaluate_problems` is the sole rule path; every legacy rule's coverage lives on in a new-engine equivalent (`clipping_count`, `true_peak_overshoot`, `loudness_vs_target`, `sub_mono_compatibility`, `negative_correlation`, `over_compression`, `mud_buildup`, `no_tonal_center`, …). Schema-contract lint + inspector tooling read the `_SINGLES` registry (`(slug, fn)` tuples).

## Observability + Failure Modes

- **Boot** (`dramatiq_app.py`): loads `components/worker/.env` before `db_sync` import; configures correlation-stamped logging + DSN-gated Sentry (`obs.configure_logging` / `init_sentry`); logs one boot-config line — `LLM_FAKE`, `WORKER_METRICS`, redis host:port (never the password), declared queues, resolved `storage_root`/`results_dir` — and warns when the storage root does not exist (the classic compose-`/data`-leaking-into-native-run symptom). Hard-fails boot if `SPECTR_REQUIRE_EMAIL=1` without `RESEND_API_KEY`.
- **Correlation (NFR30)** — `obs.set_correlation(...)` binds the job/analysis/conversation id per invocation (contextvar); a broker middleware resets it per message so actors that skip the call never log under a stale id. Sentry tags stitch the upload -> job -> actors -> llm_calls chain (`job_id` / `analysis_id` cross-tags).
- **Metrics** — `WORKER_METRICS=1` enables the dramatiq Prometheus middleware (exporter default `127.0.0.1:9191`; prod binds 0.0.0.0). Custom series: `spectr_job_duration_seconds{tier,status}`, `spectr_llm_cost_usd_total{tier,purpose}`, `spectr_verdict_validation_rejects_total{slug}`.
- **Heartbeat** — dramatiq's Redis broker writes `dramatiq:__heartbeats__` (ZSET, unix-ms scores). The BFF reads the MAX score (`Services/WorkerHeartbeat.cs`) for `GET /api/health/worker` and the reaper.
- **StaleJobReaper interplay** (`components/bff/src/Spectr.Bff/Services/StaleJobReaper.cs`) — BFF background service, 60 s ticks: flips jobs stuck `processing` past `WorkerOptions.StaleJobMinutes` (and `pending` past the grace window, faster when the heartbeat says the worker is dead) to `failed` with `error_code='worker_unavailable'` and a re-run message. `analyze_audio_job`'s redelivery guard deliberately no-ops on that exact code so a late redelivery can't double-run against the user's manual retry.
- **Half-dead worker caveat** — the worker is a dramatiq master + a multiprocessing fork child. Killing only the master orphans the fork: heartbeat stays fresh but the queue stops draining — health looks green while jobs sit pending forever. Diagnosis: confirm the queue is DRAINING, not just that the heartbeat is young; recovery: tree-kill + restart (see `memory/reference_dramatiq-orphan-fork-halfdead.md`, `reference_stuck-pending-worker-down.md`).
- **Time-limit trap** — `detect_structure_job`'s dramatiq limit is derived from `ALLIN1_TIMEOUT` (+300 s); a fixed 600 s limit previously killed legitimate long CPU runs mid-flight.

## Experience-Relevant Behaviors (what the user is waiting on)

- **Upload -> report**: `analyze_audio_job` completes in ~75 s for an 8-minute track (structure deferred; `defer_structure=True` is hardwired). The BFF polls/SSEs `analysis_jobs.current_phase` + `phase_pct`, updated by the pipeline's `progress_cb` as overall 0..1 across 7 (or 8 with .als) phases. On completion the report is fully readable; rule-engine Problems are already persisted (Phase C2 adds only ~a second).
- **Arrangement section fills in later**: allin1 structure detection runs as a background `detect_structure_job` (~6–7 min CPU via Docker; up to the 1800 s subprocess timeout) with its own progress-vehicle job row; Phase 7 data appears in the SAME report when it lands. Anon reports skip it.
- **AI verdicts are on-demand**: clicking a specialist enqueues `run_specialist` — typically ~10–60 s per verdict (LLM timeout 120 s; one malformed-JSON re-prompt attempt). In dev CLI mode calls serialize on a process-wide lock, so N queued specialists arrive one at a time. Triage (~5–30 s) fires once per analysis on first verdict-list load.
- **Coach feels live**: `coach_reply` streams prose tokens over `coach:{cid}:{mid}` Redis pub/sub -> BFF SSE; the SSE consumer either sees tokens or a terminal error/refusal frame — never a silent dead stream. Degraded analyses short-circuit to the verbatim "Coach is offline — your measured analysis and rule-based findings are unaffected." line.
- **Failure UX**: invalid file -> immediate typed failure + credit reversal; worker crash -> the reaper turns the infinite spinner into a re-runnable error within ~StaleJobMinutes; LLM budget/outage -> degradation banner + deterministic findings instead of an empty report.
- **Waiting cost knobs**: everything analysis-adjacent for paying users rides `analysis-paid` (W1), so a flood of free/anon uploads (W2) can never delay a pro user's analysis, verdicts, coach, or fix rack.
