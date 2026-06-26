# Build Brief — MixCoach Problem Engine (IDENTIFY tier), repo-targeted

**For:** Claude Code, autonomous/unsupervised run, **inside this repo** (`AIMusicAnalysisSite`, branch `ai-analysis-v2`).
**Stack:** Python 3.11+, Pydantic v2, pytest. All work in `components/worker/` + `components/shared/`.
**You are building against a finished design AND an existing system.** The spec files say *what* to build; **the existing code already implements ~60% of the plumbing.** This brief is the source of truth for *how to work*, *what to reuse*, *what done means*, and *how to stay honest when unsupervised*.

> ⚠️ **This is an integration, not a greenfield build.** The locked design
> (`PRPs/identify-solve-architecture.md` §8) says: *"the problem record ≡ the repo's
> `Verdict`; extend the existing `verdicts` table in place — do NOT add a second table."*
> Every time you're tempted to build a resolver / schema / validator / DSP-range table
> from scratch, **stop** — it already exists. Reuse it. A second parallel system is the
> exact `final-json-schema-drift` failure already recorded in project memory.

---

## 0. Read these first, in this order

**The design (what to build):**
1. `PRPs/identify-solve-architecture.md` — the locked architecture. Read §1 (what already exists), §3 (the `Verdict`/Finding contract), §7 (severity), §8 (persistence — extend in place).
2. `PRPs/problem-engine-mixcoach-rules.md` — **the integration plan you are executing.** Tiered rules, two-pass engine, suppression, genre-aware thresholds, TDD task-by-task. Your work IS this plan.
3. `components/worker/app/verdict_lib/config/genre-config.md` + `genre-profiles.json` + `rule-bindings.json` — genre thresholds + rule→profile wiring.
4. `PRPs/identifiers/composite-refiner.md`, `router.md`, `worked-example-refinement.md` — the refine-mode identifier + the 4-stage router (later slices; read for context).

**The existing system (what to reuse — Read the actual files):**
5. `components/shared/aimusic_shared/verdicts/models.py` — `Verdict`, `Evidence`, `Fix`, `DspOp` + `_DSP_PARAM_RANGES`, `Severity`, `Category`.
6. `components/worker/app/verdict_lib/{flatten_analysis,validator,rule_engine,degraded,dedupe,schema_contract}.py` and `aimusic_shared/verdicts/scoring.py`.
7. `components/worker/tests/verdict_pipeline/` — existing test patterns + fixtures.

Read all of them before writing code. **Verify every path/symbol below with Read/grep before relying on it** — this brief was written from a prior session; flag any drift in `TODO.md`.

---

## 1. What already exists — reuse, don't rebuild

| The greenfield instinct | DON'T build it | REUSE this (verify it exists) |
|---|---|---|
| "build a path resolver: `phase1.bands.low_mid` → value" | a new resolver | **`verdict_lib/flatten_analysis.py::flatten(final_json)`** — pivots the `phases[]` list into top-level `phaseN.*` keys (`phases[phase==N].data.*`). Rules receive the **flattened** dict. The "phase 8 is out of array order / numbering skips 8→9" insight is already handled here. |
| "a `ProblemRecord` type + schema" | a new type | the existing **`Verdict`** model — it IS the problem record. The plan (Task 1) adds the Problem fields (`problem_id, kind, source, data_tier, fixable, suspected, where, refines`) to it. **There is no `problem-record.schema.md` in this repo; the contract is `Verdict`.** |
| "a validator enforcing constraints + metric-resolvability" | a new validator | **`verdict_lib/validator.py::validate_verdict(verdict, analysis)`** (`.ok`) + **`_resolve_path`** (rejects unresolvable `evidence.metric`, ±10% value-truth check). Pydantic already enforces `summary≤300`, `why_it_matters≤200`, severity/category enums on `Verdict`. |
| "the exact `fix.dsp_chain` param keys + ranges" | a new range table | **`models.py::DspOp` + `_DSP_PARAM_RANGES`** — the 11 DSP types with param-key whitelist + numeric ranges, validated on construction. |
| "severity/priority scoring" | new math | **`aimusic_shared/verdicts/scoring.py::compute_priority_score`** (note §7 of the architecture: deterministic faults are exempt from the moderate-baseline downgrade). |
| "an empty rule engine" | from scratch | **EXPAND `verdict_lib/rule_engine.py`** per the plan (two-pass singles→composites + suppression). It already has 11 `@rule`s + `_make` + `evaluate_rules`; it runs today on the degraded path via `degraded.py`. Promote + expand it. |
| "a thresholds file" | re-derive numbers | the committed **`config/genre-profiles.json` + `rule-bindings.json`** + the `genre_config.py` loader described in the plan (Task 2). |
| genre routing | reinvent | `rule-bindings.json::genre_map` (only `techno`→its own profile; `trance/house/dnb/other`→`modern_trance`) + `master_context` (default `streaming`). |

The **router** (`PRPs/identifiers/router.md`) is genuinely net-new — but it consumes `Verdict`, keys merge/dedup on `problem_id`, and reuses `dedupe.py::_merge_pair` (only the bucket key changes). It is a **later slice**, not tonight's core (see §2).

---

## 2. Scope — what "done" contains (this slice)

Execute `PRPs/problem-engine-mixcoach-rules.md` in its task order. Each task is done only when its tests pass (§4). Concretely:

1. **Extend `Verdict`** with the Problem fields (plan Task 1) — optional + defaulted, so existing constructors/persistence are unaffected.
2. **`genre_config.py` loader** over the committed config files (plan Task 2).
3. **Two-pass engine core**: slug registry (`@single`/`@composite`), genre-aware `_make`, `evaluate_problems` (kept aliased as `evaluate_rules` for `degraded.py`), and `suppression.py` **with the audit trail** (the surviving composite records absorbed `problem_id`s in `related_verdict_ids` — router §1a) (plan Task 3).
4. **Tier A rules** (genre-aware where the binding says so: A1/A2/A3/A15/`bpm_genre_match`; the techno-LRA caveat) (plan Tasks 4–5).
5. **Stem (S) + MIDI (P) rules** with `data_tier` tagging, gated on presence (plan Task 6).
6. **Reconcile existing tests** to the Problem shape; keep the clean baseline silent (plan Task 7).
7. **Tier C composites** (Tier-A-input only: C1/C2/C3/C5/C6) + suppression (plan Task 8).
8. **Integration sweep** (plan Task 9).

**Out of scope this slice (do NOT touch):**
- DB migration / the `verdicts` table columns / EF entities / BFF (.NET) — persistence is a separate follow-on (plan "Follow-on #3"). This slice keeps `degraded.py` working via the `evaluate_rules` alias; new Problem fields ride in-memory.
- Frontend (`frontend-spectr-v2`).
- The **router**, the **Composite Refiner**, **Tier B** rules, and **solver** prompts — all named follow-ons in the plan. Read them; don't build them tonight unless the core is fully green with time to spare, and even then in their own commits behind the core.
- Real audio DSP (you consume `final_json`; you don't compute it).
- Live LLM calls (this slice is 100% deterministic Python — no prompts needed for it).

---

## 3. Honesty rule: Tier B lifts are NOT in the data

The design assumes several INTERNAL values get "lifted" into `final_json`. **They are not there yet.** Against the real fixture (§4):
- **B1 (missing-sidechain)** needs the momentary/short-term loudness *series*. Only the scalars `momentary_max_lufs`/`short_term_max_lufs` exist. The series is absent.
- **B2 (per-section RMS)** needs measured RMS per `structure.segments[]`. Absent — `phase7.metadata.energy_contrast_db` is `null` (it's a confidence proxy, not measured).
- **B4 (modal ambiguity)** needs the 24-key Krumhansl vector. Absent.

Tier B is **out of scope this slice** anyway — but if you implement any Tier B rule, gate it on input presence, have it emit nothing when absent, and write a `TODO.md` line: *"B1 requires lifting the momentary loudness series into `phaseN.data` — inert until then."* **Do not fake a lift.** The tonal rules A7–A12 similarly ship `suspected=true` on a placeholder base (no corpus numbers in `genre-profiles.json` yet) — say so, don't invent thresholds.

> I would rather wake up to honest "inert pending lift" TODOs than green checkmarks hiding stubbed rules. If you can't verify it against real data, say so in `TODO.md`; never assert it works.

---

## 4. Definition of done — verifiable target

Use the **real fixture already in the repo**:
`output/analysis/2026-06-25_latest-final-json/final_json.full.json`
(a real SPECTR result: `phase1.bpm ≈ 72` half-time vs `structure.bpm = 143` — a known data-quirk, note it, don't crash; `phase4.data.stems == {}` → an **audio_only** case, a clean test of the tier gate; grade F; the condensed sibling `final_json.condensed.json` truncates long arrays — prefer `.full.json`).

It is RAW (`{grade, …, phases:[{phase,name,status,data,error}]}`). **Run it through `flatten()` first**, then the engine:
```python
import json
from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.rule_engine import evaluate_problems
fj = json.load(open("output/analysis/2026-06-25_latest-final-json/final_json.full.json"))
records = evaluate_problems({**flatten(fj), "track_id": "fixture"})
```

Test layout — follow the EXISTING convention, don't invent `make test`:
```
pytest -q components/worker/tests/
  ├─ test_genre_config.py        — genre resolution + profile paths (plan Task 2)
  ├─ test_problem_fields / shared — Verdict gains the fields, defaults safe
  ├─ test_rules_tier_a.py        — each live rule fires/doesn't on real shape, right severity/category/data_tier
  ├─ test_rules_stem_midi.py     — S/P rules gate on phase4.stems.status / phase8 presence
  ├─ test_composites.py          — suppression drops the right children; two-pass order; audit trail
  └─ test_rule_engine.py         — reconciled; clean baseline silent; degraded path still wired
```
Use the existing helpers/fixtures in `components/worker/tests/verdict_pipeline/` (the `_analysis(**phase1_over)` helper + `clean_trance.json`/`clipped_pop.json`/`mono_broken_indie.json` in `fixtures/analyses/`) for per-rule units; use the real `final_json.full.json` for the end-to-end check.

**Golden:** add `components/worker/tests/verdict_pipeline/golden/problem_records.json` — the de-suppressed problem list `evaluate_problems(flatten(fixture))` should produce. Derive it by reasoning from the specs + fixture, freeze it, diff against it. Every metric in every golden record must pass `validator._resolve_path` against the flattened fixture. If a code change alters output, justify it in `TODO.md` before re-freezing.

Full gate (per CLAUDE.md), must be green before each commit:
```
pytest -q components/worker/tests/
pytest -q components/shared/tests/
ruff check components/worker/ components/shared/
mypy components/worker/app/verdict_lib/ --ignore-missing-imports
```
Commit after each green step with a clear message. Leave the repo green.

---

## 5. The "never grade missing data" rule — test it explicitly

The fixture is full of absent/degenerate values that must NOT produce a failing verdict:
- `phase7.metadata.energy_contrast_db` is `null` → no C7/payoff fires (it's out of scope anyway; assert silence).
- `phase7.eight_bar_score` — decide measured-zero vs not-computed; `total_bars`/`section_count` suggest it ran, so a low score is legitimate — pin your interpretation with a test, and gate `eight_bar_violations`/`missing_section` on `phase7.arrangement_status == "scored"`.
- `phase4.data.stems == {}` → S-rules emit nothing. The audio-only spectral path uses `phase4.data.clashes[]` whose shape is `{stems:<string label>, severity, frequency_range}` — a **string** label, NOT the `clash_matrix` pair shape (`stem_a`/`stem_b`/`band`) the stems path uses. Handle both; don't assume the stem shape.
- `phase2.data.genre` selects the genre profile via `genre_map` → wire it through every genre-aware rule.

Write one test per "absent → silent, not failing" case. These regress into false positives the fastest.

---

## 6. (Deferred) LLM-driven prompts

The identifiers/solvers/refiner are prompts — **not part of this deterministic slice.** Don't build a stub-LLM harness tonight. When those slices come: each prompt is a versioned markdown artifact under `components/worker/prompts/` whose declared output must pass the EXISTING `validate_verdict` + `DspOp` validator; a stub-LLM returns a hand-authored exemplar (from the worked examples) validated through that path. **No live API calls, ever, in an unattended run** — leave a TODO if you think one is essential.

---

## 7. Working agreement for the unattended run

- **Reuse before you build.** If you're about to write a resolver, a schema, a validator, or a DSP-range table — stop and grep `verdict_lib/` + `models.py` first. It's there.
- **Verify against the fixture, or mark it TODO.** The fixture is ground truth; your confidence is not.
- **Don't invent numbers.** A threshold/param not read from `genre-profiles.json` or a spec → flag it `# unvalidated` + a `TODO.md` line. Tonal A7–A12 stay `suspected`.
- **Extend in place; don't fork.** Emit `Verdict`. Keep `evaluate_rules` working so `degraded.py` keeps passing. No second problem-record type, no second table.
- **Don't redesign.** If a spec seems wrong, implement as written and note the concern in `TODO.md`.
- **Keep the repo green and committed.** A small, tested, honest subset beats a large untested whole. Low on context/time → stop at a green commit and write `STATUS.md`.
- **One honest morning artifact: `STATUS.md`** — what passes, what's inert-pending-lift, what numbers are unvalidated, the exact next task in the plan. First thing I'll read.

---

## 8. Suggested order of operations (maps to the plan's tasks)

1. Read §0 specs + §1 existing files. Confirm the reuse map is accurate; note drift in `TODO.md`. First commit: `TODO.md` skeleton.
2. **Plan Task 1** — extend `Verdict` + tests. Commit.
3. **Plan Task 2** — `genre_config.py` + tests. Commit.
4. **Plan Task 3** — two-pass harness + `suppression.py` (with audit trail) + tests. Commit.
5. **Plan Tasks 4–5** — Tier A rules (genre-aware) + tests + first golden records. Commit.
6. **Plan Task 6** — S/P rules (respect `stems=={}` + real midi shapes) + tests. Commit.
7. **Plan Task 7** — reconcile existing rule-engine tests; clean baseline silent. Commit.
8. **Plan Task 8** — Tier C composites + suppression + golden-diff on the real fixture. Commit.
9. **Plan Task 9** — full gate green (`pytest` worker+shared, ruff, mypy) + smoke against `final_json.full.json`. Commit.
10. `STATUS.md` + `TODO.md` final pass.

Out of scope tonight (do NOT start): router, Composite Refiner, Tier B, solver prompts, persistence/DB/BFF, frontend — all named follow-ons in the plan.

Start at 1. Reuse, don't rebuild. Leave it green.
```
