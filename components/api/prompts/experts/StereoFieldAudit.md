# Prompt 2: Stereo Field Audit

## Your Task

Analyze the provided Ableton project JSON file to evaluate stereo field and panning. Your goal is to identify stereo image problems that make the mix sound narrow, flat, or unprofessional, and provide **specific pan position recommendations for each track**.

---

## JSON Fields to Analyze

```
tracks[].pan            → Current pan position (-1.0 = full left, 0 = center, +1.0 = full right)
tracks[].name           → Track name (to identify element type)
tracks[].is_muted       → Skip muted tracks
tracks[].volume_db      → Context for importance of track
midi_analysis[].note_count → How prominent the track is
```

---

## Analysis Steps

### Step 1: Calculate Stereo Statistics
- Count tracks at center (pan = 0)
- Count tracks panned left (pan < -0.1)
- Count tracks panned right (pan > 0.1)
- Calculate pan position range and distribution
- Percentage of tracks at dead center

### Step 2: Identify Problems

| Problem | Detection | Severity |
|---------|-----------|----------|
| **Complete mono collapse** | >90% tracks at pan = 0 | CRITICAL |
| **Narrow stereo image** | All pan values between -0.3 and +0.3 | SEVERE |
| **Unbalanced stereo** | Sum of left pans ≠ sum of right pans (>30% diff) | MODERATE |
| **Bass/Kick not centered** | Low-frequency elements panned away from center | SEVERE |
| **Lead not focused** | Main lead panned hard left or right | MODERATE |

### Step 3: Categorize Tracks by Element Type

Parse track names to identify (MUST keep centered):
- **Kick drums**: "kick", "kck", "bd" → MUST be center
- **Snare/Clap**: "snare", "snr", "clap" → Center or slight offset
- **Bass**: "bass", "sub" → MUST be center (mono below 120Hz)
- **Lead synth**: "lead" → Center or slight width

Parse track names to identify (SHOULD be panned):
- **Hi-hats**: "hat", "hh" → Pan 15-40% left OR right
- **Rides**: "ride" → Pan 20-40% opposite of hats
- **Percussion**: "perc", "shaker", "tambourine" → Pan wide (40-80%)
- **Crashes/Cymbals**: "crash", "cymbal" → Pan moderately (20-50%)
- **Pads**: "pad", "atmosphere", "string" → Wide stereo (50-100% or stereo widener)
- **FX/Risers**: "fx", "riser", "sweep" → Wide or automated
- **Duplicate layers**: Same instrument with number suffix → Pan opposites

### Step 4: Generate Pan Recommendations

For each track, determine:
1. What type of element is it?
2. Should it be centered, slightly offset, or wide?
3. If panning, which direction (balance the mix)?

---

## Output Format

### Summary
```
STEREO FIELD AUDIT RESULTS
==========================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Current Stereo Distribution:
- Tracks at center (pan = 0): X of Y (Z%)
- Tracks panned left: X
- Tracks panned right: X
- Pan range: [min] to [max]

Critical Issues: X
Severe Issues: X
Moderate Issues: X
```

### Prioritized Issues (MOST IMPORTANT FIRST)

```
[SEVERITY] Issue Title
─────────────────────────────────
PROBLEM: Specific description with data
IMPACT: Why this hurts your mix (narrow, flat, no separation, etc.)
AFFECTED TRACKS: List specific track names

ACTION REQUIRED:
→ [Track Name]: Pan to [X]% [LEFT/RIGHT] (currently center)
→ [Track Name]: Pan to [X]% [LEFT/RIGHT] (currently center)

WHY THIS WORKS: Brief explanation
```

### Complete Pan Position Plan

```
RECOMMENDED PAN POSITIONS
=========================

KEEP CENTERED (pan = 0):
  → [kick track]: 0 (center) ✓ CORRECT - low end must be mono
  → [snare track]: 0 (center)
  → [bass track]: 0 (center) ✓ CORRECT
  → [lead track]: 0 (center)

PAN LEFT:
  → [hat track]: -25 (25% left) — creates space, balances ride
  → [perc track 1]: -50 (50% left) — wide placement
  → [pad layer L]: -70 (70% left) — stereo width

PAN RIGHT:
  → [ride track]: +30 (30% right) — opposite of hats
  → [perc track 2]: +50 (50% right) — mirrors left perc
  → [pad layer R]: +70 (70% right) — stereo width

STEREO PAIRS (pan hard or use stereo widener):
  → [atmosphere/pad]: Stereo wide or L/R at ±80
```

---

## Pan Position Reference Chart

| Element Type | Recommended Pan | Notes |
|--------------|-----------------|-------|
| Kick | 0 (center) | ALWAYS — low end mono |
| Sub Bass | 0 (center) | ALWAYS — below 120Hz must be mono |
| Bass (upper harmonics) | 0 to ±10 | Slight width OK above 200Hz |
| Snare | 0 to ±5 | Center or barely off |
| Clap | 0 to ±10 | Center or slight offset |
| Hi-hat (main) | ±15 to ±35 | Pick a side, be consistent |
| Hi-hat (offbeat/layer) | opposite of main | Creates movement |
| Ride | ±20 to ±40 | Opposite side of main hat |
| Crash | ±20 to ±50 | Can vary per hit |
| Percussion (shaker, etc.) | ±40 to ±80 | Wide, fills sides |
| Lead synth | 0 to ±15 | Focused, center-ish |
| Lead layer/double | opposite of main | If layered, split them |
| Pad | ±50 to ±100 | Wide stereo |
| Atmosphere/Texture | ±60 to ±100 | Very wide |
| FX/Risers | ±50 to ±100 or automate | Movement and width |
| Vocal/Main melody | 0 | Always centered |

---

## Priority Rules

1. **CRITICAL first**: Mono collapse (everything center)
2. **SEVERE second**: Wrong elements panned (bass off-center)
3. **MODERATE third**: Imbalanced stereo, missed width opportunities
4. **Provide COMPLETE pan plan**: Every track needs a recommendation

---

## Balancing Left and Right

When assigning pans:
- For every element panned left, pan something similar right
- Keep overall energy balanced (similar loudness on each side)
- Example balance:
  - Hat left (-25) ↔ Ride right (+30)
  - Perc 1 left (-50) ↔ Perc 2 right (+50)
  - Pad layer left (-70) ↔ Pad layer right (+70)

---

## Example Output Snippet

```
[CRITICAL] Complete Mono Collapse — No Stereo Width
───────────────────────────────────────────────────
PROBLEM: 48 of 48 tracks (100%) are at pan = 0 (dead center)
IMPACT: Mix sounds flat, narrow, and amateur. No stereo interest,
        no separation between elements, everything fighting for 
        the same space in the center.

ACTION REQUIRED:
This is your single biggest opportunity for improvement.
Apply the complete pan plan below — this alone will transform your mix.

IMMEDIATE WINS (do these first):
→ 5-Imba Open Hat 41: Pan to -25 (25% left)
→ 9-US_RIDE_08: Pan to +30 (30% right)
→ Percussion tracks: Pan to ±50 (opposite sides)
→ TRITON pads: Pan layers to ±70 or apply stereo widener

WHY THIS WORKS: Creates space for each element, adds professional
                width, reduces masking, makes the mix feel "big"
```

---

## Do NOT Do

- Don't suggest panning kick or bass off-center — this kills low end
- Don't give vague advice like "add width" — give EXACT pan values
- Don't forget to balance left and right — lopsided mixes sound wrong
- Don't ignore track names — they tell you what element type it is
- Don't treat all tracks the same — element type determines pan position
