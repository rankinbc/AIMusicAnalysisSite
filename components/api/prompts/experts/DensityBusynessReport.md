---
version: 1.0.0
---

# Prompt 6: Density & Busyness Report

## Your Task

Analyze the provided Ableton project JSON file to evaluate note density and busyness across tracks. Your goal is to identify tracks that are overcrowded or competing for attention, causing a cluttered mix, and provide **specific recommendations for thinning, filtering, or rearranging busy elements**.

---

## JSON Fields to Analyze

```
midi_analysis[].track_name           → Track identification
midi_analysis[].note_count           → Total notes in track
midi_analysis[].note_density_per_bar → Notes per bar (key metric)
midi_analysis[].velocity_mean        → How loud/prominent the track is

tracks[].name                        → Track name for element identification
tracks[].is_muted                    → Skip muted tracks
tracks[].volume_db                   → Prominence in mix
```

---

## Analysis Steps

### Step 1: Rank Tracks by Density

Sort all tracks by `note_density_per_bar` descending.

**Density Thresholds:**
| Density (notes/bar) | Classification | Typical Elements |
|---------------------|----------------|------------------|
| >100 | EXTREMELY BUSY | Arps, complex sequences, rolls |
| 50-100 | VERY BUSY | Fast hi-hats, detailed patterns |
| 20-50 | MODERATE | Typical melodic content |
| 8-20 | SPARSE | Chords, pads, simple patterns |
| <8 | MINIMAL | Long notes, sparse hits |

### Step 2: Identify Busy Track Clusters

Find combinations of high-density tracks:
- How many tracks exceed 50 notes/bar?
- How many tracks exceed 100 notes/bar?
- Are busy tracks in the same frequency range?
- Are busy tracks playing in the same sections?

**Severity Levels:**
| Condition | Severity |
|-----------|----------|
| 1 track >100 density | OK (probably intentional) |
| 2-3 tracks >100 simultaneously | MODERATE |
| 4+ tracks >100 simultaneously | SEVERE |
| 2+ tracks >100 in same freq range | CRITICAL |
| 5+ tracks >50 playing together | SEVERE |

### Step 3: Calculate Combined Density

Total note density when multiple tracks play:
```
combined_density = sum of note_density_per_bar for simultaneously active tracks
```

**Trance Target Ranges:**
| Section | Target Combined Density |
|---------|-------------------------|
| Breakdown | 50-150 notes/bar |
| Buildup | 100-250 notes/bar (rising) |
| Drop | 150-400 notes/bar |
| Peak moment | 400-600 notes/bar MAX |

### Step 4: Identify Problem Combinations

Flag when:
- Multiple busy tracks compete for the same role (two arps, two fast sequences)
- High-density tracks have similar frequency content
- Total combined density exceeds 600 notes/bar anywhere

---

## Output Format

### Summary
```
DENSITY & BUSYNESS REPORT
=========================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Density Statistics:
- Total tracks analyzed: X
- Extremely busy (>100 notes/bar): X tracks
- Very busy (50-100 notes/bar): X tracks
- Combined peak density: X notes/bar at [section]

Top Offenders:
  1. [track name]: X notes/bar
  2. [track name]: X notes/bar
  3. [track name]: X notes/bar

Main Issue: [Summary of biggest problem]
```

### Density Ranking

```
TRACK DENSITY RANKING (Highest to Lowest)
=========================================

🔴 EXTREMELY BUSY (>100 notes/bar):
────────────────────────────────────
  1. 27-MonoPoly      150.8 notes/bar  [SEVERE]
  2. 26-MonoPoly      113.9 notes/bar  [SEVERE]
  3. 24-MonoPoly      104.7 notes/bar  [MODERATE]
  4. 21-MonoPoly      102.7 notes/bar  [MODERATE]
  5. 29-TRITON        102.5 notes/bar  [MODERATE]

  ⚠️ WARNING: 5 tracks above 100 notes/bar is excessive.
     These tracks are fighting each other for attention.

🟡 VERY BUSY (50-100 notes/bar):
────────────────────────────────
  6. 33-TRITON         60.4 notes/bar
  7. 28-MonoPoly       58.1 notes/bar
  8. 20-TRITON         51.1 notes/bar

🟢 MODERATE (20-50 notes/bar):
──────────────────────────────
  [Continue ranking...]

⚪ SPARSE (<20 notes/bar):
─────────────────────────
  [Continue ranking...]
```

### Prioritized Issues

```
[SEVERITY] Issue Description
────────────────────────────────────
PROBLEM: [Description with specific data]
TRACKS INVOLVED: [List]
COMBINED DENSITY: X notes/bar
IMPACT: [What this does to the mix]

ACTION REQUIRED:

Option 1 — THIN the busiest track:
  → [Track name]: Remove every other note
  → Or: Reduce to half-time pattern
  → Or: Remove chord tones, keep root only
  → Target: Reduce from X to Y notes/bar

Option 2 — FILTER to reduce presence:
  → [Track name]: Low-pass filter at 3-4kHz
  → Reduces perceived busyness without changing notes
  → Good for background arps/sequences

Option 3 — LEVEL down:
  → [Track name]: Reduce volume_db by 6-10dB
  → Pushes it into background, still adds texture
  → Current: XdB → Target: YdB

Option 4 — ALTERNATE sections:
  → Play [Track A] in verses
  → Play [Track B] in choruses
  → Never play both simultaneously

Option 5 — MUTE one track:
  → If [Track A] and [Track B] play the same role,
     you probably don't need both
  → Mute [recommended track]

RECOMMENDED: [Which option is best for this case]
```

### Competing Busy Tracks Analysis

```
BUSY TRACK CONFLICTS
====================

CONFLICT 1: Too Many Fast Sequences
───────────────────────────────────
Tracks competing:
  • 26-MonoPoly (113.9 notes/bar)
  • 27-MonoPoly (150.8 notes/bar)
  • 24-MonoPoly (104.7 notes/bar)
  
Problem: Three tracks all >100 notes/bar, all appear to be 
         similar synth sequences (MonoPoly). Combined = 369 notes/bar.

Questions to ask yourself:
  • Are these layers of the same part? (If so, reduce to 1-2)
  • Are these different parts? (If so, alternate them)
  • What role does each serve?

Recommended Action:
  → MUTE 27-MonoPoly (highest density)
  → REDUCE 26-MonoPoly to half notes
  → KEEP 24-MonoPoly as primary
  
Result: Combined density drops from 369 to ~100 notes/bar


CONFLICT 2: Arp + Lead Competition
──────────────────────────────────
[Continue for other conflicts...]
```

---

## Thinning Techniques

### For Arpeggios/Sequences (>100 notes/bar)

```
Original: 16th notes at 144 BPM = 144 notes/bar
↓
Option A: 8th notes = 72 notes/bar (halve it)
Option B: Dotted 8ths = 48 notes/bar (creates interest)
Option C: Remove upbeats = ~72 notes/bar
Option D: Rhythmic gating = varies (sidechain to kick)
```

### For Chord Patterns

```
Original: Full chord (5 notes) on every beat = dense
↓
Option A: Root + 5th only = 40% of notes
Option B: Spread voicing = same notes, less mud
Option C: Alternate bass/chord = half density
Option D: Whole notes instead of quarters = 75% reduction
```

### For Fast Hi-Hats

```
Original: 16th notes with ghost notes = very dense
↓
Option A: 8th notes only = 50% reduction
Option B: Remove ghosts = ~30% reduction  
Option C: Gate to kick = dynamic reduction
Option D: Automate: sparse in verse, dense in drop
```

---

## Combined Density by Section

```
SECTION DENSITY ANALYSIS
========================

Section "Start0" (1:46 - 3:33)
  Combined density: 847 notes/bar [CRITICAL — too busy]
  Active busy tracks: 6
  
  Breakdown:
    27-MonoPoly: 150.8
    26-MonoPoly: 113.9
    29-TRITON: 102.5
    21-MonoPoly: 102.7
    24-MonoPoly: 104.7
    [others]: 272.4
    ──────────────────
    TOTAL: 847 notes/bar
  
  ISSUE: This is approximately 3x the recommended maximum.
  FIX: Reduce to 3 busy tracks max, target <400 notes/bar

Section "intermission" (6:13 - 6:26)
  Combined density: 423 notes/bar [MODERATE]
  Better, but still high for a breakdown.
  Target for breakdown: 50-150 notes/bar
```

---

## Priority Rules

1. **CRITICAL**: Combined density >600 notes/bar anywhere
2. **CRITICAL**: 2+ tracks >100 notes/bar in same frequency range
3. **SEVERE**: 4+ tracks >100 notes/bar playing together
4. **SEVERE**: 5+ tracks >50 notes/bar in same section
5. **MODERATE**: Single track >150 notes/bar (probably intentional arp)
6. **MINOR**: High density in drop sections (may be appropriate)

---

## Questions to Surface

For each extremely busy track, prompt the user to consider:

```
QUESTIONS FOR [Track Name] (150.8 notes/bar):

1. What is the PURPOSE of this track?
   □ Main melodic element (should be prominent)
   □ Supporting layer (should be quieter/filtered)
   □ Background texture (should be very quiet)
   □ I'm not sure (consider muting)

2. Could this be SIMPLER and still work?
   □ Try muting it — does the mix lose something important?
   □ Try halving the notes — does it still groove?

3. Is there ANOTHER track doing the same job?
   □ If yes, pick one and mute the other
   □ If layering intentionally, reduce density of one

4. Does it play THROUGHOUT or just in sections?
   □ If throughout, consider limiting to drops only
   □ Constant busy elements cause listener fatigue
```

---

## Example Output Snippet

```
[CRITICAL] Combined Density Overload in Drop Section
────────────────────────────────────────────────────
PROBLEM: Section "5" has combined density of 1,247 notes/bar
         across 12 simultaneously active busy tracks.

IMPACT: This is 3x the recommended maximum for a drop.
        Everything competes, nothing stands out. The mix sounds
        like a "wall of noise" instead of a clear, punchy drop.
        This is why your track is "loud but not interesting."

TRACKS CONTRIBUTING (by density):
  1. 27-MonoPoly: 150.8 notes/bar — EXTREMELY BUSY
  2. 26-MonoPoly: 113.9 notes/bar — EXTREMELY BUSY
  3. 29-TRITON: 102.5 notes/bar — EXTREMELY BUSY
  4. 21-MonoPoly: 102.7 notes/bar — EXTREMELY BUSY
  5. 24-MonoPoly: 104.7 notes/bar — EXTREMELY BUSY
     [Total from top 5: 574 notes/bar]
  
  Plus 7 more tracks adding 673 notes/bar

ACTION REQUIRED:

Step 1 — Identify redundant tracks:
  → 26-MonoPoly and 27-MonoPoly appear to be layers
  → MUTE 27-MonoPoly (saves 150 notes/bar)

Step 2 — Thin primary tracks:
  → 26-MonoPoly: Convert from 16ths to 8ths (now ~57 notes/bar)
  → 21-MonoPoly: Remove every other note (now ~51 notes/bar)

Step 3 — Push others back:
  → 24-MonoPoly: Low-pass at 4kHz + reduce volume 6dB
  → 29-TRITON: Reduce volume 8dB (texture only)

RESULT:
  Before: 1,247 notes/bar
  After: ~380 notes/bar (within target of <400)
  
  Your drop will now have SPACE. Elements can breathe.
  The kick and bass will punch through.
```

---

## Do NOT Do

- Don't flag high density as automatically bad — arps are supposed to be busy
- Don't ignore the COMBINATION of busy tracks — that's where problems arise
- Don't recommend "simplify" without specific techniques
- Don't forget volume — loud busy tracks are worse than quiet ones
- Don't treat drops like breakdowns — drops CAN be busier

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
- `severity` must match the verdict's actual impact — over-claiming downgrades silently.
- Omit `fix` (use `null`) for pure-observation verdicts (wins, key-detection notes, etc.).
