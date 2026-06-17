# Story 2.5 — Decisions Log

Decisions made while implementing "Paid Jobs Never Starve" (server-only queue split).

## Open-Questions resolutions (per task brief — take story's recommended option)

1. **Auxiliary actors → `analysis-paid`.** Adopted as specced. The 5 non-analysis actors
   (`run_triage`, `run_specialist`, `run_reference_analyzer`, `classify_stems`, `rerun_phase`)
   all declare/enqueue `analysis-paid` and are consumed by W1. Rationale: interactive/secondary
   latency-sensitive work; keeps W2 dedicated to the free-analysis flood (the FR34 starvation vector).

2. **`maintenance` provisioned-but-empty.** Chose to ADD `broker.declare_queue("maintenance")` in
   `app/dramatiq_app.py` so W2 gets a live (empty) consumer now rather than an inert whitelist entry.
   Why: makes the AR23 topology observable today (queue visible in Redis/inspection), zero downside
   (nothing produces to it yet), self-consistent with the prod overlay declaring W2 on `maintenance`.
   Alternative (leave inert) also valid; declaring is the more explicit, less surprising option.

3. **Ship minimal `docker-compose.prod.yml` overlay now.** Done. Only W1/W2 split; full prod stack
   (caddy/TLS) deferred to Epic 10.1 per story note.

4. **Drop `default` from dev Procfile `--queues`.** Done — no producer remains after Tasks 2–4.
   Dev worker now consumes `coach analysis-paid analysis-free maintenance`.

## Other decisions

- **Auxiliary BFF enqueue sites use the 3-arg `EnqueueAsync` overload with an explicit
  `DramatiqQueues.AnalysisPaid`.** Verified via grep that ZERO live 2-arg call sites remain
  (Task 3.6). The 2-arg overload stays on `IJobQueue` for source-compat but has no callers.

- **Analysis routing keys off `ent.Tier`** (the resolver's authoritative in-hand value), not a
  re-read of `job.Tier`. Both are equal at that point; `ent.Tier` is the contract source and avoids
  an extra read. Tier *stamping* on the job row is untouched (owned by story 2.4).

- **Prod overlay disables the dev `worker` via `profiles: ["dev-only"]`**, NOT `deploy.replicas: 0`.
  Plain `docker compose up` ignores `deploy.replicas` (swarm-only); the profile mechanism is honored
  by compose v2 and is the documented, reliable choice. Documented in `docker/README.md`.

- **New BFF test infra: extended `RecordingJobQueue` with a parallel `Enqueues` queue of
  `(Task, Queue)` tuples**, recorded in BOTH overloads (2-arg records `DramatiqQueues.Default`).
  The existing `Calls` collection is untouched so the ~8 pre-existing assertions still pass.

- **Task 9.3 (AC5 re-homing lock) covered by driving the real `/stems/classify` endpoint** (it only
  needs version ownership — no staged stems), asserting it enqueues on `analysis-paid` and explicitly
  `NotEqual(default)`. Chosen over a focused unit test since the endpoint is trivially drivable.

- **Worker test `test_queue_routing.py` saves/restores `dramatiq.broker.global_broker`** around a
  `StubBroker` so it doesn't leak into the rest of the suite (which relies on the lazily-created
  default broker). Uses real `StubBroker` + `dramatiq.Worker` — never mocked. The W1 isolation proof
  sends a 100-deep free flood + 1 paid job and asserts W1 processes the paid job while `free == 0`
  (W1 never even sees the flood — starvation isolation by construction).

## Test/environment notes (for the report)

- **3 pre-existing worker test failures** in `tests/verdict_pipeline/test_degraded_path.py`
  (`test_write_degradation_notice_sets_payload`, `test_run_rule_engine_persists_verdicts`,
  `test_run_rule_engine_handles_real_pipeline_shape`). Confirmed NOT caused by this story: stashing
  all `components/worker` changes and running the full suite on the clean baseline (Postgres up)
  reproduces the exact same 3 failures (228 passed baseline → 233 passed with my +5 new tests).
  Root cause is a full-suite test-ordering artifact — several pre-existing test files
  `os.environ.setdefault("DATABASE_URL", "...u:p@localhost/test")` and `db_sync` freezes its
  `SessionFactory` engine at import time; these 3 DB-backed degraded tests then can't reach their
  sqlite fixture DB. They PASS when `test_degraded_path.py` runs in isolation. Out of scope for 2.5.

- **BFF integration tests are Postgres-gated** via `PostgresReachable()`. I started
  `docker compose up -d postgres redis` and confirmed real execution (242 users written to the test
  DB; the new `DispatchQueueRoutingTests` + `DispatchEntitlementGateTests` ran for real, 11 passed).
