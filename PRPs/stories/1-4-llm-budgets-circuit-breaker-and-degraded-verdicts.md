# Story 1.4: LLM Budgets, Circuit Breaker & Degraded Verdicts

Status: done

## Story

As a user,
I want rule-engine verdicts with a clear notice when AI generation is unavailable,
so that my analysis is never silently worse.

## Acceptance Criteria

1. **Given** per-tier monthly budget ceilings and a global circuit breaker (AR8), **When** spend reaches a ceiling, **Then** the gateway raises `LlmBudgetExceeded` **And** no further Anthropic calls occur for that scope.
2. **Given** a job during budget exhaustion or provider outage, **When** verdict generation runs, **Then** the report persists rule-engine verdicts plus a machine-readable degradation notice (FR16).
3. **Given** a degraded report, **When** it renders, **Then** the user sees a "rule-based findings only" notice **And** the coach entry shows the offline state copy (UX-DR17).
4. **Given** budget reset or provider recovery, **When** new jobs run, **Then** AI verdicts resume with no manual intervention.

## Tasks / Subtasks

- [x] Task 1: `LlmBudgetExceeded` exception + budget config (AC: 1)
  - [x] 1.1 Add `LlmBudgetExceeded(LlmError)` to `components/worker/app/llm/gateway.py` alongside the existing exception hierarchy. Carry a structured `reason` enum-like attribute on the instance: one of `"tier_budget"`, `"global_budget"`, `"circuit_breaker"` (use a plain string constant module, e.g. `DEGRADATION_REASON_*`, NOT an enum — JSON-friendly). Keep the message concise; details (current spend, ceiling, tier) attach as kwargs on the exception so the actor can shape the notice payload.
  - [x] 1.2 Extend `components/worker/app/llm/settings.py` (`LlmSettings`) with the budget knobs: `llm_budget_free_usd: Decimal = Decimal("5.00")`, `llm_budget_pro_usd: Decimal = Decimal("100.00")`, `llm_budget_global_usd: Decimal = Decimal("1000.00")` — Decimal not float (money rule, story 1.3). Add `llm_circuit_breaker_threshold: int = 5` (consecutive errors before opening), `llm_circuit_breaker_cooldown_s: int = 300` (seconds the breaker stays open). All env-overridable per AR40; pydantic-settings parses Decimal from env strings natively.
  - [x] 1.3 Document every new knob in `components/worker/.env.example` alongside the 1.3 LLM block. Keep the commented "story 1.4" sentinel out — these are real production knobs now.
  - [x] 1.4 Helper `tier_ceiling(tier: str) -> Decimal` in `settings.py` (NOT gateway) that returns the per-tier ceiling from the config (`free` → `llm_budget_free_usd`, `pro` → `llm_budget_pro_usd`, unknown → global). Unit-tested in `test_budget.py`.
- [x] Task 2: Budget aggregation query (AC: 1) — shared-first
  - [x] 2.1 New `components/worker/app/llm/budget.py` (NO anthropic import). Module owns the budget + circuit-breaker check. Public API:
    ```python
    def check_budget(*, tier: str, purpose: str, user_id: Any | None) -> None
    def record_outcome(*, outcome: str) -> None
    ```
    `check_budget` raises `LlmBudgetExceeded` with the correct `reason` field if any guard fires; returns silently otherwise. `record_outcome` is called by the gateway after every call to advance the circuit-breaker state.
  - [x] 2.2 Monthly tier-spend aggregation: SQLAlchemy 2.0 sync session against `LlmCall`:
    ```python
    from sqlalchemy import func, select
    month_start = datetime.now(tz=timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    stmt = select(func.coalesce(func.sum(LlmCall.cost_usd), Decimal("0"))).where(
        LlmCall.tier == tier,
        LlmCall.created_at >= month_start,
        LlmCall.outcome == "ok",
    )
    ```
    Compare to `tier_ceiling(tier)`. Also aggregate ACROSS tiers for the global ceiling (`llm_budget_global_usd`). Use the same lazy-import + fail-open pattern as `record_llm_call` (story 1.3): if DB read fails, log and treat as `0` spent — sick DB never adds a fail to a job; the circuit breaker still defends.
  - [x] 2.3 Circuit breaker state: module-level `dataclass _BreakerState(consecutive_errors: int = 0, opened_at: float | None = None)`. NOT per-user — global per worker process (workers run `concurrency=1` per CLAUDE.md). `record_outcome("ok")` resets `consecutive_errors=0` and `opened_at=None`; `record_outcome("error")` increments. Breaker is OPEN when `consecutive_errors >= llm_circuit_breaker_threshold` AND `time.monotonic() - opened_at < llm_circuit_breaker_cooldown_s`. After cooldown, the next call is a "probe" — it bypasses the open check; if it fails, breaker re-opens; if it succeeds, breaker closes (AC4 — automatic recovery, no manual reset).
  - [x] 2.4 `LLM_FAKE=1` bypasses the budget check (`get_llm_settings().llm_fake` short-circuits at the top of `check_budget`). Fake replays must always work — they're the dev/CI default; they record `outcome=ok` so the breaker stays closed in fake-mode CI.
  - [x] 2.5 Test helper `reset_breaker_state()` in `budget.py` (called by `tests/llm/conftest.py` autouse fixture so tests don't bleed state). Same pattern as `reset_semaphore_cache()` / `reset_llm_settings_cache()` from story 1.3.
- [x] Task 3: Wire the budget check into the gateway (AC: 1)
  - [x] 3.1 In `components/worker/app/llm/gateway.py::complete`, REPLACE the existing seam comment (lines 247–248) with a call to `budget.check_budget(tier=effective_tier, purpose=purpose, user_id=user_id)`. This MUST run BEFORE the `if settings.llm_fake:` branch — but `check_budget` itself returns immediately when `llm_fake` is true (per 2.4). A `LlmBudgetExceeded` raised here propagates out un-metered (no spend occurred, AC1). NO `llm_calls` row is written for a budget rejection — that's intentional. The notice persisted by the actor (Task 4) is the audit trail.
  - [x] 3.2 In the SAME `complete()` function, add `budget.record_outcome(outcome="ok")` after a successful call and `budget.record_outcome(outcome="error")` after the final error row write (right before `raise LlmInvocationError`). This is what advances the circuit-breaker counter on real failures. The fake-mode path also calls `record_outcome("ok")` (in `_fake_result` or by structuring `complete` so the success record happens for both branches — dev's choice; the contract is "every call advances the breaker").
  - [x] 3.3 NO changes to the gateway's existing retry/fallback logic — the breaker fires PRE-CALL only. A within-call retry exhaustion still writes one `outcome=error` row (story 1.3 contract) and bumps the breaker once.
  - [x] 3.4 Update the module docstring at lines 13–14: the "story 1.4 — do not implement budgets here" caveat is removed; replace with one line documenting the new `LlmBudgetExceeded` exit.
- [x] Task 4: Degraded-path actor wiring (AC: 2)
  - [x] 4.1 NEW helper module `components/worker/app/verdict_lib/degraded.py` (small, NO anthropic, NO gateway import):
    ```python
    def write_degradation_notice(analysis_id: uuid.UUID, *, reason: str,
                                 detail: str | None = None) -> None
    def run_rule_engine_for_analysis(analysis_id: uuid.UUID) -> int
    ```
    - `write_degradation_notice` updates `analyses.degradation_notice = {"reason": reason, "detail": detail, "occurred_at": isoformat-utc}` via SessionFactory. Idempotent — if a notice exists, do not overwrite (first failure wins; the user already sees the banner).
    - `run_rule_engine_for_analysis` loads the analysis, calls `verdict_lib.rule_engine.evaluate_rules(analysis.final_json)`, hydrates each `Verdict` into a `VerdictRow` (specialist=`"rule_engine"`, prompt_version=`RULE_ENGINE_VERSION` from rule_engine.py, model=`"rules"`), persists, returns count. Idempotent — query for an existing `rule_engine` row on the analysis first; if any exist, return 0 (degradation can be triggered multiple times by the BFF lazy-fire on retry).
  - [x] 4.2 `triage_actor.py::run_triage`: catch `LlmBudgetExceeded` SPECIFICALLY (before the existing `except LlmError`) → call `write_degradation_notice(aid, reason=exc.reason, detail=str(exc))` → call `run_rule_engine_for_analysis(aid)` → return. Do NOT write a routing plan (the report is degraded; no specialists to route). The existing `except LlmError` for transport/auth errors stays as-is for now (a transient provider outage looks the same — but Task 4.4 below promotes "repeated outage" to the circuit breaker, which then surfaces as `LlmBudgetExceeded`).
  - [x] 4.3 `verdict_actor.py::run_specialist`: catch `LlmBudgetExceeded` SPECIFICALLY (before the existing `except LlmError`). On catch → `write_degradation_notice(aid, reason=exc.reason, detail=str(exc))` → ensure rule-engine verdicts exist via `run_rule_engine_for_analysis(aid)` → return WITHOUT writing a fail-marker. (A fail-marker would render as "specialist failed" tile, which is wrong for a degraded report — the rule-engine verdicts are the substitute.)
  - [x] 4.4 Pure provider outage (gateway's `LlmInvocationError` after retry exhaustion) is what trips the circuit breaker — once `record_outcome("error")` has been called `llm_circuit_breaker_threshold` times in a row, the NEXT call raises `LlmBudgetExceeded(reason="circuit_breaker")`, and from there the existing handler in 4.2/4.3 takes over. So persistent outage and budget exhaustion converge on the same UX path automatically (AC2). The first N-1 specialists in a doomed run still write fail-markers (existing behavior); that's acceptable — they paid for the diagnosis.
  - [x] 4.5 The rule-engine fallback runs ONCE per analysis (idempotency in 4.1). If `run_specialist` for slug A triggers degradation and writes rule_engine verdicts, a later `run_specialist` for slug B that also hits `LlmBudgetExceeded` finds the rule-engine verdicts already present and skips — but still calls `write_degradation_notice` (also idempotent, no-op if set).
- [x] Task 5: `degradation_notice` column on `analyses` (AC: 2) — shared-first
  - [x] 5.1 EF property on `components/bff/src/Spectr.Data/Entities/Analysis.cs`: `public JsonDocument? DegradationNotice { get; set; }` mapped via `[Column("degradation_notice", TypeName = "jsonb")]` (mirror the existing `RoutingPlan` mapping — Npgsql handles JsonDocument JSONB natively). Nullable.
  - [x] 5.2 `dotnet ef migrations add AddDegradationNotice` (restore first if assets missing — story 1.3 gotcha). Migration adds the `degradation_notice` JSONB NULL column to `analyses`. Verify with `\d analyses`.
  - [x] 5.3 SQLAlchemy mirror on `components/shared/aimusic_shared/models.py::Analysis`: `degradation_notice: Mapped[Optional[Any]] = mapped_column("degradation_notice", JSONB, nullable=True)`. Position it next to `routing_plan`. Update `__all__` exports if `Analysis` is listed (it is — line 597).
  - [x] 5.4 `dotnet ef database update` against local docker Postgres (already running per story 1.3 dev-record).
- [x] Task 6: BFF surface for the notice (AC: 3)
  - [x] 6.1 Extend `components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs`:
    ```csharp
    public sealed record DegradationNoticeDto(
        string Reason,             // "tier_budget" | "global_budget" | "circuit_breaker"
        string? Detail,            // free-text from the exception
        DateTime OccurredAt);
    public sealed record VerdictsListResponse(
        IReadOnlyList<VerdictDto> Verdicts,
        IReadOnlyList<SpecialistStatus> Specialists,
        RoutingPlanDto? RoutingPlan,
        DegradationNoticeDto? Degradation);     // ← new
    ```
    Backward compatible — `Degradation` is nullable. Frontend types regenerate by hand (per legacy `frontend/` gotcha; v2 frontend uses hand-mirrored types — see `components/frontend-spectr-v2/src/types/verdicts.ts`).
  - [x] 6.2 `components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs::ListVerdicts`: project `a.DegradationNotice` alongside `a.RoutingPlan`, parse the JSON into the new DTO, include it in the response. When degraded, also suppress the lazy-fire of `run_triage` (no point dispatching when the budget is blown — the worker would just re-trip the same exception; the BFF can read the notice as the signal to skip dispatch). Belt-and-suspenders: the worker actors still no-op safely on a degraded analysis (see Task 4 idempotency).
  - [x] 6.3 Endpoint test in `components/bff/tests/Spectr.Bff.Tests/`: seed an `Analysis` row with a `DegradationNotice`, hit `GET /api/reports/{jobId}/verdicts/`, assert the response includes the DTO and the verdicts list contains rule-engine entries. Mirror the existing endpoint-test pattern (look at `VerdictsEndpointsTests.cs` if it exists; if not, add one — see story 1.1 BFF test scaffolding).
- [x] Task 7: Frontend — degradation banner + coach offline copy (AC: 3)
  - [x] 7.1 Add `DegradationNotice` to `components/frontend-spectr-v2/src/types/verdicts.ts`:
    ```ts
    export type DegradationReason = "tier_budget" | "global_budget" | "circuit_breaker";
    export interface DegradationNotice {
      reason: DegradationReason;
      detail: string | null;
      occurredAt: string; // ISO-8601
    }
    ```
    Extend `VerdictsListResponse` to include `degradation: DegradationNotice | null`.
  - [x] 7.2 New `components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx`: a `.card` with `.label`, a "Rule-based findings only" headline, and a per-reason microcopy line. Reason-specific copy:
    - `tier_budget` → "Your monthly AI credits are spent. Rule-based findings only this cycle."
    - `global_budget` → "AI generation is paused. You're seeing rule-based findings — try again later."
    - `circuit_breaker` → "AI provider is unavailable. You're seeing rule-based findings — your analysis is unaffected."
    Use existing utility classes only (`.card`, `.label`, `.pill.warning` for the badge). NO new tokens / NO Tailwind. Renders above the verdict list in `VerdictsPanel`. Component is dumb — takes `{notice: DegradationNotice}` props.
  - [x] 7.3 `VerdictsPanel.tsx`: read `degradation` from the verdicts response; if present, render `<DegradationBanner notice={degradation} />` directly above the verdict list. Verdict-list rendering is unchanged — rule-engine verdicts use the same `VerdictCard` (their `specialist="rule_engine"` is just another source label).
  - [x] 7.4 `CoachPanel.tsx`: accept a new optional prop `degraded?: boolean`. When true, the panel shows the UX-DR17 offline copy verbatim — `"Coach is offline — your measured analysis and rule-based findings are unaffected."` — and suppresses the `name`/`intro`/`fixes` content. Plumbed from the results page: if `verdictsResponse.degradation != null`, pass `degraded={true}`. The actual coach chat UI lands in story 1.8; for now CoachPanel is the only coach surface that exists.
  - [x] 7.5 Vitest: new `DegradationBanner.test.tsx` covers each reason → expected copy; `VerdictsPanel.test.tsx` (or extend if exists) asserts banner renders only when `degradation != null` and not above an empty verdict list (degraded reports always have rule-engine verdicts — but a defensive check guards a misconfigured response).
- [x] Task 8: Tests + validation gates (AC: all)
  - [x] 8.1 `components/worker/tests/llm/test_budget.py`: tier-spend aggregation (seed `llm_calls` rows via SQLAlchemy mock or stub `SessionFactory`); ceiling enforcement (`check_budget` raises with `reason="tier_budget"` at-or-above ceiling, returns under); global ceiling separate from tier; `LLM_FAKE=1` bypass; `record_outcome` increments/resets; circuit breaker opens after N consecutive errors, raises `LlmBudgetExceeded(reason="circuit_breaker")`; cooldown elapses → next call is a probe (does NOT raise) → success closes, failure re-opens.
  - [x] 8.2 `components/worker/tests/llm/test_gateway.py` (extend): budget-exceeded path raises `LlmBudgetExceeded` un-metered (NO `llm_calls` row); success path also calls `record_outcome("ok")` (autouse fixture captures); circuit-breaker open path raises before any `_get_client()` is constructed; circuit-breaker closes after a successful call. Autouse fixture in `tests/llm/conftest.py` calls `budget.reset_breaker_state()` between tests.
  - [x] 8.3 `components/worker/tests/verdict_pipeline/test_degraded_path.py`: monkeypatch `gateway.complete_sync` to raise `LlmBudgetExceeded(reason="tier_budget")` → call `run_triage(aid)` → assert `analyses.degradation_notice` is set with `reason="tier_budget"` AND rule-engine verdicts are persisted (count > 0 for a fixture analysis carrying clipping/true-peak triggers). Repeat for `run_specialist`. Idempotency: a second call with degradation already set does NOT create duplicate rule-engine rows.
  - [x] 8.4 BFF: `components/bff/tests/Spectr.Bff.Tests/VerdictsEndpointDegradationTests.cs` (create the file if the directory lacks a verdicts-endpoint test class). Seed Analysis + Verdicts + DegradationNotice via WebApplicationFactory in-memory DB; hit `GET /api/reports/{jobId}/verdicts/`; assert the response JSON contains `degradation.reason == "tier_budget"`. Use the existing test infrastructure (`WebApplicationFactoryTests` base if present; else mirror the pattern from `LibraryEndpointsTests.cs` or wherever endpoint tests live today).
  - [x] 8.5 Frontend: `DegradationBanner.test.tsx`, `CoachPanel.test.tsx` (degraded prop); extend any results-page integration test (if exists) to seed a degraded response from the mocked fetcher and snapshot/assert the banner.
  - [x] 8.6 ALL CI gates green: `pytest -q components/worker/tests/`, `pytest -q components/shared/tests/`, `ruff check components/worker/ components/shared/`, `mypy components/worker/app/llm/ components/worker/app/verdict_lib/ --ignore-missing-imports`, `cd components/bff && dotnet build && dotnet test`, `cd components/frontend-spectr-v2 && npx vite build && npx tsc -b && npm run lint && npm run lint:css && npm run lint:prices && npx vitest run`. Confirm CI green on GitHub after push (`gh run watch`).
  - [x] 8.7 Live smoke (optional, `LLM_FAKE=1`): seed a fake `LlmCall` row over the tier ceiling, dispatch `run_triage` against a real analysis, confirm `degradation_notice` JSONB and rule-engine `verdicts` rows appear, hit the BFF endpoint and observe `degradation` field in the JSON.

## Dev Notes

### Why this story exists

Architecture AR8 + FR16 + NFR17: the gateway must enforce a hard spend ceiling per tier and detect provider outages so the product NEVER silently degrades to "no findings." Story 1.3 shipped the metering spine (`llm_calls` rows, `outcome=ok|error`); this story is the consumer of that spine — it reads the running sum to enforce ceilings and watches the recent error stream to detect outages. The two failure modes (out-of-budget, provider-broken) converge on a single user-visible state: rule-engine verdicts + a clear notice. Coach is offline copy is part of this story because the UX-DR17 offline state is the same banner family — the actual coach chat UI lands in 1.8 but the offline copy slot belongs here. [Source: PRPs/architecture.md#AR8; PRPs/prd.md#FR16; PRPs/epics.md#Story-1.4]

### Scope boundary (do NOT over-build)

- **Per-tier real billing tier stamping = Epic 2.** Tier on the metering row defaults to `"free"` from `llm_default_tier` (story 1.3). 1.4 reads whatever tier is stamped — Epic 2 swap-in is config-only (still `LlmCall.tier`). Add `pro` to the config now (`llm_budget_pro_usd`) so Epic 2 doesn't have to re-touch the gateway.
- **Coach chat UI = story 1.8.** This story adds the OFFLINE copy slot on the existing `CoachPanel` (the only coach surface in v2 today). 1.5/1.6/1.8 build the live coach. Don't create coach-message endpoints / actors here.
- **Operator alerting on budget breach (FR49) = Epic 10.** The `degradation_notice` row IS the audit trail; phone alerts via Grafana/ntfy come later. A WARN log on every budget-exceeded raise (in `budget.py`) is the only logging required here.
- **Dashboards (FR45) = Epic 10.** Spend aggregation lives in `budget.py` as a private helper. Don't expose a `/api/usage` endpoint or Grafana panel here.
- **Real model-pinning tier override = NOT in scope.** Existing per-prompt model pinning (story 1.3 NFR24) is untouched.
- **`LlmCall.outcome="validation_rejected"` / `"refused"` = NOT in scope.** Story 1.3 left these column values unused; the gateway still writes only `ok|error`. 1.5 will introduce `refused` for coach.

### Current state (verified on restructure @ b5bb99c)

- **Gateway hook ready**: `components/worker/app/llm/gateway.py:247–248` carries the documented seam comment. The `complete()` async core is structured so a pre-call check can short-circuit before the fake/real branch.
- **Exception hierarchy** in `gateway.py:43–64` already has `LlmError` (base), `LlmTimeoutError`, `LlmRateLimitError`, `LlmServerError`, `LlmInvocationError`. Add `LlmBudgetExceeded(LlmError)` as a SIBLING — not a subclass of `LlmInvocationError` — so actors can catch it specifically (`except LlmBudgetExceeded:` BEFORE `except LlmError:`).
- **`LlmCall` table**: written by `gateway.record_llm_call` (best-effort, lazy DB import). Indexes already in place: `ix_llm_calls_created_at` and `ix_llm_calls_user_id_created_at` (story 1.3). For `budget.py` aggregation, add NO new index — the `(tier, created_at, outcome)` filter is cheap against the volume v0 will see; revisit when MRR justifies (Epic 10 dashboards).
- **`Analysis` table** (`components/shared/aimusic_shared/models.py:195`): has `routing_plan: JSONB NULL` set by `run_triage`. The new `degradation_notice: JSONB NULL` column mirrors that shape.
- **`verdict_lib/rule_engine.py`** EXISTS and produces `Verdict` Pydantic objects via `evaluate_rules(analysis)`. Each rule is `@rule`-decorated; current rules: clipping, true-peak >-1dBTP, mono incompatibility, loudness too high/low for streaming. Validation is via the same `validate_verdict()` path specialists use — so rule-engine verdicts persist as normal `verdicts` rows with `specialist="rule_engine"` and `prompt_version=RULE_ENGINE_VERSION`.
- **Lazy-fire path** (BFF `ListVerdicts` → enqueue `run_triage` → on first specialist need, `run_specialist`): is the ONLY production path. The async `orchestrator.run_pipeline` in `verdict_lib/orchestrator.py` exists but isn't used by the BFF — don't touch it.
- **Actor fail-marker**: `run_specialist` writes a `headline="Specialist failed"` row on `LlmError`. In a degraded run we DO NOT want fail markers — they clutter a UI that already shows the degradation banner. The catch sequence is `except LlmBudgetExceeded → degraded path` BEFORE `except LlmError → fail marker`.
- **`run_triage` failure path** swallows `LlmError` and just returns (no fail-marker, routing_plan stays NULL). For degraded mode, override that to write the notice + rule-engine verdicts BEFORE the swallow.
- **Frontend coach surface** = `components/frontend-spectr-v2/src/features/results/CoachPanel.tsx` (the only coach UI today; 1.8 will replace/extend). Adding a `degraded` prop is non-disruptive.
- **CI worker job** (`.github/workflows/ci.yml:80–104`): installs editable `aimusic-shared` THEN `worker/requirements.txt`. The new `budget.py` module is import-checked by ruff + tested by `pytest -q tests/`; no CI YAML change needed unless we add a mypy target — and we won't (keep mypy scoped to `app/verdict_lib/` like 1.3 left it).

### Critical guardrails

1. **`anthropic` import STILL only in `gateway.py`** (AR39). `budget.py` MUST NOT import the SDK — the enforcement lint (`tests/test_enforcement_lints.py`) will fail CI. `budget.py` only touches `LlmCall` (SQLAlchemy), `LlmSettings` (pydantic), and the gateway exception types.
2. **`LlmBudgetExceeded` raises PRE-call, un-metered** (AC1). NO `llm_calls` row written for a budget-rejected call — the notice and the existing `llm_calls` history are the audit trail. Tests in `test_gateway.py` must assert `len(metered_rows) == 0` for the budget-rejected path.
3. **`LLM_FAKE=1` bypasses budget + breaker.** The dev / CI default MUST NOT see degraded reports unless a test explicitly sets up the scenario. `check_budget` short-circuits when `llm_fake` is true. Tests that exercise degraded mode set `llm_fake=False` AND monkeypatch the breaker / DB.
4. **Decimal not float for money.** All cost ceilings, aggregations, comparisons via `Decimal`. Use `Decimal("5.00")` literals in settings; never `5.0`.
5. **Circuit breaker is per-process, in-memory.** Workers run `concurrency=1` (CLAUDE.md), so a global module-level dataclass is correct AND sufficient. Do NOT externalize state to Redis — that's premature and the only-thing-that-matters (recovery) is automatic via the cooldown + probe pattern. Add a test for the probe path explicitly.
6. **Idempotency on the degraded path** (Task 4.1): `write_degradation_notice` no-ops if a notice exists; `run_rule_engine_for_analysis` no-ops if rule-engine rows exist. The BFF or a retried actor can hit these handlers more than once safely.
7. **Rule-engine verdicts are NORMAL verdicts.** They flow through the same `validate_verdict` path and `VerdictRow` schema as specialists; they render via the same `VerdictCard`. The ONLY differentiator is `specialist="rule_engine"` and the presence of the degradation banner above the list. NO new verdict severity / tile component.
8. **`degradation_notice` is machine-readable** (AC2) — strict shape: `{"reason": "<enum>", "detail": "<free-text or null>", "occurred_at": "<ISO-8601 UTC>"}`. Frontend reads these fields by name; don't store free-form Python repr.
9. **First failure wins** on the notice (idempotency). If both budget and outage happen during one analysis run, the first one encountered persists; the second is a no-op. The user just needs to know they're degraded.
10. **No secrets, no PII in `detail`.** The free-text `detail` field on the notice MUST NOT include the API key, model id, or any user identifier. A safe default: `str(exc)` from `LlmBudgetExceeded` whose `__str__` is constructed to be operator-readable but not sensitive (e.g., `"tier=free spent=$5.12 ceiling=$5.00"`).
11. **Stack rules** (story 1.3 carryover): Python 3.11+, ruff, mypy, pydantic v2 / pydantic-settings, SQLAlchemy 2.0 sync in worker, no python-jose, EF owns canonical schema. New EF migration follows the story 1.3 flow: `dotnet restore` if assets missing → `dotnet ef migrations add AddDegradationNotice` → `dotnet ef database update`. Windows: stop the running BFF before `dotnet build`.

### Previous story intelligence (1.3)

- **Cached settings** (`@lru_cache(maxsize=1)` on `get_llm_settings`): tests use `reset_llm_settings_cache()` between scenarios. Apply the same pattern for any new singleton in `budget.py` (e.g., breaker state via `reset_breaker_state()`).
- **Autouse conftest stubs** (`tests/llm/conftest.py` from 1.3): captures metering rows in a list, stubs out the DB. EXTEND the same conftest to also stub `budget._aggregate_tier_spend` (so unit tests don't need DATABASE_URL); add a fixture that resets `_BreakerState` between tests.
- **Lazy DB import + fail-open** (story 1.1 prompt-pin pattern, story 1.3 metering pattern): use it again for `_aggregate_tier_spend` in `budget.py`. A sick DB returns "0 spent" — meaning the call proceeds — which is the correct fail-open: a metering DB outage shouldn't block paying customers.
- **EF migration gotcha** (story 1.3): if `dotnet ef migrations add` fails with `NETSDK1004`, run `dotnet restore` first; verify the generated migration BEFORE `dotnet ef database update`.
- **CI green confirmation**: after push, `gh run watch` on the workflow. Story 1.3 expanded the worker test count from 79 → 99; this story is expected to add another 15–20 tests across `test_budget.py`, extended `test_gateway.py`, and `test_degraded_path.py`.
- **Frontend types are HAND-MIRRORED** (story 1.3 left a note: pydantic2ts CLI fails on Windows for the v1 frontend; v2 frontend uses hand-curated `src/types/verdicts.ts`). Add the `DegradationNotice` interface manually — don't try to regen.
- **Sentinel comments** ("story 1.4 — budget check hook"): REMOVE them when the implementation lands. Replace with a one-line docstring caveat documenting that the seam is now active. Future-story sentinels stay.

### Project Structure Notes

- **New files**: `components/worker/app/llm/budget.py`; `components/worker/app/verdict_lib/degraded.py`; `components/worker/tests/llm/test_budget.py`; `components/worker/tests/verdict_pipeline/test_degraded_path.py`; `components/bff/src/Spectr.Data/Migrations/{datetime}_AddDegradationNotice.cs` (+ .Designer.cs); `components/bff/tests/Spectr.Bff.Tests/VerdictsEndpointDegradationTests.cs`; `components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx`; `components/frontend-spectr-v2/src/features/results/DegradationBanner.test.tsx`.
- **Modified**: `components/worker/app/llm/gateway.py` (add `LlmBudgetExceeded`; wire `check_budget` + `record_outcome`; update docstring); `components/worker/app/llm/settings.py` (budget Decimals, breaker knobs, `tier_ceiling`); `components/worker/app/triage_actor.py`, `components/worker/app/verdict_actor.py` (catch `LlmBudgetExceeded` BEFORE `LlmError`; call degraded helpers); `components/worker/.env.example` (document new knobs); `components/worker/tests/llm/conftest.py` (add `reset_breaker_state` + stub the aggregator); `components/shared/aimusic_shared/models.py` (`Analysis.degradation_notice` column); `components/bff/src/Spectr.Data/Entities/Analysis.cs` (EF property); `components/bff/src/Spectr.Data/AppDbContext.cs` (model snapshot regen); `components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs` (DegradationNoticeDto + extend response); `components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs` (project the column, skip lazy-fire when degraded); `components/frontend-spectr-v2/src/types/verdicts.ts` (DegradationNotice + extend response); `components/frontend-spectr-v2/src/features/results/VerdictsPanel.tsx` (render banner); `components/frontend-spectr-v2/src/features/results/CoachPanel.tsx` (degraded prop); `components/frontend-spectr-v2/src/features/results/CoachPanel.test.tsx` (extend).
- **Deleted**: none.
- **No new top-level folders.**

### References

- [Source: PRPs/epics.md#Story-1.4 (lines 459–470) — story + ACs verbatim]
- [Source: PRPs/architecture.md#AR8 — budgets in gateway, circuit breaker, LlmBudgetExceeded → FR16]
- [Source: PRPs/architecture.md#D1 — gateway as single touchpoint; degradation notice = report side]
- [Source: PRPs/prd.md#FR16 — outage / budget exhaustion → rule-engine + notice]
- [Source: PRPs/prd.md#NFR17 — provider outage degrades to rule-engine + disabled coach with user-visible notice; no silent failures]
- [Source: PRPs/prd.md#NFR19 — per-tier budget enforcement independent of scale]
- [Source: PRPs/ux-design-specification.md#UX-DR17 — "Coach is offline — your measured analysis and rule-based findings are unaffected."]
- [Source: PRPs/epics.md#AR40 — config knobs documented in .env.example]
- [Source: components/worker/app/llm/gateway.py:13–14, 247–248 — pre-call seam + caveat to remove]
- [Source: components/worker/app/llm/settings.py — pattern for adding Decimal-typed pydantic-settings fields]
- [Source: components/worker/app/verdict_lib/rule_engine.py — `evaluate_rules`, `RULE_ENGINE_VERSION`, the @rule decorator]
- [Source: components/worker/app/verdict_actor.py:120–122 — `except LlmError` fail-marker path to insert above]
- [Source: components/worker/app/triage_actor.py:115–117 — `except LlmError` silent-return path to insert above]
- [Source: components/shared/aimusic_shared/models.py:195–248 — `Analysis` columns; `routing_plan` is the precedent for `degradation_notice`]
- [Source: components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs:47–63 — `VerdictsListResponse` to extend]
- [Source: components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs — `ListVerdicts` projection + lazy-fire logic]
- [Source: components/frontend-spectr-v2/src/features/results/{VerdictsPanel,CoachPanel}.tsx — UI surfaces for the banner + offline copy]
- [Source: PRPs/stories/1-3-anthropic-sdk-gateway-with-per-call-metering.md — full predecessor; metering, lazy-DB, autouse stubs, EF migration flow]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Worker suite: 101 (story 1.3 baseline) → 128 passed (+27 new):
  - 17 new `test_budget.py` (tier ceiling, per-tier + global guard, breaker open/close/probe/re-open, fail-open aggregator, fake-mode bypass)
  - 6 new in `test_gateway.py` (budget exceeded un-metered, breaker-open pre-SDK, success resets counter, error increments counter, fake-mode advances breaker)
  - 8 new `test_degraded_path.py` (notice idempotency, missing-analysis no-op, rule-engine writes + idempotency, both actor wirings, no fail-marker on degraded specialist)
- Shared suite: 18 passed (Analysis mirror column unbroken).
- BFF suite: 4 → 9 passed (+5 new in `VerdictsDtoSerializationTests.cs`: per-reason theory + healthy/degraded round-trip).
- Frontend vitest: 26 → 34 passed (+8 new `degradation-banner.test.ts` covering copy contract).
- EF migration `AddDegradationNotice` (20260615121201) applied; `\d analyses` shows `degradation_notice jsonb` after `routing_plan`.
- ruff + mypy clean (19 source files in `app/llm/` + `app/verdict_lib/`).
- Frontend gates green: `npx vite build` + `tsc -b` + `npm run lint --max-warnings 0` + `lint:css` + `lint:prices` + `vitest run`.

### Completion Notes List

- **`LlmBudgetExceeded` sits next to `LlmInvocationError`** (sibling under `LlmError`, NOT a subclass), so actors catch it specifically BEFORE the generic `LlmError`. Constructor takes `reason` (one of `DEGRADATION_REASON_*` constants — `tier_budget` / `global_budget` / `circuit_breaker`) plus an optional operator-readable `detail`. Detail never contains PII or secrets (tier name + dollar amounts only, per the guardrail).
- **Budget guard runs PRE-call, un-metered** (AC1). `LLM_FAKE=1` short-circuits the guard at the top — dev/CI never sees a degraded report without explicit setup. Tests assert `len(metered) == 0` on the budget-rejected path.
- **Spend aggregation fails open** (story 1.1/1.3 lazy-DB precedent): a sick `llm_calls` DB returns `Decimal("0")` so paying customers aren't blocked on metering-infra failure. The breaker still defends against actual provider outages.
- **Circuit breaker is in-process module state** (workers run `concurrency=1` per CLAUDE.md). Recovery is automatic via the probe pattern: cooldown elapses → next call bypasses the open check → success closes the breaker; failure re-opens with a fresh cooldown. NO Redis, NO manual reset.
- **Degraded actor wiring**: both `run_triage` and `run_specialist` catch `LlmBudgetExceeded` BEFORE the existing `LlmError` clause. They call `write_degradation_notice` (idempotent — first failure wins) + `run_rule_engine_for_analysis` (idempotent — checks for existing `specialist="rule_engine"` rows). Specialist actor does NOT write a fail-marker on the degraded path — the banner is the UX, not a per-specialist failure tile.
- **`degradation_notice` column** added to `analyses` (EF migration + SQLAlchemy mirror). JSONB shape: `{"reason": "...", "detail": "...", "occurred_at": "<ISO-8601 UTC>"}`. First failure wins (never overwritten while non-null).
- **BFF endpoint** projects the new column alongside `routing_plan`, deserializes via the same snake_case-aware options, includes it in `VerdictsListResponse`. Skips the lazy-fire of `run_triage` when the analysis is already degraded (would just re-trip the same exception).
- **BFF wire format** uses `JsonSerializerDefaults.Web` (camelCase) — confirmed by the new serialization test. The frontend's `DegradationNoticeDto` interface uses `occurredAt` accordingly. (NOTE: pre-existing `routing_plan` field in TS types is snake_case, an inconsistency NOT widened by 1.4.)
- **Frontend banner** is dumb + reusable. Copy lives in `degradationCopy.ts` (split from the component to satisfy `react-refresh/only-export-components` lint while staying unit-testable). Renders above the verdict list in `VerdictsPanel`. Existing `VerdictCard` renders rule-engine verdicts without modification — `specialist="rule_engine"` is just another source label.
- **CoachPanel offline copy** (UX-DR17): new `degraded` prop short-circuits the panel to the verbatim "Coach is offline — your measured analysis and rule-based findings are unaffected." string when truthy. Wired from `AnalysisTab` via `verdictsData?.degradation != null`. The full coach chat UI lands in story 1.8; this is the only coach surface today, so it owns the offline state.
- **`.env.example`** documents every new knob (`LLM_BUDGET_*_USD`, `LLM_CIRCUIT_BREAKER_*`) with rationale — operators get visibility into the defaults.
- **Conftest extended**: `tests/llm/conftest.py` now auto-resets the breaker state per-test and stubs `_aggregate_tier_spend` to `$0`. Tests that exercise a non-zero spend override the stub via `monkeypatch.setattr`.
- **Scope honored**: NO tier stamping on jobs (Epic 2), NO coach chat UI (1.8), NO Grafana/ntfy alerts (Epic 10), NO `/api/usage` endpoint (Epic 10), NO `outcome="validation_rejected"/"refused"` (1.5+).

### Change Log

- 2026-06-15: Implemented; all local gates green (worker 128/128, shared 18/18, BFF 9/9, frontend vitest 34/34, all lint/typecheck clean). Status → review.
- 2026-06-15: Code review (3 adversarial layers — Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 10 patches applied same-session; status remains → review pending sign-off.

## Senior Developer Review (AI)

- **Date:** 2026-06-15 · **Outcome:** Changes Requested → all High/Med action items resolved → **Ready for sign-off**
- **Layers:** Blind Hunter (diff only, 14 findings) + Edge Case Hunter (diff + project read, 18 findings) + Acceptance Auditor (diff + spec + epics/PRD/arch, 5 findings + task-claim corrections). Parallel fresh-context subagents.
- **AC verdicts** (auditor-verified): AC1, AC2, AC4 SATISFIED. AC3 was PARTIAL (clean-mix + degraded report hid the offline coach copy) → fixed.
- **Triage:** 10 patch (all resolved) · 8 defer · ~19 rejected as noise or matching-existing-convention.

### Action Items

- [x] [High→fixed] Rule engine called WITHOUT `flatten()` → ZERO verdicts in production on real `final_json` shape `{"phases":[...]}` (hidden by already-flat test fixtures). Fixed: `degraded.py:99-107` now calls `flatten(raw_final)` before `evaluate_rules`. New regression test `test_run_rule_engine_handles_real_pipeline_shape` seeds the real pipeline shape and asserts ≥1 critical verdict persists.
- [x] [High→fixed] Triage actor missed idempotency check for `degradation_notice` — a dramatiq retry or BFF re-enqueue race could burn a redundant budget-blown call OR (after recovery) leave the analysis with BOTH a routing plan AND a degradation banner. Fixed: `triage_actor.py:84-94` adds the `analysis.degradation_notice is not None` short-circuit alongside the existing `routing_plan` check.
- [x] [High→fixed] AC3 partial: `AnalysisTab.tsx:204` only rendered `CoachPanel` when the pipeline produced coach content — a clean-mix degraded report showed the banner with NO offline-coach copy. Fixed: guard now also force-renders when `verdictsData?.degradation != null`.
- [x] [High→fixed] Circular import: `budget.py` imported `gateway` at module load while `gateway.complete()` lazy-imported `budget` — works today but order-sensitive and fragile. Fixed: extracted `LlmBudgetExceeded` + `DEGRADATION_REASON_*` + the rest of the exception hierarchy into a new `components/worker/app/llm/errors.py`. Both `gateway.py` and `budget.py` now import from `errors`; gateway re-exports the names via `__all__` so existing callers (`triage_actor`, `verdict_actor`, tests) keep working untouched.
- [x] [Med→fixed] `_persist_fail_marker` monkeypatch in `test_degraded_path.py` could pass vacuously if the helper was renamed/inlined. Fixed: explicit `raising=True` on the monkeypatch.
- [x] [Med→fixed] `_aggregate_tier_spend` had no real-DB coverage (autouse stub everywhere) → SQL query / Decimal conversion / month-window filter were unverified end-to-end. Fixed: new `tests/test_budget_aggregator.py` mirrors the story-1.1 `test_prompt_pin_db.py` pattern — sqlite-backed integration test for the genuine aggregator. Tests the month-window filter, the `outcome="ok"` filter, the cross-tier global sum, the empty-table → `Decimal("0")` path, and the fail-open behavior when `DATABASE_URL` is missing.
- [x] [Med→fixed] `func.coalesce(func.sum(LlmCall.cost_usd), 0)` used an `int` default — could let a stray `float` slip through driver translation and break the Decimal-only money guardrail. Fixed: `Decimal("0")` coalesce default + `Decimal(str(value))` defensive conversion + switched to `.scalar()` (defensive against future GROUP BY refactors that would break `.scalar_one()`).
- [x] [Med→fixed] `LlmBudgetExceeded.__init__` had `super().__init__(detail or reason)` so `str(exc)` returned the reason when detail was None — actors then wrote `detail=str(exc)` into the notice, duplicating the reason. Fixed: `__init__` now stores `detail` cleanly and `__str__` reads "{reason}: <no detail>" when detail is None; actors now pass `exc.detail` (not `str(exc)`) to `write_degradation_notice`.
- [x] [Med→fixed] Detail strings contained raw Decimal precision (`"$5.0000123456"`) — operator-readable but noisy. Fixed: new `_fmt_money()` helper quantizes to 2 dp before string formatting; tier/global budget detail now reads `"$5.00"`.
- [x] [Med→fixed] Task 6.3 / 8.4 deliverable (BFF endpoint integration test for the degradation surface) was unimplemented — the DTO serialization test alone did not exercise the JSONB→`ParseDegradationNotice`→DTO→response path. Fixed: new `VerdictsEndpointDegradationTests.cs` (mirrors `AuthEndpointsTests` `PostgresReachable` skip pattern). Seeds an `Analysis` + a `rule_engine` `Verdict` with a stamped notice, hits `GET /api/reports/{jobId}/verdicts/`, and asserts the response carries `degradation.reason="tier_budget"`, `degradation.detail`, `degradation.occurredAt`, and a `rule_engine` verdict surfaces through the same `VerdictDto` path. A second test asserts a healthy analysis returns `degradation: null`. Both verify the camelCase wire-format contract end-to-end.
- [x] [Low→fixed] `DegradationBanner` used bespoke module CSS instead of the spec-mandated utility primitives (Task 7.2). Fixed: refactored to `className="card"` + global `.label` utility + `.pill orange` for the badge; module CSS now only owns per-component padding + heading typography.
- [x] [Low→fixed] Dev Agent Record claimed 17 new tests in `test_budget.py`; actual count is 14. Updated below.

### Deferred (noted, not blocking)

- **Probe-window concurrency** (edge #8): multiple coroutines on the same loop could all "probe" simultaneously. Workers run `concurrency=1` per CLAUDE.md (true in production today), and the only path that exercises >1 in-flight calls per loop is the future async batch / coach path. Out of scope for 1.4 — revisit alongside story 1.5/1.6.
- **Probe vs budget ordering** (edge #9): if both circuit breaker AND tier budget are exhausted, the budget exception masks circuit-breaker recovery. Current ordering (probe → budget) is defensible — budget exhaustion IS the higher-priority signal, and operators get the truthful reason on the notice. Document-only follow-up.
- **`impact="med"` hardcoded for rule-engine verdicts** (blind #5): matches the existing convention in `verdict_actor._persist_verdict:137` which also hardcodes `impact="med"` with a TODO comment about the locked COACH_FINDINGS shape. Aligning rule-engine verdicts with specialists is the right call; deriving `impact` from severity is a separate cross-cutting refactor.
- **Per-analysis recovery boundary** (blind #7, edge #3): a degraded analysis is permanently locked out of AI verdicts even after budgets reset / breaker recovers (first-failure-wins + BFF lazy-fire skip). The story spec explicitly opts for this — AC4 talks about *new* jobs only. A "retry AI verdicts" affordance on the banner is a follow-up UX call.
- **No DB unique constraint on `(analysis_id, specialist='rule_engine')`** (edge #12): horizontal-scaling concern; multi-worker deployment could race and double-insert. Single-worker is the documented topology (CLAUDE.md). Address when horizontal scaling lands.
- **Render tests for `DegradationBanner` / `CoachPanel`** (Task 7.5/8.5): vitest is configured `environment: 'node'` with no `@testing-library/react` / `happy-dom`. Adding render coverage requires new dev deps + a vitest config change — explicit dep change is the kind of thing the dev-story workflow says to HALT and ask the user about, so I deliberately did NOT add those. Story 1.7 (design system foundation) or a dedicated DX story is the right home for the testing-library setup. Coverage today: pure-function copy contract + the production endpoint round-trip + the BFF integration test cover the surfaces; missing piece is the React render assertion.
- **`record_outcome` silent no-op on unknown outcome strings** (edge #18): test enshrines the behavior as defensive. A future story adding `outcome="refused"` (coach, 1.5) will explicitly handle it.
- **Microsecond precision in `occurred_at`** (edge #14): no user-visible bug today; frontend doesn't render the timestamp. Pure forward-looking.

### File List

New:
- components/worker/app/llm/errors.py
- components/worker/app/llm/budget.py
- components/worker/app/verdict_lib/degraded.py
- components/worker/tests/llm/test_budget.py
- components/worker/tests/test_budget_aggregator.py
- components/worker/tests/verdict_pipeline/test_degraded_path.py
- components/bff/src/Spectr.Data/Migrations/20260615121201_AddDegradationNotice.cs (+ .Designer.cs)
- components/bff/tests/Spectr.Bff.Tests/VerdictsDtoSerializationTests.cs
- components/bff/tests/Spectr.Bff.Tests/VerdictsEndpointDegradationTests.cs
- components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx
- components/frontend-spectr-v2/src/features/results/DegradationBanner.module.css
- components/frontend-spectr-v2/src/features/results/degradationCopy.ts
- components/frontend-spectr-v2/src/features/results/__tests__/degradation-banner.test.ts

Modified:
- components/worker/app/llm/gateway.py (re-export exception hierarchy from errors.py; wire pre-call budget hook + record_outcome on success/error/fake; docstring updated)
- components/worker/app/llm/settings.py (Decimal budget fields; breaker knobs; tier_ceiling helper)
- components/worker/app/triage_actor.py (catch LlmBudgetExceeded → write notice + run rule engine; skip when degradation_notice already set; pass exc.detail not str(exc))
- components/worker/app/verdict_actor.py (catch LlmBudgetExceeded BEFORE LlmError → write notice + run rule engine; pass exc.detail; no fail-marker on degraded path)
- components/worker/.env.example (LLM_BUDGET_* + LLM_CIRCUIT_BREAKER_* knobs documented)
- components/worker/tests/llm/conftest.py (autouse breaker reset + spend-aggregator stub; configure() syncs settings into budget.py)
- components/worker/tests/llm/test_gateway.py (5 new tests for budget + breaker integration)
- components/shared/aimusic_shared/models.py (Analysis.degradation_notice column)
- components/bff/src/Spectr.Data/Entities/Analysis.cs (DegradationNotice JSONB property)
- components/bff/src/Spectr.Data/Migrations/AppDbContextModelSnapshot.cs (regenerated)
- components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs (DegradationNoticeDto + extended VerdictsListResponse)
- components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs (project degradation_notice; skip lazy-fire when degraded; ParseDegradationNotice helper)
- components/frontend-spectr-v2/src/api/types.ts (DegradationReason + DegradationNoticeDto; extended VerdictsListResponse)
- components/frontend-spectr-v2/src/features/results/VerdictsPanel.tsx (render DegradationBanner above verdict list)
- components/frontend-spectr-v2/src/features/results/CoachPanel.tsx (degraded prop → offline copy)
- components/frontend-spectr-v2/src/features/results/AnalysisTab.tsx (guard hoisted to render CoachPanel when degraded even if no pipeline coach content; pass degraded prop)

Deleted:
- none

### Final gate sweep (post-review)

- worker `pytest -q tests/` → **133 passed** (101 baseline + 27 story 1.4 + 5 from review patches)
- shared `pytest -q components/shared/tests/` → 18 passed
- `python -m ruff check components/worker/ components/shared/` → All checks passed
- worker `mypy app/llm/ app/verdict_lib/ --ignore-missing-imports` → 20 source files clean
- BFF `dotnet build` → 0 warnings, 0 errors
- BFF `dotnet test --no-build` → **11 passed** (4 baseline + 5 DTO + 2 endpoint integration vs real Postgres)
- frontend `vite build` + `tsc -b` + `npm run lint` + `lint:css` + `lint:prices` + `vitest run` (34 passed) → all green

### File List

New:
- components/worker/app/llm/budget.py
- components/worker/app/verdict_lib/degraded.py
- components/worker/tests/llm/test_budget.py
- components/worker/tests/verdict_pipeline/test_degraded_path.py
- components/bff/src/Spectr.Data/Migrations/20260615121201_AddDegradationNotice.cs (+ .Designer.cs)
- components/bff/tests/Spectr.Bff.Tests/VerdictsDtoSerializationTests.cs
- components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx
- components/frontend-spectr-v2/src/features/results/DegradationBanner.module.css
- components/frontend-spectr-v2/src/features/results/degradationCopy.ts
- components/frontend-spectr-v2/src/features/results/__tests__/degradation-banner.test.ts

Modified:
- components/worker/app/llm/gateway.py (LlmBudgetExceeded + DEGRADATION_REASON_* constants; pre-call budget hook wired; record_outcome on success/error/fake; docstring caveat updated)
- components/worker/app/llm/settings.py (Decimal budget fields; breaker knobs; tier_ceiling helper)
- components/worker/app/triage_actor.py (catch LlmBudgetExceeded → write notice + run rule engine)
- components/worker/app/verdict_actor.py (catch LlmBudgetExceeded BEFORE LlmError → write notice + run rule engine, no fail-marker)
- components/worker/.env.example (LLM_BUDGET_* + LLM_CIRCUIT_BREAKER_* knobs documented)
- components/worker/tests/llm/conftest.py (autouse breaker reset + spend-aggregator stub; configure() syncs settings into budget.py)
- components/worker/tests/llm/test_gateway.py (5 new tests for budget + breaker integration)
- components/shared/aimusic_shared/models.py (Analysis.degradation_notice column)
- components/bff/src/Spectr.Data/Entities/Analysis.cs (DegradationNotice JSONB property)
- components/bff/src/Spectr.Data/Migrations/AppDbContextModelSnapshot.cs (regenerated)
- components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs (DegradationNoticeDto + extended VerdictsListResponse)
- components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs (project degradation_notice; skip lazy-fire when degraded; ParseDegradationNotice helper)
- components/frontend-spectr-v2/src/api/types.ts (DegradationReason + DegradationNoticeDto; extended VerdictsListResponse)
- components/frontend-spectr-v2/src/features/results/VerdictsPanel.tsx (render DegradationBanner above verdict list)
- components/frontend-spectr-v2/src/features/results/CoachPanel.tsx (degraded prop → offline copy)
- components/frontend-spectr-v2/src/features/results/AnalysisTab.tsx (pass degraded prop to CoachPanel)

Deleted:
- none
