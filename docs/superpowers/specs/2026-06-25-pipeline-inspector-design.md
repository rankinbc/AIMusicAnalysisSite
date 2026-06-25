# Pipeline Inspector — Design Spec

**Date:** 2026-06-25
**Status:** Implemented (2026-06-25)
**Author:** brankin92 + Claude
**Topic:** A dev/debug tool that renders the full input→output trace of a single analysis, overlaid on the complete catalog of rules and specialists, to find gaps in the rule system.

---

## 1. Purpose

A **dev/debug inspector** (not user-facing). Given an `analysis_id`, produce a single self-contained HTML page that shows:

1. The full trace of how that analysis's results were formed — every component's inputs and outputs.
2. The **complete catalog** of what *could* have run (every rule, every specialist), overlaid with what *did* run, so we can spot:
   - Rules that can never fire (read a metric the pipeline doesn't produce).
   - Specialists that are never selected.
   - Stored-vs-recomputed drift in deterministic stages.

Primary goal beyond "viewing a trace": **identify gaps and improvements in the rule system.**

### Motivating evidence (already found)
While scoping this, several rule read-paths appear mismatched against actual pipeline output — strong justification for the catalog/gap view:
- `loudness_too_high/low_for_streaming` read `phase1.integrated_lufs`; Phase 1 outputs `lufs`.
- `stereo_correlation_negative` reads `phase2.stereo_correlation`; stereo data is on `phase1`.
- `excessive/tiny_dynamic_range` read `phase1.crest_factor`; `low_mid_mud_*` read `phase3.low_mid_energy`; `key_detection_low_confidence` reads `phase1.key_detection_confidence` — none confirmed present in `final_json`.

If confirmed, these rules **never fire**. Surfacing that is the core value of this tool. (The inspector reports the facts; it does not fix the rules.)

---

## 2. Scope

**In scope:** full end-to-end trace — 9 analysis phases + rollups + verdict pipeline (rule engine → triage → specialists → validation → ranked verdicts) + a system-audit gap view.

**Two run modes (see §4):**
- **Trace mode** — given an `analysis_id`, render the catalog overlaid with that analysis's real values, fired/not-fired, and stored-vs-recomputed drift.
- **Catalog mode** — given *no* `analysis_id`, render the pipeline's static structure only: every stage's declared datapoints, every rule and the datapoints it consumes (mapped back to the producing phase), and the full specialist roster. This is a standalone map of the rule/datapoint system and can flag mismatches **statically**, with no DB and no analysis required.

Every stage — in both modes — carries **descriptive narration** explaining what it consumes, what it produces, and how that data is used downstream (see §6).

**Out of scope (YAGNI):**
- Interactive filtering / search.
- Diffing across multiple analyses.
- User-state overlay (dismiss / applied / feedback from `verdict_user_state`).
- Any production / owner-facing surface, auth, or SPA integration. (Could be reused later; not now.)
- Fixing the rule mismatches it surfaces.

---

## 3. Approach

**Chosen: Python static-HTML generator** (over a frontend route + dev BFF endpoint). Rationale: the rule catalog and specialist roster live in **Python** (`rule_engine._RULES`, `prompt_loader.SLUG_TO_FILENAME`, prompt frontmatter); the .NET BFF cannot introspect them. A Python tool that imports the real modules keeps the catalog in lockstep with code automatically, with the least infrastructure.

---

## 4. Location & invocation

- **Module:** `components/worker/app/tools/pipeline_inspector.py`
  - Lives in `worker/` because it imports `verdict_lib` + `db_sync` (the canonical Python side of the verdict pipeline).
- **Run (trace mode):** `python -m app.tools.pipeline_inspector <analysis_id> [--open]`
  - `--open` opens the produced file in the default browser.
  - Accepts a full UUID or a unique prefix (resolve via `WHERE id::text LIKE '<prefix>%'`; error if 0 or >1 match).
- **Run (catalog mode):** `python -m app.tools.pipeline_inspector --catalog [--open]`
  - No `analysis_id`. No DB connection required — renders the static pipeline/rule/specialist map only. Fast, always available, useful for rule-system review independent of any track.
- **Run (validate map):** `python -m app.tools.pipeline_inspector --validate-map [<analysis_id>]`
  - Checks the §6 stage map's declared outputs against a real `final_json` and reports drift (see §6.1). Exits non-zero on mismatch so it can gate CI.
- **Output:**
  - Trace mode → `output/worker/<YYYY-MM-DD>_pipeline_inspector/<short_id>.html`
  - Catalog mode → `output/worker/<YYYY-MM-DD>_pipeline_inspector/_catalog.html`
  - Per CLAUDE.md output rules; never overwrites a prior run for a different id; same-id (or catalog) re-run overwrites its own file.
- **Self-contained:** inline CSS + minimal vanilla JS, no network calls, no external assets, no build step. Collapsible regions via native `<details>`.

---

## 5. Data sources (all read-only)

| Source | Used for |
|---|---|
| `analyses` row | `final_json` (phases + rollups), `routing_plan`, `song_name`, `job_id`, ids, `created_at`, input-provenance hints (`stem_metrics`, etc.) |
| `verdicts` rows (`WHERE analysis_id = …`) | persisted final verdicts; `sources` field separates `rule_engine` vs specialist origin |
| `rule_engine._RULES` (live import) | full rule catalog; re-run each rule against the analysis |
| `validator` + `scoring` (live import) | recompute validation/severity over persisted verdicts |
| `flatten_analysis` (live import) | convert `final_json.phases` list → `phase1`/`phase2`/… keys before running rules |
| `prompt_loader.SLUG_TO_FILENAME` + prompt frontmatter | full specialist roster + versions |

DB access via the worker's existing `db_sync` session (sync SQLAlchemy / psycopg2). No new DB columns, no writes.

**Catalog mode** uses **only** the live-import sources (rules, validator, prompt roster) plus the static stage map (§6). It touches **no DB** and needs no `analysis_id`.

---

## 6. Static stage map (narration + I/O + datapoints)

A single authored data structure inside the tool — the backbone for descriptive text, catalog mode, and static gap detection. One entry per pipeline stage (9 phases, rollups, rule engine, triage, specialists, validation, ranking). Each entry declares:

- **`title`** — display name.
- **`narration`** — 1–3 sentences in plain language: what this stage *consumes*, what it *produces*, and **how that input/output is used** downstream. (Satisfies the "descriptive text per pipeline" requirement.)
- **`inputs`** — the datapoints/artifacts it reads (e.g. `phase1.lufs`, the raw WAV, the reference track).
- **`outputs`** — the datapoints it produces (e.g. `phase1.true_peak_db`, `routing_plan.specialists_to_run`).

This map is **authored, not introspected** — phases output dynamic dicts with no typed schema, so the output datapoint list is maintained here (sourced from the pipeline). Accepted drift risk for a dev tool; trace mode cross-checks it against the real `final_json`, and any mismatch is itself surfaced.

### 6.1 Map-freshness validation (guards against drift)

Two layers keep the §6 map honest as the pipeline evolves:

- **`--validate-map` CLI flag** — diffs the map's declared `outputs` against the actual flattened-key set of a real `final_json`. Source of truth: an `analysis_id` if given, else the most recent `analyses` row, else a committed golden snapshot (see below). Prints two lists and exits non-zero if either is non-empty:
  - **stale/missing** — keys the pipeline emits that the map doesn't declare (map needs updating);
  - **phantom** — keys the map declares that no real `final_json` contains (map over-claims, or the field was removed).
- **pytest `test_stage_map_matches_pipeline_outputs`** — the CI form of the same check, run against a **committed golden `final_json` fixture** (reuse the analysis package's existing golden snapshots — CLAUDE.md notes `run_pipeline` output is guarded byte-identical by them, so they're a stable schema reference). The test fails if the map drifts from the snapshot's key set, so a pipeline change that adds/removes a field forces a matching map update in the same PR.

Rule read-paths are deliberately *excluded* from "phantom" detection — a read-path with no producer is a real bug the gap view is meant to surface, not a map error. Only the map's own `outputs` are validated against reality.

**Static gap detection (catalog mode):** cross-reference each rule's read-paths (extracted per §6b) against the union of all `outputs` in the stage map. A read-path that no stage produces ⇒ **"reads a datapoint the pipeline never emits — can't fire"**, detected with zero analyses. This is the static counterpart to trace mode's per-analysis resolution.

---

## 6b. Deterministic re-derivation (no LLM calls)

- **Flatten** `final_json` → `phaseN` keys.
- **Re-run every registered rule** → fired (Verdict) / not-fired (None).
- **Per-rule read-path resolution:** extract the metric paths a rule reads (via `inspect.getsource` + a small regex for `_phase(analysis, "phaseN")` and `.get("key")`, plus any `Evidence(metric=…)` strings when fired). Resolve each path against the flattened analysis → **present / null / missing**. This distinguishes "didn't fire because value in range" from "didn't fire because the field is absent."
  - Heuristic parsing limitation is acceptable for a dev tool and noted in-page; the collapsible source snippet lets a human verify.
- **Validator** — the `verdicts` table persists only the *post-validation* verdict (already downgraded/scored); the pre-validation LLM output is not stored. So validator re-run over persisted rows is a near-no-op and yields no meaningful drift. The validation stage is therefore shown as documented narration + the final persisted verdicts; **true validator-drift detection is deferred to the versioning-analyses follow-up (§10)** which would persist pre-validation output. The high-value deterministic recompute that *is* delivered is the **rule engine** (re-run live against `final_json`).

LLM stages (triage, specialists) are **never re-run** — shown from persisted `routing_plan` / `verdicts`.

---

## 7. Page sections

Every stage card opens with its **narration** line from the §6 map (consumes → produces → how it's used), shown in **both** modes. Trace-mode-only content (real values, fired/not, drift) is omitted in catalog mode; catalog mode shows the static structure in its place.

0. **Header** —
   - *Trace mode:* analysis id, song, job id, created-at, overall score + grade; input provenance row (mix / stems / reference / .als present?).
   - *Catalog mode:* title banner ("Pipeline & rule-system catalog — no analysis"), generated-at, code/version stamps (rule engine version, specialist prompt versions).
1. **Analysis phases 1–9** — per card: narration; **declared inputs/outputs** (§6). *Trace mode also:* status (ok / skipped / failed), key output values + collapsible raw JSON.
2. **Rollups** — narration + `overall_score`, `grade`, `danceability_score`, `top_fixes`, `coach_*` (values in trace mode; field list in catalog mode).
3. **Verdict pipeline:**
   - **3a. Rule engine** — every registered rule. Per rule, always: narration/docstring; the datapoints it reads + each path's **producing stage** (from §6) or **"unmapped — no stage emits this"**; collapsible source snippet. *Trace mode also:* fired/not-fired badge; per-path resolution (present / null / **missing**); output verdict if fired.
   - **3b. Triage** — narration. *Trace mode:* persisted `routing_plan` (`specialists_to_run` w/ priority + focus, `skip`, `rationale`; "no LLM stage ran" if null). *Catalog mode:* description of the triage prompt + that it is an LLM routing call (not re-run).
   - **3c. Specialists** — full roster from `SLUG_TO_FILENAME` (+ prompt version). *Trace mode overlay:* **ran** / **selected-but-empty** / **not-selected**, with verdicts for those that ran. *Catalog mode:* roster + category each covers.
   - **3d. Validation** — narration describing the validation/scoring rules (metric-path check, section sanity, ALS grounding, moderate-baseline downgrade) in both modes. (Validator-recompute drift is deferred — see §6b: pre-validation output isn't persisted.)
   - **3e. Final verdicts** — *trace mode only:* ranked list from the `verdicts` table.
4. **Datapoint → consumers map** — a table keyed by datapoint (every `outputs` entry in §6): which producing stage emits it and which rules/specialists consume it. Makes "this phase output feeds these rules" legible at a glance, and exposes **orphan producers** (emitted, consumed by nothing) and **orphan consumers** (read, produced by nothing). Available in both modes (static); trace mode annotates each datapoint with its actual value.
5. **System audit (gap view)** — aggregated payoff section, **both modes**:
   - *Static (both modes):* rules whose read-paths are unmapped ("reads a datapoint the pipeline never emits — can't fire"); specialists in the roster never reachable by any routing rule.
   - *Trace mode adds:* rules whose paths resolve but stayed in-range; specialists not selected for *this* analysis; stored-vs-recomputed drift summary.

---

## 8. Disclaimer / caveat (REQUIRED, must render on the page)

A prominent banner near the top, repeated in the relevant deterministic sections:

> ⚠️ **Recomputed with current code.** Deterministic stages (rule engine, validation, severity scoring) are re-run against the stored `final_json` using the **current** versions of `rule_engine`, `validator`, and `scoring` — which may differ from the code that ran when this analysis was originally produced. LLM stages (triage, specialists) are shown from persisted data, not re-run. Treat "stored vs recomputed" drift as a signal, not a bug.

This caveat exists because analyses are **not currently versioned** (see §10).

---

## 9. Testing (pytest in `components/worker/tests/`)

- **Data loader** — mocked DB row → parsed model; prefix resolution (0 / 1 / many matches).
- **Rule re-runner** — fired vs not-fired; read-path resolution present/null/missing.
- **Read-path extractor** — given a rule's source, returns the datapoint paths it reads.
- **Static gap detection (catalog mode)** — a rule reading an unmapped datapoint is flagged with no DB / no analysis.
- **`test_stage_map_matches_pipeline_outputs`** — the §6 map's declared outputs match a committed golden `final_json` snapshot; drift (stale/missing or phantom keys) fails the test so map updates ride along with pipeline changes (§6.1).
- **Validator recompute** — downgrade applied; drift detected vs stored.
- **HTML assembly smoke test** — both modes produce valid HTML containing every expected section heading; no unescaped `final_json` breaking markup.
- **Catalog mode** — runs with `--catalog`, no DB connection, emits `_catalog.html` with the rule roster + datapoint→consumers table.
- **Edge case** — analysis with no verdicts and null `routing_plan` renders cleanly.
- **Failure case** — unknown analysis id → clean, explicit error (no traceback dump).

Minimum bar (CLAUDE.md): one expected-use, one edge, one failure — covered above.

---

## 10. Follow-up: start versioning analyses (NOTE — separate work)

**Problem:** an analysis row records *what* was produced but not *which code* produced it. That's why §8's caveat is necessary — the inspector can't recompute against the historical rule/validator/prompt versions, only current ones.

**Proposed direction (not part of this spec's implementation):**
- Stamp each `analyses` row with the versions that produced it: pipeline/analysis package version, `rule_engine` version (`RULE_ENGINE_VERSION` already exists = `rule_engine@1.0.0`), validator/scoring version, and the triage + per-specialist prompt version set (a `verdicts_prompt_version_set` concept already exists in the legacy api).
- Candidate storage: a `pipeline_version` / `code_versions` JSONB column on `analyses` (or a sibling table), written by the worker at finalize time.
- Payoff: the inspector (and reproducibility/regression tooling generally) can then recompute deterministic stages against the *actual* historical code, turning the §8 disclaimer into a precise, trustworthy comparison.

**Action:** tracked as a project memory; size and schedule as its own PRP. Out of scope here.

---

## 11. Open questions / assumptions

- Assumes `db_sync` is importable and configured via the worker's existing env (`DATABASE_URL` / storage settings). If run outside the worker's environment, the DB connection string must be available the same way the worker resolves it.
- Assumes `flatten_analysis` produces the `phaseN` keys the rules expect; if rule mismatches are confirmed, the gap view will simply report them (the tool does not adapt rule behavior).
- The §6 stage map (narration + inputs + outputs) is maintained inside the tool (small, explicit) rather than introspected — phases are a fixed, well-known set of 9, and their outputs are dynamic dicts with no typed schema. Map drift is acceptable for a dev tool and is itself surfaced (trace mode cross-checks the map's outputs against the real `final_json`).
- Catalog mode is intentionally DB-free; if `db_sync` import has heavy side effects at import time, the tool must import the rule/validator/prompt modules without forcing a DB connection (lazy-connect only in trace mode).
