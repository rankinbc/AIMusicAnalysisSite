# Story 2.5: Paid Jobs Never Starve

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a paying user,
I want my analyses to start promptly regardless of free-tier load,
So that paying is visibly worth it.

## Acceptance Criteria

1. **Given** queues `analysis-paid`, `analysis-free`, `coach`, `maintenance` (AR23), **When** jobs dispatch, **Then** paid/credit jobs route to `analysis-paid`, free/anonymous to `analysis-free`, and coach replies to `coach`.
2. **Given** production compose, **When** workers start, **Then** W1 (`worker-paid`) consumes `coach, analysis-paid` (in that order) and W2 (`worker-free`) consumes `analysis-free, maintenance`.
3. **Given** W2 saturated with free jobs, **When** a paid job arrives, **Then** its queue wait is unaffected (integration test with stub jobs proves it — FR34).
4. **Given** dev, **When** a single worker consumes all queues, **Then** behavior is functionally unchanged.

### Derived / regression-prevention criterion (see Dev Notes → "The `default` queue trap")

5. **Given** the AR23 prod topology has **no `default` queue**, **When** the split ships, **Then** every actor that today rides `default` (`run_triage`, `run_specialist`, `run_reference_analyzer`, `classify_stems`, `rerun_phase`) is re-homed onto a queue some prod worker consumes — otherwise verdicts, stem classification, reference analysis, and per-phase re-run silently break in production. An enforcement test asserts no actor and no BFF enqueue site targets `default`.

## Tasks / Subtasks

- [ ] **Task 1: BFF — queue-name constants (AC: 1, 2, 5)**
  - [ ] 1.1 In `components/bff/src/Spectr.Bff/Services/DramatiqQueues.cs` add three constants beside the existing `Default`/`Coach`:
    - `public const string AnalysisPaid = "analysis-paid";`
    - `public const string AnalysisFree = "analysis-free";`
    - `public const string Maintenance = "maintenance";`
    - Keep `Default` defined (legacy/back-compat) but it must no longer be the target of any live enqueue after this story.
  - [ ] 1.2 Do **not** change `IJobQueue` / `DramatiqJobQueue` — the 3-arg `EnqueueAsync(taskName, args, queueName, ct)` overload already exists (story 1.5) and already writes `dramatiq:<queue>.msgs` HASH + `dramatiq:<queue>` LIST with the matching `options.redis_message_id`. We only pass new queue strings through it.

- [ ] **Task 2: BFF — tier-route the analysis job (AC: 1, 3)**
  - [ ] 2.1 In `Endpoints/VersionEndpoints.cs`, inside `DispatchAnalysisAsync`, replace the final enqueue (currently `await queue.EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, new object[] { jobId.ToString() }, ct);`) with a tier-derived queue:
    ```csharp
    var queueName = ent.Tier switch
    {
        "pro"     => DramatiqQueues.AnalysisPaid,
        "credits" => DramatiqQueues.AnalysisPaid,
        _         => DramatiqQueues.AnalysisFree, // "free", null, future anonymous
    };
    await queue.EnqueueAsync(
        DramatiqTasks.AnalyzeAudioJob,
        new object[] { jobId.ToString() },
        queueName,
        ct);
    ```
  - [ ] 2.2 Route off `ent.Tier` (the resolver's authoritative value), **not** off `job.Tier` re-read — they are equal here, but `ent.Tier` is already in hand and is the contract source. The job row's `tier` column (stamped in 2.4) remains the worker's source of truth for in-pipeline tier decisions; this story does not change the worker's tier reads.
  - [ ] 2.3 The enqueue still happens AFTER the DB transaction commits (unchanged ordering from 2.4 / AR13).

- [ ] **Task 3: BFF — re-home the 5 auxiliary enqueue sites off `default` (AC: 1, 2, 5)**
  - [ ] All five currently call the 2-arg overload (→ `default`). Switch each to the 3-arg overload with `DramatiqQueues.AnalysisPaid` (rationale: these are paid-priority / paid-feature work — see Dev Notes → "Auxiliary actor placement"). `coach_reply` already passes `DramatiqQueues.Coach` — leave it.
  - [ ] 3.1 `Endpoints/VersionEndpoints.cs` (~line 779) `ClassifyStems` → `DramatiqQueues.AnalysisPaid`.
  - [ ] 3.2 `Endpoints/VerdictEndpoints.cs` (~line 65) `RunTriage` → `DramatiqQueues.AnalysisPaid`.
  - [ ] 3.3 `Endpoints/VerdictEndpoints.cs` (~line 177) `RunSpecialist` → `DramatiqQueues.AnalysisPaid`.
  - [ ] 3.4 `Endpoints/ReportPhaseEndpoints.cs` (~line 57) `RerunPhase` → `DramatiqQueues.AnalysisPaid`.
  - [ ] 3.5 `Endpoints/ReferenceEndpoints.cs` (~line 196) `RunReferenceAnalyzer` → `DramatiqQueues.AnalysisPaid`.
  - [ ] 3.6 Grep the whole BFF for `EnqueueAsync(` and confirm **zero** remaining 2-arg call sites (every live enqueue now names a queue). The 2-arg overload may stay on `IJobQueue` for source-compat but must have no callers.

- [ ] **Task 4: Worker — align actor `queue_name` decorators (AC: 1, 2, 4, 5)**
  - [ ] 4.1 `app/tasks_dramatiq.py`:
    - `analyze_audio_job` (~line 80): `queue_name="default"` → `queue_name="analysis-free"`. **This is a hard correctness requirement, not a style choice — do NOT change it to `analysis-paid`.** `analyze_audio_job` is the *only* actor that declares `analysis-free`, and a Dramatiq worker only attaches a consumer to a queue that some actor has DECLARED (the `--queues` flag merely whitelists among declared queues — see Dev Notes → "Dramatiq consumption model"). If `analyze_audio_job` declared `analysis-paid` instead, `analysis-free` would be undeclared, W2's `{analysis-free, maintenance}` whitelist would match nothing, and **every free job would be orphaned.** The actor is consumed from BOTH lanes (the worker dispatches incoming messages by `actor_name` regardless of arrival queue); it just must *declare* `analysis-free`.
    - `classify_stems` (~line 214): `queue_name="default"` → `queue_name="analysis-paid"`.
  - [ ] 4.2 `app/verdict_actor.py` `run_specialist` (~line 158): → `queue_name="analysis-paid"`.
  - [ ] 4.3 `app/triage_actor.py` `run_triage` (~line 68): → `queue_name="analysis-paid"`.
  - [ ] 4.4 `app/reference_analyzer_actor.py` `run_reference_analyzer` (~line 36): → `queue_name="analysis-paid"`.
  - [ ] 4.5 `app/rerun_phase_actor.py` `rerun_phase` (~line 49): → `queue_name="analysis-paid"`.
  - [ ] 4.6 `app/coach_actor.py` `coach_reply` (~line 242): unchanged (`queue_name="coach"`).
  - [ ] 4.7 Preserve every other decorator arg verbatim (`max_retries`, `time_limit`, `actor_name`). Only `queue_name` changes.

- [ ] **Task 5: Worker — dev entrypoint consumes all queues (AC: 4)**
  - [ ] 5.1 `components/worker/Procfile` line 9: change the `--queues default coach` flag to `--queues coach analysis-paid analysis-free maintenance`. Keep `--processes 1 --threads 1`. This single dev worker drains all four queues, so dev behavior is functionally identical (every message still gets processed by one process). Drop `default` from the list (no producer remains after Tasks 2–3); if a stray legacy message is a concern in a long-lived dev Redis, append `default` back temporarily.

- [ ] **Task 6: Docker — production W1/W2 split (AC: 2)**
  - [ ] 6.1 Leave the dev `worker` service in `docker/docker-compose.yml` as-is (it inherits the Procfile/Dockerfile CMD → single worker, all queues → AC4).
  - [ ] 6.2 Create `docker/docker-compose.prod.yml` (a compose **overlay**, used as `-f docker-compose.yml -f docker-compose.prod.yml`) defining two worker services that reuse the dev image build context:
    - `worker-paid` (W1): `command: python -m dramatiq app.dramatiq_app --processes 1 --threads 1 --queues coach analysis-paid`
    - `worker-free` (W2): `command: python -m dramatiq app.dramatiq_app --processes 1 --threads 1 --queues analysis-free maintenance`
    - Both carry the same `environment` + `volumes` block as the dev `worker` service; both `depends_on` postgres+redis healthy.
    - The overlay should disable the single dev `worker` (e.g. `worker: { deploy: { replicas: 0 } }` or `profiles: ["dev-only"]` on the dev service — pick whichever the installed compose version honors cleanly; document the chosen mechanism in `docker/README.md`).
  - [ ] 6.3 Add a short note in `docker/README.md`: dev = `docker compose up` (one worker, all queues); prod = `docker compose -f docker-compose.yml -f docker-compose.prod.yml up` (W1+W2 split). **Note:** the full production stack (caddy/TLS, image pull, etc.) is owned by Epic 10 story 10.1 — this overlay only proves the AR23 queue split (FR34) and will be folded into 10.1's topology.

- [ ] **Task 7: Worker test — structural starvation isolation (AC: 3)**
  - [ ] 7.1 New `components/worker/tests/test_queue_routing.py`. Use `dramatiq.brokers.stub.StubBroker` + `dramatiq.Worker`. Save/restore the global broker in a fixture (the coach tests stub Redis globally — isolate this test's broker so it does not leak).
  - [ ] 7.2 **Declare the queues the test uses BEFORE `worker.start()`** (consumers only attach to declared queues — see Dev Notes #2). Simplest: register two stub actors, one `queue_name="analysis-paid"` and one `queue_name="analysis-free"` (each just increments a counter), so both queues are declared; or call `broker.declare_queue(...)` for each. Then start the worker. Sending alone (`.send_with_options`) declares the queue too, but doing it before `start()` avoids a race where the consumer isn't attached yet.
  - [ ] 7.3 **Isolation proof (the FR34 assertion):** send 100 messages to the `analysis-free` actor and 1 to the `analysis-paid` actor. Start `Worker(broker, queues={"coach", "analysis-paid"})` (W1). `broker.join("analysis-paid")` then `worker.join()`; `worker.stop()`. Assert the paid counter == 1 **and** the free counter == 0 — W1 never even sees the free flood, so paid latency is independent of free depth by construction. (Note `dramatiq.Worker.join()` is the test-only drain helper; `broker.join(queue)` waits on a specific queue.)
  - [ ] 7.4 **Symmetric W2 check:** a fresh `Worker(broker, queues={"analysis-free", "maintenance"})` drains `analysis-free` and never processes `analysis-paid`.
  - [ ] 7.5 Confirmed API (dramatiq 2.1.0): `Worker(broker, *, queues: set[str], worker_threads=8)`; `queues` is an unordered set. Pin assertions to real `StubBroker`/`Worker` behavior; never mock to pass.

- [ ] **Task 8: Worker test — actor queue assignments + enforcement lint (AC: 1, 5)**
  - [ ] 8.1 New test (or extend `components/worker/tests/test_enforcement_lints.py`): import the actor modules and assert each actor's `.queue_name`:
    - `analyze_audio_job == "analysis-free"`, `classify_stems == "analysis-paid"`, `run_specialist == "analysis-paid"`, `run_triage == "analysis-paid"`, `run_reference_analyzer == "analysis-paid"`, `rerun_phase == "analysis-paid"`, `coach_reply == "coach"`.
    - **No registered actor has `queue_name == "default"`** (iterate the broker's declared actors). This is the AC5 guard.

- [ ] **Task 9: BFF test — dispatch routing by tier (AC: 1, 5)**
  - [ ] 9.1 Extend `RecordingJobQueue` (in `tests/Spectr.Bff.Tests/UploadDeferralTests.cs`) to also capture the queue name. Add a parallel `ConcurrentQueue<(string Task, string Queue)> Enqueues` recorded in BOTH overloads (2-arg records queue `DramatiqQueues.Default`); **keep the existing `Calls` collection unchanged** so the ~8 existing assertions (`queue.Calls.First()`, `Assert.Single(queue.Calls)`, etc.) still pass.
  - [ ] 9.2 New `tests/Spectr.Bff.Tests/DispatchQueueRoutingTests.cs` (model on `DispatchEntitlementGateTests` — same Postgres-reachable gate + `RecordingJobQueue` injection). Cases:
    - free user (0 used) dispatch → `analyze_audio_job` enqueued on `analysis-free`.
    - credits user (balance ≥ 1) → `analysis-paid`.
    - pro user (sub active) → `analysis-paid`.
    - pro `past_due` → `analysis-paid` (matches 2.4 tier table; dunning is 2.9).
  - [ ] 9.3 Add one assertion that `ClassifyStems` (and at least one other auxiliary task reachable in tests) enqueues on `analysis-paid`, OR cover via a focused unit test if the endpoint is hard to drive — the goal is to lock the AC5 re-homing so a later refactor can't silently send them back to `default`.

- [ ] **Task 10: Docs (AC: all)**
  - [ ] 10.1 Update `components/worker/README.md`: queue topology table (queue → actors → which worker), dev vs prod launch commands, and the "no `default` queue in prod" invariant.
  - [ ] 10.2 Update `CLAUDE.md` worker section (D4/AR23): replace the implicit "production split is deferred" note with the shipped topology — W1 `coach, analysis-paid`; W2 `analysis-free, maintenance`; dev = one worker, all queues; `analyze_audio_job` tier-routed by the BFF; auxiliary actors on `analysis-paid`; `maintenance` provisioned-but-empty until Epic 3/4 add `sweep_retention`/`send_email`.

## Dev Notes

### What story 2.4 already gave us (previous-story intelligence)

Story 2.4 (status: `review`, file `PRPs/stories/2-4-server-side-entitlements-and-metering.md`) landed the entire tier-resolution + dispatch spine this story rides on. **Its changes are uncommitted in the working tree** (`git status` shows `VersionEndpoints.cs`, `Program.cs`, etc. as modified and the 2.4 story file untracked) — do not assume a clean `git log`; the 2.4 code is present in-tree.

Key carry-forward facts:
- `EntitlementsDto.Tier` is already `"free" | "credits" | "pro"` and is resolved by `EntitlementService.ForAsync(userId, ct)` (cached 60 s). [Source: `Services/EntitlementService.cs`; 2.4 Tasks 2–3]
- `AnalysisJob.Tier` column already stamps the tier at dispatch (`[Column("tier"), MaxLength(16)]`). The worker reads it; never reads billing tables (AR13). **This story does not touch tier stamping — only queue routing.**
- `DispatchAnalysisAsync` is the **single** authoritative analysis-dispatch path; all 5 `analyze_audio_job` enqueue sites already funnel through it. So tier routing for analysis is a one-line change in one place. [Source: `Endpoints/VersionEndpoints.cs` `DispatchAnalysisAsync` ~lines 866–950]
- 2.4 explicitly deferred "Worker queue routing by tier (story 2.5)" in its Out-of-scope list — this is that story.

### The queue plumbing already exists (story 1.5)

`IJobQueue` already has the queue-name overload and `DramatiqJobQueue` already writes the correct Dramatiq wire format for any queue name:
- `dramatiq:<queue>.msgs` HASH (message_id → JSON) + `dramatiq:<queue>` LIST (message_id, RPUSH), atomic via `CreateTransaction()` (MULTI/EXEC). Envelope sets `queue_name` AND `options.redis_message_id` (the latter MUST match the keys or the Python consumer KeyErrors on ack). [Source: `Services/IJobQueue.cs` lines 8–70; `Namespace = "dramatiq"`]
- `coach_reply` is the existing reference for a 3-arg enqueue (`DramatiqQueues.Coach`). [Source: `Endpoints/CoachConversationEndpoints.cs` ~lines 192–201]

So there is **no broker / wire-format work** in this story — only routing strings, actor decorators, the Procfile, a prod compose overlay, and tests.

### Routing map (the authoritative table for this story)

| Actor (`actor_name`) | Decorator `queue_name` | BFF enqueue target | Consumed by |
|---|---|---|---|
| `analyze_audio_job` | `analysis-free` (**required** — sole declarer of this queue) | **tier-routed**: pro/credits → `analysis-paid`, free/anon/null → `analysis-free` | W1 (paid) / W2 (free) |
| `coach_reply` | `coach` (unchanged) | `coach` (unchanged) | W1 |
| `run_triage` | `analysis-paid` | `analysis-paid` | W1 |
| `run_specialist` | `analysis-paid` | `analysis-paid` | W1 |
| `run_reference_analyzer` | `analysis-paid` | `analysis-paid` | W1 |
| `classify_stems` | `analysis-paid` | `analysis-paid` | W1 |
| `rerun_phase` | `analysis-paid` | `analysis-paid` | W1 |
| `sweep_retention` *(future, Epic 3)* | `maintenance` | — | W2 |
| `send_email` *(future, Epic 4)* | `maintenance` | — | W2 |

Worker pools (AR23 / D8):
- **W1 `worker-paid`** consumes `coach, analysis-paid` (coach first).
- **W2 `worker-free`** consumes `analysis-free, maintenance`.
- **Dev** = one worker consuming all four.

### Dramatiq consumption model (verified against dramatiq 2.1.0 — read this before touching queues)

Three facts from the installed source (`dramatiq/worker.py`) that drive every decision below:

1. **Routing is by `actor_name`, not by queue.** A `WorkerThread` looks up the actor on each message by its `actor_name` and runs it, regardless of which queue/consumer delivered it. So one actor (`analyze_audio_job`) can be consumed from both `analysis-paid` and `analysis-free`. **The BFF's explicit `queueName` argument is the real router** (Tasks 2–3); there are zero Python-side `.send()` chains in the worker (verified), so the decorator `queue_name` is *not* a runtime router.

2. **A consumer is only created for a DECLARED queue, then filtered by the whitelist.** `Worker(broker, queues=...)` stores `consumer_whitelist`. Consumers are attached via the `after_declare_queue` event — i.e. only when an actor registers on that queue (or `broker.declare_queue(name)` is called). The `--queues` flag does **not** declare anything; it only whitelists among already-declared queues. Consequences:
   - `analyze_audio_job` **must** declare `analysis-free` (it is the sole declarer — see Task 4.1). The 5 auxiliary actors declare `analysis-paid`. `coach_reply` declares `coach`. So all three live queues are declared and therefore consumable.
   - **Coupling to remember:** `analysis-paid` is declared *only* by the auxiliary actors. Keep ≥1 actor on `analysis-paid`, or W1 loses its paid-analysis consumer.
   - `maintenance` is declared by **no actor this story** → W2 gets **no consumer** for it (not an error; it's an empty whitelist entry). It self-heals when Epic 3/4 adds `sweep_retention`/`send_email` (which declare `maintenance`). If you want a live empty consumer now, add `broker.declare_queue("maintenance")` in `app/dramatiq_app.py` after `set_broker`.

3. **`queues` is an unordered `set[str]`** (`Worker.__init__` signature). So AC2's "consumes `coach, analysis-paid` *in that order*" is **documentary, not an enforced priority** — a single worker pulls from all its queues into one shared work queue with no cross-queue precedence. The starvation guarantee (FR34) is delivered by **process separation (W1 ≠ W2)**, not by intra-worker queue order. Do not promise coach-over-paid priority *within* W1; if that's ever needed it's a separate worker or a priority middleware (out of scope).

### The `default` queue trap (the regression this story exists to prevent)

AR23's prod topology lists exactly four queues — `analysis-paid`, `analysis-free`, `coach`, `maintenance`. **There is no `default`.** Today six actors ride `default`. If we ship W1/W2 (AC2) without re-homing them, then in prod **nothing consumes `default`** and these features die silently: on-demand verdicts (`run_triage`/`run_specialist`), bulk stem classification (`classify_stems`), reference-track analysis (`run_reference_analyzer`), and per-phase re-run (`rerun_phase`). Hence AC5, Task 3, Task 4, and the enforcement lint in Task 8. This is the single highest-risk item — verify it with the lint, not by eyeballing.

### Auxiliary actor placement — rationale (a documented decision, see Open Questions)

The 4 ACs only name analysis jobs + coach. The auxiliary actors need a home anyway (above). They are routed to `analysis-paid` (W1) because:
- `run_triage`/`run_specialist` are interactive LLM work; D1+D4 compose explicitly puts interactive LLM (coach) on the paid-priority worker for latency [architecture.md line 285] — verdict generation is the same class of work.
- `classify_stems` only runs for paid/credits users (free tier has `stems=false` per the 2.4 tier table), so `analysis-paid` is its natural and only audience.
- `rerun_phase`/`run_reference_analyzer` are low-volume, latency-sensitive secondary operations on a user's existing track; keeping them off W2 protects them from the free-analysis flood.
- Net effect: **W2 is dedicated to the high-volume free-analysis flood + maintenance** — which is exactly the starvation vector FR34 isolates. Putting auxiliary work on W1 keeps W2's only job "absorb free load."
- Accepted minor trade-off: a free user viewing (limited) verdicts can trigger `run_triage` on W1, i.e. paid-priority. Verdicts are on-demand and low-volume; acceptable. Flagged in Open Questions for operator confirmation.

### Testing standards

- **Worker:** `pytest -q components/worker/tests/`. Tests use SQLite-backed in-memory DB (`conftest.py` compiles `JSONB`→`JSON`) and stub Redis. For queue tests use `StubBroker` + `dramatiq.Worker`; restore the global broker after the test. Never mock to pass — assert real `StubBroker`/`Worker` behavior. [Source: `components/worker/tests/conftest.py`, `test_coach_actor.py`]
- **BFF:** `cd components/bff && dotnet test`. Integration tests are gated on a reachable Postgres (`PostgresReachable()` pattern) and inject `RecordingJobQueue` via `WithWebHostBuilder` + `RemoveAll<IJobQueue>()`. [Source: `DispatchEntitlementGateTests.cs`, `UploadDeferralTests.cs`]
- All BFF gates: `dotnet build && dotnet test`. No frontend changes in this story (queue routing is server-only) → no frontend gate needed; confirm `git diff --stat` shows no `frontend-spectr-v2` changes.

### Architecture / source citations

- **AC1–AC4 verbatim:** [Source: `PRPs/epics.md#Story 2.5: Paid Jobs Never Starve` lines 602–613]
- **AR23 (queue topology):** "Dramatiq queues: `analysis-paid`, `analysis-free`, `coach`, `maintenance`. … W1 consumes `coach, analysis-paid`; W2 consumes `analysis-free, maintenance`. Starvation-proofing structural by process separation. Existing actors unchanged except queue assignment + tier stamp." [Source: `PRPs/epics.md` line 198; `PRPs/architecture.md#D4` line 108]
- **FR34:** "Free-tier and anonymous jobs never starve paying users' jobs (queue prioritization)." [Source: `PRPs/epics.md` line 77]
- **NFR4:** concurrency floor 10 analyses / 5 LLM streams without queue starvation of paid users. [Source: `PRPs/epics.md` line 113]
- **D8 (compose names worker-paid/worker-free):** [Source: `PRPs/architecture.md#D8` line 124]
- **Queue naming convention kebab-case; actors snake_case:** [Source: `PRPs/architecture.md` line 157]
- **Coach rides paid worker (precedent for auxiliary LLM placement):** [Source: `PRPs/architecture.md` line 285]

### Project Structure Notes

- No new top-level folders. New files land where convention dictates: BFF test under `components/bff/tests/Spectr.Bff.Tests/`, worker test under `components/worker/tests/`, prod compose under `docker/`.
- Touch points are all inside `components/bff/`, `components/worker/`, `docker/` — no cross-component contract change (BFF↔worker seam preserved: still Redis enqueue, no HTTP).
- The 2-arg `IJobQueue.EnqueueAsync` overload survives for source-compat but ends this story with zero callers (Task 3.6 guard).

### Git intelligence

Recent commits on the active branch (`listen-v2-visual`) are unrelated frontend Listen-page work (EQ overlay, DAW shell). The billing/dispatch lineage (stories 2.1–2.4) lives in the **working tree, uncommitted** (see `git status`). So: don't mine `git log` for patterns here — mine the 2.4 story file and the in-tree `VersionEndpoints.cs`/`EntitlementService.cs`. Confirm `DispatchAnalysisAsync` is present in-tree before editing (it is, per the 2.4 File List).

## Open Questions / Assumptions (for operator review — do NOT block dev on these)

1. **Auxiliary actors → `analysis-paid`.** Assumed (rationale above). If you'd rather verdict generation for *free* users not ride the paid worker, the alternative is tier-routing `run_triage`/`run_specialist` too — but those call sites are fire-and-forget and don't currently have the entitlement tier in hand, so that's a larger change. Confirm `analysis-paid` is acceptable.
2. **`maintenance` is provisioned-but-empty** this story (no `sweep_retention`/`send_email` until Epic 3/4). Because Dramatiq only attaches a consumer to a *declared* queue (Dev Notes #2), W2's `--queues ... maintenance` whitelist entry is **inert** — no consumer is created until an actor declares `maintenance`. This is benign (no error, no orphaned messages since nothing produces to it yet) and self-heals in Epic 3/4. If you'd prefer a live empty consumer now, add `broker.declare_queue("maintenance")` in `app/dramatiq_app.py`. Confirm the preferred option.
3. **Prod compose overlay vs. Epic 10.** This story ships a minimal `docker-compose.prod.yml` (just W1/W2) to satisfy AC2; story 10.1 owns the full prod stack. Confirm you want the overlay now rather than deferring AC2's compose proof to 10.1.
4. **Dropping `default` from the dev Procfile.** Safe after Tasks 2–4 (no producer remains), but a long-lived dev Redis could hold stray `default` messages. Assumed fine for fresh dev; re-add `default` to the dev `--queues` if you run against a dirty broker.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed — comprehensive developer guide created.

### File List
