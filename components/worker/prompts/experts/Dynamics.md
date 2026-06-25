---
version: 2.0.0
---

# Audio Analysis Module: Dynamics Specialist

## Your Task

Analyze the provided audio analysis JSON file to evaluate dynamic range, punch, transients, and compression. Your goal is to identify dynamics problems that cause weak, flat, or over-compressed mixes, and provide **specific compression settings and transient shaping recommendations**.

---

## JSON Fields to Analyze

### Primary Dynamics Data
```
phase1.peak_dbfs                → Should be around -1 to -3 dBFS
phase1.rms                      → Linear amplitude; RMS in dB = 20·log10(phase1.rms)
phase1.crest_factor             → Peak − RMS in dB (higher = more dynamic)
                                   DERIVE is_over_compressed: phase1.crest_factor < 8
                                   DERIVE interpretation: <4 squashed, 4–8 over-compressed,
                                   8–14 healthy, 14–22 dynamic, >22 very wide
```

### Transient Data
```
phase1.transients.transient_count           → How many transients detected
phase1.transients.transients_per_second     → Activity/punch density
phase1.transients.avg_transient_strength    → 0–1 scale (higher = punchier)
                                               DERIVE attack_quality label:
                                                 ≥0.6  → "punchy"
                                                 0.3–0.6 → "average"
                                                 <0.3  → "soft"
```

### Section Data (if available)
```
phase7.section_scores[].section_type        → Section role (intro, buildup, drop, breakdown, outro)
phase7.section_scores[].start_time          → Section start (seconds)
phase7.section_scores[].end_time            → Section end (seconds)
phase7.section_scores[].score               → Section quality score (0–100)
phase7.metadata.energy_contrast_db          → Overall energy contrast between sections (dB)
phase7.metadata.has_drop                    → Boolean: drop section detected
phase7.metadata.has_breakdown               → Boolean: breakdown section detected
```

Note: Per-section RMS and transient-density values are not emitted by the pipeline.
Use `phase7.metadata.energy_contrast_db` for overall contrast assessment and
`phase7.section_scores[].section_type` to identify which sections are present.

### Clipping Data
```
phase1.clipping_detected                    → True = pushed too hard
phase1.clipped_sample_count                 → Number of clipped samples (severity)
```

---

## Dynamics Targets for Trance

| Metric | Target Range | Below Target | Above Target |
|--------|--------------|--------------|--------------|
| Crest factor | 8-12 dB | Over-compressed | Too dynamic |
| Peak level | -3 to -1 dBFS | Too quiet | Clipping risk |
| Attack quality (derived) | "punchy" | Transients squashed | — |
| Transient strength | 0.5-0.8 | Weak punch | — |

### Section Energy Relationships
```
Reference: DROP = 0 dB (loudest section)

Intro:      -10 to -14 dB from drop
Buildup:    -6 to -10 dB, INCREASING toward drop
Drop:       0 dB (reference / loudest)
Breakdown:  -6 to -10 dB from drop
Outro:      -10 to -14 dB from drop

Use phase7.metadata.energy_contrast_db as the overall contrast metric.
Target: energy_contrast_db ≥ 4 dB (drop measurably louder than surrounding sections).
```

---

## Severity Thresholds

| Problem | Detection | Severity |
|---------|-----------|----------|
| Severely over-compressed | `phase1.crest_factor < 6` | CRITICAL |
| Over-compressed | `phase1.crest_factor < 8` (derived: is_over_compressed) | SEVERE |
| Weak transients | `phase1.transients.avg_transient_strength < 0.3` (derived: "soft" attack) | SEVERE |
| Clipping detected | `phase1.clipping_detected = true` | SEVERE |
| Excessive clipping | `phase1.clipped_sample_count > 100` | CRITICAL |
| Too dynamic | `phase1.crest_factor > 16` | MODERATE |
| Low section contrast | `phase7.metadata.energy_contrast_db < 4` | MODERATE |

---

## Analysis Steps

### Step 1: Check Crest Factor
```
Read phase1.crest_factor.

IF phase1.crest_factor < 6:
    CRITICAL — Over-compressed to the point of damage
    Transients are destroyed, mix is lifeless

IF phase1.crest_factor < 8:
    SEVERE — Over-compressed, lacking punch
    Mix will sound flat and fatiguing

IF phase1.crest_factor 8-12:
    GOOD — Target range for trance
    Punchy but loud

IF phase1.crest_factor > 16:
    MODERATE — Too dynamic for electronic music
    May sound weak compared to other tracks
```

### Step 2: Check Transients
```
Read phase1.transients.avg_transient_strength and derive attack_quality:
  ≥0.6  → "punchy"
  0.3–0.6 → "average"
  <0.3  → "soft"

IF derived attack_quality = "soft" (phase1.transients.avg_transient_strength < 0.3):
    Transients are being squashed
    Check compression attack times — they're too fast
    
IF phase1.transients.avg_transient_strength < 0.3:
    Weak punch — needs transient enhancement or less compression
```

### Step 3: Check for Clipping
```
Read phase1.clipping_detected.

IF phase1.clipping_detected = true:
    Clipping is present — check phase1.clipped_sample_count for severity
    Usually occurs during drops or kick hits
    Need to reduce level or address peaks earlier in chain
```

### Step 4: Check Section Contrast (if data available)
```
Read phase7.metadata.energy_contrast_db (if phase7 data is present).

IF energy_contrast_db < 4:
    Not enough contrast — drop won't hit
    
IF energy_contrast_db > 10:
    Breakdown may be too quiet relative to drop
```

---

## Output Format

### Summary
```
DYNAMICS ANALYSIS
=================
Overall Status: [PUNCHY / NEEDS WORK / OVER-COMPRESSED / TOO DYNAMIC]

Dynamics Measurements:
  Peak level: [X] dBFS → [interpretation]
  RMS level: [X] dBFS → [interpretation]
  Crest factor: [X] dB → [interpretation]
  Attack quality: [derived from phase1.transients.avg_transient_strength] → [interpretation]
  Transient strength: [X] → [interpretation]

Section Energy:
  Energy contrast: [phase7.metadata.energy_contrast_db] dB → [OK/needs contrast]
  Drop detected: [phase7.metadata.has_drop]
  Breakdown detected: [phase7.metadata.has_breakdown]
```

### Prioritized Issues

```
[SEVERITY] Issue Title
─────────────────────────────────
PROBLEM: [Specific description with numbers]
IMPACT: [How this affects the listener]
CURRENT VALUE: [X]
TARGET VALUE: [Y]

FIX:

Step 1: [Specific action]
        → [Exact compressor/plugin setting]
        
Step 2: [Specific action]
        → [Exact value]

COMPRESSOR SETTINGS:
  Ratio: [X]:1
  Attack: [X] ms
  Release: [X] ms
  Threshold: [description]
  Target GR: [X] dB
  
EXPECTED RESULT: [What will improve]
```

---

## Common Problems & Specific Fixes

### Problem: Over-Compressed / No Punch
```
SEVERE — Crest factor at [X] dB (target: 8-12 dB)

WHY THIS MATTERS:
- Mix sounds flat, lifeless, fatiguing
- Kick and snare have no impact
- "Loud but boring" syndrome
- Everything at the same level = nothing stands out

DETECTION: phase1.crest_factor < 8 (derived is_over_compressed)

FIX:

Step 1: Reduce limiting on master
  → Current limiter gain reduction: likely 8-12dB
  → Target: 3-6dB max gain reduction
  → Reduce limiter input gain by 4-6dB

Step 2: Check individual track compression
  → Drums: Attack time may be too fast (killing transients)
  → Target drum compressor attack: 10-30ms (lets transient through)
  
Step 3: Use parallel compression instead of heavy direct
  → Create a return track with aggressive compression
  → Blend in UNDER the dry signal (adds density, keeps transients)

Step 4: Consider multiband limiting instead of broadband
  → Broadband limiters hit transients hardest
  → Multiband can be gentler on the transient frequencies

COMPRESSOR ADJUSTMENTS:
  Drum bus: Attack 10→30ms, Ratio 4:1→2:1
  Master limiter: Reduce input gain by 4-6dB
  
EXPECTED RESULT: Crest factor should rise to 8-12dB range
                 Kick will punch, snare will crack
```

### Problem: Weak Transients / Soft Attack
```
SEVERE — Derived attack quality is "soft" (phase1.transients.avg_transient_strength at [X])

WHY THIS MATTERS:
- Drums don't hit, kick doesn't punch
- Mix feels weak even at loud levels
- No excitement or energy

DETECTION: phase1.transients.avg_transient_strength < 0.4 (derived attack_quality: "soft")

FIX:

Step 1: Check compressor attack times
  → If attack < 10ms on drums, transients are being squashed
  → Increase attack to 15-30ms (let the transient through)
  → The attack time determines how much punch you keep

Step 2: Add transient shaping
  → Ableton Drum Buss: Transients knob +20-50%
  → Or transient shaper plugin:
    Attack: +3-6dB
    Sustain: 0 to -2dB (optional)

Step 3: Use parallel compression for punch
  → Send drums to return track
  → Heavy compression: Ratio 8:1, Attack 1-5ms, Release 50ms
  → Blend in low (-10 to -6dB below main drums)
  → This adds aggression while main signal keeps transients

Step 4: Check EQ on kick
  → Punch lives at 3-5kHz (click) and 50-80Hz (thump)
  → Boost 2-3dB at 4kHz for more click
  → Make sure these aren't cut

RECOMMENDED SETTINGS:
  Transient shaper: Attack +4dB
  Drum compressor: Attack 20ms, Release 100ms, Ratio 4:1
  Parallel compression blend: -8dB
```

### Problem: Clipping Detected
```
SEVERE — phase1.clipped_sample_count = [X] clipped samples

WHY THIS MATTERS:
- Audible distortion artifacts
- Indicates limiter is being pushed too hard
- Usually happens during drops when everything peaks together

DETECTION: phase1.clipping_detected = true; severity from phase1.clipped_sample_count

FIX:

Step 1: Identify when clipping occurs
  → Clipped samples often cluster during drops or kick hits
  → Listen through the track to locate the loudest moments

Step 2: Reduce the hottest element
  → Usually kick or bass during drops
  → Reduce by 1-2dB
  → Recheck phase1.clipped_sample_count after export

Step 3: Add soft clipping before limiter
  → Saturator (Ableton): Soft Clip mode, Drive 0dB, Output -1dB
  → This catches transients before they hit the limiter
  → Smoother than hard limiting

Step 4: If still clipping, reduce limiter input
  → Reduce master limiter input by 2-3dB
  → Better to be slightly quieter than to clip
```

### Problem: Drops Don't Hit Hard Enough
```
MODERATE — phase7.metadata.energy_contrast_db only [X] dB

WHY THIS MATTERS:
- The drop IS the payoff in trance
- Without contrast, the drop feels weak
- Even if the drop is loud, it won't FEEL loud without contrast

DETECTION: phase7.metadata.energy_contrast_db < 4

FIX:

Step 1: Reduce breakdown energy
  → Remove kick in breakdown (or reduce by 6dB)
  → Filter down bass and low elements
  → Reduce overall breakdown level by 2-4dB (Utility automation)

Step 2: Increase drop energy (carefully)
  → Add parallel compression that engages only in drops
  → Or automate limiter input gain: +1-2dB for drops
  → Don't just make drop louder — make breakdown quieter

Step 3: Use frequency contrast
  → Breakdown: High-pass/filter down (remove low end)
  → Drop: Full frequency spectrum
  → The "opening up" of frequencies creates perceived loudness

Step 4: Check transient density
  → Drop should have MORE transients than breakdown
  → Kick should be punching in drop, absent in breakdown

AUTOMATION TARGETS:
  Breakdown: -6dB from drop, kick muted/quiet, bass filtered
  Drop: Full level, kick punching, bass full
```

### Problem: Mix Is Too Dynamic
```
MODERATE — Crest factor at [X] dB (target: 8-12 dB)

WHY THIS MATTERS:
- Mix will sound weak compared to other trance tracks
- Streaming loudness will be low
- Quiet parts may be inaudible in noisy environments

DETECTION: phase1.crest_factor > 16 OR phase7.metadata.energy_contrast_db is very high

FIX:

Step 1: Add gentle master bus compression
  → Glue Compressor: Ratio 2:1, Attack 30ms, Auto release
  → Target: 1-2dB gain reduction on average
  → Threshold: Just touching the peaks

Step 2: Add more limiting
  → Increase limiter input gain by 2-4dB
  → Target: 4-6dB gain reduction on peaks
  → Watch crest factor — should approach 10-12dB

Step 3: Check section levels via phase7.section_scores[]
  → Identify breakdown sections and check if they're too quiet
  → Automate volume to bring them up slightly
  → Target: -6 to -8dB from drop (not -12dB)

Step 4: Bus compression on drums
  → Drums should have controlled dynamics
  → Add Glue Compressor to drum bus: 3-4dB GR

EXPECTED RESULT: Crest factor should drop to 10-12dB
                 Mix will sound "tighter" and more powerful
```

---

## Compression Settings Reference

### Kick Drum
```
Ratio: 4:1 to 6:1
Attack: 10-30ms (let transient through!)
Release: 50-100ms (match tempo)
Gain reduction: 3-6dB
```

### Snare/Claps
```
Ratio: 4:1 to 8:1
Attack: 5-15ms
Release: 50-100ms
Gain reduction: 4-8dB
```

### Bass
```
Ratio: 3:1 to 4:1
Attack: 20-50ms
Release: 100-200ms (or match sidechain)
Gain reduction: 4-8dB
```

### Synths/Leads
```
Ratio: 2:1 to 3:1
Attack: 10-30ms
Release: Auto or 100-200ms
Gain reduction: 2-4dB
```

### Master Bus (glue compression)
```
Ratio: 2:1 to 3:1
Attack: 30ms+ (preserve transients!)
Release: Auto
Gain reduction: 1-3dB MAX
```

### Master Limiter
```
Input gain: Adjust for target LUFS
Ceiling: -1.0dBTP (true peak)
Release: Fast to medium
Target GR: 4-6dB on peaks (not constant!)
```

---

## Section Energy Map Template

```
SECTION ENERGY ANALYSIS
=======================

Overall energy contrast (phase7.metadata.energy_contrast_db): [X] dB

| Section    | Time        | Score  | vs Drop | Status     |
|------------|-------------|--------|---------|------------|
| Intro      | 0:00-0:45   | [X]    | —       | OK         |
| Buildup    | 0:45-1:15   | [X]    | —       | OK         |
| Drop 1     | 1:15-2:30   | [X]    | Ref     | OK         |
| Breakdown  | 2:30-3:30   | [X]    | —       | OK         |
| Buildup 2  | 3:30-4:00   | [X]    | —       | OK         |
| Drop 2     | 4:00-5:30   | [X]    | Ref     | OK         |
| Outro      | 5:30-6:30   | [X]    | —       | OK         |

(Use phase7.section_scores[].section_type + start_time/end_time to populate the table.)

CONTRAST CHECK:
  energy_contrast_db: [X] dB ✓ (target: ≥4 dB)
  Buildup progression: check phase7.section_scores[] for rising scores
```

---

## Priority Rules

1. **CRITICAL**: phase1.crest_factor < 6 (severely over-compressed)
2. **CRITICAL**: Excessive clipping (phase1.clipped_sample_count > 100)
3. **SEVERE**: phase1.crest_factor < 8 (over-compressed)
4. **SEVERE**: Weak transients (phase1.transients.avg_transient_strength < 0.3, derived: "soft" attack)
5. **MODERATE**: Insufficient section contrast (phase7.metadata.energy_contrast_db < 4)
6. **MODERATE**: Too dynamic (phase1.crest_factor > 16)

---

## Example Output Snippet

```
[SEVERE] Mix Is Over-Compressed
───────────────────────────────
PROBLEM: Crest factor at 5.8 dB (target: 8-12 dB)
         Mix is severely squashed — kick has no punch, everything is flat.
         
CURRENT: phase1.crest_factor = 5.8, derived attack_quality = "soft"
         (phase1.transients.avg_transient_strength = 0.2)
TARGET: phase1.crest_factor = 10-12, derived attack_quality = "punchy"

IMPACT: Your track will sound weak and fatiguing despite being loud.
        The kick doesn't punch, the drop doesn't hit.
        This is the #1 reason your mix sounds "loud but not interesting."

FIX:

Step 1: Reduce master limiter input gain by 5dB
        → This alone will restore significant dynamics
        → Watch the crest factor rise as you reduce

Step 2: Check drum bus compression
        → Current attack is likely < 5ms (killing transients)
        → Change attack to 20-30ms
        → Change ratio from [X]:1 to 3:1

Step 3: Add transient shaping to drums
        → Drum Buss: Transients +30%
        → This recovers lost punch

EXPECTED RESULT:
  Crest factor: 5.8 → 10-12 dB
  Derived attack quality: soft → punchy
  Mix will sound more alive, kick will hit, drops will impact
```

---

## Do NOT Do

- Don't compress just because you can — compression destroys dynamics
- Don't use fast attack times everywhere — this kills punch
- Don't chase loudness at the expense of dynamics
- Don't say "too compressed" — give the EXACT crest factor and targets
- Don't forget to specify compressor settings (ratio, attack, release)
- Don't ignore phase1.clipped_sample_count — it tells you the severity of clipping

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
