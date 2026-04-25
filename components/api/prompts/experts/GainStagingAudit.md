---
version: 1.0.0
---

# Prompt 1: Gain Staging Audit

## Your Task

Analyze the provided Ableton project JSON file to evaluate gain staging and level balance. Your goal is to identify level problems that prevent a clean, punchy mix and provide **specific, actionable fixes with exact dB values**.

---

## JSON Fields to Analyze

```
tracks[].volume_db      → Current fader position for each track
tracks[].name           → Track name (to identify element type)
tracks[].is_muted       → Skip muted tracks in active analysis
tracks[].is_solo        → Note if solo is engaged
```

---

## Analysis Steps

### Step 1: Calculate Global Statistics
- Mean volume_db across all unmuted tracks
- Standard deviation of volume_db
- Min and max volume_db values
- Count of tracks at specific thresholds (≥20dB, ≥24dB, <10dB)

### Step 2: Identify Problems

| Problem | Detection | Severity |
|---------|-----------|----------|
| **No headroom** | >80% of tracks at volume_db ≥ 20 | CRITICAL |
| **All tracks identical** | std deviation < 2dB | CRITICAL |
| **Clipping risk** | Any track volume_db > 24 | SEVERE |
| **Extreme outlier (hot)** | Track >8dB above mean | SEVERE |
| **Extreme outlier (buried)** | Track >10dB below mean (unmuted) | MODERATE |
| **No level hierarchy** | std deviation < 4dB | MODERATE |

### Step 3: Categorize Tracks by Element Type

Parse track names to identify:
- **Kick drums**: names containing "kick", "kck", "bd"
- **Snares/Claps**: names containing "snare", "snr", "clap", "clp"
- **Hi-hats/Cymbals**: names containing "hat", "hh", "cymbal", "ride", "crash"
- **Bass**: names containing "bass", "sub", "low"
- **Leads/Synths**: names containing "lead", "synth", "poly", "triton", "monopoly"
- **Pads**: names containing "pad", "string", "str", "atmosphere"
- **FX**: names containing "fx", "riser", "sweep", "impact"
- **Groups/Buses**: names containing "group", "bus", "drum", "master"

### Step 4: Compare to Target Levels

Reference levels (relative to kick at 0dB baseline):
| Element | Target Range | Notes |
|---------|--------------|-------|
| Kick | 0dB (reference) | Set as anchor |
| Snare/Clap | -2 to +1dB | Just under or equal to kick |
| Bass | -3 to 0dB | Slightly under kick |
| Hi-hats | -8 to -4dB | Background rhythm |
| Leads | -6 to -2dB | Present but not dominating |
| Pads | -12 to -6dB | Fill, not compete |
| FX/Percs | -15 to -8dB | Accent elements |

---

## Output Format

### Summary
```
GAIN STAGING AUDIT RESULTS
==========================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Key Stats:
- Tracks analyzed: X (Y muted, skipped)
- Volume range: [min]dB to [max]dB
- Average level: [mean]dB
- Level variation: [std]dB

Critical Issues: X
Severe Issues: X
Moderate Issues: X
```

### Prioritized Issues (MOST IMPORTANT FIRST)

For each issue, provide:

```
[SEVERITY] Issue Title
─────────────────────────────────
PROBLEM: Specific description with data
IMPACT: Why this hurts your mix
AFFECTED TRACKS: List specific track names

ACTION REQUIRED:
→ [Track Name]: Set volume_db to [X]dB (currently [Y]dB) — reduce by [Z]dB
→ [Track Name]: Set volume_db to [X]dB (currently [Y]dB) — reduce by [Z]dB

WHY THIS WORKS: Brief explanation
```

### Recommended Level Structure

Provide a complete level plan:

```
RECOMMENDED FADER POSITIONS
===========================
Use [identified kick track] as reference at -10dB

DRUMS:
  → [kick track name]: -10dB (reference)
  → [snare track name]: -11dB
  → [hat track name]: -16dB
  ...

BASS:
  → [bass track name]: -12dB
  ...

SYNTHS/LEADS:
  → [lead track name]: -14dB
  ...

PADS/ATMOSPHERE:
  → [pad track name]: -20dB
  ...
```

---

## Priority Rules

1. **CRITICAL issues first**: No headroom, all tracks maxed
2. **SEVERE issues second**: Clipping risk, extreme outliers
3. **MODERATE issues third**: Buried tracks, weak hierarchy
4. Group related issues together (e.g., "all synth tracks too hot")

---

## Key Principles to Apply

1. **Headroom is mandatory**: Mix should peak at -6dB to leave room for mastering
2. **Hierarchy creates clarity**: Not everything can be loud — some elements must sit back
3. **Relative levels matter more than absolute**: It's about relationships between elements
4. **Kick is king in trance**: Use it as the reference point for everything else

---

## Example Output Snippet

```
[CRITICAL] No Mixing Headroom — All Tracks at Maximum
─────────────────────────────────────────────────────
PROBLEM: 46 of 48 tracks (96%) are at volume_db = 20.0dB
IMPACT: No headroom for mastering, all elements competing equally, 
        guaranteed muddy/squashed final result

AFFECTED TRACKS: 3-Imba Kick 53, 5-Imba Open Hat 41, 6-Imba Snare 52... 
                 (and 43 others)

ACTION REQUIRED:
→ Select ALL tracks, reduce by 12dB as starting point
→ Then set kick (3-Imba Kick 53) to -10dB as new reference
→ Mix all other elements relative to kick using the level chart below

WHY THIS WORKS: Creates 10dB+ headroom for mastering, forces you to 
                make mixing decisions about what's actually important
```

---

## Do NOT Do

- Don't just list every track's volume — focus on PROBLEMS
- Don't give vague advice like "adjust levels" — give EXACT dB values
- Don't ignore track names — use them to identify element types
- Don't treat all tracks equally — drums and bass matter most for trance

---

## Required Output

Respond ONLY with JSON matching this schema. No prose, no code fences, no commentary outside the JSON object.

```
{
  "specialist": "<this specialist's slug, snake_case>",
  "verdicts": [
    {
      "severity": "critical" | "severe" | "moderate" | "minor" | "win",
      "category": "<category slug>",
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
