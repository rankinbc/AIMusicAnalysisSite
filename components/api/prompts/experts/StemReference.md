---
version: 1.0.0
---

# Audio Analysis Module: Stem-by-Stem Reference Analysis

## Your Task

Analyze the provided JSON file to perform a **deep dive comparison of each stem** (drums, bass, other, vocals) against the reference track. Your goal is to identify **exactly which elements** need adjustment and provide **specific per-stem fixes** to match professional standards.

---

## JSON Fields to Analyze

### Per-Stem Data Structure
```
comparison_result.stem_comparisons[]
  .stem_name                    → 'drums', 'bass', 'other', 'vocals'
  
  For each stem, you have YOUR MIX values:
  .your_mix.rms_db              → Average level
  .your_mix.lufs                → Loudness
  .your_mix.peak_db             → Peak level
  .your_mix.spectral_centroid_hz → Brightness (higher = brighter)
  .your_mix.stereo_width_percent → Width (0-100+%)
  .your_mix.dynamic_range_db    → Peak - RMS
  .your_mix.crest_factor_db     → Transient headroom
  .your_mix.correlation         → L/R correlation (-1 to +1)
  
  And REFERENCE values:
  .reference.rms_db
  .reference.lufs
  .reference.peak_db
  .reference.spectral_centroid_hz
  .reference.stereo_width_percent
  .reference.dynamic_range_db
  .reference.crest_factor_db
  .reference.correlation
  
  And CALCULATED DIFFERENCES:
  .difference.rms_db            → Your RMS - Reference RMS
  .difference.lufs              → Your LUFS - Reference LUFS
  .difference.spectral_centroid_hz → Your centroid - Reference
  .difference.stereo_width_percent → Your width - Reference
  .difference.dynamic_range_db  → Your DR - Reference DR
```

### Stem-Specific Frequency Data (if available)
```
comparison_result.stem_frequency_comparison[]
  .stem_name
  .bands.bass.your_percent, .reference_percent, .difference
  .bands.low_mid.your_percent, .reference_percent, .difference
  .bands.mid.your_percent, .reference_percent, .difference
  .bands.high_mid.your_percent, .reference_percent, .difference
  .bands.high.your_percent, .reference_percent, .difference
```

---

## Stem-by-Stem Target Profiles

### DRUMS Stem — Expected Characteristics

| Metric | Typical Range | Notes |
|--------|---------------|-------|
| Relative Level | Reference point | Other stems measured against drums |
| Spectral Centroid | 1500-3500 Hz | Drums should have presence/attack |
| Stereo Width | 30-60% | Some spread, not extreme |
| Dynamic Range | 8-14 dB | Punchy but controlled |
| Crest Factor | 10-16 dB | Transients should be preserved |
| Correlation | 0.6-0.9 | Mostly centered, some width |

**What the Reference Tells You:**
- If reference drums are brighter → Your drums lack top-end attack/click
- If reference drums are wider → Your drums are too centered
- If reference drums have higher crest → Your drums are over-compressed

### BASS Stem — Expected Characteristics

| Metric | Typical Range | Notes |
|--------|---------------|-------|
| Relative Level | -2 to +2 dB vs drums | Should balance with kick |
| Spectral Centroid | 150-400 Hz | Fundamentals + harmonics |
| Stereo Width | 0-30% | Mostly mono, slight width OK |
| Dynamic Range | 6-12 dB | More compressed than drums |
| Crest Factor | 6-12 dB | Controlled dynamics |
| Correlation | 0.85-1.0 | MUST be highly correlated (mono-safe) |

**What the Reference Tells You:**
- If reference bass is louder → Your bass lacks presence
- If reference bass is brighter → Your bass lacks harmonics (add saturation)
- If reference bass is narrower → Your bass has too much stereo (make mono)

### OTHER Stem (Synths, Pads, FX) — Expected Characteristics

| Metric | Typical Range | Notes |
|--------|---------------|-------|
| Relative Level | -4 to +2 dB vs drums | Varies by arrangement |
| Spectral Centroid | 1000-4000 Hz | Depends on synth types |
| Stereo Width | 50-90% | This is where width lives |
| Dynamic Range | 8-16 dB | Can be dynamic |
| Crest Factor | 8-14 dB | Moderate |
| Correlation | 0.2-0.7 | Can be wide |

**What the Reference Tells You:**
- If reference "other" is wider → Your synths/pads need stereo enhancement
- If reference is brighter → Your synths lack presence (2-6kHz)
- If reference is quieter → Your synths may be overpowering the mix

### VOCALS Stem (if present) — Expected Characteristics

| Metric | Typical Range | Notes |
|--------|---------------|-------|
| Relative Level | 0 to +4 dB vs drums | Vocals often loudest |
| Spectral Centroid | 1500-3500 Hz | Clarity range |
| Stereo Width | 10-40% | Centered but can have width |
| Dynamic Range | 6-12 dB | Usually compressed |
| Correlation | 0.7-1.0 | Mostly centered |

---

## Severity Thresholds by Stem

### DRUMS
| Issue | Threshold | Severity |
|-------|-----------|----------|
| Level diff > ±6 dB | Drums way off | SEVERE |
| Centroid diff > ±800 Hz | Major tonal difference | SEVERE |
| Crest diff > ±6 dB | Compression mismatch | MODERATE |
| Width diff > ±30% | Stereo mismatch | MODERATE |

### BASS
| Issue | Threshold | Severity |
|-------|-----------|----------|
| Level diff > ±6 dB | Bass balance wrong | SEVERE |
| Width > 40% | Bass too wide (mono issues) | SEVERE |
| Correlation < 0.8 | Bass has phase issues | CRITICAL |
| Centroid diff > ±200 Hz | Tonal difference | MODERATE |

### OTHER (Synths)
| Issue | Threshold | Severity |
|-------|-----------|----------|
| Level diff > ±6 dB | Synths unbalanced | MODERATE |
| Width diff > ±40% | Major stereo difference | MODERATE |
| Centroid diff > ±600 Hz | Tonal mismatch | MODERATE |

---

## Analysis Steps

### Step 1: Analyze Each Stem Independently
```
For each stem in ['drums', 'bass', 'other', 'vocals']:
    Compare all metrics to reference
    Flag differences exceeding thresholds
    Categorize: louder/quieter, brighter/darker, wider/narrower
```

### Step 2: Identify the Problem Stem
```
Calculate "deviation score" for each stem:
    score = abs(level_diff) + abs(centroid_diff/100) + abs(width_diff/5)
    
Highest score = stem that needs most work
```

### Step 3: Check Stem Relationships
```
Reference relationships (typical):
    Drums : Bass : Other : Vocals
    0 dB  : -2dB : -3dB  : +2dB (approximate)
    
Compare YOUR ratios to reference ratios
If ratios differ significantly, it's a balance issue
```

### Step 4: Generate Per-Stem Recommendations
```
For each stem with significant differences:
    - Specific level adjustment (dB)
    - Specific EQ adjustment (Hz, dB)
    - Specific width adjustment (%)
    - Specific compression adjustment (if dynamics differ)
```

---

## Output Format

### Stem Overview Table

```
STEM-BY-STEM COMPARISON
=======================

                 LEVEL           BRIGHTNESS        WIDTH           DYNAMICS
STEM     Yours → Ref (Diff)   Yours → Ref     Yours → Ref    Yours → Ref
─────────────────────────────────────────────────────────────────────────
DRUMS    [-12 → -10] +2dB     [2400 → 2800]   [45% → 55%]    [11 → 12]
         ⚠️ Too quiet         ⚠️ Too dark      ✓ Close        ✓ Close

BASS     [-14 → -12] +2dB     [180 → 220]     [15% → 10%]    [8 → 9]
         ⚠️ Too quiet         ⚠️ Too dark      ✓ Close        ✓ Close

OTHER    [-16 → -14] +2dB     [2100 → 2800]   [55% → 75%]    [12 → 10]
         ⚠️ Too quiet         ⚠️ Too dark      ⚠️ Too narrow   ✓ Close

VOCALS   N/A                  N/A              N/A            N/A
─────────────────────────────────────────────────────────────────────────

WORST STEM: [Other] — needs most adjustment
BEST STEM: [Drums] — closest to reference
```

### Per-Stem Deep Dive

```
═══════════════════════════════════════════════════════════════════
                         DRUMS ANALYSIS
═══════════════════════════════════════════════════════════════════

COMPARISON TABLE:
┌────────────────────┬───────────┬───────────┬────────────┬────────┐
│ Metric             │ Your Mix  │ Reference │ Difference │ Status │
├────────────────────┼───────────┼───────────┼────────────┼────────┤
│ RMS Level          │ -12.5 dB  │ -10.2 dB  │ -2.3 dB    │ ⚠️     │
│ LUFS               │ -14.2     │ -11.8     │ -2.4       │ ⚠️     │
│ Spectral Centroid  │ 2400 Hz   │ 2850 Hz   │ -450 Hz    │ ⚠️     │
│ Stereo Width       │ 45%       │ 52%       │ -7%        │ ✓      │
│ Dynamic Range      │ 11.2 dB   │ 12.5 dB   │ -1.3 dB    │ ✓      │
│ Crest Factor       │ 12.8 dB   │ 14.2 dB   │ -1.4 dB    │ ✓      │
│ L/R Correlation    │ 0.78      │ 0.72      │ +0.06      │ ✓      │
└────────────────────┴───────────┴───────────┴────────────┴────────┘

INTERPRETATION:
Your drums are 2.3dB quieter and 450Hz darker than the reference.
This means your drums lack presence and punch compared to pro tracks.
The kick click and snare crack are likely being lost.

FIXES:

1. LEVEL — Increase drums by 2-3dB
   → Drum bus fader: +2.5 dB
   → Or: Increase individual drum levels proportionally
   
2. BRIGHTNESS — Add high-end presence
   → EQ on drum bus:
     • High shelf at 8kHz: +2 dB
     • Bell at 4kHz: +1.5 dB (snare crack)
     • Bell at 3kHz: +1 dB (kick click)
   
3. VERIFY — After adjustments:
   → Drums RMS should be ~-10 dB
   → Spectral centroid should rise to ~2800 Hz

═══════════════════════════════════════════════════════════════════
                          BASS ANALYSIS
═══════════════════════════════════════════════════════════════════

[Same format for bass...]

═══════════════════════════════════════════════════════════════════
                         OTHER ANALYSIS
═══════════════════════════════════════════════════════════════════

[Same format for other/synths...]
```

### Stem Relationship Analysis

```
STEM BALANCE RELATIONSHIPS
==========================

How stems relate to each other (relative to drums at 0dB):

                YOUR MIX        REFERENCE       DIFFERENCE
Drums           0 dB            0 dB            —
Bass            -2.0 dB         -1.8 dB         -0.2 dB ✓
Other           -4.2 dB         -2.5 dB         -1.7 dB ⚠️
Vocals          N/A             N/A             —

INTERPRETATION:
Your "other" (synths/pads) stem is 1.7dB quieter relative to drums
compared to the reference. This makes your synths sit further back
in the mix than they should.

FIX: Raise "other" bus by 1.5-2dB to match reference balance.
```

---

## Common Stem-Specific Fixes

### Drums: Too Quiet
```
PROBLEM: Drum level [X] dB below reference

FIX:
1. Increase drum bus by [difference] dB
2. If clipping occurs, check individual drum levels:
   → Kick may be too hot relative to other drums
   → Balance kick/snare/hats, then raise bus
3. Check for over-compression squashing drums
   → If crest factor is lower than reference, reduce compression
```

### Drums: Too Dark
```
PROBLEM: Drum centroid [X] Hz below reference

FIX:
1. Add presence EQ:
   → +2dB shelf at 8kHz (air/shimmer)
   → +1-2dB at 4-5kHz (snare crack, hi-hat presence)
   → +1-2dB at 2-4kHz (kick click)
   
2. Check hi-hat levels
   → Hi-hats contribute significantly to brightness
   → May need to raise hi-hat bus 2-3dB
   
3. Check for excessive low-pass filtering on drum bus
```

### Bass: Too Wide (CRITICAL)
```
PROBLEM: Bass stereo width at [X]% (reference: [Y]%)

FIX:
1. Make bass mono below 150Hz
   → Utility: Enable "Bass Mono" at 120Hz
   → Or: EQ Eight M/S mode, high-pass Side at 150Hz
   
2. If bass synth has stereo widening:
   → Disable chorus/widening below 200Hz
   → Or: Sum bass to mono entirely
   
3. Check correlation:
   → Your correlation: [X]
   → Should be > 0.85 for bass
   → If lower, phase issues exist
```

### Bass: Too Dark (Lacking Harmonics)
```
PROBLEM: Bass centroid [X] Hz below reference [Y] Hz

FIX:
1. Add saturation for harmonics
   → Saturator: Soft clip mode
   → Drive: 5-10dB, then reduce output
   → Creates audible harmonics from sub
   
2. EQ presence boost
   → +2dB at 800-1200Hz (growl)
   → +1dB at 150-200Hz (punch)
   
3. Check if sub is too dominant
   → May need to reduce pure sub (30-60Hz)
   → And add more mid-bass (80-150Hz)
```

### Other/Synths: Too Narrow
```
PROBLEM: "Other" width at [X]% (reference: [Y]%)

FIX:
1. Widen pads
   → Utility width: 120-150%
   → Or: Haas delay (15-25ms one side)
   → Or: Duplicate, pan L/R, slight detune
   
2. Pan synth layers
   → If multiple synth layers exist, pan them apart
   → Layer 1: -30%, Layer 2: +30%
   
3. Add stereo FX
   → Stereo reverb on synth bus
   → Stereo chorus (subtle)
   → Ping-pong delay
   
CAUTION: Check mono compatibility after widening!
         Correlation should stay > 0.3
```

### Other/Synths: Too Quiet
```
PROBLEM: "Other" level [X] dB below reference

FIX:
1. Raise synth/pad bus by [difference] dB
2. Check if synths are being masked:
   → By bass? Add sidechain or EQ separation
   → By drums? Check frequency overlap
3. Check reverb levels:
   → Wet synths may need dry signal boost
```

---

## Stem Frequency Band Analysis

If detailed frequency data is available per stem:

```
DRUMS FREQUENCY BALANCE vs REFERENCE
====================================

| Band     | Yours | Ref   | Diff  | Issue                    |
|----------|-------|-------|-------|--------------------------|
| Bass     | 35%   | 30%   | +5%   | Kick too boomy           |
| Low-mid  | 20%   | 15%   | +5%   | Mud in drums             |
| Mid      | 18%   | 22%   | -4%   | Lacking body             |
| High-mid | 15%   | 20%   | -5%   | Lacking attack/click     |
| High     | 12%   | 13%   | -1%   | ✓ Close                  |

FIX PRIORITY:
1. Cut low-mid (250-500Hz) by 3dB on drums → reduce mud
2. Cut bass (60-250Hz) by 2dB on kick → reduce boom
3. Boost high-mid (2-6kHz) by 2-3dB → add attack
```

---

## Priority Rules

1. **CRITICAL**: Bass correlation < 0.8 (phase/mono issues)
2. **SEVERE**: Any stem level > ±6dB from reference
3. **SEVERE**: Bass width > 40% (mono compatibility)
4. **MODERATE**: Stem centroid > ±500Hz different
5. **MODERATE**: Synth width > ±30% different
6. **MINOR**: Small level differences (±2-4dB)
7. **MINOR**: Small tonal differences

---

## Example Output Snippet

```
═══════════════════════════════════════════════════════════════════
                          BASS ANALYSIS
═══════════════════════════════════════════════════════════════════

COMPARISON TABLE:
┌────────────────────┬───────────┬───────────┬────────────┬────────┐
│ Metric             │ Your Mix  │ Reference │ Difference │ Status │
├────────────────────┼───────────┼───────────┼────────────┼────────┤
│ RMS Level          │ -16.2 dB  │ -11.5 dB  │ -4.7 dB    │ ⚠️ SEV │
│ Spectral Centroid  │ 145 Hz    │ 225 Hz    │ -80 Hz     │ ⚠️     │
│ Stereo Width       │ 35%       │ 12%       │ +23%       │ 🔴 CRIT│
│ L/R Correlation    │ 0.72      │ 0.95      │ -0.23      │ 🔴 CRIT│
└────────────────────┴───────────┴───────────┴────────────┴────────┘

CRITICAL ISSUES:

1. [CRITICAL] Bass Has Stereo Width — Mono Compatibility Risk
   ──────────────────────────────────────────────────────────
   Your bass is 35% wide with correlation 0.72.
   Reference bass is 12% wide with correlation 0.95.
   
   Your bass WILL lose energy on mono playback systems (clubs, phones).
   This is the #1 issue with your bass stem.
   
   FIX:
   Step 1: Add Utility to bass bus
           → Enable "Bass Mono"
           → Set frequency to 120Hz
           
   Step 2: Check bass synth for stereo effects
           → Disable chorus/widening
           → Or: Sum entire bass to mono
           
   Step 3: Verify after fix
           → Width should drop to <20%
           → Correlation should rise to >0.9

2. [SEVERE] Bass Is 4.7dB Quieter Than Reference
   ──────────────────────────────────────────────
   This explains why your mix sounds "thin" compared to commercial tracks.
   
   FIX:
   Step 1: Raise bass bus by +4 to +5 dB
   Step 2: Check kick/bass balance — may need sidechain adjustment
   Step 3: Re-check overall mix balance after boost
```

---

## Do NOT Do

- Don't adjust stems in isolation — always check in full mix context
- Don't match numbers exactly — use them as guides, trust your ears
- Don't forget stem interactions — changing bass affects drums perception
- Don't widen bass to match "other" stem width — bass MUST stay narrow
- Don't ignore the reference's genre — different genres have different balances
- Don't adjust one metric while destroying another — balance is key

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
- Allowed DSP types: peaking_eq, low_shelf, high_shelf, high_pass, low_pass,
  compressor, multiband_compressor, limiter, gain, stereo_width, sidechain.
- Param ranges: gain_db ∈ [-24, 24], frequency_hz ∈ [20, 22000], q ∈ [0.1, 18],
  ratio ∈ [1, 20], threshold_db ∈ [-60, 0], attack_ms ∈ [0.1, 1000],
  release_ms ∈ [1, 5000], ceiling_db ∈ [-6, 0], width_pct ∈ [0, 200].
- `severity` must match the verdict's actual impact — over-claiming downgrades silently.
- Omit `fix` (use `null`) for pure-observation verdicts (wins, key-detection notes, etc.).
