# Deterministic SOLVE → Fix Rack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live, persisted **Problem list** into parameter-exact **`Fix`** objects and compile them into a **rack-preset** the Listen rack can load — fully deterministically (no LLM, no deferred Tier-B lifts).

**Architecture:** A new pure-Python `solve_lib` in the worker: **Router** (route → fan-out → merge) → **Solvers** (Problem → `Fix`) → **Preset Compiler** (`Fix[]` → rack `Chain`). It reuses the existing `Fix`/`DspOp` Pydantic contract + validator + `genre_config`. **Phase 1** (the deterministic core) produces a valid `chain` dict + leftover advice + change log — independently testable and hand-importable. **Phase 2** (gated) persists it as a `RackPreset(source='analysis')` and surfaces a "Generate fix rack" action.

**Tech Stack:** Python 3.11 / Pydantic v2 / pytest (worker); .NET 10 / EF Core (BFF, Phase 2); React 19 / TS (frontend, Phase 2).

## Global Constraints

- **Deterministic only.** No LLM call, no Tier-B time-series. The composite-refiner (LLM, `router.md` Stage 1b) and refiner-dependent `where`-localization are **out of scope** — the router routes the raw (already-suppressed) problem.
- **Suppression is already done.** `rule_engine.evaluate_problems` returns the de-suppressed list (Stage 1a). SOLVE consumes that list; it does NOT re-suppress.
- **Every `Fix` must validate.** A solver builds a `Fix`; the merged verdict must pass `validator.validate_verdict(verdict, analysis).ok`. `DspOp` params are range-checked at construction (`_DSP_PARAM_RANGES`) — **clamp every computed param to its range** or Pydantic raises.
- **`DspOp.params` use snake_case; rack module params use camelCase.** The compiler is the single translation boundary (`threshold_db→thresholdDb`, `ceiling_db→ceilingDb`, `width_pct→width` as a ratio, `mono_maker_hz→monoMakerHz`).
- **The rack schema is owned by the frontend** (`features/listen-rack/data.ts`). `solve_lib/rack_schema.py` is a hand-mirror — keep the `order` array, EQ band frequencies, and param keys in sync (note it at the top of the file, same discipline as the EF↔ORM mirror).
- **TDD.** Test first, watch RED, minimal GREEN, commit each. `cd components/worker && python -m pytest <path> -q`; lint/types via `python -m ruff` / `python -m mypy --ignore-missing-imports`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Reference shapes (verified)

**`Fix`** (`aimusic_shared/verdicts/models.py`): `fix_id: str`, `target: {type: "master"|"bus"|"stem", name: str}`, `section: dict|None`, `dsp_chain: list[DspOp]`, `sidechain: dict|None`, `expected_outcome: str`, `ableton_hint: dict|None`.

**`DspOp`**: `type: DspType`, `params: dict`. `DspType` = `peaking_eq | low_shelf | high_shelf | high_pass | low_pass | compressor | multiband_compressor | limiter | gain | stereo_width | sidechain`. Param ranges (clamp to these):
- `peaking_eq`/`low_shelf`/`high_shelf`: `frequency_hz`[20,22000] `gain_db`[-24,24] `q`[0.1,18]
- `high_pass`/`low_pass`: `frequency_hz`[20,22000] `slope_db`[6,96] `q`[0.1,18]
- `compressor`: `threshold_db`[-60,0] `ratio`[1,20] `attack_ms`[0.1,1000] `release_ms`[1,5000] `knee_db`[0,24] `makeup_gain_db`[0,24]
- `limiter`: `ceiling_db`[-6,0] `release_ms`[1,5000] `lookahead_ms`[0,10]
- `gain`: `gain_db`[-24,24]
- `stereo_width`: `width_pct`[0,200]

**Validator gates a Fix must satisfy:** evidence metrics resolve (the problem already passed this); `section` (if present) `start<end<=duration+0.5`; ALS grounding only fires for `target.type=="track"` (our solvers use `master`/`bus`/`stem`, so skipped); severity may be recomputed (non-blocking).

**Rack `Chain`** (`features/listen-rack/chain.ts` + `data.ts`): `{ order: string[], modules: { [id]: { enabled: bool, ...params } }, masterBypass: bool }`, `schemaVersion: 1`. Canonical `order` = `['djfilter','eq','gate','comp','sat','bitcrusher','ms','pan','tremolo','delay','reverb','limiter','trim']`. Module params (camelCase):
- `eq`: 8 freq-assignable band slots (defaults `[60,170,350,700,1400,3500,7000,14000]` Hz); each band `{type, freq, gainDb, q, enabled}`; `type` ∈ `peaking|lowshelf|highshelf|lowpass|highpass|...`.
- `comp`: `thresholdDb, ratio, attackMs, releaseMs, kneeDb, makeupDb, mix`
- `limiter`: `ceilingDb, releaseMs, lookaheadMs`
- `ms`: `width, midGainDb, sideGainDb, monoMakerHz, mono`
- `trim`: `gainDb`

---

# PHASE 1 — Deterministic SOLVE core (worker, pure Python)

## File Structure (Phase 1)

| File | Responsibility |
|---|---|
| `components/worker/app/solve_lib/__init__.py` | package + `solve()` export |
| `components/worker/app/solve_lib/rack_schema.py` | rack manifest mirror: `ORDER`, `EQ_BANDS`, snap helper, snake→camel param maps |
| `components/worker/app/solve_lib/solvers.py` | solver roster: `Verdict + analysis + genre → Fix` |
| `components/worker/app/solve_lib/router.py` | `ROUTE_TABLE`, `route`, `fan_out`, `merge` |
| `components/worker/app/solve_lib/preset_compiler.py` | `Fix[] → {chain, leftover_advice, change_log}` |
| `components/worker/tests/solve/test_*.py` | one test module per unit |

## Task 1: `rack_schema.py` — the rack manifest mirror

**Files:** Create `solve_lib/rack_schema.py` + `tests/solve/test_rack_schema.py`.

**Interfaces — Produces:**
- `ORDER: list[str]` (the 13-module canonical order, verbatim from `data.ts`).
- `EQ_BANDS: list[float]` = `[60,170,350,700,1400,3500,7000,14000]`.
- `nearest_band_slot(freq_hz: float) -> int` — index of the closest default band.
- `DSPTYPE_TO_MODULE: dict[str,str]` — `{"compressor":"comp","limiter":"limiter","stereo_width":"ms","gain":"trim", "peaking_eq":"eq","low_shelf":"eq","high_shelf":"eq","high_pass":"eq","low_pass":"eq"}` (`sidechain`/`multiband_compressor` absent → leftover advice).
- `PARAM_MAP: dict[str, dict[str,str]]` per module, snake→camel (e.g. `comp`: `{"threshold_db":"thresholdDb","ratio":"ratio","attack_ms":"attackMs","release_ms":"releaseMs","knee_db":"kneeDb","makeup_gain_db":"makeupDb"}`; `limiter`: `{"ceiling_db":"ceilingDb","release_ms":"releaseMs","lookahead_ms":"lookaheadMs"}`; `trim`: `{"gain_db":"gainDb"}`).
- `EQ_BAND_TYPE: dict[str,str]` = `{"peaking_eq":"peaking","low_shelf":"lowshelf","high_shelf":"highshelf","high_pass":"highpass","low_pass":"lowpass"}`.

- [ ] **Step 1: Failing test**
```python
from app.solve_lib import rack_schema as R
def test_order_and_bands():
    assert R.ORDER[0] == "djfilter" and R.ORDER[-1] == "trim"
    assert "eq" in R.ORDER and "limiter" in R.ORDER
    assert R.EQ_BANDS == [60,170,350,700,1400,3500,7000,14000]
def test_nearest_band_slot():
    assert R.nearest_band_slot(300) == 2     # 350
    assert R.nearest_band_slot(30) == 0      # 60 (lowest slot)
    assert R.nearest_band_slot(9000) == 6    # 7000
def test_dsptype_to_module():
    assert R.DSPTYPE_TO_MODULE["limiter"] == "limiter"
    assert R.DSPTYPE_TO_MODULE["peaking_eq"] == "eq"
    assert "sidechain" not in R.DSPTYPE_TO_MODULE
```
- [ ] **Step 2:** Run → RED. **Step 3:** Implement constants/helpers. **Step 4:** Run → GREEN.
- [ ] **Step 5: Commit** `feat(solve): rack-schema manifest mirror + snake→camel maps`

## Task 2: `solvers.py` — the deterministic solver roster

**Files:** Create `solve_lib/solvers.py` + `tests/solve/test_solvers.py`.

**Interfaces — Produces** one function per move, each `(v: Verdict, analysis: dict, genre: str|None) -> Fix`. Build `Fix(fix_id=f"fix.{v.problem_id}", target={"type":"master","name":"master"}, dsp_chain=[...], expected_outcome=...)`. Every numeric param **clamped** to its `_DSP_PARAM_RANGES` band. Roster (MVP — the master-rack winners):

| solver | fires for slug(s) | `DspOp` | params (from evidence, clamped) |
|---|---|---|---|
| `solve_limiter` | `true_peak_overshoot`, `clipping_count` | `limiter` | `ceiling_db` = genre `loudness.{ctx}.true_peak_dbtp_max` (default −1.0); `release_ms` 100; `lookahead_ms` 2 |
| `solve_loudness_trim` | `loudness_vs_target` **only when too loud** (`lufs > target`) | `gain` | `gain_db` = clamp(target − lufs, −24, 0) |
| `solve_eq_cut` | `mud_buildup`, `harsh_upper_mid` | `peaking_eq` | `frequency_hz` = band center (mud≈300, harsh≈3500); `gain_db` = −min(evidence delta/2, 6); `q` 1.0 |
| `solve_eq_boost` | `dull_no_air`, `thin_low_end` | `high_shelf`/`low_shelf` | `frequency_hz` (air≈10000 shelf, thin≈80 shelf); `gain_db` +min(deficit, 4); `q` 0.7 |
| `solve_highpass` | `sub_rumble` | `high_pass` | `frequency_hz` 30; `slope_db` 24 |
| `solve_stereo` | `over_widened`, `phantom_width` | `stereo_width` | `width_pct` = pull toward genre ceiling (e.g. 90) |

Non-MVP / other tiers (`stem_clash`, `stem_balance`, `over_compression`, `channel_imbalance`, MIDI problems) are **not solved here** — the router leaves them unrouted (Task 3), and/or the compiler diverts them to leftover advice (Task 4). `over_compression`/`loudness_war` "un-squash" isn't a master-rack move → leftover advice.

- [ ] **Step 1: Failing test** (one assertion per solver — fix validates + params in range). Example:
```python
from app.solve_lib.solvers import solve_limiter
from app.verdict_lib.rule_engine import _problem
from app.verdict_lib.validator import validate_verdict
from aimusic_shared.verdicts.models import Evidence
def test_solve_limiter_builds_valid_fix():
    a = {"track_id":"t","phase1":{"true_peak_db":0.4},"phase2":{"genre":"techno"}}
    v = _problem(track_id="t", slug="true_peak_overshoot", severity="severe", category="clipping",
                 headline="h", summary="s", why_it_matters="w",
                 evidence=[Evidence(metric="phase1.true_peak_db", value=0.4, label="x")])
    fix = solve_limiter(v, a, "techno")
    assert fix.dsp_chain[0].type == "limiter"
    assert -6.0 <= fix.dsp_chain[0].params["ceiling_db"] <= 0.0
    v2 = v.model_copy(update={"fix": fix})
    assert validate_verdict(v2, a).ok
```
- [ ] **Step 2:** RED → **Step 3:** implement each solver (clamp helper `_clamp(x,lo,hi)`; genre targets via `genre_config.ppath`) → **Step 4:** GREEN (cover every solver: fires + valid + in-range).
- [ ] **Step 5: Commit** `feat(solve): deterministic solver roster (limiter/gain/eq/highpass/stereo)`

## Task 3: `router.py` — route → fan-out → merge

**Files:** Create `solve_lib/router.py` + `tests/solve/test_router.py`.

**Interfaces — Produces:**
- `ROUTE_TABLE: dict[tuple[str,str], str]` keyed `(category, data_tier)` → solver name. MVP audio_only routes: `("clipping","audio_only")→limiter`, `("loudness","audio_only")→loudness_trim`, `("frequency_balance","audio_only")→eq`, `("low_end","audio_only")→eq_or_highpass`, `("stereo_field","audio_only")→stereo`. Stems/project_midi keys absent in MVP.
- `route(v: Verdict) -> str | None` — returns solver name; `None` ⇒ unsolvable/wrong-tier (left for leftover advice). Observations (`fixable is False`) → `None`.
- `merge(problems: list[Verdict], analysis, genre) -> list[Verdict]` — for each routed problem, call its solver, attach `.fix`; pass through unrouted/observations unchanged (`.fix` stays None). (Fan-out for multi-domain — e.g. a kick/bass low_end with stems = EQ + sidechain — is a **stems**-tier concern; in the audio_only MVP `merge` is 1-solver-per-problem. Leave a documented `_fan_out` hook returning `[primary]` for now.)

- [ ] **Step 1: Failing test**
```python
def test_route_by_category_and_tier():
    assert route(_p("clipping","audio_only")) == "limiter"
    assert route(_p("frequency_balance","audio_only")) == "eq"
    assert route(_p("humanization","project_midi")) is None      # not in MVP table
def test_observations_not_routed():
    assert route(_p("harmonic","audio_only", fixable=False)) is None
def test_merge_attaches_fixes_only_to_routed():
    out = merge([clipping_problem, observation_problem], analysis, "techno")
    assert next(p for p in out if p.category=="clipping").fix is not None
    assert next(p for p in out if not p.fixable).fix is None
```
- [ ] **Step 2:** RED → **Step 3:** implement → **Step 4:** GREEN.
- [ ] **Step 5: Commit** `feat(solve): deterministic router (route/merge by category+data_tier)`

## Task 4: `preset_compiler.py` — `Fix[]` → rack `Chain`

**Files:** Create `solve_lib/preset_compiler.py` + `tests/solve/test_preset_compiler.py`.

**Interfaces — Produces** `compile_preset(verdicts: list[Verdict], *, base: dict|None=None) -> dict` returning `{"chain": Chain, "leftover_advice": [...], "change_log": [...]}`. Stages (per `PRPs/identifiers/preset-compiler.md`):
1. **Filter:** keep fixes with `target.type in {master,bus}`; divert `stem` + any `sidechain`-bearing fix → `leftover_advice` (instruction preserved).
2. **Translate:** each `DspOp` → module via `rack_schema.DSPTYPE_TO_MODULE` + `PARAM_MAP`; EQ ops assign to a band slot (`nearest_band_slot`, write exact `freq`+`gainDb`+`q`+`type`, log the snap); `stereo_width`→`ms.width = width_pct/100`; `multiband_compressor`/`sidechain`→leftover advice.
3. **Dedup/merge per module:** ONE instance each — all `limiter` fixes collapse into one `limiter` (param conflict → highest `confidence` then `priorityScore` wins; log the others as "also suggested"); EQ is additive across band slots, but same-slot collision → larger-magnitude `gainDb` wins (cap [−24,24]).
4. **Order:** start from `base` (or the default all-disabled chain), set touched modules `enabled=true` + write params, **never reorder** `ORDER`.
5. **Output:** the `chain` + `leftover_advice` (problem_id, reason, instruction) + `change_log` (module, change, from_fix, why).

**Critical test (from the spec):** four different limiter fixes for one clipping issue must collapse to a single `limiter` module — not four.

- [ ] **Step 1: Failing tests** — (a) one EQ cut + one limiter → `chain.modules.eq.bands[slot]` written + `chain.modules.limiter.enabled` + others disabled; (b) four limiter fixes → exactly one `limiter` module, change_log notes the merge; (c) a `sidechain`/`stem` fix → `leftover_advice`, not in chain; (d) `chain.order == rack_schema.ORDER`.
- [ ] **Step 2:** RED → **Step 3:** implement → **Step 4:** GREEN.
- [ ] **Step 5: Commit** `feat(solve): preset compiler — Fix[] → rack chain (+leftover advice, change log)`

## Task 5: `solve()` orchestrator + real-payload smoke

**Files:** Modify `solve_lib/__init__.py`; add `tests/solve/test_solve_end_to_end.py`.

**Interfaces — Produces** `solve(problems: list[Verdict], analysis: dict) -> dict` = `compile_preset(merge(problems, analysis, genre))`, where `genre = analysis.get("phase2",{}).get("genre")`.

- [ ] **Step 1: Failing test** — feed 2–3 hand-built problems (clipping + mud + over_widened) through `solve`; assert a valid `chain` with `limiter`+`eq`+`ms` enabled and a non-empty `change_log`.
- [ ] **Step 2:** RED → **Step 3:** implement → **Step 4:** GREEN.
- [ ] **Step 5: Smoke** against the real payload's problems:
```bash
cd components/worker && python - <<'PY'
import json
from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.rule_engine import evaluate_problems
from app.solve_lib import solve
fj = json.load(open("../../output/analysis/2026-06-25_latest-final-json/final_json.full.json"))
a = {**flatten(fj), "track_id":"smoke"}
out = solve(evaluate_problems(a), a)
print("enabled modules:", [m for m,s in out["chain"]["modules"].items() if s.get("enabled")])
print("leftover:", len(out["leftover_advice"]), "change_log:", len(out["change_log"]))
PY
```
Expected: a valid chain, no exceptions.
- [ ] **Step 6: Commit** `feat(solve): solve() orchestrator (problems → rack chain) + smoke`

- [ ] **Final gate:** `python -m pytest tests/solve/ -q` · `python -m ruff check app/solve_lib/` · `python -m mypy app/solve_lib/ --ignore-missing-imports` — all green.

**Phase 1 deliverable:** `solve()` returns a valid rack `chain`. You can wrap it as `{name, source:"analysis", chain, schemaVersion:1}` and hand-import it via the Listen rack's `parseImportEnvelope` — usable before any Phase 2 wiring.

---

# PHASE 2 — Persist + surface (gated; do with explicit go-ahead)

Turns the Phase-1 `chain` into a saved, loadable `RackPreset` and a "Generate fix rack" action. Cross-subsystem; sequence as its own slice.

**Key facts (verified) + gotchas:**
- `RackPreset` is **version-scoped** (`song_version_id`, no `user_id`) with `source` CHECK `user|coach|analysis`; `chain_json` jsonb. A generated rack = a row with `source='analysis'`, `song_version_id = <the analyzed version>`, `chain_json = <compiled chain>`.
- **`GET /versions/{versionId}/rack/presets` filters `source='user'`** — analysis presets won't appear there. Phase 2 needs a **new read path** (a `?source=analysis` filter or a dedicated route) + the frontend surfacing it separately from the user's personal library.
- The worker needs a **`RackPreset` ORM mirror** in `aimusic_shared.models` (same EF→ORM discipline as the Verdict reconcile) to write the row, OR the actor returns the chain and the BFF persists it.

**Tasks (outline):**
1. **`RackPreset` ORM mirror** in `aimusic_shared/models.py` (mirror the EF entity: id, song_version_id, name, source, chain_json, created_at, updated_at). TDD column check.
2. **Worker actor `generate_fix_rack(analysis_id)`** (queue `analysis-paid`): load the analysis + its persisted `rule_engine` problems (verdicts where `source='rule_engine'`), `solve(...)`, persist `RackPreset(source='analysis', song_version_id, name="Fix rack — <song>", chain_json=chain)`. Idempotent (one analysis preset per analysis/version — upsert or skip-if-exists). Best-effort.
3. **BFF dispatch + read**: `POST /reports/{jobId}/fix-rack` (enqueue the actor via `IJobQueue`) returning a job/preset handle; extend the rack-presets read with `source=analysis` (new route or filter) + DTO already covers `source`/`chain`.
4. **Frontend**: a "Generate fix rack" action in the results **`actions`** tab (gated on `fixable` problems existing) → POST → poll → "Open in Listen rack" deep-link that loads the `chain` (reuse `useRackPresets`/the rack loader). Surface `leftover_advice` + `change_log` as the coaching layer beside the rack.

**Decision to confirm before Phase 2:** **on-demand** (button → dispatch; recommended) vs **automatic** (a Phase C3 after the Problem engine's Phase C2). On-demand matches the `fixable` CTA and avoids wasted compile.

---

## Out of scope / follow-ons
- **Composite-refiner** (LLM; `PRPs/identifiers/composite-refiner.md`) — sharper `where`-localized problems + `source='llm_identifier'`; needs the LLM budget + Tier-B lifts. The router already tolerates its absence (routes the raw problem).
- **Stems/MIDI solvers** — `sidechain` (kick/bass duck), stem-balance gain, arrangement moves — unlock once stems/.als data is routed (the compiler already diverts stem/sidechain fixes to leftover advice until then).
- **`over_compression`/`loudness_war` un-squash** — not a master-rack move; stays leftover advice (re-master guidance).

## Self-Review
- **Spec coverage:** Solvers (`identify-solve-architecture.md` §5) = Task 2 (MVP subset). Router (`router.md` route/fan-out/merge; suppression already upstream; refine deferred) = Task 3. Preset Compiler (`preset-compiler.md` all 4 stages + leftover advice + change log + the 4-limiter dedup) = Task 4. Persistence/surface = Phase 2.
- **Placeholder scan:** every task carries concrete code/params/commands. Solver param sources + clamp ranges are explicit.
- **Type consistency:** solver output = `Fix`; merge sets `Verdict.fix`; compiler reads `Verdict.fix.dsp_chain[].type/params` and maps via `rack_schema`. `chain` shape matches `features/listen-rack/chain.ts`.
