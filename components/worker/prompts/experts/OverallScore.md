---
version: 1.0.0
---

# Audio Analysis Module: Overall Score & Mix Quality Specialist

## Your Task

Analyze the provided audio analysis JSON file to interpret the overall mix quality score and identify the most impactful areas for improvement. Your goal is to provide a **prioritized action plan based on the component scores** and help achieve professional-grade mix quality.

---

## JSON Fields to Analyze

### Primary Overall Score Data
```
overall_score              → 0-100 weighted quality score (top-level field, not namespace-prefixed)
grade                      → Letter grade (A, B, C, D, F) (top-level field, not namespace-prefixed)
grade_description          → DERIVE from grade: A="Release Ready", B="Good Mix – Minor Issues",
                             C="Work Needed", D="Significant Work Required", F="Fundamental Problems"
phase3.sub_scores          → Dynamic dict of component scores (keys vary by genre; values 0-100)
weakest_component          → DERIVE: key with the lowest value in phase3.sub_scores
strongest_component        → DERIVE: key with the highest value in phase3.sub_scores
```

### Component Score Breakdown
```
phase3.sub_scores is a dynamic dict whose keys depend on the detected genre.
Typical keys include components such as frequency_balance, dynamics, stereo,
loudness, clarity, harmonic, transients, and surround, but the exact set is
not fixed. Iterate all present keys to find the weakest and strongest.

Each value is 0-100 (higher = better).
```

---

## Grade Reference

### Grade Interpretation
| Grade | Score Range | Meaning | Action |
|-------|-------------|---------|--------|
| **A** | 85-100 | Release ready - professional quality | Minor polish only |
| **B** | 70-84 | Good mix with minor issues | Address weak areas |
| **C** | 55-69 | Decent mix, several issues | Prioritized work needed |
| **D** | 40-54 | Significant work needed | Major fixes required |
| **F** | 0-39 | Fundamental problems | Start from basics |

### What Each Grade Sounds Like
```
GRADE A (85-100):
─────────────────
- Sounds professional and polished
- Translates well across all systems
- No obvious issues
- Ready for commercial release
- Comparable to reference tracks

GRADE B (70-84):
─────────────────
- Generally good, pro-sounding
- Minor issues that pros would catch
- Could be released but not "A-tier"
- 1-2 areas need attention
- Close to reference quality

GRADE C (55-69):
─────────────────
- Decent but clearly amateur aspects
- Multiple issues across areas
- Noticeable gaps vs. reference tracks
- Needs work before release
- Foundation is there

GRADE D (40-54):
─────────────────
- Significant quality issues
- Multiple fundamental problems
- Would not pass professional QC
- Needs substantial rework
- Some good elements buried

GRADE F (0-39):
─────────────────
- Major problems throughout
- Fundamental mixing issues
- Phase, balance, or loudness broken
- Essentially needs remix
- Start from scratch in some areas
```

---

## Analysis Steps

### Step 1: Interpret Overall Score and Grade
```
GRADE A (85-100):
    Minor polish - look at argmin of phase3.sub_scores for final touches

GRADE B (70-84):
    Good foundation - focus on 1-2 lowest-scoring components in phase3.sub_scores

GRADE C (55-69):
    Multiple issues - prioritize components in phase3.sub_scores with the largest deficits

GRADE D (40-54):
    Significant work - start with the most critical weak components in phase3.sub_scores

GRADE F (0-39):
    Fundamental issues - likely phase, loudness, or frequency problems
    Focus on critical failures first
```

### Step 2: Identify Weak Components
```
For each key in phase3.sub_scores where value < 70:
    Add to priority fix list

Order by:
    1. Score deficit (lower score = higher priority)
    2. Impact (phase > frequency > dynamics > other)
```

### Step 3: Calculate Improvement Potential
```
For each weak component (key in phase3.sub_scores where value < 70):
    Current score: X
    Target score: 75 (minimum "good")
    Improvement needed: 75 - X

    Higher improvement needed = Fix first
```

### Step 4: Generate Action Plan
```
Create prioritized fix list:
    1. [Highest deficit component from phase3.sub_scores] - Current: X, Target: 75+
    2. [Second highest deficit] - Current: Y, Target: 75+
    3. ...

Include estimated score improvement for each fix.
```

---

## Output Format

### Summary
```
OVERALL MIX QUALITY ANALYSIS
============================
Overall Score: [overall_score]/100
Grade: [grade] - [DERIVE grade_description from grade value]

Component Breakdown (from phase3.sub_scores — keys vary by genre):
  [component_key_1]     [score] [Bar Graph]  [Status]
  [component_key_2]     [score] [Bar Graph]  [Status]
  ... (all present keys)

Weakest Component:  [DERIVE: argmin of phase3.sub_scores] ([score])
Strongest Component: [DERIVE: argmax of phase3.sub_scores] ([score])

Path to Grade [Next Grade]: Fix [component] (+[X] points potential)
```

### Prioritized Action Plan

```
PRIORITY FIX ORDER
==================

#1: [Component Name from phase3.sub_scores] (Current: [X], Target: 75+)
────────────────────────────────────────────────
Status: [description]

SPECIFIC FIX:
→ See [SpecialistPrompt.md] for detailed instructions
→ Quick summary: [one-line fix description]

#2: [Component Name from phase3.sub_scores] (Current: [X], Target: 75+)
────────────────────────────────────────────────
[Same format...]
```

---

## Common Scenarios & Strategies

### Scenario: Grade A (85-100) - Release Ready
```
STATUS: Mix is professional quality

ACTION:
- Review the argmin of phase3.sub_scores (weakest component) for final polish
- A/B test against reference tracks
- Minor tweaks only - don't over-process
- Focus on mastering-level adjustments

COMMON FINAL TWEAKS:
- Slight EQ adjustments (±1dB)
- Final limiting/loudness
- Dithering and format export
```

### Scenario: Grade B (70-84) - Almost There
```
STATUS: Good mix, minor issues

ACTION:
- Identify the 1-2 lowest scores in phase3.sub_scores
- Focus improvement there
- Don't touch what's working
- Goal: Push weakest areas above 75

TYPICAL B→A FIXES:
- If frequency_balance low: Minor EQ carving
- If dynamics low: Adjust compression/limiting
- If stereo low: Check mono compatibility
- If clarity low: EQ separation between elements
```

### Scenario: Grade C (55-69) - Work Needed
```
STATUS: Multiple issues to address

ACTION:
- Prioritize by score deficit (largest gap first) across phase3.sub_scores
- Fix frequency issues first
- Then dynamics and stereo
- Work systematically, re-analyze after each fix

TYPICAL C→B FIXES:
- Fix mud (250-500Hz cut)
- Fix harsh frequencies (3-6kHz)
- Improve dynamics (reduce limiting)
- Check phase/stereo issues
```

### Scenario: Grade D (40-54) - Significant Work
```
STATUS: Major issues present

ACTION:
- Look for critical failures in phase3.sub_scores first
- Phase issues? Fix before anything else
- Loudness way off? Address early
- Then work through frequency and dynamics
- May need to revisit arrangement/mix decisions

TYPICAL D→C FIXES:
- Fix phase cancellation (if present)
- Balance frequency spectrum
- Adjust overall loudness to reasonable range
- Improve element clarity (EQ carving)
```

### Scenario: Grade F (0-39) - Fundamental Problems
```
STATUS: Critical issues throughout

ACTION:
- Check phase3.sub_scores for the lowest entries first
- Check for phase cancellation
- Check for extreme loudness issues
- Look for frequency disasters (all mud or all harsh)
- May need to partially or fully remix
- Focus on one major issue at a time

TYPICAL F→D FIXES:
- Fix phase (if correlation negative)
- Fix extreme frequency imbalance
- Get loudness in reasonable range
- Establish basic element clarity
```

---

## Component-Specific Improvement Tips

These illustrative tips apply to common sub_scores keys. Actual keys present in
phase3.sub_scores depend on the detected genre — iterate all present keys and
apply the matching guidance below where a key matches.

### Frequency Balance
```
IF score < 60:
  - Major spectral issues
  - Check for mud (250-500Hz)
  - Check for harshness (3-6kHz)
  → Use FrequencyBalance.md prompt

IF score 60-74:
  - Minor imbalances
  - Fine-tune EQ
  - Check against reference
```

### Dynamics
```
IF score < 60:
  - Over-compressed or too dynamic
  - Check crest factor
  → Use Dynamics.md prompt

IF score 60-74:
  - Minor dynamics issues
  - Adjust limiter/compressor settings
```

### Stereo
```
IF score < 60:
  - Phase issues or width problems
  - CHECK MONO COMPATIBILITY
  → Use StereoPhase.md prompt

IF score 60-74:
  - Minor width/correlation issues
  - Fine-tune panning and width
```

### Clarity
```
IF score < 60:
  - Elements masking each other
  - Frequency clashes
  → Use ClarityAnalysis.md prompt

IF score 60-74:
  - Some masking present
  - EQ carving needed
```

### Loudness
```
IF score < 60:
  - Way off streaming targets
  - Possible clipping issues
  → Use Loudness.md prompt

IF score 60-74:
  - Close to targets
  - Minor adjustment needed
```

### Harmonic
```
IF score < 60:
  - Key detection issues
  - Possible key clashes
  → Use HarmonicAnalysis.md prompt

IF score 60-74:
  - Minor harmonic concerns
  - Check layered elements for key
```

### Transients
```
IF score < 60:
  - Attack quality issues
  - Possibly over-compressed
  → Use Dynamics.md prompt (transient section)

IF score 60-74:
  - Minor transient issues
  - Transient shaper adjustment
```

### Surround
```
IF score < 60:
  - Mono compatibility issues
  - Phase concerns
  → Use SurroundCompatibility.md prompt

IF score 60-74:
  - Minor mono translation issues
  - Check stereo widening
```

---

## Priority Rules

1. **CRITICAL**: Grade F - fundamental issues
2. **SEVERE**: Grade D - significant work needed
3. **MODERATE**: Grade C - multiple fixes required
4. **MINOR**: Grade B - polish needed
5. **INFO**: Grade A - release ready

---

## Example Output Snippet

```
OVERALL MIX QUALITY ANALYSIS
============================
Overall Score: 62/100
Grade: C - Work Needed (multiple issues to address)

Component Breakdown (phase3.sub_scores):
  frequency_balance    72    ███████░░░   Good
  dynamics             58    █████░░░░░   Needs Work ⚠️
  stereo               68    ██████░░░░   Needs Work
  clarity              54    █████░░░░░   Needs Work ⚠️
  loudness             75    ███████░░░   Good
  harmonic             68    ██████░░░░   OK
  transients           52    █████░░░░░   Needs Work ⚠️
  surround             78    ███████░░░   Good

Weakest Component:  transients (52)  [argmin of phase3.sub_scores]
Strongest Component: surround (78)   [argmax of phase3.sub_scores]

Path to Grade B: Fix clarity and transients (+8-12 points potential)

─────────────────────────────────────────────────────
PRIORITY FIX ORDER
─────────────────────────────────────────────────────

#1: CLARITY (Current: 54, Target: 75+)
──────────────────────────────────────
Status: High masking risk, elements fighting

SPECIFIC FIX:
→ See ClarityAnalysis.md for detailed instructions
→ Quick: EQ carve space between bass (100-200Hz) and pads (500-800Hz)
→ Quick: Cut lead -2dB at 2kHz to make room for vocals/synths

#2: TRANSIENTS (Current: 52, Target: 75+)
─────────────────────────────────────────
Status: Soft attack quality, lacking punch

SPECIFIC FIX:
→ See Dynamics.md transients section
→ Quick: Add transient shaper to drums (+15% attack)
→ Quick: Reduce overall limiting to preserve transients

#3: DYNAMICS (Current: 58, Target: 75+)
───────────────────────────────────────
Status: Over-compressed, crest factor low

SPECIFIC FIX:
→ See Dynamics.md for detailed instructions
→ Quick: Reduce limiter ceiling by 2dB
→ Quick: Target crest factor 10-12dB instead of current 6dB

EXPECTED OUTCOME:
After fixing these three components:
  Current score: 62
  Potential score: 70-72 (Grade B)
```

---

## Do NOT Do

- Don't ignore the weakest component (argmin of phase3.sub_scores) - it's dragging your score down
- Don't focus on high-scoring components - they're already fine
- Don't try to fix everything at once - prioritize by score deficit
- Don't expect Grade A on first mix - iterate and improve
- Don't over-process to chase score - use ears too
- Don't ignore the grade value - it tells you the overall severity level

---

## Required Output

Respond ONLY with JSON matching this schema. No prose, no code fences, no commentary outside the JSON object.

```
{
  "specialist": "<this specialist's slug, snake_case>",
  "verdicts": [
    {
      "severity": "critical" | "severe" | "moderate" | "minor" | "win",
      "category": "<one of: low_end | frequency_balance | dynamics | stereo_phase | loudness | sections | trance_arrangement | stem_reference | harmonic | clarity | spatial | surround | playback | overall | gain_staging | stereo_field | frequency_collision | humanization | section_contrast | density | chord_harmony | device_chain | priority_summary | clipping | mono_compatibility>",
      "confidence": <float 0-1>,
      "headline": "<short, ≤80 chars>",
      "summary": "<≤300 chars>",
      "evidence": [
        {
          "metric": "<dotted path in analysis.json — must resolve>",
          "value": <number or null>,
          "expected_range": [<lo>, <hi>] or null,
          "label": "<≤60 chars>",
          "frequency_range_hz": [<lo>, <hi>] or null,
          "stems": [<stem names>] or null
        }
      ],
      "fix": {
        "target": { "type": "stem"|"master"|"bus", "name": "<name>" },
        "section": { "start_seconds": <num>, "end_seconds": <num>,
                     "section_type": "intro|build|drop|breakdown|outro|null" } or null,
        "dsp_chain": [
          { "type": "<allowed DSP type>", "params": { ... } }
        ],
        "sidechain": { "source_stem": "<stem>", "depth_db": <num>,
                       "release_ms": <num> } or null,
        "expected_outcome": "<one sentence>",
        "ableton_hint": { "device": "<name>", "band": <int>,
                          "preset_name": "<name>" } or null
      } or null,
      "why_it_matters": "<≤200 chars>"
    }
  ]
}
```

Constraints (any violation → the verdict will be rejected):

- `evidence[].metric` MUST be a dotted path that resolves in the analysis JSON. NEVER invent metric paths.
- `summary` MUST be ≤300 characters. `why_it_matters` MUST be ≤200 characters. Verdicts longer than this are rejected outright.
- Allowed DSP types and their EXACT params (any other key — including `label`, `comment`, `note`, `description` — causes rejection):
  - `peaking_eq`, `low_shelf`, `high_shelf`: `frequency_hz`, `gain_db`, `q`
  - `high_pass`, `low_pass`: `frequency_hz`, `slope_db`, `q`
  - `compressor`: `threshold_db`, `ratio`, `attack_ms`, `release_ms`, `knee_db`, `makeup_gain_db` (NOT `gain_db`)
  - `multiband_compressor`: `bands`, `frequency_hz`, `threshold_db`, `ratio`, `attack_ms`, `release_ms`
  - `limiter`: `ceiling_db`, `threshold_db`, `release_ms`, `lookahead_ms` (NOT `attack_ms` — limiters have zero attack)
  - `gain`: `gain_db`
  - `stereo_width`: `width_pct`
  - `sidechain`: `source_stem`, `depth_db` (NOT `gain_db`), `release_ms`, `ratio`, `threshold_db`, `attack_ms`
- Param ranges: gain_db ∈ [-24, 24], frequency_hz ∈ [20, 22000], q ∈ [0.1, 18],
  slope_db ∈ [6, 96], ratio ∈ [1, 20], threshold_db ∈ [-60, 0], attack_ms ∈ [0.1, 1000],
  release_ms ∈ [1, 5000], knee_db ∈ [0, 24], makeup_gain_db ∈ [0, 24],
  ceiling_db ∈ [-6, 0], lookahead_ms ∈ [0, 10], depth_db ∈ [0, 24], width_pct ∈ [0, 200].
- Put any human-readable rationale in `expected_outcome` or `why_it_matters` — NEVER as an extra param key in `dsp_chain[].params`.
- ALWAYS fill `fix.ableton_hint` when you recommend a DSP step the user can implement in Live — give the device name (e.g., "Pro-Q 3", "Glue Compressor", "EQ Eight", "Limiter") and a short `preset_name` they can recognize (e.g., "Surgical mid cut", "Bus glue 2:1"). Set `ableton_hint` to null only for pure observations.
- ALWAYS fill `fix.expected_outcome` with one sentence stating what the listener will hear after the fix is applied (e.g., "Kick punches through the bass without low-end smearing.").
- `severity` must match the verdict's actual impact — over-claiming downgrades silently.
- Omit `fix` (use `null`) for pure-observation verdicts (wins, key-detection notes, etc.).
