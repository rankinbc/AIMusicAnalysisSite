# IDENTIFY / SOLVE — analysis-pipeline architecture (ai-analysis-v2)

> The comprehensive design for splitting the music-analysis LLM path into two specialized tiers:
> **IDENTIFY** (diagnose a problem, prove it with a resolvable metric, never propose a fix) and
> **SOLVE** (turn one typed finding into a parameter-exact, data-tier-aware fix). A frozen, validated
> handoff record is the only thing that crosses the boundary.
>
> This unifies three inputs: the incoming "two-group" proposal (`~/Downloads/{README, problem-record.schema,
> identify-low-end-detective, solve-eq-surgeon, solve-sidechain-specialist, worked-example-low-end}.md`),
> and the two specs already in this repo — `PRPs/detection-engine-spec.md` (fault/observation/integrity
> philosophy) and `PRPs/detection-prescription-inventory.md` (data-vs-consumer inventory). Memory:
> *"the baseline burn-down IS the two-engine prescription rewrite."*
>
> Status: **LOCKED — under active implementation.** This is the architecture the team's build
> brief (`PRPs/problem-engine-build-brief.md`) executes against; see "Build status" below.
> Branch: `ai-analysis-v2`. Date: 2026-06-25 (reconciled same day).

---

## Build status — reconciliation (2026-06-25, same day)

This document is **locked** and is the architecture the team builds against —
`PRPs/problem-engine-build-brief.md` cites it as the source of truth (§1, §3, §7, §8).
Reconciled the same day, after the IDENTIFY tier was implemented in parallel (commits
`49822d9..51eb1a5`):

- **IDENTIFY tier — BUILT.** Two-pass Problem engine in
  `components/worker/app/verdict_lib/rule_engine.py` (`@single`/`@composite`/`evaluate_problems`
  + `suppression.py`), genre-relative thresholds via `genre_config.py` +
  `config/{genre-profiles.json,rule-bindings.json}`, the `Verdict` Problem-fields
  (`problem_id/kind/source/data_tier/fixable/suspected/where/refines`), new phase1 metrics
  (`channel_balance/key_estimate/loudness_timeline/sub_30_energy`), and a full test suite.
  Canonical plan: **`PRPs/problem-engine-mixcoach-rules.md`**.
- **SOLVE / router / preset-compiler — PLANNED (net-new, later slices).** See
  `PRPs/identifiers/{router,preset-compiler,composite-refiner,worked-example-refinement}.md`.
  The router (Reconcile → Route → Fan-out → Merge) and preset-compiler (fixes → `rack-preset.json`)
  refine §5–§6 below.

**Terminology:** the implementation calls the handoff record a **"Problem"** (a `Verdict` with the
Problem-fields populated, `fix=null` until SOLVE). That is exactly the **`Finding`** of §3 here —
same object, same fields. Read "Finding ≡ Problem record" throughout.

**Adopted from this design (confirmed in the build brief):** extend the existing `Verdict` in place,
no second record type or table (§8); deterministic faults exempt from the moderate-baseline
downgrade (§7); reuse `validate_verdict` + `_resolve_path` and the `DspOp` 11-type validator
unchanged. DB migration / BFF / frontend remain explicit follow-ons.

**Superseded (removed during reconciliation):** `PRPs/rule-engine-low-mid-mud-revival.md` (revived the
*legacy* `@rule` low-mid path, slated for retirement; the new engine handles mud via `mud_buildup` +
`congested_mix`) and `PRPs/low-end-vertical-slice.md` (the walking-skeleton is moot now the engine is
built — `worked-example-refinement.md` is its live equivalent).

> Sections 0–14 below are the original locked design, preserved as-authored (the build brief
> references them by number). Where reality has advanced past them, the bullets above govern.

---

## 0. Decisions locked (this pass)

| Fork | Decision | Consequence |
|---|---|---|
| **Problem model** | **Merge.** Adopt the repo's typed `Finding{kind: fault\|observation\|integrity}` AND a comprehensive analyst roster. Faults = must-fix (assertive); observations = solver advises in a soft "here's an option vs your references" tone; integrity = quiet heads-up, no solver. | The handoff record carries `kind` **and** the incoming record's `data_tier / fixable / suspected / source / where`. Solver adapts tone by `kind` and target by `data_tier`. |
| **Who detects** | **Deterministic-first.** The expanded rule engine emits most findings straight from real metrics (cheap, always-on, validator-clean by construction). LLM identifiers run **only** for genuine judgment calls the numbers can't settle. | The IDENTIFY tier is mostly Python, not prompts. LLM cost concentrates in SOLVE. The "metric must resolve" guard becomes a non-issue for deterministic findings. |
| **Scope now** | **Design only.** Produce this document; implement later in slices. | Section 12 is a sequenced roadmap, not a work order. The repo already has a drafted low-end vertical slice (incoming docs) to execute first. |

Terminology: **IDENTIFY ≡ detection engine**; **SOLVE ≡ prescription/coaching engine**. The incoming "problem record" ≡ the repo's `Finding`. We standardize on **`Finding`** (the repo name) for continuity, since this lands in the repo.

---

## 1. Why the split is low-risk here (what already exists)

The expensive, scary parts are already built and — surprisingly — already match the incoming design:

| Need | Already in the repo | Cite |
|---|---|---|
| "Every `evidence.metric` must resolve" hallucination guard | `validator.py::_resolve_path` rejects any verdict whose metric path doesn't resolve in `flatten(final_json)`, + a ±10% value-truth check | `worker/app/verdict_lib/validator.py:96` |
| Schema authority to ground against | `schemas/final_json.contract.json` (175 leaves) + `schema_contract.path_resolves()` + a CI ratchet baseline (prompts:0, rules:4, fixtures:20) | `worker/app/verdict_lib/schema_contract.py`, `schemas/_schema_drift_baseline.json` |
| Strict DSP fix validator | Pydantic `DspOp` + `_DSP_PARAM_RANGES` — **exactly the 11 types in the incoming `solve-*` docs, zero deltas**, with param-key whitelist + numeric ranges; fires automatically when a `Fix` is parsed | `shared/aimusic_shared/verdicts/models.py:19-134` |
| A detector that already emits the handoff shape | `rule_engine.py` emits `Verdict(fix=None, evidence=[…], severity, category, …)` — identical to an LLM identifier's record. **But only on the degraded path, and 2 rules are dead.** | `worker/app/verdict_lib/rule_engine.py`, `degraded.py:73` |
| Severity/priority math | `scoring.py` priority formula + the moderate-baseline downgrade | `shared/aimusic_shared/verdicts/scoring.py`, `validator.py:140` |
| Dispatch + persistence + read-back + per-user state | `IJobQueue` (dramatiq), `verdicts` table + `verdict_user_state`, `VerdictDto`, polling hooks | `bff/.../Endpoints/VerdictEndpoints.cs`, `Entities/Verdict.cs`, `frontend/.../api/hooks.ts:490` |
| Profile-relative comparison math + reference infra (dormant) | phase5 deltas, phase6 gaps, `genre_presets.py`, `reference_sets/reference_tracks` entities, `run_reference_analyzer` | per `detection-engine-spec.md §"What exists"` |
| A finished prompt slice to copy | Incoming `identify-low-end-detective.md` + `solve-eq-surgeon.md` + `solve-sidechain-specialist.md` + `worked-example-low-end.md` | `~/Downloads/` |

**Net-new** is therefore: the unified `Finding` contract, promoting deterministic detection to the **healthy** path, the profile-relative observation layer, repointing specialist prompts from "find problems" to "prescribe a fix," a **deterministic router with fan-out/merge** (today's triage is advisory only), and a handful of frontend fields.

---

## 2. The biggest correction the incoming docs need: metric paths

The incoming identifier prompts cite paths that **do not exist**. Grounding is mandatory and already enforced, so these must be fixed before any prompt or rule ships.

| Incoming-doc path | Reality | Use instead |
|---|---|---|
| `phase2.bands.sub.energy_db` | ✗ phase2 only has `{genre, confidence, bpm}` | `phase1.bands.sub_bass` (bare float, mel-dB) or `phase4.band_energy.sub_bass` |
| `phase2.bands.bass.energy_db` | ✗ | `phase1.bands.bass` |
| `phase2.correlation.sub` | ✗ no per-band correlation exists | `phase1.stereo_correlation` (overall scalar only) — **per-band correlation needs a pipeline change** |
| `phase2.tilt` | ✗ no spectral-tilt metric anywhere | derive a tilt proxy from `phase1.bands.*` ratios, **or** emit `phase1.spectral_tilt` |
| `phase1.detected_key` | ✓ exists | — |
| `loudness.lufs_short_term[]` | ✗ no `loudness` namespace, not an array | `phase1.short_term_max_lufs` (scalar), `phase1.momentary_max_lufs`, `phase1.loudness_range_lu`, integrated `phase1.lufs` |
| `phase4.stems.clash_matrix[].{overlap_severity,severity_tier,stem_a,stem_b,band}` | ✓ but **only** with uploaded stems + grouped mode + `status=="ok"`; bare mix → `phase4.stems=={}` | gate on `phase4.stems.status=="ok"`; bare-mix clash is the different `phase4.clashes[]` |
| `phase4.stems.per_stem[]` | ✓ but it's a **dict keyed by role**, not an array | `phase4.stems.per_stem.<role>.<field>` (no `[0]`) |

**Three hard rules for every identifier (rule or LLM), enforced by the existing guards:**
1. Ground against `flatten(final_json)`, never raw `final_json` (prod stores a `phases[]` list; the `phaseN.*` namespace exists only after `flatten_analysis.py`).
2. Every emitted `evidence.metric` must pass `schema_contract.path_resolves()` **and** `validator._resolve_path` (real traversal — the contract lint fails *open* on dynamic prefixes like `per_stem.*`, so the runtime validator is the real backstop).
3. Conditional metrics (stems, reference, `.als`) must be gated on their presence flag, exactly as `input_grounding.py` already does for the current prompts — never grade absent data.

**Safe grounding surface available today** (always present, sample/contract-real): the phase1 scalar set — `lufs, true_peak_db, peak_dbfs, rms, crest_factor, stereo_correlation, stereo_width, mono_compatibility, clipping_detected, clipped_sample_count, key_detection_confidence, spectral_centroid_hz/contrast/flatness, loudness_range_lu, short_term_max_lufs, momentary_max_lufs, transients.*, detected_key, bands.{sub_bass,bass,low_mid,mid,upper_mid,presence,air}` — plus `phase4.band_energy.*`, `phase4.clashes[]`, `phase6.gaps[*].in_range`, `phase7.issues[]`, `phase9.surround/playback/spatial`.

---

## 3. The unified handoff: `Finding`

One frozen, validated object crosses IDENTIFY → SOLVE. Identifiers fill everything **except** `fix`; the solver fills **only** `fix`. Neither can do the other's job — so a bad result is traceable to "wrong diagnosis" or "wrong remedy," never a blend.

```python
class Finding(BaseModel):
    # ---- identity & provenance ----
    finding_id: str          # STABLE across re-runs: "<category>.<slug>.<index>".
                             #   = the incoming "problem_id". Survives user-state (dismiss/apply)
                             #   AND is the correlation key the router/merge uses (NOT category+metric).
    kind: Literal["fault", "observation", "integrity"]   # repo: drives tone + whether a solver runs
    source: Literal["rule_engine", "llm_identifier"]     # incoming: who found it (solver can't tell them apart)
    specialist: str          # slug of the rule or LLM identifier that produced it
    code: str                # stable rule/finding code, e.g. "low_end.kick_bass_mask"
    category: str            # shared vocab: low_end | frequency_balance | dynamics | stereo_phase |
                             #   loudness | clarity | sections | harmonic | stem_* | gain_staging | …

    # ---- rating (ONE-DIRECTIONAL: set once at IDENTIFY, inherited verbatim by SOLVE) ----
    severity: Literal["critical", "severe", "moderate", "minor", "win", "info"]   # +info (new vs today)
    confidence: float        # 0..1; feeds ranking, never suppression

    # ---- diagnosis (NO remedy text anywhere) ----
    title: str               # ≤80 — what's wrong, plainly (= incoming "headline")
    summary: str             # ≤300 — the diagnosis only

    # ---- proof ----
    evidence: list[Evidence] # real phaseN.* paths; MUST resolve (reused guard). Reused Evidence model.

    # ---- localization & data context ----
    where: Where | None      # {section_type, start_seconds, end_seconds}; null when un-localizable
    scope: Literal["full_track", "section", "als_track", "als_project"]   # what a fix would target
    data_tier: Literal["audio_only", "stems", "project_midi"]
                             # THE HINGE: tag to the richest tier the EVIDENCE ACTUALLY USED, not the
                             # richest available. Solver adapts: audio_only→master/bus; stems→named stem.

    # ---- profile context (observations only) ----
    profile_ref: ProfileRef | None   # which reference set / genre fallback, the dim's range + the value

    # ---- routing / solve flags ----
    fixable: bool            # false → skip solver entirely, render with no action card (wins, integrity)
    suspected: bool          # true → judgment call the metrics only hint at; ranking may hold it
    needs_coaching: bool     # faults+observations → coaching layer; integrity usually false

    # ---- the solve slot (written ONLY by the solver) ----
    fix: Fix | None          # null out of IDENTIFY. Reused Fix schema (dsp_chain[] + sidechain + target …).
```

### Semantics of `kind` × `fixable` × tone (the merge in one table)

| `kind` | examples | `fixable` | severity range | solver runs? | solver tone |
|---|---|---|---|---|---|
| **fault** | true-peak over ceiling, clipping, phase cancellation, mono-incompat | true | up to **critical** | yes | assertive: "do this" |
| **observation** | loudness/tonal/width/dynamics vs the artist's references | true | capped at **moderate** | yes | soft: "here's an option vs your set X — if that's intentional, ignore" |
| **integrity** | `structure_detection_unavailable`, `bpm_octave_mismatch` | false | **info/minor** | no | — (quiet heads-up) |
| *win* (a `kind=observation` that's genuinely good) | "low end is tight" | false | win | no | — |

This is the synthesis: the **incoming docs' `data_tier` adaptation** (what data → where the fix lands) composes with the **repo's `kind` tone model** (how assertive). A solver reads both.

### The `Fix` object — reused unchanged (the SOLVE contract)

Keep the existing `Fix` + `DspOp` schema verbatim; it's the specificity-forcing function and it already validates. **Key realization:** one `Fix` carries **both** `dsp_chain[]` *and* `sidechain` *and* `target`/`section` — so a merged multi-domain remedy (EQ carve + sidechain) fits in a **single** `Fix`. Fan-out solvers contribute to one `Fix`; no schema change for the canonical kick/bass case.

```
Fix = { target{type:stem|master|bus, name}, section?, dsp_chain:[DspOp], sidechain?,
        expected_outcome, ableton_hint?, why_it_matters }
DspOp.type ∈ { peaking_eq, low_shelf, high_shelf, high_pass, low_pass, compressor,
               multiband_compressor, limiter, gain, stereo_width, sidechain }   # exact ranges in models.py
```

### Solver output envelope (reattach by `finding_id`)
```json
{ "specialist": "<solver slug>", "fixes": [ { "finding_id": "low_end.kick_bass_mask.0", "fix": { } } ] }
```

---

## 4. TIER 1 — IDENTIFY (detection). Comprehensive analyst roster

Two engines emit the **same** `Finding` shape, distinguished only by `source`.

### 4A. Deterministic detectors (PRIMARY — Python, validator-clean by construction)

Promote the rule engine from the degraded-only path to the **healthy** path and expand it. Organized by what it reads:

**Layer A — objective faults** (`kind=fault`, genre/profile-agnostic, may be critical):

| code | condition (real path) | sev | category |
|---|---|---|---|
| `true_peak_over_ceiling` | `phase1.true_peak_db > 0` crit / `> -1.0` sev | crit/sev | loudness |
| `clipping_present` | `phase1.clipping_detected` (scale w/ `clipped_sample_count`) | severe+ | clipping |
| `phase_cancellation` | `phase1.stereo_correlation < 0.1` | severe | stereo_phase |
| `mono_incompatible` | `phase1.mono_compatibility < 0.7` | severe | mono_compatibility |
| `mono_fold_risk` | `phase9.surround.mono_compatibility < 70` | severe | surround |
| `dc_offset`, `encoding_artifacts`, `abrupt_ending` | *(future, same bucket)* | minor+ | clipping/playback |

**Layer B — profile-relative observations** (`kind=observation`, vs the artist's `TargetProfile`, soft, ≤moderate). For each dimension: compare WIP `phase1.*` to the resolved profile (`in_range`/distance outside spread), attach `profile_ref`:

`lufs` · `dynamic_range_lu`/`crest_factor` · `stereo_width` · `stereo_correlation` · `bpm` · the **7-band tonal balance** `phase1.bands.{sub_bass…air}` (the richest — "darker / more sub-heavy than your references"). Source the profile via the resolution order in §6.

**Harvested measurable findings** (currently emitted but no detector consumes them — `kind=fault` if objective, else `observation`):

`phase4.clashes[]` (spectral clash; HIGH clash → near-objective "worth a listen") · `phase6.gaps[*].in_range=false` (ready-made gap detector) · `phase5.deltas[*].severity≥moderate` (only when reference present) · `phase7.issues[]` (already carry severity + a fix hint) · low-mid mud from `phase1.low_mid_ratio` *(needs emit — §10)* · ALS thresholds from phase8 (clutter %, disabled devices, quantization count) when `.als` present.

**Integrity flags** (`kind=integrity`, info/minor, `fixable=false`, no solver):
`structure_detection_unavailable` (empty `phase1.structure`/phase7 fail — **reframes phase7's bogus CRITICAL "F" as a tooling gap**) · `bpm_octave_mismatch` (`phase1.bpm ≈ ½·phase8.tempo`).

### 4B. LLM identifiers (judgment-only — the SHORT list)

Only where metrics genuinely can't settle it (`suspected=true`, `source=llm_identifier`). These are reframed from today's 26 specialists' **top halves** (the `Severity Thresholds` + `Analysis Steps` sections), with all fix logic stripped:

| identifier | judgment it makes that rules can't | min data |
|---|---|---|
| `low_end_detective` | "kick/bass masking with **no ducking signature**" (inference from coincident loudness, not a direct metric) | audio |
| `over_compression` | "sounds lifeless / over-limited" from low crest + low PLR — a perceptual call | audio |
| `harshness_fatigue` | 2–5 kHz character / ear-fatigue judgment beyond a band number | audio |
| `clarity_masking` | congestion/definition that isn't a single clash row | audio |
| `arrangement_energy` | drop payoff / energy-flow judgment beyond phase7's section scores | audio + sections |
| `tonal_intent` | interpreting whether a tonal skew reads as a style choice vs a problem | audio + profile |
| `stem_clash_judgment` | when the clash matrix is ambiguous between elements | stems |

Everything else the current roster covers (loudness, true-peak, mono, clipping, gaps, clashes, ALS hygiene) becomes **deterministic** and drops out of the LLM identify path.

### 4C. Shared identifier rules
Diagnose only — never a remedy in `title`/`summary`. One problem per record (so "muddy and harsh" = two findings → two fixes). Every record needs ≥1 resolvable `evidence.metric`. Stamp `data_tier` to the evidence actually used. `fix` is always `null`. Don't grade missing data. A `win` is a valid `fixable:false` record.

---

## 5. TIER 2 — SOLVE (prescription). Solver roster by remedy domain

Solvers are organized by **tool, not problem category** — one EQ expert that knows EQ cold beats ten do-everything specialists. Each is an LLM prompt = the **bottom half** ("Common Problems & Specific Fixes" + DSP/Ableton blocks) of today's specialists, reframed to *"here is a confirmed problem with its measured value — prescribe the fix."* All reuse the `Fix`/`DspOp` validator.

| solver | DSP types it owns | takes (categories) | notes |
|---|---|---|---|
| **EQ Surgeon** | peaking_eq, low/high_shelf, high/low_pass | low_end, frequency_balance, clarity, masking | mud 200–500 Hz, harshness 2–5 kHz, air shelf, complementary low-end carve, HP non-bass |
| **Dynamics Engineer** | compressor, multiband_compressor | dynamics (punch, over-compression) | transient/glue; not loudness ceiling |
| **Master / Loudness Engineer** | limiter, gain | loudness, true_peak, clipping | platform targets as **configurable data**; ceiling/PLR |
| **Sidechain Specialist** | sidechain | low_end masking, rhythmic pump | needs separable sources → **stems/project_midi only**; audio_only → hands back to EQ |
| **Stereo Engineer** | stereo_width (+ prose for mono/phase) | stereo_phase, mono_compatibility, surround | phase cancellation is a mono/stereo fix, not EQ |
| **Arrangement Coach** | *(none — empty dsp_chain)* | sections, trance_arrangement, same-note masking | "the fix is mute/move/remove the track"; prose `Fix` |
| **Gain / Routing** | gain | gain_staging | enrich tier (`.als`); names tracks/levels |

**Coverage gaps to decide (§13):** the `DspOp` set has **no saturation/exciter and no de-esser type**. A "saturation/tone" or "de-esser" solver can't emit a typed fix today → either add DSP types or keep those as EQ-handled / coaching prose.

**Shared solver rules:** receive a diagnosis — don't re-diagnose or change `severity`. Be parameter-exact (device, param, value). **Adapt to `data_tier`** (master/bus for audio_only; named stem otherwise — never prescribe a per-stem move at audio_only). **Adapt tone to `kind`** (fault = assertive; observation = "an option vs your references, if not intentional"). State what the producer will hear (`expected_outcome`). Offer the arrangement alternative when DSP is the wrong tool (return empty `dsp_chain` + hand back). Teach one sentence of *why* (`why_it_matters`).

---

## 6. The streamlining system — Router + orchestration

Today's "triage" is an LLM that *suggests* which diagnostic specialists to run; nothing auto-executes (the user clicks each). The revamp replaces it with a **deterministic router** + an **orchestrating actor**.

### 6A. Profile resolution (feeds Layer B observations) — `detection-engine-spec.md §"Resolution order"`
Per analysis: (1) the song's **selected reference set** (≥ N analyzed members) → aggregate member `reference_tracks` columns into a `TargetProfile{source, label, track_count, dims{Stat}}`; else (2) a **genre fallback** profile (labelled "genre default, not your references"); else (3) **none** — only Layer A faults + integrity run, no profile-relative coaching.

### 6B. The router: `Finding → solver(s)` (deterministic map)

Keyed on `(category, kind, data_tier)`. The `@rule`-registry pattern is the model to copy.

| category | data_tier | → solver(s) |
|---|---|---|
| low_end / masking | audio_only | **EQ Surgeon** (no separable sources to sidechain) |
| low_end / masking | stems / project_midi | **Sidechain Specialist** (+ EQ Surgeon fan-out; merge into one `Fix`) |
| low_end (boomy/mud), frequency_balance, clarity | any | **EQ Surgeon** |
| dynamics | any | **Dynamics Engineer** |
| loudness / true_peak / clipping | any | **Master / Loudness Engineer** |
| stereo_phase / mono_compatibility / surround | any | **Stereo Engineer** |
| sections / trance_arrangement / same-note masking | any | **Arrangement Coach** |
| gain_staging | project_midi (.als) | **Gain / Routing** |
| harmonic / key | any | usually `fixable:false` (observation) → no solver |

`kind` gates execution: `integrity` and `fixable:false` skip the router entirely. `observation` routes to the same solver as the equivalent fault but flips the solver's tone flag.

### 6C. Fan-out + merge
The canonical multi-domain case is **kick/bass masking with stems = EQ carve + sidechain**. Router fans out to both solvers; the **merge** step combines their contributions into **one `Fix`** on the shared `finding_id` (dsp_chain from EQ + sidechain from Sidechain Specialist). Either solver may hand back ("not mine") with an empty `dsp_chain`.

> **Critical fix to the existing merge:** `dedupe.py` currently buckets by `(category, primary_metric)` — correct for collapsing duplicate findings, **wrong** for "one problem solved by two domains." Multi-domain merge must key on **`finding_id`**. `_merge_pair` (unions sources/evidence, max priority/confidence) is reusable; only the bucket key changes.

### 6D. Ranking & presentation
Reuse `rank_verdicts` + `compute_priority_score`. Sort by `priority_score`, dedupe by `finding_id`, surface `suspected` findings per a ranking policy (hold low-value suspects). Map to the existing Problems/Actions surface (§9).

### 6E. The orchestrating actor (replaces advisory triage)
New `run_detection` (deterministic detect → persist findings) + `run_solver_plan` (route → fan-out N solvers → merge → persist fixes). Reuse the dramatiq plumbing (`IJobQueue`, actor template) and the dormant `run_specialists` fan-out loop + `orchestrator.run_pipeline` (currently legacy-only — register it in `dramatiq_app.py`). On-demand single-solver re-run stays available (the per-phase-rerun pattern is the model).

---

## 7. Severity & scoring reconciliation

A real defect in today's system the split must fix:

- The validator's **moderate-baseline downgrade** caps **every** LLM verdict below critical — the max reachable band is *severe*, and only for clipping (weight 1.5 × moderate 70 = 105). Everything else collapses to *moderate*. Rule-engine `critical`/`severe` survive **only because the degraded path skips the validator.**
- The downgrade exists to stop an LLM **self-inflating** severity via category weight. In the split, **severity is set at IDENTIFY and the solver never touches it** — so the inflation vector differs by `source`:
  - **Deterministic findings**: severity comes from a measured threshold, no self-justification → **trusted, exempt from the downgrade.** Faults can be `critical`.
  - **LLM-identifier findings**: keep a downgrade-style guard (an identifier could still over-claim).
  - **Solver**: inherits `severity` verbatim; may never change it.
- Add **`info`** to the severity Literal (the `Finding` model needs it; today's `Verdict.severity` lacks it) and to `scoring.severity_from_score`.
- `observation` severity is capped at `moderate` regardless of category weight (they're comparisons, not defects).

---

## 8. Persistence & data model

**Recommendation: extend the existing `verdicts` table into the unified `Finding` record — do NOT add a second table.** The current `Verdict` already fuses problem + fix and the rule engine already emits the shape; the "split" is conceptual (IDENTIFY writes the row with `fix=null`; SOLVE updates `fix` in place, keyed by `finding_id`). This reuses read-back, `verdict_user_state`, dedupe, and the DTO with minimal churn.

New columns on `verdicts` (+ EF entity + `aimusic_shared` model + DTO): `finding_id`, `kind`, `source`, `code`, `data_tier`, `fixable`, `suspected`, `needs_coaching`, `where` (jsonb), `profile_ref` (jsonb), `failure_stage` (`identify|solve|null`). `severity` gains `info`.

Two assumptions to revisit: the **"409 if a verdict exists for `(analysis, slug)`"** guard and **"one row per specialist"** both break when one finding can be re-solved or fan-out produces multiple solver contributions — re-key these on `finding_id` and treat the solver as an in-place `fix` update, not a new row. Fold in the decided-but-unbuilt **version-stamping** (`memory: project_version-analyses-followup`): stamp findings with rule/identifier/solver/validator versions so historical recompute + regression detection work.

---

## 9. Frontend contract

The current UI already handles most of it (per the BFF+frontend audit): observation-only via null `fix`, dismissed/applied/feedback, degraded banner + rule-engine non-empty fallback, per-specialist loading/failed, impact bands. The Actions/`MoveCard` layer even has `isRule`/`source`/`hasParams`.

Net-new for the frontend:
- Surface the new `Finding` fields: `kind` (fault/observation/integrity styling), `fixable` (authoritative "no action card" — today it's *inferred* from `fix?.dsp_chain?.length`, and the Apply/Dismiss row still renders for fix-less verdicts), `suspected`, `data_tier`, `source`, `profile_ref` ("vs your set X" copy for observations), `where`.
- **Split the single string-keyed "failed" sentinel into identify-failed vs solve-failed** (`failure_stage`), replacing the `Headline == "Specialist failed"` sniff in all three places (`VerdictEndpoints.cs:97`, `VerdictCard.tsx:22`, `SpecialistTile.tsx:71`). This unlocks "re-run just the solver on an already-diagnosed problem."
- Coordinate with the `analysis-results-ui` branch (the results-UI refactor + `Phase1Data` TS types live there, not on `master`/`ai-analysis-v2`) before doing frontend work, to avoid divergence.

---

## 10. Pipeline metric additions required

Minimize new emits; ground on what exists. Needed:
1. **`phase1.low_mid_ratio`** — fraction of spectral energy 200–500 Hz (0–1), reusing the STFT already computed for `low_energy`. Revives the 2 dead mud rules (`phase1.bands.low_mid` is dB-normalized-to-peak, NOT a genre-comparable ratio, so it can't back the `0.20/0.25` thresholds). **This is the stashed `rule-engine-low-mid-mud-revival.md` draft — do it first (§12 Phase 0).**

Optional / only if the slice proves they're needed (otherwise rewrite identifiers to existing metrics):
2. `phase1.spectral_tilt` — if a real tilt metric beats a band-ratio proxy.
3. per-band correlation (e.g. `phase1.sub_correlation`) — the incoming Low-End Detective wants sub-band phase; today only overall `phase1.stereo_correlation` exists.

Every new metric: add to the emitter, regenerate `final_json.contract.json`, and burn down its baseline line so the path-lint covers it.

---

## 11. Failure model

Distinct, typed failure stages (vs today's one sentinel):
- **identify-failed** — a rule raised, or an LLM identifier returned malformed JSON / no resolvable evidence. The finding doesn't exist; nothing to solve.
- **solve-failed** — the finding is valid but the solver failed (bad JSON, DSP validation reject, hand-back). The diagnosis stands; **re-run only the solver.**
Partial tolerance everywhere (per-finding try/except), matching the worker's existing 3-phase tx + fail-marker discipline. `failure_stage` drives the UI.

---

## 12. Roadmap (for later — design-only now)

- **Phase 0 — prerequisite.** Land the stashed `phase1.low_mid_ratio` revival → rule baseline to 0, giving IDENTIFY a fully-live deterministic floor. (Small, isolated, already drafted.)
- **Phase 1 — the `Finding` contract + healthy-path detection.** Extend the `Verdict` model/table to the unified record; promote `rule_engine` to the healthy path; add Layer A faults + integrity + the harvested measurable findings (`phase4.clashes`, `phase6.gaps`, `phase7.issues`, `phase5.deltas`). All validator-clean.
- **Phase 2 — vertical slice (proves the whole pipeline).** Move the incoming `low_end_detective` (LLM identifier, **repathed to real metrics**) + `eq_surgeon` + `sidechain_specialist` solvers into the repo; wire detect → router → fan-out/merge → render for low-end only, end-to-end, on real run data. This is the de-risking milestone — the incoming `worked-example-low-end.md` is the acceptance fixture (audio_only → EQ; stems → sidechain).
- **Phase 3 — profile-relative observations.** `TargetProfile` aggregation + pluggable profile resolution (Layer B) over the dormant reference infra.
- **Phase 4 — replicate solvers + router** across remaining domains (tonal→EQ, dynamics→Dynamics, loudness→Master, stereo→Stereo, arrangement→Arrangement Coach). Cheap once the contract is fixed.
- **Phase 5 — the short LLM-identifier list** (§4B) for the remaining judgment calls.
- **Phase 6 — frontend** (new fields, `failure_stage` split, observation tone) — coordinated with `analysis-results-ui`.
- **Cross-cutting:** severity reconciliation (§7), version-stamping (§8), schema-contract lint coverage for every new path.

---

## 13. Open questions (decide before/within implementation)

1. **Saturation & de-esser have no DSP type.** Add `saturation`/`de_esser` to `DspOp` (+ ranges), or keep them as EQ-handled / coaching prose? (Affects the solver roster in §5.)
2. **One finding per signal vs pre-merge** correlated signals (mono + correlation + width → one "stereo field" finding) before routing? Affects dedupe placement. (Repo open Q.)
3. **`TargetProfile` spread** — std vs p10/p90; **min reference-set size** before a set profile is trusted vs falling back; does a song/version already link to a chosen reference set, or add that link? (Repo open Qs 1–3.)
4. **Genre-fallback parity** — build `house/techno/dnb` profiles by the same aggregation so user-sets and fallbacks share one code path. (Repo open Q 4.)
5. **Audio-only masking router policy** — route straight to EQ, or fan out to Sidechain + EQ and let Sidechain hand back? (Incoming README open call; the worked example shows both converge.)
6. **Reliability of `phase6.gaps` / `phase5.deltas`** numerically before leaning on them (phase6 has profile-vs-per-track fallback shapes).
7. **Where `suspected` findings surface** in the UI (hold vs show). (Incoming README open call.)
8. **`has_humanized_midi` vs quantization-issue count** — reconcile before any ALS humanization observation. (Repo open Q 5.)

---

## 14. Appendix — source-doc cross-reference

- Incoming proposal & slice: `~/Downloads/README.md`, `problem-record.schema.md`, `identify-low-end-detective.md`, `solve-eq-surgeon.md`, `solve-sidechain-specialist.md`, `worked-example-low-end.md`.
- Repo specs this builds on: `PRPs/detection-engine-spec.md`, `PRPs/detection-prescription-inventory.md`, `PRPs/schema-contract-prevention-design.md`.
- Shipped foundation: `PRPs/archive/2026-06-25_prompt-schema-reconciliation.md` (11 EMIT metrics + 175-leaf contract), `…_rule-engine-tier1-field-fixes.md`.
- Pending prerequisite: `rule-engine-low-mid-mud-revival.md` (currently stashed on this worktree).
- Key code anchors: `worker/app/verdict_lib/{rule_engine,validator,schema_contract,degraded,dedupe,orchestrator,specialists,triage_actor,verdict_actor}.py`, `shared/aimusic_shared/verdicts/{models,scoring}.py`, `bff/.../Endpoints/VerdictEndpoints.cs`, `bff/.../Entities/{Analysis,Verdict,VerdictUserState}.cs`, `frontend-spectr-v2/src/features/results/*`.
</content>
</invoke>
