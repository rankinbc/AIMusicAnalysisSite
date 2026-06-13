# Story 1.3: Anthropic SDK Gateway with Per-Call Metering

Status: review

## Story

As the operator,
I want every LLM call to flow through one SDK-based gateway with per-call metering,
so that verdicts scale beyond `Semaphore(1)` and unit economics are observable per call.

## Acceptance Criteria

1. **Given** `components/worker/app/llm/gateway.py`, **When** any verdict pipeline stage needs the LLM, **Then** it calls the gateway using the official `anthropic` SDK **And** the `claude` CLI subprocess path is deleted.
2. **Given** `LLM_MAX_CONCURRENCY` config (default 5), **When** concurrent calls exceed the limit, **Then** excess calls queue on the semaphore **And** per-purpose sub-limits (verdicts vs coach) apply (AR6).
3. **Given** any completed or failed call, **When** the gateway returns, **Then** exactly one `llm_calls` row exists with ULID, user_id, tier, purpose, prompt_slug, prompt_version, model, input/output tokens, cost_usd (computed from a versioned price table), latency_ms, outcome, and correlation_id (AR7).
4. **Given** `LLM_FAKE=1` (AR41), **When** verdicts run, **Then** golden-fixture responses replay with zero API spend.
5. **Given** model pinning per prompt version (NFR24), **When** a prompt version specifies a model, **Then** the gateway honors it **And** a fallback model is configurable.
6. **Given** a timeout or transient API error, **When** a call fails, **Then** the explicit retry policy applies and an `outcome=error` row is recorded.

## Tasks / Subtasks

- [x] Task 1: Worker LLM settings + dependency (AC: 1, 2, 5)
  - [x] 1.1 Add `anthropic>=0.40` to `components/worker/requirements.txt` (verify the version exists on PyPI before pinning; pick the current stable)
  - [x] 1.2 New `components/worker/app/llm/__init__.py` (package marker, no anthropic import — AR39 lint forbids the SDK anywhere but `gateway.py`)
  - [x] 1.3 New `components/worker/app/llm/settings.py` — pydantic-settings `LlmSettings(BaseSettings)`: `anthropic_api_key: str | None` (env `ANTHROPIC_API_KEY`, NFR6 — never hardcoded), `llm_max_concurrency: int = 5`, `llm_coach_concurrency: int = 2` (per-purpose sub-limit), `llm_fake: bool = False` (env `LLM_FAKE`, truthy "1"/"true"), `llm_default_model: str` (e.g. the current Claude default), `llm_fallback_model: str`, `llm_max_retries: int = 2`, `llm_timeout_s: int = 120`. NO anthropic import here. Provide a cached accessor `get_llm_settings()`.
- [x] Task 2: `llm_calls` metering table (AC: 3) — shared-first
  - [x] 2.1 EF entity `LlmCall` in `components/bff/src/Spectr.Data/Entities/LlmCall.cs` (`[Table("llm_calls")]`): `id` text PK (ULID, MaxLength 40), `user_id` Guid nullable (triage has no caller until Epic 2 stamps tier; specialist carries it), `tier` text(20) nullable, `purpose` text(20), `prompt_slug` text(64) nullable, `prompt_version` text(120) nullable, `model` text(60), `input_tokens` int, `output_tokens` int, `cost_usd` numeric(12,6), `price_table_version` text(20), `latency_ms` int, `outcome` text(20), `correlation_id` text(64) nullable, `created_at` timestamptz default now(). Architecture (Spectr.Data tables note) says LlmCall is "written by worker via SQL, mapped read-only in EF" — register the DbSet but the worker is the writer.
  - [x] 2.2 `dotnet ef migrations add AddLlmCalls` (restore first if needed); verify the generated table; index on `(created_at)` and `(user_id, created_at)` for the Epic-10 spend dashboards
  - [x] 2.3 SQLAlchemy mirror `LlmCall` in `components/shared/aimusic_shared/models.py` (snake_case, mirror exactly — cost_usd as `Numeric`); add to shared `__init__` exports if siblings are exported
  - [x] 2.4 `dotnet ef database update` against local Postgres (docker compose is already running) — verify `\d llm_calls`
- [x] Task 3: Versioned price table (AC: 3)
  - [x] 3.1 New `components/worker/app/llm/pricing.py` (NO anthropic import): `PRICE_TABLE_VERSION` string constant + `MODEL_PRICES: dict[str, ModelPrice]` where `ModelPrice` holds input + output USD-per-million-tokens; `compute_cost_usd(model, input_tokens, output_tokens) -> Decimal` (use `decimal.Decimal`, round to 6 dp). Unknown model → cost `Decimal("0")` + a logged warning (never raise — metering must not break a job). This is the canonical price location (architecture "no price literals outside config" — pricing.py IS the config for LLM prices).
  - [x] 3.2 Seed prices for the configured default + fallback models from current public Anthropic pricing; comment each with the date sourced.
- [x] Task 4: Gateway core (AC: 1, 2, 3, 5, 6)
  - [x] 4.1 New `components/worker/app/llm/gateway.py` — the ONLY module that may `import anthropic` (AR39 lint enforces exact path). Define typed exceptions `LlmError`, `LlmTimeoutError`, `LlmInvocationError` (the seam for `LlmBudgetExceeded` lands in story 1.4 — leave a documented hook, do not implement budgets here).
  - [x] 4.2 Async core `async def complete(*, system, user, purpose, prompt_slug, prompt_version, model, user_id, tier, correlation_id, max_tokens=4096, timeout_s=None) -> GatewayResult`. `GatewayResult` = dataclass(text, model, input_tokens, output_tokens, cost_usd, outcome, latency_ms). Uses the Messages API (`anthropic.AsyncAnthropic`). Acquires the global semaphore AND the purpose sub-semaphore (weighted: coach calls also hold a slot of the global pool) — see 4.4.
  - [x] 4.3 Sync wrapper `complete_sync(**kwargs) -> GatewayResult` that runs the async core via `asyncio.run` (dramatiq actors are sync — established pattern). This is the production path for `run_specialist` / `run_triage` this story.
  - [x] 4.4 Concurrency (AR6): module-level `asyncio.Semaphore(LLM_MAX_CONCURRENCY)` global + a smaller `asyncio.Semaphore(LLM_COACH_CONCURRENCY)` for `purpose=coach`. Verdict/triage purposes take only the global; coach takes coach-sub THEN global (weighted acquisition so coach can't starve verdicts and vice-versa). Build the structure now; the coach path that exercises it lands in 1.5/1.6 — unit-test the acquisition logic directly.
  - [x] 4.5 Metering (AC3): EVERY return path — success, validation-reject (caller-reported; default ok here), error, timeout — writes EXACTLY ONE `llm_calls` row via a `record_llm_call(...)` helper that lazily imports `app.db_sync` (same lazy-import + fail-open pattern as the prompt-pin lookup in story 1.1, so unit tests stay DB-free). A metering DB failure must be logged but MUST NOT mask the call result (best-effort write; the call already happened/cost money). Use `new_*` ULID helper from `aimusic_shared.verdicts.ulid_helpers` (add a `new_llm_call_id()` if a prefixed helper is wanted, else reuse).
  - [x] 4.6 Model pin + fallback (AC5): the caller passes the resolved `model`. Add prompt-frontmatter model resolution: extend `verdict_lib/prompt_loader.py` with a parser for an optional `model:` frontmatter field (alongside `version:`), exposed as `load_prompt_meta(slug) -> (version, model_or_none, body)` (keep `load_prompt` returning `(version, body)` for back-compat, or update both call sites — dev's choice, but don't break the golden tests). Gateway: effective model = pinned (frontmatter) → else `llm_default_model`. On a retryable failure with the primary model exhausted, retry ONCE on `llm_fallback_model` (configurable, may equal default → no-op), then record `outcome=error`.
  - [x] 4.7 Retry policy (AC6): catch `anthropic.APITimeoutError`, `anthropic.APIConnectionError`, `anthropic.RateLimitError`, `anthropic.InternalServerError` as retryable; non-retryable (`anthropic.BadRequestError`, auth errors) fail fast. Explicit bounded retries (`llm_max_retries`) with backoff; after exhaustion record an `outcome=error` row and raise `LlmInvocationError`. A timeout records `outcome=error` too. Do NOT silently swallow.
- [x] Task 5: LLM_FAKE replay (AC: 4)
  - [x] 5.1 New `components/worker/app/llm/fake.py` (NO anthropic import): a deterministic replay that returns a canned, schema-valid response keyed by `purpose`+`prompt_slug`. For specialists, return a minimal valid `{"verdicts":[...]}` (one moderate verdict with a real evidence metric path that survives the validator); for triage, a minimal valid routing plan. Reuse/derive from the golden fixtures where practical.
  - [x] 5.2 Gateway honors `LLM_FAKE=1`: short-circuit before any SDK call, return a `GatewayResult` with `model="fake"`, token counts estimated (e.g. `len//4`) or zero, `cost_usd=0`, `outcome=ok`, and STILL write the `llm_calls` row (so fake runs are observable). Zero network, zero spend.
  - [x] 5.3 Document `LLM_FAKE=1` in `components/worker/.env.example` (create if absent) alongside `ANTHROPIC_API_KEY`, `LLM_MAX_CONCURRENCY`, `LLM_DEFAULT_MODEL`, `LLM_FALLBACK_MODEL`.
- [x] Task 6: Wire actors + delete CLI path (AC: 1)
  - [x] 6.1 `verdict_actor.py` (`run_specialist(analysis_id, slug, user_id)`): replace the `llm_call_sync(...)` two-attempt loop with `gateway.complete_sync(purpose="specialist", prompt_slug=slug, prompt_version=<resolved>, model=<pinned-or-default>, user_id=<uuid>, tier=<resolved>, correlation_id=analysis_id, system=prompt_body, user=user_msg)`. Keep the existing JSON-retry-suffix behavior if the gateway response isn't valid JSON (that's a parse retry, distinct from transport retry). Update exception handling to the gateway's exception types. `tier`: until Epic 2 stamps it on the job, resolve to a config default `"free"` (note this in a comment referencing Epic 2).
  - [x] 6.2 `triage_actor.py` (`run_triage(analysis_id)` — has NO user_id arg): fetch `user_id` from the loaded `Analysis` row for the metering row; call `gateway.complete_sync(purpose="triage", prompt_slug="triage", prompt_version=<triage version>, ...)`.
  - [x] 6.3 Delete `components/worker/app/verdict_lib/llm_client_sync.py` and its references. The async pipeline modules (`specialists.py`/`triage.py`/`orchestrator.py`) keep the `LLMCaller` protocol (not the production path until 1.4) — do NOT delete the protocol. The frozen api `components/api/app/llm/client.py` stays frozen/untouched (v1, excluded from CI).
  - [x] 6.4 Confirm the AR39 anthropic-import lint still passes (the SDK now exists at the one allowed path) and the frozen-v1 boundary test still passes.
  - [x] 6.5 `docker/docker-compose.yml` worker service: replace `USE_CLAUDE_CLI: "true"` with `ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}"` + `LLM_FAKE: "${LLM_FAKE:-0}"` (so the dev stack runs fake by default without a key). Update CLAUDE.md worker gotcha if it references USE_CLAUDE_CLI (light touch — note the CLI path is gone).
- [x] Task 7: Tests + validation gates (AC: all)
  - [x] 7.1 `components/worker/tests/llm/test_pricing.py`: cost math (known tokens × known rate = expected Decimal), unknown-model → 0 + warning, rounding.
  - [x] 7.2 `components/worker/tests/llm/test_gateway.py`: monkeypatch the anthropic AsyncAnthropic client (no network) — assert (a) success path returns text + writes one metering row (stubbed `record_llm_call`), (b) `outcome=error` row on simulated retryable exhaustion, (c) fallback model used after primary exhaustion, (d) non-retryable fails fast with one error row, (e) `LLM_FAKE=1` returns canned + zero cost + still one row + zero SDK construction. Stub `record_llm_call` via autouse fixture capturing rows in a list (stay DATABASE_URL-free).
  - [x] 7.3 `components/worker/tests/llm/test_concurrency.py`: drive `complete` concurrently with a slow fake SDK; assert no more than `LLM_MAX_CONCURRENCY` in flight; assert coach sub-limit caps coach purpose independently.
  - [x] 7.4 `components/worker/tests/llm/test_fake_replay.py`: fake specialist response survives the real `validator.validate_verdict`; fake triage parses to a `SpecialistRoutingPlan`.
  - [x] 7.5 Extend `test_enforcement_lints.py` expectation is unchanged — but ADD an assertion-free confirmation in the gateway test module's docstring that the SDK import lives only here. Run the existing enforcement lint: it must PASS now that `gateway.py` exists at the allowed path with the import.
  - [x] 7.6 Full worker suite green: `cd components/worker && python -m pytest -q tests/` (DATABASE_URL unset). `ruff check components/worker/ components/shared/`. `mypy app/llm/ app/verdict_lib/ --ignore-missing-imports`. `pytest -q components/shared/tests/`. BFF `dotnet build && dotnet test`.
  - [x] 7.7 Live smoke (optional, gated on a real key being present; otherwise run with `LLM_FAKE=1`): dispatch `run_triage` + one `run_specialist` against a real analysis, confirm verdict rows AND an `llm_calls` row per call with correct purpose/outcome. Use a temp_ script, delete after.

## Dev Notes

### Why this story exists

Architecture D1: the gateway is the single Anthropic touchpoint, replacing the `claude` CLI `Semaphore(1)` that throttles verdicts to one-at-a-time and gives zero cost visibility. Per-call metering (`llm_calls`) is the telemetry spine Epic 2 billing and Epic 10 dashboards both read. This story builds the gateway + metering; story 1.4 adds budget ceilings + circuit breaker on top (raise `LlmBudgetExceeded`), 1.5/1.6 add the coach purpose that exercises the per-purpose sub-limit. [Source: PRPs/architecture.md#D1; PRPs/epics.md#Story-1.3]

### Scope boundary (do NOT over-build)

- **Budgets / circuit breaker / `LlmBudgetExceeded` = story 1.4.** Build the gateway so 1.4 can add a pre-call budget check + post-call spend accounting without restructuring — but implement NO ceilings here. Leave a clearly-commented hook.
- **Coach purpose = stories 1.5/1.6.** Build the `purpose=coach` sub-semaphore and accept `purpose="coach"`, but no coach actor exists yet. Unit-test the concurrency structure directly.
- **Real tier stamping = Epic 2.** `tier` on the metering row defaults to `"free"` from config until billing stamps the job row. Comment it.
- **The async batch orchestrator path = story 1.4.** This story wires only the sync per-actor path (`run_specialist`, `run_triage`). The `LLMCaller` protocol + async pipeline modules stay as-is (not production yet).

### Current state (verified on restructure @ 7f46484)

- **No `app/llm/` in the worker yet** — the directory is created here; `gateway.py` is the AR39-blessed SDK path (lint at `components/worker/tests/test_enforcement_lints.py` already allows exactly `components/worker/app/llm/gateway.py`).
- **Production LLM path today** = `components/worker/app/verdict_lib/llm_client_sync.py::llm_call_sync` (sync subprocess of the `claude` CLI), called by `verdict_actor.py` (`run_specialist`, two-attempt JSON loop, `timeout_s=120`) and `triage_actor.py` (`run_triage`). Both are sync dramatiq actors. They import `LLMInvocationError`/`LLMTimeoutError` from `llm_client_sync` — the gateway must provide replacement exception types.
- **`run_triage(analysis_id)` has NO `user_id` parameter** — load it from the `Analysis` row (`analysis.user_id`) for the metering row. `run_specialist(analysis_id, slug, user_id)` carries it.
- **Frozen reference**: `components/api/app/llm/client.py` has the v1 async `CliClient` (Semaphore(1)) + a stub `ApiClient` that raises NotImplementedError. It is FROZEN (v1, excluded from CI) — read it for the call shape, do not import or revive it.
- **Prompt frontmatter** currently carries only `version:` (`parse_version_frontmatter`). Model pinning (AC5) needs an optional `model:` field — extend the loader without breaking `load_prompt`'s `(version, body)` contract used by the actors and golden tests.
- **Config today** is ad-hoc `os.environ` (`db_sync.py`, `dramatiq_app.py`). This story introduces the first pydantic-settings module in the worker — keep it scoped to `app/llm/settings.py`; don't refactor the existing env reads.
- **`docker-compose.yml` worker** sets `USE_CLAUDE_CLI: "true"` — now obsolete; swap to `ANTHROPIC_API_KEY` + `LLM_FAKE` (fake by default so the dev stack needs no key).
- **Metering DB-write isolation**: tests must stay `DATABASE_URL`-free (stories 1.1/1.2 established autouse DB stubs). Route every metering write through one `record_llm_call(...)` that lazily imports `db_sync` and is stubbed by an autouse fixture in the new `tests/llm/conftest.py`.

### Critical guardrails

1. **`anthropic` import ONLY in `gateway.py`.** Settings, pricing, fake, and tests must NOT import the SDK — the AR39 lint (exact-path allowlist, catches comma-list + quoted dynamic forms) will fail CI otherwise. Stub the SDK in gateway tests via monkeypatch on the gateway's client factory, not via importing anthropic in the test.
2. **Exactly one `llm_calls` row per call, on every path** (AC3) — success, error, timeout, fake. Best-effort write that never masks the call outcome; a metering failure logs and continues.
3. **Metering must not break a job.** Lazy DB import + fail-open, mirroring the story-1.1 prompt-pin pattern. No `DATABASE_URL` in unit tests.
4. **`cost_usd` is `Decimal`/numeric, not float** — money. Versioned price table; unknown model → 0 + warning, never raise.
5. **Don't implement budgets** — that's 1.4. A `# story 1.4: budget check hook` comment marks the seam.
6. **Sync actors call `complete_sync`** (asyncio.run wrapper). Don't make the actors async — dramatiq actors are sync `def` (CLAUDE.md). Demucs forces worker `concurrency=1`, so the semaphore is mostly latent until the async batch/coach paths — build it correct, test it directly.
7. **No secrets in repo (NFR6).** `ANTHROPIC_API_KEY` via env/pydantic-settings only. `.env.example` documents the knob with no value.
8. **Keep golden-fixture tests passing** — the validator/dedupe/ranker tests use `MockLLMClient`, untouched. Don't reroute them through the gateway.
9. **Stack rules**: Python 3.11+, ruff, mypy, Pydantic v2 / pydantic-settings, SQLAlchemy 2.0 sync in worker, no python-jose, EF owns canonical schema (shared mirror follows).

### Previous story intelligence (1.1, 1.2)

- **Lazy-import + fail-open DB pattern** (story 1.1 prompt-pin `_fetch_pin_from_db`): reuse verbatim shape for `record_llm_call` so unit tests need no DB and a sick DB never fails a job.
- **Autouse conftest stubs** (story 1.2 `tests/verdict_pipeline/conftest.py`): add `tests/llm/conftest.py` with an autouse fixture stubbing `record_llm_call` to capture rows in a list, plus `get_llm_settings` overrides for fake/concurrency.
- **AR39 lint is exact-path + catches dynamic/comma imports** — the SDK import must be a plain top-level `import anthropic` (or `from anthropic import ...`) in `gateway.py` only.
- **CI installs** `pip install -e components/shared -r components/worker/requirements.txt` then ruff/mypy/pytest — adding `anthropic` to requirements.txt is sufficient for CI; the SDK is import-only at module load, so `LLM_FAKE`/monkeypatch keeps CI network-free. Confirm CI green on GitHub (`gh run watch`).
- **EF migration flow** (story 1.1): `dotnet restore` if assets missing → `dotnet ef migrations add` → `dotnet ef database update` against the running docker Postgres (stack is up from 1.1). Stop any running `Spectr.Bff.exe` before `dotnet build` (Windows file lock).
- **Shared dep gap caught by CI** (story 1.2): `aimusic-shared` must declare anything it imports — but `anthropic` belongs to the WORKER, not shared. Keep it in worker requirements only.

### Project Structure Notes

- New: `components/worker/app/llm/{__init__,settings,gateway,pricing,fake}.py`, `components/worker/tests/llm/{__init__,conftest,test_pricing,test_gateway,test_concurrency,test_fake_replay}.py`, `components/worker/.env.example`, `components/bff/src/Spectr.Data/Entities/LlmCall.cs` + migration.
- Modified: `verdict_actor.py`, `triage_actor.py` (gateway calls), `verdict_lib/prompt_loader.py` (optional `model:` frontmatter), `components/worker/requirements.txt` (anthropic), `components/shared/aimusic_shared/models.py` (LlmCall mirror), `AppDbContext.cs` (+DbSet), `docker/docker-compose.yml` (env swap).
- Deleted: `components/worker/app/verdict_lib/llm_client_sync.py`.
- No new top-level folders.

### References

- [Source: PRPs/epics.md#Story-1.3 (lines 444–457) — story + ACs verbatim]
- [Source: PRPs/architecture.md#D1 — gateway placement, semaphore, metering columns, retry/degradation seam]
- [Source: PRPs/architecture.md#Project-Structure — `LlmCall*` "written by worker via SQL, mapped read-only in EF"]
- [Source: PRPs/architecture.md#Naming/Format-Patterns — ULIDs, integer cents/Decimal money, snake_case tables]
- [Source: components/worker/app/verdict_actor.py — run_specialist lifecycle, two-attempt JSON loop, exception handling to replace]
- [Source: components/worker/app/triage_actor.py — run_triage (no user_id), Analysis load]
- [Source: components/worker/app/verdict_lib/llm_client_sync.py — the CLI path to delete; exception types to replace]
- [Source: components/api/app/llm/client.py — frozen v1 async CliClient call shape (reference only, do not import)]
- [Source: components/worker/tests/test_enforcement_lints.py — AR39 allowlist path the gateway must occupy]
- [Source: PRPs/stories/1-1-*.md, 1-2-*.md Dev Agent Records — lazy-DB pattern, autouse stubs, EF flow, CI install]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code)

### Debug Log References

- anthropic SDK on PyPI: latest 0.109.1, installed 0.72.1 → pinned `anthropic>=0.69,<1`
- Worker suite: 99 passed (79 prior + 20 new llm tests: 7 pricing, 9 gateway, 2 concurrency, 3 fake-replay − overlap)
- Enforcement + boundary: 3 passed (AR39 anthropic-only-in-gateway now green with the SDK present at the allowed path)
- ruff clean; mypy 17 files clean (app/llm + app/verdict_lib); shared 18 passed
- BFF: build 0 errors; test 4/4
- EF: `AddLlmCalls` applied; regenerated once to add `created_at` `now()` default (worker inserts via SQLAlchemy, needs DB-side default); `\d llm_calls` verified
- Metering smoke (LLM_FAKE=1, real Postgres, scripted then deleted): run_triage + run_specialist → routing_plan persisted, verdict row persisted, and TWO llm_calls rows (`triage`/`specialist`, outcome=ok, model=fake, cost 0) keyed by correlation_id=analysis_id. Real `record_llm_call` lazy-import + SQLAlchemy write path exercised (unit tests stub it).

### Completion Notes List

- **Gateway is the sole anthropic touchpoint** at `app/llm/gateway.py` (AR39 allowed path). settings/pricing/fake are SDK-free. Tests stub the SDK by monkeypatching `gateway._get_client` (no `import anthropic` in any test) and access exception classes via `gateway.anthropic.*` attribute (lint-safe — not an import statement).
- **Exactly one `llm_calls` row per logical call** on every path: success, fallback-success, retry-exhaustion error, non-retryable error, fake. Retries/fallback collapse into the single final row (verified by `len(metered)==1` across all gateway tests).
- **Metering fail-open**: `record_llm_call` lazily imports `db_sync` and swallows any DB error (logged) — a sick DB never fails a job. Same pattern as story 1.1's prompt-pin lookup.
- **Concurrency** (AR6): per-event-loop semaphore cache (`complete_sync` uses a fresh `asyncio.run` loop each call, so a module-global semaphore would bind to a dead loop — keyed on running-loop id, rebuilt on change). Global cap + coach sub-pool; coach acquires coach-sem THEN global-sem (weighted). Tested: 6 specialist calls cap at max_concurrency=2; 4 coach calls cap at coach_concurrency=1.
- **Retry/fallback** (AC5/AC6): gateway owns retries (SDK `max_retries=0`). Retryable = timeout/connection/rate-limit/5xx (translated from anthropic exceptions at the `_call_once` boundary into gateway exception types); non-retryable = 4xx fail-fast. Bounded retries with exponential backoff (base monkeypatched to 0 in tests), then fallback model, then one error row + raise.
- **Model pinning** (NFR24): `prompt_loader.load_prompt_model(slug)` parses optional `model:` frontmatter (pin-aware via the story-1.1 resolver, refactored to a shared `_served_prompt_content`). Effective model = pinned → else `LLM_DEFAULT_MODEL`. `load_prompt`'s `(version, body)` contract unchanged (golden tests untouched).
- **cost_usd is Decimal**, from a versioned price table (`PRICE_TABLE_VERSION=2026-06-13`) keyed by model family with longest-prefix match (dated snapshots price correctly); unknown model → 0 + warning, never raises.
- **CLI path deleted**: `verdict_lib/llm_client_sync.py` removed; both actors call `gateway.complete_sync`. The frozen v1 `components/api/app/llm/client.py` is untouched (excluded from CI).
- **Default model strings** (`claude-sonnet-4-5` / `claude-haiku-4-5`) are config defaults — the operator must confirm the exact API model id for their account; dev/CI run `LLM_FAKE=1` so no real model id is exercised. Documented in `.env.example` + settings comments.
- **Scope honored**: NO budgets/circuit-breaker (1.4 — a commented pre-call hook marks the seam), coach purpose accepted + sub-semaphore built but no coach actor yet (1.5/1.6), tier defaults to "free" until Epic 2 stamps the job row.
- **Pre-existing api `test_cli_client*.py`** still reference the v1 CLI client (frozen, excluded from CI) — untouched.

### Change Log

- 2026-06-13: Implemented; all gates green incl. real-DB metering smoke. Status → review.

### File List

New:
- components/worker/app/llm/{__init__,settings,pricing,fake,gateway}.py
- components/worker/tests/llm/{__init__,conftest,test_pricing,test_gateway,test_concurrency,test_fake_replay}.py
- components/worker/.env.example (LLM section appended)
- components/bff/src/Spectr.Data/Entities/LlmCall.cs
- components/bff/src/Spectr.Data/Migrations/20260613132832_AddLlmCalls.cs (+ .Designer.cs)

Modified:
- components/worker/app/verdict_actor.py (gateway.complete_sync; model from result)
- components/worker/app/triage_actor.py (gateway.complete_sync; user_id from Analysis row)
- components/worker/app/verdict_lib/prompt_loader.py (optional model: frontmatter; _served_prompt_content refactor; load_prompt_model)
- components/worker/requirements.txt (anthropic, pydantic-settings)
- components/worker/README.md (tree: llm/ package, CLI wrapper removed)
- components/shared/aimusic_shared/models.py (LlmCall mirror, Numeric import)
- components/shared/aimusic_shared/verdicts/ulid_helpers.py (new_llm_call_id)
- components/bff/src/Spectr.Data/AppDbContext.cs (LlmCall DbSet, indexes, created_at default)
- components/bff/src/Spectr.Data/Migrations/AppDbContextModelSnapshot.cs (regenerated)
- docker/docker-compose.yml (worker: USE_CLAUDE_CLI → ANTHROPIC_API_KEY + LLM_FAKE)

Deleted:
- components/worker/app/verdict_lib/llm_client_sync.py
