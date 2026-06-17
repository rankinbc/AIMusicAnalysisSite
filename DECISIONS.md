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

---

# Story 2.6 — Tier-Aware Coach Caps

## Pre-existing infra found (built into 2.4)
- `feature_flags` table + `EntitlementService.GetFlagsAsync()` (60s `IMemoryCache`) ALREADY exist on the
  BFF. Seeded flags: `free_analyses_per_month`, `coach_free_followups`, `history_depth_free`,
  `history_depth_credits`. 2.4 explicitly deferred `coach_pro_monthly` to 2.6 (2.4 file, out-of-scope §).
- 2.4 metered ONLY `analysis` usage_events; coach was never metered. The two-guard SPEND side
  (gateway per-tier monthly USD ceiling) lives in `worker/app/llm/budget.py` reading env settings.

## Decisions

1. **Pro pooled monthly cap source = `usage_events` (type `coach_message`, `billing_period`).** The BFF now
   writes a `coach_message` usage_event in the SAME `SaveChanges` as the user/assistant coach rows
   (mirrors how analysis dispatch writes its usage_event — 2.4). Pro pool `used` = COUNT of those events
   in the current `YYYY-MM`. Rationale: architecture line 93 says "Pro coach pool computed per period from
   [usage_events]"; this also completes the coach-metering the broader epic wording implies. Alternative
   (count coach_messages rows joined to conversations by created_at) was rejected — usage_events is the
   period-scoped meter of record and keeps the Usage page (2.8) consistent.

2. **Free per-analysis cap source unchanged (count user coach_messages in THIS conversation), but the LIMIT
   now derives from the entitlement resolver** (`coach_free_followups` feature flag), NOT
   `IOptions<CoachCapsOptions>` (AC2). The `CoachCapsOptions` class + its Program registration are kept
   (CoachCapsOptionsTests still binds it directly) but the endpoint no longer reads it — vestigial config.

3. **Tier-aware logic lives in a new scoped `CoachCapService`** (depends on `EntitlementService` +
   `AppDbContext`), used by BOTH `PostMessage` (gate) and `GetConversation` (chip). Keeps the endpoint thin
   and the cap math unit-testable. Tier mapping: pro → pooled monthly (`coach_pro_monthly`); free →
   per-analysis (`coach_free_followups`); credits → unlimited (no gate), consistent with 2.4's
   `CoachRemaining = int.MaxValue` for credits. Credits coach caps are out of epic scope.

4. **`CoachCapsDto` extended additively with `Scope` ("analysis"|"month"|"unlimited") + `ResetsAt`** (first
   of next month UTC, only for the monthly/pooled form) so the frontend can pick the FR15 grammar
   ("{used} of {limit} this month" vs "… · this analysis"). Additive → no wire break; existing tests read
   only Used/Limit/CapReached. The DTO comment already anticipated these exact fields.

5. **Worker half of AR35 (AC3) = the SPEND ceilings become feature_flags-overridable.** New
   `worker/app/feature_flags.py` — a 60s-TTL, fail-open cached reader of the SAME `feature_flags` table
   (SQLAlchemy Core `text()` query via the sync `SessionFactory`; no new shared ORM model → no migration
   coupling). `budget.py` resolves each per-tier + global monthly USD ceiling from feature_flags
   (`llm_budget_{free,pro,global}_usd`), falling back to env settings on any miss. This is a genuine,
   tested worker consumption of feature_flags AND it stays squarely inside the SPEND guard (AC4: BFF gates
   COUNT, gateway gates SPEND — both now operator-tunable via the one table, hot-reloaded in ≤60s).
   `None`-check (not truthiness) so an operator can set a ceiling to `0` to hard-stop a tier.
   `tests/llm/conftest.py` stubs `budget._ceiling_override → None` so the SPEND-guard unit tests stay
   hermetic and env-driven regardless of the module-level flag cache.

6. **`coach_pro_monthly` default seeded as `300`** (≈10 coach messages/day for Pro). No canonical number in
   epics/architecture; operator-tunable via feature_flags. Budget flags seeded equal to env defaults
   (5/100/1000) so seeding changes NO behavior, only makes them live-tunable.

7. **New migration `AddCoachAndBudgetFlags`** seeds the four new flags with `INSERT … ON CONFLICT DO
   NOTHING` (idempotent, mirrors the 2.4 flag seed). Does NOT edit the already-applied 2.4 migration.
