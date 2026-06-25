# Detection & coaching — spec (v2)

> How we turn measured `final_json` into useful guidance **without homogenizing the artist's work**.
> Two layers: a small **objective-fault guardrail** (genre/profile-agnostic), and **profile-relative
> coaching** that compares a work-in-progress against *the artist's own reference set* (or a generic
> genre fallback), surfaced as intent-aware observations — never as rules to conform to.
> Scope: common upload — mix only, or mix + .als. Grounded in real run `8aeef3b4`. v2: 2026-06-25.

## Philosophy (the correction that drives this)
The goal is to help a producer realize **their** creative vision, not push them toward a generic
genre standard. So the auto-"problem" surface is deliberately tiny, and everything subjective is
compared to **the artist's chosen yardstick**, framed as a question, not a verdict.

- **Targets come from the artist, not a norm.** The comparison profile is the average of the user's
  **reference set** (the tracks *they* want to sound like). A generic per-genre profile is only a
  *fallback* when they haven't set up/analyzed references.
- **Two surfaces, very different tones:**
  1. **Objective faults** — "this will break the delivery of your art regardless of intent" (true-peak,
     clipping, phase cancellation, mono-incompatibility). The *only* things auto-called a problem.
     Flagging them **protects** the vision.
  2. **Profile-relative observations** — "here's where you sit vs your references — intentional?"
     (loudness, tonal balance, width, dynamics). Never auto-"fixed"; the artist decides.
- **Genre is advisory context, never a gate.** Used only to pick a fallback profile when the user has
  no reference set, and never to drive the grade.

## What exists vs. what's new (honest build delta)
**Already built (dormant):**
- Data model: `reference_sets`, `reference_set_members`, `reference_tracks` (BFF entities +
  `aimusic_shared/models.py`). Each analyzed reference stores `lufs, true_peak_db, dynamic_range_lu,
  stereo_width, stereo_correlation, band_levels{7}, bpm, detected_key, duration_seconds`.
- `run_reference_analyzer` actor analyzes a reference via phase1 and persists those columns.
- Comparison logic: **phase5** (per-dimension deltas + severity, + `genre_context` from
  `genre_presets.py`) and **phase6** (mean ± std, `acceptable_range`, `in_range`, percentile, from
  `genre_profile_loader.py`).
- Generic fallbacks: `genre_presets.py` (trance/house/techno/dnb/progressive targets) and
  `data/reference_library/profiles/<genre>_profile.json` (only trance built, 196 tracks).
- Frontend reference-library UI (create sets, add members) + `ReferenceTab`.

**New (the actual work):**
1. **Reference-set aggregation** → a `TargetProfile` (the missing piece). Mean + spread over the
   member `reference_tracks` columns. Small, deterministic.
2. **Pluggable profile source**: resolve the comparison profile as *selected reference set* →
   *genre fallback* → *none (objective-only)*, and feed it to the comparison instead of the
   hard-wired file/genre path.
3. **The objective-fault guardrail** (genre-agnostic), reading correct fields (subsumes the dead
   rule-engine reads; validator-clean; covered by the schema-contract lint).
4. **Reframed output**: profile-relative results are *observations*, not pass/fail verdicts.

## The `TargetProfile` (the "genre marks", computed identically for user-sets and fallbacks)
```python
class TargetProfile(BaseModel):
    source: Literal["reference_set", "genre_fallback"]
    label: str                 # set name, or genre id
    track_count: int
    dims: dict[str, Stat]      # one entry per comparable dimension
# Stat = {mean, spread (std or p10/p90 band), acceptable_range}
```
**Dimensions** (exactly the per-reference columns already stored, so user-sets and fallbacks are
computed the same way):
`lufs · true_peak_db · dynamic_range_lu · stereo_width · stereo_correlation · bpm ·
band_levels.{sub_bass,bass,low_mid,mid,upper_mid,presence,air}` (the 7-band tonal fingerprint — the
most characterful dimension).

**Resolution order** (per analysis):
1. The song's **selected reference set** (≥ N analyzed members) → aggregate to `TargetProfile`.
2. Else a **genre fallback** profile (advisory genre → `genre_presets`/`genre_profile`), clearly
   labelled "genre default, not your references."
3. Else **none** — only the objective-fault guardrail runs; no profile-relative coaching.

## Layer A — objective-fault guardrail (genre/profile-agnostic)
The only auto-"problems." Small, intent-independent, each cites a real `phaseN.*` path. From run
`8aeef3b4`:

| code | condition | sev | run |
|---|---|---|---|
| `true_peak_over_ceiling` | `phase1.true_peak_db > 0` (crit) / `> -1.0` (sev) | crit/sev | **FIRES (crit)** +0.015 dBTP |
| `clipping_present` | `phase1.clipping_detected` (scales w/ sample count) | severe+ | no |
| `phase_cancellation` | `phase1.stereo_correlation < 0.1` | severe | no — 0.994 |
| `mono_incompatible` | `phase1.mono_compatibility < 0.7` | severe | no — 0.998 |
| `mono_fold_risk` | `phase9.surround.mono_compatibility < 70` | severe | no — 99.7 |

(Encoding faults / DC offset / dropouts are future additions in the same bucket.) These never depend
on genre or profile. `crest_factor` (today a dead field) is **computable here** from
`peak_dbfs − 20·log10(rms)` (≈16.4 dB on the run) — available for dynamics observations without a
pipeline change.

## Layer B — profile-relative coaching (vs the artist's references)
For each comparable dimension, compare the WIP mix's phase1 value to the resolved `TargetProfile`
(`in_range` / how far outside the set's spread). Surface as an **observation**, intent-aware:

> *"Your low-mid sits ~4 dB hotter than the average of your reference set 'Peak-time Trance' — that
> can read as congestion. If that warmth is intentional, ignore this; if not, here's where to look."*

Rules of the surface:
- **Never auto-"fix" or fail a track on these.** They are comparisons, not defects.
- **Always name the yardstick** ("vs your set X" or "vs genre default Y").
- Reuse phase5's per-dimension delta + phase6's `in_range`/percentile math — just sourced from the
  resolved profile instead of the hard-wired genre file.
- The LLM **coaching** layer (formerly "prescription") takes these observations + the artist's intent
  and helps them get *their* sound — it does not enforce the profile.

Dimensions surfaced: loudness (`lufs` vs set), dynamics (`dynamic_range_lu`/crest), stereo
(`stereo_width`/`stereo_correlation`), and the **7-band tonal balance** (the richest — where "this is
darker / more sub-heavy / brighter than your references" lives). Spectral **clashes**
(`phase4.clashes[]`) are a hybrid: a HIGH clash (the run has 2) is closer to objective, but still
surfaced as "worth a listen," not an auto-fail.

## Integrity flags (cross-source; not defects)
Catch the cascade so it stops producing artifacts. Capped at info/minor.
- `bpm_octave_mismatch` — `phase1.bpm` ≈ ½·`phase8.tempo` (run: 70.8 vs 141). Explains a wrong
  advisory genre; flag, don't correct.
- `structure_detection_unavailable` — empty `phase1.structure` / phase7 "structure failed" (run:
  fires). **Reframes phase7's bogus CRITICAL "F" as a tooling gap, not a track defect.**

## Output model
```python
class Finding(BaseModel):
    kind: Literal["fault", "observation", "integrity"]   # tone differs sharply by kind
    code: str
    title: str
    category: str
    severity: Literal["critical","severe","moderate","minor","win","info"]
    scope: Literal["full_track","section","als_track","als_project"]
    evidence: list[Evidence]          # real phaseN.* paths
    profile_ref: ProfileRef | None    # for observations: which set/genre, the dim's range + the value
    confidence: float
    needs_coaching: bool              # faults+observations → coaching layer; integrity usually not
```
`kind="fault"` is assertive; `kind="observation"` is always framed against the named profile and
intent; `kind="integrity"` is a quiet "heads-up / measurement caveat."

## Open questions
1. **Aggregation spread** — std vs a p10/p90 band for `TargetProfile.dims`. (Lean p10/p90: robust to
   a couple of outlier references, and matches the existing profile JSON shape.)
2. **Min set size** — how many analyzed members before a set profile is trusted vs. falling back?
3. **Per-song reference-set selection** — does a song/version already point at a chosen set, or do we
   add that link? (Resolution order needs it.)
4. **Genre fallback parity** — build the missing `house/techno/dnb` profiles by running the same
   aggregation over `data/reference_library/<genre>/`, so fallbacks and user-sets are computed
   identically (one code path).
5. **`has_humanized_midi` vs quant-issue count** — reconcile before any als humanization observation.
