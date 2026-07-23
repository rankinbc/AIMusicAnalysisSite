# PRP: v3 Analysis-System Closeout

**Date:** 2026-07-23
**Confidence:** 8/10 (all touch points researched with line refs; residual risk is the schema-contract repoint surfacing unexpected offenders and the inspector AST extractor idiom update)
**Scope source:** user directive 2026-07-23 (closeout tail of the IDENTIFY/SOLVE build — see `PRPs/identify-solve-architecture.md` lines 24–58 "Build status" banner)

---

## Goal

Four independent closeout tasks, one wave:

1. **RETIRE** the legacy flat `@rule` registry in `components/worker/app/verdict_lib/rule_engine.py` (11 dead rules + `_RULES`/`evaluate_rules`/`_make`), repoint the schema-contract lint + inspector tooling to the new `_SINGLES` registry, migrate/delete the legacy tests, and **shrink** `schemas/_schema_drift_baseline.json` (delete the `low_mid_mud_*` rule lines and the `phase3.low_mid_energy` fixture lines).
2. **IMPLEMENT** `tempo_octave_error` as a NEW-engine `@single` rule (translated from the legacy-path blueprint in `PRPs/rule-tempo-octave-error.md`).
3. **VERSION-STAMP** `analyses` rows with 4 new columns: `pipeline_version`, `rule_engine_version`, `validator_version`, `prompt_set_version` — EF-Core-first (entity → migration → SQLAlchemy mirror → worker writes).
4. **HOUSEKEEPING**: delete stale local branches `ai-analysis-v2` (force — 3 unmerged commits, parked/superseded) and `analysis-results-ui` (merged, but checked out in a worktree — remove worktree first).

**Out of scope:** the LLM tier (`PRPs/identifiers/{composite-refiner,router,preset-compiler}.md`), `surface-latent-analysis-datapoints.md`, Epic 8 genre corpus, any `solve_lib/` behavior change, any frontend/TS change (no TS types change here — skip frontend gates).

## Success criteria

- [ ] `evaluate_rules`, `_RULES`, `rule` decorator, `_make`, and all 11 legacy `@rule` functions are gone from `rule_engine.py`; new engine (`@single`/`@composite`/`evaluate_problems`, `_track_id`, `_phase`, `RULE_ENGINE_VERSION`, `RULE_MODEL`) untouched
- [ ] `schemas/_schema_drift_baseline.json` is strictly SMALLER (rules section empty; `phase3.low_mid_energy` fixture lines gone); `pytest components/worker/tests/test_schema_contract_lints.py` green
- [ ] Nothing anywhere emits or reads `phase3.low_mid_energy`
- [ ] `tempo_octave_error` fires on the half-time case (71.78 vs 143.0), silent on agreement/missing structure, passes `validate_verdict`
- [ ] `analyses` has the 4 new nullable varchar columns in EF entity + migration + SQLAlchemy mirror + parity test; `analyze_audio_job` stamps all 4; `rerun_phase` re-stamps `pipeline_version`
- [ ] Both stale branches deleted; `spectr-analysis-ui` worktree removed
- [ ] All validation gates pass (modulo the documented pre-existing failures)
- [ ] Live verification: fresh analysis row carries stamps; `source='rule_engine'` verdicts still generated; fix rack populates

---

## All Needed Context

### Files to read before implementing (with why)

```yaml
- file: components/worker/app/verdict_lib/rule_engine.py
  why: The main surgery site. 1545 lines. Legacy pieces at 49-100 + 262-543 (see map below). KEEP 103-109 (_track_id/_phase), 46-47 (RULE_ENGINE_VERSION/RULE_MODEL), 111-256 (new engine core), 549-EOF (30 @single + 9 @composite).

- file: components/worker/app/verdict_lib/schema_contract.py
  why: _rule_offenders() (line ~103-106) and scan_sizes() (~171-176) iterate rule_engine._RULES — LIVE, must repoint to _SINGLES (entries are (slug, fn) tuples, not bare fns).

- file: components/worker/tools/inspector/build.py        # lines 8, 34, 74
  why: iterates _RULES for datapoint-consumer map + trace overlay — repoint to _SINGLES.

- file: components/worker/tools/inspector/rule_introspect.py   # lines 20, 113
  why: rule_catalog() iterates _RULES; AST extractor written for legacy _phase + Evidence(metric=...) idiom. New rules use the same Evidence(metric=...) keyword style, but verify the extractor still finds them; update idioms as needed.

- file: components/worker/app/verdict_lib/__init__.py     # lines 21, 32
  why: re-exports evaluate_rules — remove from import + __all__.

- file: components/worker/app/verdict_lib/orchestrator.py # lines 11, 49, 119-122
  why: run_pipeline() calls evaluate_rules (NOT invoked in worker production — only test_orchestrator.py). Swap to evaluate_problems. Also _collect_prompt_versions lives here (reference for stamping, but we use the on-disk variant).

- file: schemas/_schema_drift_baseline.json               # 31 lines
  why: rules lines 3-6 (low_mid_mud_*) become stale on retirement → DELETE. Fixture lines for phase3.low_mid_energy (5 fixtures) only deletable if the key is ALSO stripped from the fixture JSONs.

- file: components/worker/tests/test_schema_contract_lints.py
  why: 3 tests. test_baseline_has_no_stale_entries FAILS if baseline lines outlive their offenders (the shrink ratchet). test_scan_is_not_vacuous asserts scan_sizes()["rules"] >= 8 — satisfied by repointing to _SINGLES (~30 entries).

- file: PRPs/rule-tempo-octave-error.md
  why: The rule's spec (thresholds verbatim below). WARNING: its blueprint targets the LEGACY path (_make/evaluate_rules/category="tempo") — translate per Task 2, do not copy literally.

- file: components/worker/tests/verdict_pipeline/test_rules_tier_a.py
  why: The test pattern to mirror for tempo_octave_error (the _a(**p1) fixture builder + direct-call + validate_verdict tests).

- file: components/bff/src/Spectr.Data/Entities/Analysis.cs
  why: Attribute-based [Column("snake_case")] mapping (NO fluent naming). [Table("analyses")] line 9. Add the 4 new properties here FIRST.

- file: components/bff/src/Spectr.Data/Migrations/20260626030953_AddVerdictProblemFields.cs
  why: The pattern migration for "add scalar columns to existing table".

- file: components/shared/aimusic_shared/models.py        # Analysis at line 264
  why: SQLAlchemy mirror — add columns with "# mirror of EF AddAnalysisVersionStamps" comments AFTER the EF migration exists.

- file: components/shared/tests/test_verdict_orm_problem_columns.py
  why: The parity-test pattern to copy for test_analysis_orm_version_columns.py.

- file: components/worker/app/tasks_dramatiq.py           # Phase C at 344, Analysis(...) at 363-381
  why: The stamp write site for analyze_audio_job.

- file: components/worker/app/rerun_phase_actor.py        # Phase C write-back at 199-203
  why: rerun mutates final_json in place — must RE-stamp pipeline_version there.

- file: components/api/app/routers/verdicts.py            # _expected_prompt_version_set at 53-65
  why: The all-prompts-on-disk prompt-set gatherer to REPLICATE worker-side (legacy api stays untouched).

- file: components/worker/app/verdict_lib/prompt_loader.py
  why: SLUG_TO_FILENAME (43), load_prompt(slug)->(version,body) (225), load_triage (236) — building blocks for the worker-side prompt-set string.
```

### Legacy anatomy map (rule_engine.py, verified 2026-07-23)

DELETE (contiguous-ish):
- `RuleFn` (49), `_RULES` (50), `rule()` decorator (53–56), `evaluate_rules()` (59–66), `_make()` (69–100)
- 11 `@rule` functions, block 262–543: `clipping_detected` 262–283, `true_peak_over_minus_1` 285–308, `mono_incompatible` 310–333, `loudness_too_high_for_streaming` 335–359, `loudness_too_low_for_streaming` 361–384, `low_mid_mud_trance` 386–410, `low_mid_mud_generic` 412–438, `excessive_dynamic_range` 440–464, `tiny_dynamic_range` 466–490, `stereo_correlation_negative` 492–517, `key_detection_low_confidence` 519–544

KEEP: module docstring 1–24 (UPDATE wording — the "remaining follow-on" at 22–23 is now done), `RULE_ENGINE_VERSION`/`RULE_MODEL` 46–47, `_track_id` 103–104, `_phase` 107–109, new engine core 111–256, all rules 549–EOF.

Every legacy rule's coverage already exists in the new engine (`true_peak_overshoot`, `mud_buildup`/`congested_mix`, etc. — see identify-solve banner line 52–55); no behavior is lost.

### Importer sweep (complete list of legacy-surface consumers)

| Site | Action |
|---|---|
| `verdict_lib/__init__.py:21,32` | remove `evaluate_rules` import + `__all__` entry |
| `verdict_lib/orchestrator.py:11,49` | swap `evaluate_rules(analysis)` → `evaluate_problems(analysis)` (import from `.rule_engine`) |
| `verdict_lib/schema_contract.py:10,103,106,171,173` | repoint `_RULES` → `_SINGLES`; note `_SINGLES` entries are `(slug, fn)` tuples — iterate `fn for _slug, fn in _SINGLES` |
| `tools/inspector/build.py:8,34,74` | same repoint |
| `tools/inspector/rule_introspect.py:20,113` | same repoint + verify AST extractor finds new-idiom rules |
| `tests/verdict_pipeline/test_rule_engine.py` | DELETE whole file (~25 legacy tests; new rules covered by `test_rules_tier_*`) |
| `tests/verdict_pipeline/test_triage.py:54-55` | migrate helper `evaluate_rules(clipped_pop)` → `evaluate_problems(clipped_pop)` (adjust assertions if verdict set differs) |
| `tests/verdict_pipeline/test_orchestrator.py` | update alongside the orchestrator swap |
| `tests/inspector/test_rule_introspect.py:13,54` | migrate: `_RULES` → `_SINGLES` len; `_rule("clipping_detected")`/`_rule("low_mid_mud_trance")` → new-engine slugs (e.g. `true_peak_overshoot`, `mud_buildup`) |
| `degraded.py` | NO CHANGE — already calls `rule_engine.evaluate_problems` (line 113) |
| docs: `docs/architecture-worker.md:112`, `CLAUDE.md:242` | update the "retirement is a follow-on" sentences to past tense |

### Known gotchas

```
# GOTCHA 1 — ratchet direction: test_baseline_has_no_stale_entries fails when baseline
#   lines outlive offenders. Deleting the low_mid_mud rules REQUIRES deleting baseline
#   rules lines 3-6 in the same change.
# GOTCHA 2 — test_scan_is_not_vacuous asserts scan_sizes()["rules"] >= 8. _RULES empties
#   → 0 → red. The repoint to _SINGLES (~30) is mandatory in the same change. Do NOT
#   lower the >= 8 threshold.
# GOTCHA 3 — repointing the offender scan to _SINGLES may surface NEW offenders (paths
#   new rules read that the contract doesn't list). Expected: none (new rules were built
#   against the current contract). If any appear: fix the CONTRACT (the path is genuinely
#   emitted) — do NOT grow the baseline. Baseline "rules" section must end EMPTY (`[]`).
# GOTCHA 4 — fixture baseline lines: fixture offenders come from scanning the 5 fixture
#   JSONs directly, INDEPENDENT of rules. To delete the phase3.low_mid_energy fixture
#   lines you must also strip that key from all 5 fixture files. genre_hint: strip + delete
#   its lines ONLY if grep shows zero remaining consumers post-retirement (legacy rules
#   were the consumers; check validator paths too). phase1.integrated_lufs /
#   phase2.stereo_correlation fixture lines: LEAVE (out of scope).
# GOTCHA 5 — category="tempo" DOES NOT EXIST in the Category literal
#   (aimusic_shared/verdicts/models.py:10-17) — pydantic will reject it. Use "sections"
#   (precedent: bpm_genre_match).
# GOTCHA 6 — validate_verdict's _is_deterministic exemption (validator.py:87-97,170-175)
#   keeps rule_engine verdicts' severity un-downgraded — "minor" survives as-is.
# GOTCHA 7 — EF-first discipline: C# entity + migration BEFORE touching models.py
#   (models.py header lines 1-6 codifies this). Migration cmd needs
#   --startup-project src/Spectr.Bff or EF can't load the DbContext.
# GOTCHA 8 — Windows file lock: stop any running Spectr.Bff.exe before dotnet build /
#   dotnet ef (Stop-Process). Stack may be running — stop it first, restart for live verify.
# GOTCHA 9 — verdicts do NOT exist at analyze_audio_job Phase C insert time (rule engine
#   runs Phase C2, specialists lazily). prompt_set_version must be gathered from DISK
#   (replicate api _expected_prompt_version_set with worker prompt_loader), never from
#   produced verdicts.
# GOTCHA 10 — NO validator version constant exists anywhere. Introduce ONE:
#   VALIDATOR_VERSION = "validator@1.0.0" in components/worker/app/verdict_lib/validator.py
#   (module top, next to imports). This is the single permitted new constant — the
#   "reuse existing constants" rule covers pipeline (ANALYSIS_SCHEMA_VERSION "2.1.0",
#   from audio_analysis) and rule engine (RULE_ENGINE_VERSION "rule_engine@1.0.0").
# GOTCHA 11 — prompt_set_version can be LONG (comma-joined "<slug>@<ver>" for every
#   specialist + triage). Legacy column was String(2000). Use varchar(2000)/String(2000).
# GOTCHA 12 — worker tests: python -m pytest from components/worker so `app` package
#   resolves (match existing invocation in CLAUDE.md validation gates).
```

---

## Implementation Blueprint

### Task 1 — Retire the legacy @rule registry

1. `rule_engine.py`: delete lines 49–100 (KEEP 46–47 constants; KEEP 103–109 `_track_id`/`_phase` which sit just after) and the 262–543 block (all 11 `@rule` functions). Update module docstring (1–24): remove the "kept as importable alias" + "remaining follow-on" language.
2. `verdict_lib/__init__.py`: drop `evaluate_rules` from import and `__all__`.
3. `orchestrator.py`: `from .rule_engine import evaluate_problems`; call it in `run_pipeline`. Update `tests/verdict_pipeline/test_orchestrator.py` expectations (verdict count/slugs will change — assert on structural invariants, not legacy slugs).
4. `schema_contract.py`: repoint `_rule_offenders()` + `scan_sizes()["rules"]` to `_SINGLES` (`(slug, fn)` tuples). Run the scan; per GOTCHA 3 the rules offender list should be empty.
5. Inspector: `tools/inspector/build.py` + `rule_introspect.py` repoint to `_SINGLES`; run `tests/inspector/` and fix the AST extractor if it misses new-idiom rules. Migrate `tests/inspector/test_rule_introspect.py` to new slugs.
6. Tests: delete `tests/verdict_pipeline/test_rule_engine.py`; migrate `test_triage.py:54-55` to `evaluate_problems`.
7. Baseline burn-down: delete `schemas/_schema_drift_baseline.json` rules lines 3–6 (`low_mid_mud_generic::genre_hint`, `low_mid_mud_generic::phase3.low_mid_energy`, `low_mid_mud_trance::genre_hint`, `low_mid_mud_trance::phase3.low_mid_energy`) → `"rules": []`. Strip `phase3.low_mid_energy` from the 5 fixture JSONs (clean_trance, clipped_pop, mono_broken_indie, muddy_hiphop, tiny_dynamics_edm — find under worker tests fixtures dir) and delete their 5 `::phase3.low_mid_energy` baseline lines. `genre_hint`: grep post-retirement; if zero consumers, strip + delete its baseline lines too; if any consumer remains, leave both key and lines.
8. Docs: update `docs/architecture-worker.md:112` and the CLAUDE.md worker bullet (line ~242) — legacy path retired, `evaluate_problems` sole producer.
9. Gate: `cd components/worker && python -m pytest -q tests/` — schema lints green with the smaller baseline.

### Task 2 — tempo_octave_error (@single, new engine)

Append to `rule_engine.py` near `bpm_genre_match` (Tier A block). Genre-independent — NO genre-profiles/rule-bindings entry needed:

```python
@single("tempo_octave_error", tier="A")
def tempo_octave_error(a: dict[str, Any]) -> Verdict | None:
    """Phase-1 beat tracker disagrees with allin1 structure BPM by an octave
    (half/double-time). Measurement-integrity caveat, not a mix fault."""
    p1 = _phase(a, "phase1")
    bpm = p1.get("bpm")
    struct_bpm = (p1.get("structure") or {}).get("bpm")
    if bpm is None or not struct_bpm:
        return None
    ratio = bpm / struct_bpm
    half = 0.47 <= ratio <= 0.53
    double = 1.89 <= ratio <= 2.11
    if not (half or double):
        return None
    direction = "half-time" if half else "double-time"
    return _problem(
        track_id=_track_id(a), slug="tempo_octave_error", severity="minor",
        category="sections", kind="integrity", fixable=False,
        headline=f"Detected BPM {bpm:.0f} looks {direction} of the true {struct_bpm:.0f}",
        summary=(
            f"The beat tracker reported {bpm:.1f} BPM but structure analysis measured "
            f"{struct_bpm:.1f} BPM (ratio {ratio:.2f}) — a classic {direction} octave error. "
            f"Treat {struct_bpm:.0f} BPM as the working tempo."
        ),
        evidence=[
            Evidence(metric="phase1.bpm", value=float(bpm), label=f"{bpm:.1f} BPM (beat tracker)"),
            Evidence(metric="phase1.structure.bpm", value=float(struct_bpm),
                     label=f"{struct_bpm:.1f} BPM (structure)"),
        ],
        why_it_matters=(
            "Genre matching and danceability scoring read the beat-tracker BPM; an octave "
            "error skews both and the displayed tempo."
        ),
    )
```

(Adapt kwargs to `_problem`'s exact signature at lines 138–185 — e.g. if `Evidence` requires `expected_range`, follow `bpm_genre_match`'s usage; keep the two metric paths EXACT or the validator drops the verdict.)

Tests — append to `tests/verdict_pipeline/test_rules_tier_a.py` using its `_a(**p1)` builder:
- fires on half-time: `_a(bpm=71.78, structure={"bpm": 143.0})` → severity "minor", kind "integrity", evidence metrics == {"phase1.bpm", "phase1.structure.bpm"}
- fires on double-time: `_a(bpm=280.0, structure={"bpm": 140.0})`
- silent on agreement: `_a(bpm=140.0, structure={"bpm": 140.0})` → None
- silent when structure missing/deferred: `_a(bpm=140.0)` and `_a(bpm=140.0, structure={"available": False})` → None
- validator: `validate_verdict(v, a).ok` and severity survives as "minor" (deterministic exemption)

Then archive `PRPs/rule-tempo-octave-error.md` → `PRPs/archive/2026-07-23_rule-tempo-octave-error.md` (implemented by this wave).

### Task 3 — Version stamps on analyses (EF-first, strict order)

1. **Entity**: `Analysis.cs` — add after `FinalJson`:
   ```csharp
   [Column("pipeline_version"), MaxLength(40)]  public string? PipelineVersion  { get; set; }
   [Column("rule_engine_version"), MaxLength(60)] public string? RuleEngineVersion { get; set; }
   [Column("validator_version"), MaxLength(60)] public string? ValidatorVersion { get; set; }
   [Column("prompt_set_version"), MaxLength(2000)] public string? PromptSetVersion { get; set; }
   ```
2. **Migration**: stop Spectr.Bff.exe if running; `cd components/bff && dotnet ef migrations add AddAnalysisVersionStamps --project src/Spectr.Data --startup-project src/Spectr.Bff` (pattern: `AddVerdictProblemFields`), then `dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff`.
3. **Mirror**: `models.py` Analysis (after `final_json`, line ~303):
   ```python
   # v3 closeout — mirror of EF AddAnalysisVersionStamps (2026-07-23)
   pipeline_version: Mapped[Optional[str]] = mapped_column("pipeline_version", String(40), nullable=True)
   rule_engine_version: Mapped[Optional[str]] = mapped_column("rule_engine_version", String(60), nullable=True)
   validator_version: Mapped[Optional[str]] = mapped_column("validator_version", String(60), nullable=True)
   prompt_set_version: Mapped[Optional[str]] = mapped_column("prompt_set_version", String(2000), nullable=True)
   ```
4. **Parity test**: `components/shared/tests/test_analysis_orm_version_columns.py` copying `test_verdict_orm_problem_columns.py` (column-name set + nullability).
5. **Constants**: add `VALIDATOR_VERSION = "validator@1.0.0"` to `verdict_lib/validator.py` (GOTCHA 10). Add worker-side `expected_prompt_version_set()` — new small helper in `verdict_lib/prompt_loader.py` replicating `components/api/app/routers/verdicts.py:53-65` (iterate `SLUG_TO_FILENAME` + `load_triage`, join `f"{slug}@{version}"` comma-sorted).
6. **Stamp — analyze_audio_job**: `tasks_dramatiq.py` Phase C `Analysis(...)` ctor (363–381): add
   `pipeline_version=ANALYSIS_SCHEMA_VERSION` (`from audio_analysis import ANALYSIS_SCHEMA_VERSION`),
   `rule_engine_version=RULE_ENGINE_VERSION`, `validator_version=VALIDATOR_VERSION`,
   `prompt_set_version=expected_prompt_version_set()`. Wrap the prompt-set call defensively (best-effort — a prompt-dir hiccup must not fail the persist; fall back to None).
7. **Re-stamp — rerun_phase**: `rerun_phase_actor.py` line ~203, alongside `row.final_json = merged_safe`: `row.pipeline_version = ANALYSIS_SCHEMA_VERSION` (rule/validator/prompt columns untouched — reruns don't regenerate verdicts).
8. **Worker test**: extend the existing analyze_audio_job persist test (find in `components/worker/tests/` — grep `final_json` inserts) to assert the 4 stamps; failure-path job rows unaffected (no Analysis row).

No BFF DTO/endpoint change (columns are ops-facing; no UI surface this wave → no frontend gates).

### Task 4 — Branch housekeeping (verified state 2026-07-23)

```powershell
# ai-analysis-v2: 3 commits ahead of master, upstream gone, parked/superseded → force delete
git branch -D ai-analysis-v2
# analysis-results-ui: fully merged BUT checked out at C:/Users/badmin/projects/spectr-analysis-ui
git -C C:/Users/badmin/projects/spectr-analysis-ui status --porcelain   # must be EMPTY; if dirty, STOP and report
git worktree remove C:/Users/badmin/projects/spectr-analysis-ui
git branch -d analysis-results-ui
git worktree prune
```

---

## Validation Gates

```bash
# Worker (from components/worker):  python -m pytest -q tests/
#   KNOWN PRE-EXISTING failures (verify pre-existing via `git stash` run if they appear;
#   do NOT chase): test_coach_stream_gateway x3, test_budget_flag_override, test_local_root
# Analysis:  pytest -q components/analysis/tests/
# Shared:    pytest -q components/shared/tests/
# Python lint (changed dirs): ruff check components/worker/ components/shared/ components/analysis/src/
# BFF (stop Spectr.Bff.exe first): cd components/bff && dotnet build && dotnet test
#   KNOWN FLAKE: AnonAnalysisTests under parallel run — re-run isolated if sole failure
# Frontend gates: SKIPPED (no TS change) — if any TS type ends up touched, run all four.
```

## Live Verification (after gates)

1. `./scripts/start-spectr.ps1` (per docs/STARTUP.md; verify worker CONSUMING per section 5, not just heartbeat).
2. Upload or re-analyze a track (UI at :5174), wait for completion.
3. DB (bare `docker` is shadowed — use full path):
   ```powershell
   & "C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec docker-postgres-1 psql -U spectr -d spectr -c "SELECT pipeline_version, rule_engine_version, validator_version, left(prompt_set_version,60) FROM analyses ORDER BY created_at DESC LIMIT 1;"
   & "C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec docker-postgres-1 psql -U spectr -d spectr -c "SELECT count(*) FROM verdicts WHERE source='rule_engine' AND analysis_id=(SELECT id FROM analyses ORDER BY created_at DESC LIMIT 1);"
   ```
   Expect: all 4 stamps non-null (`2.1.0`, `rule_engine@1.0.0`, `validator@1.0.0`, non-empty set); rule_engine verdict count > 0.
4. Results page: Findings/Problems render; fix rack populates (AI Coach tab).

## Anti-Patterns

- Do NOT keep `evaluate_rules` as a deprecation shim — the point is retirement; fix callers.
- Do NOT lower `test_scan_is_not_vacuous` thresholds; repoint the scan instead.
- Do NOT grow the drift baseline to make lints pass — fix the contract or the emitter.
- Do NOT emit `phase3.low_mid_energy` anywhere (analysis pipeline must not re-grow it).
- Do NOT add SQLAlchemy columns before the EF migration exists (models.py header rule).
- Do NOT gather prompt_set_version from produced verdicts (GOTCHA 9).
- Do NOT touch solve_lib/, the LLM-tier PRPs, or frontend code.
- Do NOT `git branch -D analysis-results-ui` while its worktree is dirty — stop and report.

## Completion

Archive this PRP → `PRPs/archive/2026-07-23_v3-analysis-closeout.md` (plus the tempo PRP per Task 2). Surgical commit (worker+schemas+shared+bff+docs; nothing unrelated). Update memory: `identify-solve-architecture` (closeout done — only LLM tier + Epic 8 remain), `version-analyses-followup` (resolved → delete file + index line). Push.
