# Problem-Engine Reconcile + Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deterministic two-pass Problem engine (`evaluate_problems`) the live verdict producer on the degraded/free path, and persist its IDENTIFY-tier fields (`problem_id`, `kind`, `source`, `data_tier`, `fixable`, `suspected`, `where`, `refines`) end-to-end through the DB, the worker, and the BFF DTO.

**Architecture:** EF Core (BFF) owns the canonical `verdicts` schema; `aimusic_shared/models.py` is a hand-mirror that the worker writes through. So the change flows in dependency order: **EF entity → EF migration → mirror ORM → worker persistence mappers → switch the engine call → BFF DTO**. The engine already exists, is tested, and emits the 8 Problem fields on the pydantic `Verdict`; this plan only widens the storage + read path and flips the producer. No new analysis logic.

**Tech Stack:** .NET 10 / EF Core 10 / Npgsql (BFF); Python 3.11 / SQLAlchemy 2.0 / Pydantic v2 / dramatiq (worker); Postgres 16.

## Global Constraints

- **EF Core owns the schema.** Never add a column to `aimusic_shared/models.py` that doesn't exist in the EF `Verdict` entity first. The file header says so. (`components/shared/aimusic_shared/models.py:1-6`.)
- **Additive only.** The legacy `@rule`/`evaluate_rules` path stays importable (other call sites + the `evaluate_rules` alias keep working). This plan changes the degraded *caller*, not the legacy registry.
- **Snake_case columns.** EF maps via `[Column("snake_case")]` data annotations; jsonb columns are `string` properties with `TypeName = "jsonb"`. Mirror exactly in SQLAlchemy.
- **`where` is a SQL reserved word.** EF (Npgsql) and SQLAlchemy both auto-quote it as `"where"`; keep the column name `where` for 1:1 parity with the pydantic field, but never hand-write raw SQL referencing it unquoted.
- **TDD.** Test first, watch RED, minimal GREEN, commit each task. Worker tests: `cd components/worker && python -m pytest <path> -q`. (`ruff`/`mypy` are invoked as `python -m ruff` / `python -m mypy --ignore-missing-imports`.)
- **Commit messages** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Windows BFF gotcha:** stop any running `Spectr.Bff.exe` before `dotnet build`/`ef` (file lock on `bin/Debug/net10.0/Spectr.Bff.exe`).
- **Test-isolation caveat:** the worker suite has pre-existing cross-file `sys.modules` pollution (tracked separately) that makes `test_degraded_path.py` flaky under the *full* `tests/` run + `pytest-randomly`. Verify degraded changes by running the file **in isolation** (`python -m pytest tests/verdict_pipeline/test_degraded_path.py -q`), which is green.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `components/bff/src/Spectr.Data/Entities/Verdict.cs` | EF entity (canonical) | +8 properties |
| `components/bff/src/Spectr.Data/Migrations/<ts>_AddVerdictProblemFields.cs` | DB migration | new (scaffolded) |
| `components/shared/aimusic_shared/models.py` | SQLAlchemy mirror ORM | +8 columns on `Verdict` |
| `components/worker/app/verdict_lib/degraded.py` | degraded persistence + producer | extend `_to_row`; switch `evaluate_rules`→`evaluate_problems`; fix idempotency guard |
| `components/worker/app/verdict_actor.py` | healthy LLM-specialist persistence | extend `_persist_verdict` (parity) |
| `components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs` | API read DTO | +8 fields |
| `components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs` | `ToDto` mapper | +8 mappings |
| `components/worker/tests/verdict_pipeline/test_degraded_path.py` | degraded tests | +Problem-field round-trip + producer-switch tests |

**The 8 columns (canonical types):**

| pydantic field | EF property / type | column (snake) | DB type | nullable | default |
|---|---|---|---|---|---|
| `problem_id: Optional[str]` | `ProblemId: string?` | `problem_id` | text/varchar(80) | yes | null |
| `kind: ProblemKind` | `Kind: string` | `kind` | varchar(20) | no | `'fault'` |
| `source: ProblemSource` | `Source: string` | `source` | varchar(20) | no | `'rule_engine'` |
| `data_tier: DataTier` | `DataTier: string` | `data_tier` | varchar(20) | no | `'audio_only'` |
| `fixable: bool` | `Fixable: bool` | `fixable` | boolean | no | `true` |
| `suspected: bool` | `Suspected: bool` | `suspected` | boolean | no | `false` |
| `where: Optional[dict]` | `Where: string?` (jsonb) | `where` | jsonb | yes | null |
| `refines: Optional[str]` | `Refines: string?` | `refines` | text/varchar(80) | yes | null |

---

## Task 1: Add the 8 Problem properties to the EF `Verdict` entity

**Files:**
- Modify: `components/bff/src/Spectr.Data/Entities/Verdict.cs` (append after `PresetName`/`CreatedAt`, ~line 82)

**Interfaces:**
- Produces: 8 new mapped properties on the canonical entity that Task 2 scaffolds a migration from and Task 3 mirrors.

- [ ] **Step 1: Add the properties** (follow the existing `[Column(...)]` + jsonb-as-string convention):

```csharp
    [Column("problem_id")]
    [MaxLength(80)]
    public string? ProblemId { get; set; }

    [Column("kind")]
    [MaxLength(20)]
    public string Kind { get; set; } = "fault";

    [Column("source")]
    [MaxLength(20)]
    public string Source { get; set; } = "rule_engine";

    [Column("data_tier")]
    [MaxLength(20)]
    public string DataTier { get; set; } = "audio_only";

    [Column("fixable")]
    public bool Fixable { get; set; } = true;

    [Column("suspected")]
    public bool Suspected { get; set; } = false;

    // SQL reserved word — Npgsql quotes it. jsonb-as-string, same pattern as Fix.
    [Column("where", TypeName = "jsonb")]
    public string? Where { get; set; }

    [Column("refines")]
    [MaxLength(80)]
    public string? Refines { get; set; }
```

- [ ] **Step 2: Build** (stop a running BFF first).

Run: `cd components/bff && dotnet build`
Expected: succeeds (no migration yet — entity-only change compiles).

- [ ] **Step 3: Commit**

```bash
git add components/bff/src/Spectr.Data/Entities/Verdict.cs
git commit -m "feat(bff): add Problem-tier columns to Verdict entity"
```

---

## Task 2: Scaffold + apply the EF migration

**Files:**
- Create: `components/bff/src/Spectr.Data/Migrations/<timestamp>_AddVerdictProblemFields.cs` (scaffolded)

**Interfaces:**
- Consumes: the entity from Task 1. Produces: the live DB columns the worker + DTO rely on.

- [ ] **Step 1: Scaffold the migration**

Run:
```bash
cd components/bff
dotnet ef migrations add AddVerdictProblemFields --project src/Spectr.Data --startup-project src/Spectr.Bff
```
Expected: a new migration whose `Up()` has 8 `migrationBuilder.AddColumn<...>` calls (the bools with `defaultValue: true/false`, the strings with `defaultValue: "fault"` etc., `where` as `type: "jsonb", nullable: true`).

- [ ] **Step 2: Verify the generated `Up()`/`Down()`** — confirm non-null columns carry server defaults so existing rows backfill (e.g. `kind` → `'fault'`, `fixable` → `true`). No partial index is added here, so the CLAUDE.md raw-SQL index caveat does **not** apply. If `dotnet ef` emitted a default of `""` for a non-null string, change it to the table-above default.

- [ ] **Step 3: Apply to the dev DB**

Run: `dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff`
Expected: migration applies; `\d verdicts` (psql) shows the 8 new columns. (Postgres must be up: `docker compose -f docker/docker-compose.yml up -d`.)

- [ ] **Step 4: Commit**

```bash
git add components/bff/src/Spectr.Data/Migrations/
git commit -m "feat(bff): migration — add Problem-tier columns to verdicts"
```

---

## Task 3: Mirror the 8 columns in the SQLAlchemy ORM

**Files:**
- Modify: `components/shared/aimusic_shared/models.py` (`class Verdict`, after `created_at`, ~line 317)
- Test: `components/shared/tests/test_verdict_orm_problem_columns.py` (create)

**Interfaces:**
- Consumes: the EF schema from Task 2. Produces: ORM attributes (`problem_id`, `kind`, `source`, `data_tier`, `fixable`, `suspected`, `where`, `refines`) the worker mappers write.

- [ ] **Step 1: Write the failing test** (match the file's existing import style; uses sqlite in-memory):

```python
# components/shared/tests/test_verdict_orm_problem_columns.py
from __future__ import annotations
from aimusic_shared.models import Verdict


def test_verdict_orm_has_problem_columns():
    cols = set(Verdict.__table__.columns.keys())
    assert {"problem_id", "kind", "source", "data_tier",
            "fixable", "suspected", "where", "refines"} <= cols


def test_verdict_orm_defaults():
    v = Verdict(
        id="vrd_x", analysis_id=None, specialist="rule_engine.clipping_count",
        prompt_version="rule_engine@1.0.0", model="rules", severity="severe",
        category="clipping", confidence=0.9, priority_score=50, headline="h",
    )
    # Python-side defaults applied at construction OR flush — assert the column
    # defaults exist (server_default/default) so existing rows + new inserts are safe.
    assert Verdict.__table__.c.kind.default is not None or Verdict.__table__.c.kind.server_default is not None
    assert Verdict.__table__.c.fixable.default is not None or Verdict.__table__.c.fixable.server_default is not None
```

- [ ] **Step 2: Run — verify RED**

Run: `cd components/shared && python -m pytest tests/test_verdict_orm_problem_columns.py -q`
Expected: FAIL (`KeyError`/assertion — columns absent).

- [ ] **Step 3: Add the columns** (use the file's existing `mapped_column` style; if it uses bare `Column`, match that):

```python
    problem_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="fault", server_default="fault")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="rule_engine", server_default="rule_engine")
    data_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="audio_only", server_default="audio_only")
    fixable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    suspected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # "where" is a SQL reserved word; SQLAlchemy quotes it. JSONB, nullable.
    where: Mapped[dict | None] = mapped_column("where", JSONB, nullable=True)
    refines: Mapped[str | None] = mapped_column(String(80), nullable=True)
```
(Ensure `Boolean`, `JSONB`, `text` are imported at the top of the file — add to the existing import lines if missing.)

- [ ] **Step 4: Run — verify GREEN**

Run: `cd components/shared && python -m pytest tests/test_verdict_orm_problem_columns.py -q`
Expected: PASS. Also run the whole shared suite: `python -m pytest tests/ -q` → all green.

- [ ] **Step 5: Commit**

```bash
git add components/shared/aimusic_shared/models.py components/shared/tests/test_verdict_orm_problem_columns.py
git commit -m "feat(shared): mirror Problem-tier columns on Verdict ORM"
```

---

## Task 4: Persist the 8 fields in both worker mappers

**Files:**
- Modify: `components/worker/app/verdict_lib/degraded.py` (`_to_row`, ~lines 120-151)
- Modify: `components/worker/app/verdict_actor.py` (`_persist_verdict`, ~lines 126-152)
- Test: `components/worker/tests/verdict_pipeline/test_degraded_path.py` (extend)

**Interfaces:**
- Consumes: ORM columns from Task 3 + the pydantic `Verdict` Problem fields (already present: `v.problem_id`, `v.kind`, `v.source`, `v.data_tier`, `v.fixable`, `v.suspected`, `v.where`, `v.refines`).
- Produces: ORM rows carrying the Problem fields.

- [ ] **Step 1: Write the failing test** (round-trip a problem verdict through the mapper). The existing `_FakeSession.added` list captures `s.add(row)`:

```python
def test_to_row_persists_problem_fields():
    from app.verdict_lib import degraded
    from app.verdict_lib.rule_engine import _problem  # the Problem builder
    from aimusic_shared.verdicts.models import Evidence
    import uuid

    v = _problem(
        track_id="t", slug="clipping_count", severity="severe", category="clipping",
        headline="h", summary="s", why_it_matters="w",
        evidence=[Evidence(metric="phase1.clipped_sample_count", value=5.0, label="5")],
        data_tier="audio_only", suspected=False,
    )
    row = degraded._to_row(uuid.uuid4(), v)
    assert row.problem_id == "clipping.clipping_count.0"
    assert row.kind == "fault" and row.source == "rule_engine"
    assert row.data_tier == "audio_only" and row.fixable is True and row.suspected is False
    assert row.where is None and row.refines is None
```

- [ ] **Step 2: Run — verify RED**

Run: `cd components/worker && python -m pytest tests/verdict_pipeline/test_degraded_path.py::test_to_row_persists_problem_fields -q`
Expected: FAIL (`AttributeError: 'Verdict' object has no attribute 'problem_id'` — the ORM row isn't populated).

- [ ] **Step 3: Extend `_to_row`** — add the 8 assignments to the `VerdictRow(...)` constructor:

```python
        problem_id=v.problem_id,
        kind=v.kind,
        source=v.source,
        data_tier=v.data_tier,
        fixable=v.fixable,
        suspected=v.suspected,
        where=v.where,
        refines=v.refines,
```

- [ ] **Step 4: Apply the identical 8 lines to `verdict_actor._persist_verdict`** (parity — LLM specialists default `source="rule_engine"`? No: LLM verdicts should carry `source="llm_identifier"` once produced by the refiner, but until then the pydantic default `source="rule_engine"` is wrong for LLM output. **For this task, map the fields verbatim from `v`** — the producer sets them correctly; do not hardcode. The refiner follow-on owns setting `source="llm_identifier"`.)

- [ ] **Step 5: Run — verify GREEN**

Run: `cd components/worker && python -m pytest tests/verdict_pipeline/test_degraded_path.py -q`
Expected: PASS (file-isolated run is green despite the suite-wide pollution caveat).

- [ ] **Step 6: Commit**

```bash
git add components/worker/app/verdict_lib/degraded.py components/worker/app/verdict_actor.py components/worker/tests/verdict_pipeline/test_degraded_path.py
git commit -m "feat(worker): persist Problem-tier fields in both verdict mappers"
```

---

## Task 5: Switch the degraded producer to `evaluate_problems` + fix the idempotency guard

**Files:**
- Modify: `components/worker/app/verdict_lib/degraded.py` (`run_rule_engine_for_analysis`, ~lines 73-117)
- Test: `components/worker/tests/verdict_pipeline/test_degraded_path.py` (extend)

**Interfaces:**
- Consumes: `rule_engine.evaluate_problems` (the de-suppressed two-pass list). Produces: persisted Problem rows on the degraded/free path.

**Why the guard must change:** the current dedupe (and `_to_row` specialist) keys on `specialist == "rule_engine"`, but the Problem engine sets `specialist = f"rule_engine.{slug}"` (e.g. `rule_engine.clipping_count`). The old exact-match guard would never see existing rows → duplicate inserts on re-run. Switch the guard to a **prefix/`source`** check.

- [ ] **Step 1: Write the failing tests** (producer switch + idempotency):

```python
def test_run_rule_engine_uses_problem_engine(install_fake_sessions):
    import uuid
    from app.verdict_lib import degraded
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json=_clipping_analysis())
    install_fake_sessions(analysis, preexisting_rule_rows=False)
    written = degraded.run_rule_engine_for_analysis(aid)
    assert written >= 1  # the Problem engine fired clipping_count / true_peak_overshoot


def test_run_rule_engine_idempotent_on_problem_specialists(install_fake_sessions):
    import uuid
    from app.verdict_lib import degraded
    aid = uuid.uuid4()
    analysis = _FakeAnalysis(aid, final_json=_clipping_analysis())
    # preexisting rows now use specialist="rule_engine.<slug>" — the guard must skip.
    install_fake_sessions(analysis, preexisting_rule_rows=True)
    assert degraded.run_rule_engine_for_analysis(aid) == 0
```
(Update `_FakeSession`'s `preexisting_rule_rows` branch — the count/exists query at ~line 70 — to model a row whose `source == "rule_engine"` or `specialist LIKE 'rule_engine%'`, matching the new guard.)

- [ ] **Step 2: Run — verify RED**

Run: `cd components/worker && python -m pytest tests/verdict_pipeline/test_degraded_path.py -k "problem_engine or idempotent_on_problem" -q`
Expected: FAIL (still calling `evaluate_rules`; guard mismatch).

- [ ] **Step 3: Make the switch** — in `run_rule_engine_for_analysis`:
  - Line ~108: `rule_engine.evaluate_rules(flattened)` → `rule_engine.evaluate_problems(flattened)`.
  - Change the idempotency query from `specialist == "rule_engine"` to `source == "rule_engine"` (preferred — explicit) or `specialist.like("rule_engine%")`. Use the ORM column added in Task 3.
  - **(Recommended) validate before persist:** wrap each verdict in `validate_verdict(v, flattened)` and persist `.verdict` when `.ok` (caps genre-aware severity + recomputes `priority_score`). Skip-and-log on `not .ok`. Mirror the pattern already in `verdict_actor.run_specialist`.

- [ ] **Step 4: Run — verify GREEN**

Run: `cd components/worker && python -m pytest tests/verdict_pipeline/test_degraded_path.py -q`
Expected: PASS (file-isolated).

- [ ] **Step 5: Commit**

```bash
git add components/worker/app/verdict_lib/degraded.py components/worker/tests/verdict_pipeline/test_degraded_path.py
git commit -m "feat(worker): degraded path emits two-pass Problems (+source-keyed idempotency)"
```

---

## Task 6: Surface the 8 fields in the BFF DTO + mapper

**Files:**
- Modify: `components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs` (`VerdictDto` record, ~lines 13-35)
- Modify: `components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs` (`ToDto`, ~lines 238-268)

**Interfaces:**
- Consumes: the EF entity (Task 1). Produces: the `VerdictDto` the frontend reads (full `ListVerdicts`; the SSE `StreamVerdicts` partial projection can stay minimal).

- [ ] **Step 1: Add fields to `VerdictDto`** (place before `CreatedAt`/`UserState`):

```csharp
    string? ProblemId,
    string Kind,
    string Source,
    string DataTier,
    bool Fixable,
    bool Suspected,
    JsonElement? Where,
    string? Refines,
```

- [ ] **Step 2: Map them in `ToDto`** — add to the `VerdictDto(...)` construction; parse `where` with the existing helper:

```csharp
        ProblemId: v.ProblemId,
        Kind: v.Kind,
        Source: v.Source,
        DataTier: v.DataTier,
        Fixable: v.Fixable,
        Suspected: v.Suspected,
        Where: TryParseJson(v.Where),
        Refines: v.Refines,
```

- [ ] **Step 3: Build + test**

Run: `cd components/bff && dotnet build && dotnet test`
Expected: green. (If a verdict-endpoint test asserts an exact DTO shape, update it to include the 8 fields.)

- [ ] **Step 4: Commit**

```bash
git add components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs
git commit -m "feat(bff): expose Problem-tier fields on VerdictDto"
```

---

## Task 7 (OPTIONAL / PHASE 2): Promote the engine to the healthy path

**Deferred decision — only do this with explicit go-ahead.** Today the deterministic engine runs **only** when an analysis degrades. Promoting it means: after a normal `analyze_audio_job` writes the `analyses` row, also run `evaluate_problems` once and persist the de-suppressed list, so *every* analysis carries a deterministic Problem list even before any LLM specialist runs.

**Files (when approved):**
- Modify: the worker analyze actor (find the post-pipeline persistence point in `components/worker/app/` — `analyze_audio_job` / `tasks_dramatiq.py` Phase C).
- Reuse `degraded.run_rule_engine_for_analysis(analysis_id)` verbatim — it's already idempotent (Task 5 guard) and self-contained, so calling it from the healthy completion path writes Problems exactly once and is a no-op if they already exist.

- [ ] Decide: call site (end of successful analyze) + ensure it runs **after** the `analyses` row is committed (the helper loads `final_json` from the row).
- [ ] Test: a successful analyze persists ≥1 Problem row; a second call writes 0 (idempotent).
- [ ] Commit: `feat(worker): run deterministic Problem engine on every completed analysis`

---

## Task 8 (OPTIONAL): Frontend types

The Problems UI is a separate follow-on (`problem-list-ui`). The DTO change in Task 6 is additive and safe without it. When the UI work starts, mirror the 8 fields into `components/frontend-spectr-v2/src/api/types.ts` (hand-edit — `pydantic2ts` fails on Windows per CLAUDE.md). Not required for this PRP.

---

## Task 9: Final gates + docs

- [ ] **Step 1: Run all affected suites**

```bash
cd components/worker && python -m pytest tests/verdict_pipeline/ -q          # engine + degraded (file-green)
python -m ruff check app/verdict_lib/ app/verdict_actor.py
python -m mypy app/verdict_lib/ app/verdict_actor.py --ignore-missing-imports
cd ../shared && python -m pytest tests/ -q
cd ../bff && dotnet build && dotnet test
```
Expected: all green. (Full-`tests/` worker pollution caveat from Global Constraints still applies — verify degraded by file.)

- [ ] **Step 2: Smoke the live path against the real payload**

```bash
cd components/worker && python - <<'PY'
import json
from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.rule_engine import evaluate_problems
fj = json.load(open("../../output/analysis/2026-06-25_latest-final-json/final_json.full.json"))
recs = evaluate_problems({**flatten(fj), "track_id": "smoke"})
print(len(recs), "problems; sample:", [(r.problem_id, r.data_tier, r.suspected) for r in recs[:3]])
PY
```
Expected: a non-empty de-suppressed list (already verified: 6 problems incl. a `project_midi` one).

- [ ] **Step 3: Update CLAUDE.md** — change the worker "Two-pass Problem engine" note: the engine is now **live on the degraded/free path** (and, if Task 7 shipped, every analysis), persisting the Problem fields; the legacy `@rule` list remains only as the `evaluate_rules` alias for any residual callers.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(rules): mark two-pass Problem engine live + persisted"
```

---

## Self-Review

**1. Spec coverage** (problem-list-persistence, from `problem-engine-mixcoach-rules.md` §Out-of-Scope #3):
- Extend `verdicts` table + EF entity + ORM + DTO with `problem_id`/`source`/`data_tier`/`fixable`/`suspected`/`kind`/`where`(/`refines`): Tasks 1-3, 6. ✓
- Promote engine to the live path persisting the de-suppressed list: Task 5 (degraded) + Task 7 (healthy, gated). ✓
- `refines` audit column for the refiner round-trip (#4): included in the 8. ✓

**2. Placeholder scan:** every step carries concrete code/columns/commands. No TBD.

**3. Type consistency:** column names identical across EF (`[Column("data_tier")]`), ORM (`data_tier`), pydantic (`data_tier`), DTO (`DataTier`). `where` stays `where` everywhere (reserved-word note attached). The idempotency guard switch (Task 5) is the one behavioral gotcha and is called out with its root cause (`specialist` now `rule_engine.<slug>`).

**Out of scope (named follow-ons):** composite-refiner (sets `source="llm_identifier"`, fills `refines`), router, SOLVE solvers, Problems UI, and the worker test-isolation cleanup (pre-existing `sys.modules` pollution).
