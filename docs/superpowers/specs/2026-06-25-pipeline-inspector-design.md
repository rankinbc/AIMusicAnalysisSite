# Pipeline Inspector — Design Spec

**Date:** 2026-06-25
**Status:** Approved (pre-implementation)
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
- **Run:** `python -m app.tools.pipeline_inspector <analysis_id> [--open]`
  - `--open` opens the produced file in the default browser.
  - Accepts a full UUID or a unique prefix (resolve via `WHERE id::text LIKE '<prefix>%'`; error if 0 or >1 match).
- **Output:** `output/worker/<YYYY-MM-DD>_pipeline_inspector/<short_id>.html`
  - Per CLAUDE.md output rules; never overwrites a prior run for a different id; same-id re-run overwrites its own file.
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

---

## 6. Deterministic re-derivation (no LLM calls)

- **Flatten** `final_json` → `phaseN` keys.
- **Re-run every registered rule** → fired (Verdict) / not-fired (None).
- **Per-rule read-path resolution:** extract the metric paths a rule reads (via `inspect.getsource` + a small regex for `_phase(analysis, "phaseN")` and `.get("key")`, plus any `Evidence(metric=…)` strings when fired). Resolve each path against the flattened analysis → **present / null / missing**. This distinguishes "didn't fire because value in range" from "didn't fire because the field is absent."
  - Heuristic parsing limitation is acceptable for a dev tool and noted in-page; the collapsible source snippet lets a human verify.
- **Re-run the validator** over the persisted specialist verdicts → show downgrades/rejects and any **stored-vs-recomputed drift** in severity/priority_score.

LLM stages (triage, specialists) are **never re-run** — shown from persisted `routing_plan` / `verdicts`.

---

## 7. Page sections

0. **Header** — analysis id, song, job id, created-at, overall score + grade. Input provenance row: mix / stems / reference / .als present?
1. **Analysis phases 1–9** — per card: phase name, **declared inputs** (from a static dependency map maintained in the tool), status (ok / skipped / failed), key outputs + collapsible raw JSON.
2. **Rollups** — `overall_score`, `grade`, `danceability_score`, `top_fixes`, `coach_*`.
3. **Verdict pipeline:**
   - **3a. Rule engine** — every registered rule. Per rule: fired/not-fired badge; metric paths read + resolution status (present/null/**missing**); output verdict if fired; collapsible source snippet.
   - **3b. Triage** — persisted `routing_plan`: `specialists_to_run` (priority + focus), `skip`, `rationale`. If null → "no LLM stage ran for this analysis."
   - **3c. Specialists** — full roster overlaid: **ran** / **selected-but-empty** / **not-selected**; verdicts for those that ran.
   - **3d. Validation** — validator re-run over persisted verdicts: downgrades/rejects + stored-vs-recomputed drift.
   - **3e. Final verdicts** — ranked list from the `verdicts` table.
4. **System audit (gap view)** — aggregated: rules whose read-paths never resolve ("can't fire on this track"), specialists never selected. The payoff section for rule-system improvement.

---

## 8. Disclaimer / caveat (REQUIRED, must render on the page)

A prominent banner near the top, repeated in the relevant deterministic sections:

> ⚠️ **Recomputed with current code.** Deterministic stages (rule engine, validation, severity scoring) are re-run against the stored `final_json` using the **current** versions of `rule_engine`, `validator`, and `scoring` — which may differ from the code that ran when this analysis was originally produced. LLM stages (triage, specialists) are shown from persisted data, not re-run. Treat "stored vs recomputed" drift as a signal, not a bug.

This caveat exists because analyses are **not currently versioned** (see §10).

---

## 9. Testing (pytest in `components/worker/tests/`)

- **Data loader** — mocked DB row → parsed model; prefix resolution (0 / 1 / many matches).
- **Rule re-runner** — fired vs not-fired; read-path resolution present/null/missing.
- **Validator recompute** — downgrade applied; drift detected vs stored.
- **HTML assembly smoke test** — output is valid HTML containing every section heading; no unescaped `final_json` breaking markup.
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
- Static phase dependency map is maintained inside the tool (small, explicit) rather than introspected — phases are a fixed, well-known set of 9.
