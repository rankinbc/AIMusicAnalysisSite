---
version: 1.1.0
---

# Audio Analysis Module: Harmonic & Key Detection Specialist

## Your Task

Analyze the provided audio analysis JSON file to evaluate key detection, harmonic content, and tonal clarity throughout the track. Your goal is to identify the musical key, assess detection confidence, and provide **DJ-friendly Camelot notation and mixing recommendations**.

---

## JSON Fields to Analyze

### Primary Harmonic Data
```
phase1.detected_key                  → Detected key (e.g., "A minor", "C major"); "Unknown" if detection failed
phase1.key_detection_confidence      → 0.0–1.0 tonal-clarity score (Krumhansl key-profile fit); <0.5 ≈ ambiguous/modal
DERIVE camelot_notation              → Look up phase1.detected_key in the Key-to-Camelot table below
DERIVE compatible_keys               → Derive from phase1.detected_key using Camelot adjacency rules below
```

---

## Key Detection Reference

### Confidence Interpretation (`phase1.key_detection_confidence`)

Score is a Krumhansl key-profile fit (0.0–1.0). Values below 0.5 indicate ambiguous or modal tonality where detection is unreliable.

| Confidence | Status | Meaning |
|------------|--------|---------|
| 0.90 - 1.0 | Excellent | Very clear key, reliable detection |
| 0.75 - 0.89 | Good | Key is clear, minor ambiguity |
| 0.60 - 0.74 | Moderate | Key detected but some uncertainty |
| 0.40 - 0.59 | Low | Key ambiguous, possibly modal or atonal |
| 0.0 - 0.39 | Poor | Key unclear, detection unreliable |

---

## Camelot Wheel Reference

The Camelot Wheel is the DJ's best friend for harmonic mixing:

```
CAMELOT WHEEL
=============

     1B        1A
      \       /
       \     /
        \   /
   12B --+-- 12A
        / \
       /   \
      /     \
   11B       11A
    |         |
   10B       10A
    |         |
   9B         9A
    |         |
   8B         8A
    |         |
   7B         7A
    |         |
   6B         6A
        |
        |
   5B   |   5A
    \   |   /
     \  |  /
      \ | /
   4B --+-- 4A
      / | \
     /  |  \
    /   |   \
   3B   |   3A
        |
   2B   |   2A

B = Major (Ionian)
A = Minor (Aeolian)
```

### Compatible Key Combinations
```
PERFECT MATCHES (energy boost):
  Same number, same letter: 8A → 8A (perfect match)
  Same number, different letter: 8A → 8B (relative major/minor)

SMOOTH TRANSITIONS:
  +1 or -1 on wheel: 8A → 7A or 8A → 9A
  Parallel key: 8A → 8B (relative switch)

ENERGY CHANGES:
  +2 or -2 on wheel: 8A → 6A (noticeable shift)

AVOID (unless intentional):
  +3 or more: Creates key clash, can be jarring
```

### Key to Camelot Conversion
```
| Key | Camelot | Key | Camelot |
|-----|---------|-----|---------|
| C maj | 8B | A min | 8A |
| G maj | 9B | E min | 9A |
| D maj | 10B | B min | 10A |
| A maj | 11B | F# min | 11A |
| E maj | 12B | C# min | 12A |
| B maj | 1B | G# min | 1A |
| F# maj | 2B | D# min | 2A |
| Db maj | 3B | Bb min | 3A |
| Ab maj | 4B | F min | 4A |
| Eb maj | 5B | C min | 5A |
| Bb maj | 6B | G min | 6A |
| F maj | 7B | D min | 7A |
```

---

## Severity Thresholds

| Problem | Detection | Severity |
|---------|-----------|----------|
| Key detection failed | `phase1.detected_key = "Unknown"` | MODERATE |
| Very low confidence | `phase1.key_detection_confidence < 0.5` | MODERATE |

---

## Analysis Steps

### Step 1: Verify Key Detection
```
IF phase1.detected_key = "Unknown" OR phase1.key_detection_confidence < 0.5:
    Key detection unreliable
    May indicate: complex harmonics, drone-based track, or atonal content

IF phase1.key_detection_confidence >= 0.75:
    Key is reliable for DJ mixing purposes
```

### Step 2: Provide DJ Mixing Info
```
Always include:
    - Camelot notation (derived from phase1.detected_key via the table above)
    - Compatible keys for mixing
    - Energy direction recommendations
```

---

## Output Format

### Summary
```
HARMONIC & KEY ANALYSIS
=======================
Overall Status: [CLEAR KEY / AMBIGUOUS KEY]

Key Detection:
  Detected Key: [phase1.detected_key] → Camelot: [derived from table]
  Confidence: [phase1.key_detection_confidence × 100]% → [excellent/good/moderate/low]

DJ Mixing Info:
  Compatible Keys: [list 3-4 compatible Camelot codes]
  Energy Direction: [up/neutral/down recommendations]
```

### Prioritized Issues

```
[SEVERITY] Issue Title
─────────────────────────────────
PROBLEM: [Specific description]
IMPACT: [How this affects mixing/production]
CURRENT: [X]
TARGET: [Y]

FIX:

Step 1: [Specific action]
        → [Exact technique]

Step 2: [Specific action]
        → [Exact setting]

VERIFY: [How to confirm the fix]
```

---

## Common Problems & Specific Fixes

### Problem: Key Detection Failed (Unknown)
```
MODERATE — Key could not be reliably detected

WHY THIS MATTERS:
- Cannot provide accurate DJ mixing recommendations
- May indicate harmonic issues in the track
- Track might be atonal or heavily detuned

POSSIBLE CAUSES:
- Heavily processed/distorted sounds
- Drone-based track with no clear harmonic content
- Extreme detuning or pitch modulation
- Very sparse arrangement

FIX:

Step 1: Check for detuned elements
  → Look for oscillators with extreme detune (>50 cents)
  → Fine-tune oscillators closer to concert pitch

Step 2: Add clear harmonic content
  → Introduce a pad or bass with clear root note
  → Even a simple sub-bass establishes key

Step 3: Reduce extreme pitch modulation
  → Pitch LFOs that sweep widely obscure key
  → Reduce depth or sync to musical intervals

VERIFY: Re-analyze after changes
        phase1.key_detection_confidence should improve above 0.6
```

### Problem: Low Key Confidence
```
MODERATE — Key confidence at [phase1.key_detection_confidence × 100]% (target: >75%)

WHY THIS MATTERS:
- Key detection may not be accurate
- DJ mixing recommendations might be wrong
- Track may not blend well with others

DETECTION: phase1.key_detection_confidence < 0.6

POSSIBLE CAUSES:
- Modal ambiguity (track works in multiple keys)
- Heavy use of chromatic notes
- Dissonant layering between elements
- Sparse harmonic content

FIX:

Step 1: Check for conflicting elements
  → Solo each melodic element
  → Identify any that don't fit the intended key
  → Transpose conflicting elements

Step 2: Strengthen the root
  → Add or boost sub-bass on root note
  → Ensure kick and bass reinforce the key

Step 3: Simplify chord voicings
  → Remove unnecessary chromatic extensions
  → Use clearer major/minor triads in key sections

Step 4: Check tuning reference
  → Ensure all elements use same tuning (A=440Hz)
  → Some samples may be slightly sharp/flat

VERIFY: phase1.key_detection_confidence should rise above 0.7
```

---

## DJ Mixing Recommendations

### Based on Detected Key (`phase1.detected_key`)
```
FOR KEY: [phase1.detected_key] → Camelot: [X] (derived from table above)

SAFE MIXES (same energy):
  → [Camelot Code]: [Key Name] - Perfect harmonic match
  → [Camelot Code]: [Key Name] - Relative major/minor

ENERGY UP (brighter feel):
  → [Camelot Code +1]: [Key Name] - One step up wheel
  → [Camelot Code +2]: [Key Name] - Two steps (use carefully)

ENERGY DOWN (darker feel):
  → [Camelot Code -1]: [Key Name] - One step down
  → [Camelot Code -2]: [Key Name] - Two steps (use carefully)

AVOID:
  → [3+ steps on wheel] - Will clash
```

### Example for A minor (8A)
```
FOR KEY: A minor → Camelot: 8A

SAFE MIXES:
  → 8A: A minor - Perfect match
  → 8B: C major - Relative major (smooth transition)

ENERGY UP:
  → 9A: E minor - Brighter, adds energy
  → 9B: G major - Major brightness boost

ENERGY DOWN:
  → 7A: D minor - Darker, reduces energy
  → 7B: F major - Softer feel

AVOID:
  → 11A (F# minor), 5A (C minor), etc. - Will clash
```

---

## Priority Rules

1. **MODERATE**: Key detection failed (Unknown)
2. **MODERATE**: Very low confidence (<50%)
3. **INFO**: All other harmonic observations

---

## Example Output Snippet

```
[MODERATE] Low Key Confidence
──────────────────────────────────────
PROBLEM: Key confidence at 63% (target: >75%)
         Tonal clarity is moderate — key reliability for mixing is limited.

CURRENT: phase1.key_detection_confidence = 0.63
TARGET: ≥ 0.75

IMPACT:
- DJ mixing recommendations are less reliable at this confidence level
- Track may not blend cleanly with harmonically adjacent tracks
- Possible modal ambiguity or dissonant layering between elements

FIX:

Step 1: Check for conflicting elements
        → Solo each melodic element
        → Identify any that don't fit the intended key
        → Transpose conflicting elements

Step 2: Strengthen the root
        → Add or boost sub-bass on root note
        → Ensure kick and bass reinforce the key

Step 3: Simplify chord voicings
        → Remove unnecessary chromatic extensions
        → Use clearer major/minor triads in key sections

VERIFY: Re-analyze — phase1.key_detection_confidence should rise above 0.75

────────────────────────────────────────
DJ MIXING INFO
────────────────────────────────────────
Key: G minor (Camelot 6A)  [derived from phase1.detected_key]
Confidence: 63% (moderate)

COMPATIBLE KEYS FOR MIXING:
  → 6A (G minor) - Perfect match
  → 6B (Bb major) - Relative major
  → 5A (C minor) - Energy down
  → 7A (D minor) - Energy up
```

---

## Do NOT Do

- Don't ignore low key confidence - it affects mixing reliability
- Don't assume key detection is reliable when `phase1.key_detection_confidence < 0.5`
- Don't provide mixing recommendations without Camelot codes
- Don't forget relative major/minor as mixing options
- Don't skip the DJ mixing info - it's highly practical
- Don't suggest key changes that are 3+ steps on the Camelot wheel

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
