# Audio Analysis Module: 3D Spatial Perception Specialist

## Your Task

Analyze the provided audio analysis JSON file to evaluate the three-dimensional spatial perception of the mix. Your goal is to assess height (frequency), depth (reverb/distance), and width consistency, and provide **specific spatial enhancement techniques**.

---

## JSON Fields to Analyze

### Primary Spatial Data
```
audio_analysis.spatial.height_score          → 0-100 vertical frequency spread
audio_analysis.spatial.depth_score           → 0-100 front-to-back dimension
audio_analysis.spatial.width_consistency     → 0-100 stereo stability over time
audio_analysis.spatial.perceived_height      → 'low', 'balanced', 'high', 'extreme'
audio_analysis.spatial.perceived_depth       → 'flat', 'moderate', 'deep', 'cavernous'
audio_analysis.spatial.spatial_balance       → Overall assessment
```

### Supporting Data
```
audio_analysis.stereo.correlation            → Stereo width indicator
audio_analysis.stereo.width_estimate         → 0-100% stereo width
audio_analysis.frequency.*_energy            → Frequency distribution
```

---

## 3D Spatial Concepts

### The Three Dimensions of Audio
```
HEIGHT (Vertical Dimension)
───────────────────────────
Low frequencies = "ground" (20-200Hz)
Mid frequencies = "body" (200Hz-2kHz)
High frequencies = "sky/air" (2kHz-20kHz)

A good mix has energy distributed across all "heights"
Not everything on the ground, not everything in the air

WIDTH (Horizontal Dimension)
────────────────────────────
Left ← Center → Right

Mono elements: Center (kick, bass, lead)
Stereo elements: Spread L-R (pads, FX, ambience)

DEPTH (Front-to-Back Dimension)
───────────────────────────────
Dry/close = "in your face" (front)
Wet/reverby = "distant" (back)

Creates sense of space and dimension
Prevents mix from sounding flat
```

### Height Score Interpretation
```
85-100: Excellent - Full frequency spectrum utilized
        Energy from sub-bass to air frequencies

70-84:  Good - Solid frequency spread
        Minor gaps in spectrum

55-69:  Moderate - Some frequency ranges underrepresented
        Mix may sound thin or heavy

40-54:  Poor - Significant frequency gaps
        Mix sounds unbalanced vertically

<40:    Very poor - Major frequency issues
        Mix concentrated in narrow range
```

### Depth Score Interpretation
```
85-100: Excellent - Clear front-to-back dimension
        Some elements close, some distant
        Creates sense of space

70-84:  Good - Reasonable depth
        Most elements have their place

55-69:  Moderate - Some depth but flat areas
        May need more reverb variation

40-54:  Poor - Mix sounds flat
        All elements at same distance

<40:    Very poor - Two-dimensional sound
        No sense of space or depth
```

### Width Consistency Interpretation
```
85-100: Rock solid - Stereo image stable throughout
        Width doesn't fluctuate wildly

70-84:  Good - Minor width variations
        Generally stable stereo field

55-69:  Moderate - Noticeable width changes
        Some sections significantly different

40-54:  Poor - Unstable stereo image
        Width fluctuates distractingly

<40:    Very poor - Erratic stereo field
        May indicate automation issues or phase problems
```

---

## Severity Thresholds

| Problem | Detection | Severity |
|---------|-----------|----------|
| Very unstable width | `width_consistency < 50` | SEVERE |
| Mix is flat/2D | `depth_score < 40` | MODERATE |
| Extreme height imbalance | `height_score < 40` | MODERATE |
| Width inconsistency | `width_consistency < 70` | WARNING |
| Depth issues | `depth_score < 60` | WARNING |

---

## Analysis Steps

### Step 1: Evaluate Height (Frequency Spread)
```
IF height_score < 50:
    Mix concentrated in narrow frequency range
    Check sub-bass, presence, and air frequencies

IF perceived_height = 'low':
    Missing high frequencies - add air
IF perceived_height = 'extreme':
    Too much high frequency - may be harsh
```

### Step 2: Evaluate Depth (Front-to-Back)
```
IF depth_score < 50:
    Mix sounds flat, two-dimensional
    Need variation in reverb/delay amounts

IF perceived_depth = 'flat':
    All elements at same distance - boring
IF perceived_depth = 'cavernous':
    Too much reverb - might be washy
```

### Step 3: Evaluate Width Consistency
```
IF width_consistency < 60:
    Stereo image unstable over time
    Check for:
    - Extreme stereo modulation
    - Phase issues
    - Inconsistent panning automation
```

### Step 4: Check Overall Spatial Balance
```
All three dimensions should be balanced:
    Height + Depth + Width = 3D sound

If one dimension is weak:
    Mix sounds flat or uninteresting
    Address the weakest dimension first
```

---

## Output Format

### Summary
```
3D SPATIAL PERCEPTION ANALYSIS
==============================
Overall Status: [3D SOUND / NEEDS DEPTH / FLAT MIX]

Spatial Dimensions:
  Height (Frequency): [X]/100 → [interpretation]
  Depth (Distance):   [X]/100 → [interpretation]
  Width Stability:    [X]/100 → [interpretation]

Perceived Character:
  Height feel: [low/balanced/high/extreme]
  Depth feel: [flat/moderate/deep/cavernous]

Spatial Balance: [assessment]
```

### Prioritized Issues

```
[SEVERITY] Issue Title
─────────────────────────────────
PROBLEM: [Specific description]
IMPACT: [What sounds wrong]
CURRENT: [X]
TARGET: [Y]

FIX:

Step 1: [Specific action]
        → [Exact technique]

Step 2: [Specific action]
        → [Exact setting]

EXPECTED RESULT: [What will improve]
```

---

## Common Problems & Specific Fixes

### Problem: Mix Sounds Flat (Low Depth)
```
MODERATE — Depth score at [X]/100 (target: >65)

WHY THIS MATTERS:
- Mix sounds two-dimensional
- All elements at same apparent distance
- No sense of space or environment
- Sounds amateur and "direct-to-console"

DETECTION: depth_score < 50 OR perceived_depth = 'flat'

FIX:

Step 1: Create front-to-back placement plan
  → FRONT (dry, close):
    - Kick
    - Snare
    - Lead vocal/synth
    - Bass
  → MIDDLE (moderate reverb):
    - Supporting synths
    - Percussion
    - Background elements
  → BACK (wet, distant):
    - Pads
    - Atmosphere
    - FX tails
    - Reverb wash

Step 2: Add reverb strategically
  → Create depth with reverb AMOUNT, not type:
    - Front elements: 5-15% wet
    - Middle elements: 20-35% wet
    - Back elements: 40-60% wet

Step 3: Use pre-delay for separation
  → Short pre-delay (10-30ms): Element sounds close
  → Long pre-delay (50-80ms): Element sounds distant
  → Reverb on drums: 20-40ms pre-delay

Step 4: EQ to create depth
  → Close/front elements: Brighter, more presence
    - Boost +2dB at 3-5kHz
  → Distant/back elements: Darker, less presence
    - Cut -2dB at 3-5kHz
    - Roll off highs above 10kHz

Step 5: Use different reverb types
  → Close: Short room or plate (0.5-1.5s)
  → Mid: Medium hall (1.5-2.5s)
  → Distant: Long hall or ambient (3-5s)

REVERB SETTINGS EXAMPLE:
  Kick: No reverb (front and center)
  Lead synth: Room, 15% wet, 30ms pre-delay
  Pads: Hall, 45% wet, 60ms pre-delay, -2dB at 4kHz

VERIFY: Depth score should rise above 60
        Mix should feel "3D" with clear depth
```

### Problem: Unstable Stereo Width
```
SEVERE — Width consistency at [X]% (target: >70%)

WHY THIS MATTERS:
- Stereo image fluctuates throughout track
- Distracting for listeners
- Sounds unprofessional
- May indicate phase or automation issues

DETECTION: width_consistency < 60

FIX:

Step 1: Identify width-varying elements
  → Listen for elements that "breathe" in stereo
  → Often: Autopan, stereo modulation, phaser
  → Or: Different width in different sections

Step 2: Reduce extreme stereo modulation
  → Autopan: Reduce depth from 100% to 30-50%
  → Stereo widener: Reduce modulation speed
  → Phaser/chorus: Reduce rate and depth

Step 3: Standardize section widths
  → Intro and outro can be narrower
  → But main sections should be consistent
  → Don't go from 30% width to 90% suddenly

Step 4: Check for phase-related issues
  → Extreme stereo processing can cause instability
  → Test in mono - if volume changes, phase issues
  → Reduce stereo widening if phase is affected

Step 5: Use consistent stereo sends
  → Same reverb for similar elements
  → Same widening for similar element types
  → Creates cohesive stereo image

VERIFY: Width consistency should rise above 70%
        Stereo image should feel stable throughout
```

### Problem: Height Imbalance (Frequency Distribution)
```
MODERATE — Height score at [X]/100 (target: >65)
           Perceived height: [low/extreme]

WHY THIS MATTERS:
- Not using full frequency spectrum
- Mix sounds thin, heavy, or unbalanced
- Missing "air" up top or "weight" down low
- Professional mixes use all frequencies

DETECTION: height_score < 50 OR perceived_height not 'balanced'

IF perceived_height = 'low':
  Mix is bottom/mid-heavy, lacking air

  FIX:
  Step 1: Add high-frequency content
    → Boost hi-hat/cymbal levels +2-3dB
    → Add air shelf: +2dB at 10kHz
    → Check LP filters - may be too aggressive

  Step 2: Add sparkle to key elements
    → On leads: +1.5dB shelf at 8kHz
    → On pads: +2dB shelf at 12kHz
    → Use exciter for harmonic generation

  Step 3: Check for missing elements
    → Is there hi-hat content?
    → Are cymbals/rides audible?
    → Add high percussion if needed

IF perceived_height = 'extreme':
  Mix is too bright/top-heavy

  FIX:
  Step 1: Reduce excessive highs
    → Cut hi-hat level by 2-3dB
    → Reduce air shelf if present
    → LP filter at 15-18kHz if harsh

  Step 2: Add body and weight
    → Boost bass +1-2dB
    → Add warmth: +2dB at 200Hz
    → Ensure sub-bass is present

  Step 3: Balance frequency spectrum
    → Target roughly equal energy across bands
    → Sub, bass, low-mid, mid, high-mid, high

VERIFY: Height score should rise above 60
        Perceived height should read "balanced"
```

### Problem: Too Much Depth (Cavernous)
```
WARNING — Perceived depth: CAVERNOUS

WHY THIS MATTERS:
- Mix sounds washy and indistinct
- Elements lose definition in reverb
- Sounds distant and disconnected
- Common problem with over-reverbing

DETECTION: perceived_depth = 'cavernous'

FIX:

Step 1: Reduce overall reverb amounts
  → Cut all reverb sends by 3-6dB
  → Or: Reduce reverb return faders

Step 2: Keep front elements dry
  → Kick: No reverb (or just transient click)
  → Bass: No reverb
  → Lead: Minimal reverb, short decay

Step 3: Shorten reverb times
  → Long reverb (>3s) makes things distant
  → Try shorter halls (1.5-2s)
  → Use room instead of hall for close elements

Step 4: Use reverb high-pass filter
  → HP reverb return at 300-500Hz
  → Keeps low end clear and defined
  → Reverb still provides space without mud

Step 5: Add dry signal back
  → Some elements may need more dry signal
  → Blend reverb in rather than replacing dry

VERIFY: Depth should feel "moderate" to "deep"
        Not "cavernous" or washy
```

---

## 3D Mixing Techniques

### Creating Height (Frequency)
```
LOW (20-200Hz):
  - Sub-bass: Foundation, power
  - Kick low end: Thump
  - Bass fundamental: Weight

MID (200Hz-2kHz):
  - Kick body: Punch
  - Bass harmonics: Definition
  - Snare body: Crack
  - Lead presence: Clarity

HIGH (2kHz-20kHz):
  - Hi-hats: Rhythm, sparkle
  - Cymbals: Air, release
  - Lead harmonics: Cut-through
  - Air/shimmer: Space

TECHNIQUE: Each element occupies a HEIGHT
  Kick = low + mid attack
  Lead = mid + high harmonics
  Pads = mid + high air
```

### Creating Depth (Distance)
```
TECHNIQUES FOR DEPTH:

1. REVERB AMOUNT
   Close = dry to 15% wet
   Mid = 20-40% wet
   Far = 50-80% wet

2. PRE-DELAY
   Close = 0-20ms
   Mid = 20-50ms
   Far = 50-100ms+

3. EQ SHAPING
   Close = bright, present (+3kHz)
   Far = darker, rolled off (-3kHz, LP at 8kHz)

4. LEVEL
   Close = louder
   Far = quieter

5. COMPRESSION
   Close = punchy, controlled
   Far = more dynamics, less compressed
```

### Creating Width (Stereo)
```
CENTER (MONO):
  - Kick
  - Bass
  - Sub
  - Lead (mostly)
  - Snare

MODERATE SPREAD (30-60%):
  - Hi-hats
  - Percussion
  - Supporting synths

WIDE SPREAD (60-100%):
  - Pads
  - Atmosphere
  - FX/risers
  - Room ambience

TECHNIQUE: Width increases from center outward
  Core elements anchor the center
  Supporting elements fill the sides
  Creates a stable, immersive image
```

---

## Priority Rules

1. **SEVERE**: Unstable width (<50%) - distracting issue
2. **MODERATE**: Mix sounds flat (<50 depth) - major character issue
3. **MODERATE**: Height imbalance (<50) - frequency problem
4. **WARNING**: Width inconsistency (<70%) - polish issue
5. **WARNING**: Depth needs work (<65) - minor character issue
6. **INFO**: Spatial observations

---

## Example Output Snippet

```
[MODERATE] Mix Sounds Flat (Low Depth Score)
────────────────────────────────────────────
PROBLEM: Depth score at 42/100 (target: >65)
         Mix sounds two-dimensional with no front-to-back space.

CURRENT: Depth = 42, perceived = 'flat'
TARGET: Depth > 65, perceived = 'moderate' or 'deep'

IMPACT:
- All elements sound at same distance
- No sense of space or dimension
- Mix sounds amateur and "direct"
- Lacks the immersive quality of pro mixes

FIX:

Step 1: Plan element depth placement
        → Front: Kick, snare, lead, bass (dry)
        → Middle: Percussion, supporting synths (moderate reverb)
        → Back: Pads, atmosphere, FX (more reverb)

Step 2: Add reverb variation
        → Create "Close" reverb: Room, 0.8s, send -12dB
        → Create "Mid" reverb: Plate, 1.5s, send -8dB
        → Create "Far" reverb: Hall, 2.5s, send -5dB
        → Route elements to appropriate sends

Step 3: Use EQ to reinforce depth
        → Front elements: +2dB at 3-4kHz (presence)
        → Back elements: -2dB at 3-4kHz, LP at 10kHz (distance)

EXPECTED RESULT:
  Depth score rises to 60+
  Mix feels three-dimensional
  Elements have clear front-to-back placement
```

---

## Do NOT Do

- Don't treat all elements equally in depth - create hierarchy
- Don't use same reverb amount on everything - that's what causes flatness
- Don't ignore width consistency - it's often overlooked but important
- Don't forget that height = frequency, not actual spatial height
- Don't over-reverb to fix flatness - moderate variation is key
- Don't leave all elements at same apparent distance - boring!
