# PRP: `final_json` schema path-lint CI gate (Layer 2)

**Goal:** Add a dependency-free CI lint that fails when any consumer (rule, LLM prompt, or test
fixture) references a `final_json` field path that the pipeline does not actually emit — so the
three-schema drift documented in `PRPs/detection-prescription-inventory.md` can never silently
recur or grow.

**Why:** The rule engine read `phase1.integrated_lufs` while production emits `phase1.lufs`; 14
prompts cite an `audio_analysis.*` namespace that doesn't exist in the JSON the model is handed; and
the test fixtures encode the *wrong* schema, so the dead rules passed their tests over a fiction.
None of it was caught for months because nothing checks consumer paths against the producer's real
output. Design rationale: `PRPs/schema-contract-prevention-design.md`.

**Architecture:** A committed **manifest** of every emitted path (`schemas/final_json.contract.json`)
+ a small pure module that resolves a consumer path against it + an enforcement test (modeled on
`components/worker/tests/test_enforcement_lints.py`) that runs in the existing worker CI job. Ships
behind a **ratcheting baseline** so it's green on day one despite large existing drift, fails on any
*new* drift, and forces the baseline to shrink as fixes land.

---

## Success criteria
- [ ] `schemas/final_json.contract.json` exists, generated from real `final_json` sample(s), and
      includes optional-phase paths (phase4 stems, phase5 reference, phase8 als).
- [ ] `app/verdict_lib/schema_contract.py` (pure, no DB/LLM) exposes: `load_contract()`,
      `path_resolves(path, contract) -> bool`, `prompt_paths(md_text) -> set[str]`,
      `fixture_paths(obj) -> set[str]`.
- [ ] `components/worker/tests/test_schema_contract_lints.py` asserts, for rules + prompts +
      fixtures, that every referenced path resolves — except entries in the frozen baseline.
- [ ] The test is **green** in CI on first merge (baseline absorbs current drift) and **fails
      closed** if it scans zero rules/prompts/fixtures.
- [ ] Adding a bogus unresolved path to any consumer turns the test **red** (covered by a test).
- [ ] Removing a baselined offender (fixing the drift) without deleting its baseline entry turns the
      test **red** (ratchet — covered by a test).
- [ ] All existing gates still pass: `ruff check components/worker/`, `pytest -q components/worker/tests/`.

## Context — exact existing symbols to build on (do not reinvent)
- **Rule path extraction (reuse as-is):** `app.tools.inspector.rule_introspect.read_paths_for_rule(fn)`
  over `app.verdict_lib.rule_engine._RULES`. Already AST-extracts `.get()` + `Evidence(metric=…)`
  paths. (Caveat in its docstring: handles current rule idioms only — fine, rules follow them.)
- **Flatten shape (the real schema):** `app.verdict_lib.flatten_analysis.flatten(final_json)` →
  top-level `phase1`…`phaseN` keys. The manifest describes THIS flattened shape.
- **Validator resolution (mirror its `[idx]` handling):** `app.verdict_lib.validator._resolve_path`
  strips `name[idx]`. The lint resolver must normalize `name[idx]` → `name[]` the same way.
- **Authored output map (cross-check, do not use as source of truth):**
  `app.tools.inspector.stage_map.final_json_output_paths()` and `diff_against_final_json()`.
- **Prompt inventory:** `app.verdict_lib.prompt_loader.SLUG_TO_FILENAME` (24 specialists),
  `PROMPTS_DIR`, `TRIAGE_FILENAME`. Prompt files: `components/worker/prompts/experts/*.md`.
- **Fixtures:** `components/worker/tests/verdict_pipeline/fixtures/analyses/*.json`.
- **CI:** `.github/workflows/ci.yml` `python` job already runs `python -m pytest -q tests/` in
  `components/worker` — a new `tests/test_*.py` is picked up automatically. **No YAML change.**
- **Enforcement-lint pattern to copy:** `components/worker/tests/test_enforcement_lints.py`
  (collect offenders, assert empty with a readable message, fail closed on a vacuous scan).
- **Repo folder for the artifact:** top-level `schemas/` (declared in CLAUDE.md).

## Manifest format (`schemas/final_json.contract.json`)
```json
{
  "generated_from": ["schemas/samples/<id>.final_json.json"],
  "leaf_paths": ["phase1.lufs", "phase1.bands.sub_bass", "phase4.clashes[].severity",
                 "phase5.deltas.band_air.value", "phase8.tracks[].name", "overall_score", "..."],
  "bare_top_level_allowed": ["track_id", "genre_hint"]
}
```
- Array levels use `[]`; the resolver normalizes any `name[<int>]` → `name[]`.
- `path_resolves` is true when the (normalized) path is a leaf OR an ancestor prefix of a leaf OR a
  member of `bare_top_level_allowed`. (Prefixes let a consumer read `phase4.clashes` whole.)
- Dynamic dict keys with a fixed vocabulary (the 7 band names) are enumerated as leaves.

## Baseline format (`schemas/_schema_drift_baseline.json`)
```json
{
  "rules":    ["loudness_too_high_for_streaming::phase1.integrated_lufs", "..."],
  "prompts":  ["Loudness.md::audio_analysis.loudness.integrated_lufs", "..."],
  "fixtures": ["clean_trance.json::phase1.integrated_lufs", "..."]
}
```
Entry = `"<source>::<offending_path>"`. The lint enforces: `current_offenders ⊆ baseline` (no new
drift) **and** `baseline ⊆ current_offenders` (no stale entries — fixing a drift forces its removal).

---

## Tasks (TDD, bite-sized)

### Task 1 — `schema_contract.py` resolver + extractors
**Files:** Create `components/worker/app/verdict_lib/schema_contract.py`; Test
`components/worker/tests/verdict_pipeline/test_schema_contract.py`.
- [ ] Write failing tests: `path_resolves("phase1.lufs", c)` True; `"phase1.integrated_lufs"` False;
      `"phase4.clashes[0].severity"` resolves when `phase4.clashes[].severity` is a leaf;
      `"phase4.clashes"` resolves as a prefix; `"track_id"` resolves via `bare_top_level_allowed`.
      `prompt_paths` over a snippet containing `audio_analysis.loudness.integrated_lufs` and
      `phase1.lufs` returns both; ignores prose without dotted paths. `fixture_paths({"phase1":
      {"lufs":1,"bands":{"sub_bass":2}}})` returns `{"phase1.lufs","phase1.bands.sub_bass"}`.
- [ ] Implement: `load_contract()` (reads the JSON, builds leaf set + derived prefix set);
      `_normalize(path)` (`re.sub(r"\[\d+\]", "[]", path)`); `path_resolves`; `prompt_paths`
      (regex `\b(?:phase[1-9]|audio_analysis|section_analysis|stem_analysis)(?:\.\w+)+\b` — the
      namespaces consumers actually use; extract from full md text); `fixture_paths` (recursive
      dict walk to dotted leaves, arrays collapse to `[]`).
- [ ] Run tests → PASS.

### Task 2 — Build the manifest + bootstrap CLI
**Files:** Create `components/worker/app/tools/build_schema_contract.py`; commit
`schemas/samples/*.final_json.json` (real, scrubbed snapshots — at least one maximal run exercising
stems+reference+als; if unavailable, union several) and the generated `schemas/final_json.contract.json`.
- [ ] CLI: `python -m app.tools.build_schema_contract --samples schemas/samples/*.json
      --out schemas/final_json.contract.json` → flattens each sample via `flatten()`, unions
      `fixture_paths`, writes the manifest. Manually add any gated-phase leaf the samples missed
      (enumerated in the inventory doc).
- [ ] Cross-check: assert the manifest's leaf set is a superset of
      `stage_map.final_json_output_paths()` minus known-dynamic; print any stage_map path absent
      from the manifest for human review (drift between authored map and real run).
- [ ] Commit manifest + samples.

### Task 3 — Bootstrap the baseline
**Files:** Add baseline-writing mode to the CLI; commit `schemas/_schema_drift_baseline.json`.
- [ ] CLI `--write-baseline`: compute current offenders for rules (via `read_paths_for_rule`),
      prompts (`prompt_paths` over every `SLUG_TO_FILENAME` file + `Triage.md`), fixtures
      (`fixture_paths` over every fixture), keep those that fail `path_resolves`, write grouped JSON.
- [ ] Sanity: expect ~8 rule entries (this branch; ~5 on master), 165-ish prompt entries across 14
      files, and the fixture `integrated_lufs`/`crest_factor`/`key_detection_confidence`/`genre_hint`
      entries. Eyeball the counts against the inventory doc before committing.

### Task 4 — The enforcement test
**Files:** Create `components/worker/tests/test_schema_contract_lints.py`.
- [ ] `_current_offenders()` helper returns the three grouped sets (same logic as the CLI;
      import shared code from `schema_contract.py` — do not duplicate the resolver).
- [ ] `test_no_unbaselined_schema_drift`: `current - baseline` is empty (message lists the new
      offenders with source::path). `test_baseline_has_no_stale_entries`: `baseline - current` is
      empty (message says "fixed — remove from baseline"). Fail **closed**: assert each scanned set
      is non-empty (`len(rules._RULES) > 0`, prompt files found, fixtures found) so a vacuous scan
      can't pass.
- [ ] Run `pytest -q components/worker/tests/test_schema_contract_lints.py` → PASS (baseline absorbs
      current drift).

### Task 5 — Prove the ratchet (regression tests for the gate itself)
**Files:** add to `test_schema_contract.py`.
- [ ] `test_injected_unresolved_path_is_flagged`: feed the offender-computation a synthetic consumer
      path `phase1.bogus_field` → it appears in current offenders and is NOT in baseline → the
      not-empty assertion would fire. (Test the helper directly with an injected input; don't mutate
      real files.)
- [ ] `test_fixed_offender_must_leave_baseline`: a baseline entry with no matching current offender
      is reported by `baseline - current`.

### Task 6 — Docs
- [ ] Add a short "Schema contract" subsection to `components/worker/README.md` (or the worker docs):
      what the manifest is, how to regenerate it (`build_schema_contract`), and the rule "fixing a
      drift means deleting its baseline line — the test enforces it."
- [ ] Tick the Layer-2 box in `PRPs/schema-contract-prevention-design.md`.

## Validation gates
```bash
ruff check components/worker/
python -m pytest -q components/worker/tests/test_schema_contract.py
python -m pytest -q components/worker/tests/test_schema_contract_lints.py
python -m pytest -q components/worker/tests/        # full worker suite still green
```

## Gotchas / decisions
- **Resolver must mirror `validator._resolve_path`'s `[idx]` stripping** or fixture/evidence array
  paths false-flag. Normalize to `[]`, not by dropping the segment.
- **`prompt_paths` regex must NOT match version strings or prose** — anchor on the known consumer
  namespaces (`phaseN`, `audio_analysis`, `section_analysis`, `stem_analysis`). A path like
  `1.0.0` (frontmatter) must not register.
- **Gated phases:** if no committed sample exercised stems/reference/als, their leaves are absent
  from a generated manifest and every gated-phase consumer path would falsely become an offender.
  Either commit a maximal sample or hand-add those leaves (the inventory doc enumerates them) —
  Task 2 calls this out explicitly.
- **Do not try to fix the prompts here.** This PRP makes drift *visible and non-growing*. The actual
  prompt reconciliation is the two-engine prescription work; each fix there deletes baseline lines.
- **Branch note:** on `listen-ui-overhaul` the rule layer has ~8 dead rules; on `master` the Tier-1
  fix leaves ~5. Generate the baseline on whatever branch this lands on; the ratchet handles the
  difference when branches merge (a merged-away offender shows as a stale baseline entry → red →
  delete the line).

## Anti-goals
- No between-phase runtime checker (wrong seam — see design doc).
- No frontend type codegen (Layer 4, separate).
- No validator telemetry (Layer 3, separate small PRP).
- No JSON-Schema/Pydantic model of `final_json` (the path manifest is intentionally lighter; can
  graduate later without changing this lint's contract).
