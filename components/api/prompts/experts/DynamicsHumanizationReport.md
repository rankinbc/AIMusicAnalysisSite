# Prompt 4: Dynamics & Humanization Report

## Your Task

Analyze the provided Ableton project JSON file to evaluate velocity dynamics and humanization. Your goal is to identify tracks that sound robotic or lifeless due to static velocity, and provide **specific velocity adjustments, accent patterns, and humanization recommendations**.

---

## JSON Fields to Analyze

```
midi_analysis[].track_name          → Track identification
midi_analysis[].velocity_mean       → Average velocity (0-127)
midi_analysis[].velocity_std        → Velocity variation (standard deviation)
midi_analysis[].velocity_range      → [min, max] velocity values
midi_analysis[].humanization_score  → "natural" or "robotic"
midi_analysis[].swing_ratio         → Timing feel (0.5 = straight, >0.5 = swing)
midi_analysis[].note_count          → How many notes (more notes = more important to fix)

tracks[].midi_clips[].notes[].velocity → Individual note velocities for detailed analysis
```

---

## Analysis Steps

### Step 1: Identify Robotic Tracks

| Severity | Detection Criteria |
|----------|---------------------|
| CRITICAL | velocity_std = 0 (all notes identical) |
| SEVERE | velocity_std < 3 |
| MODERATE | velocity_std < 8 AND velocity_range span < 20 |
| MINOR | humanization_score = "robotic" but std > 8 |

### Step 2: Categorize by Element Type

Different elements need different velocity treatment:

**Drums (need most variation):**
- Kick: Moderate variation (std 5-15), accent on downbeats
- Snare: High variation (std 10-20), ghost notes at low velocity
- Hi-hats: Highest variation (std 15-25), constant movement
- Percussion: High variation (std 10-20)

**Synths/Melodic (moderate variation):**
- Lead: Moderate variation (std 8-15), accent on phrase starts
- Pad: Low variation OK (std 3-8), smooth and even is fine
- Bass: Low-moderate variation (std 5-10)

**FX (case by case):**
- Risers: Usually programmed, static OK
- One-shots: Static OK

### Step 3: Analyze Velocity Patterns

For tracks with note-level data, check:
- Are downbeats louder than offbeats?
- Is there any accent pattern?
- Do builds increase in velocity?
- Are there ghost notes or quieter layers?

### Step 4: Calculate Humanization Recommendations

For each robotic track, determine:
1. What type of element is it?
2. What velocity range should it have?
3. What accent pattern fits the genre?

---

## Output Format

### Summary
```
DYNAMICS & HUMANIZATION REPORT
==============================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Velocity Statistics:
- Tracks analyzed: X
- Robotic tracks (std=0): X [CRITICAL if >0]
- Nearly robotic (std<5): X [SEVERE]
- Under-humanized (std<10): X [MODERATE]
- Well-humanized (std>10): X

Most Robotic Track: [name] with velocity_std = X
```

### Prioritized Issues (MOST IMPORTANT FIRST)

```
[SEVERITY] Track Name — Element Type
────────────────────────────────────
CURRENT STATE:
  Velocity mean: X
  Velocity std: 0 (completely static)
  Velocity range: [X, X] (no variation)
  Note count: X notes

PROBLEM: Every single hit is identical at velocity X
IMPACT: Sounds mechanical, lifeless, fatiguing to listen to.
        Human players NEVER hit exactly the same twice.

ACTION REQUIRED:

Step 1 — Add Random Variation:
  → Select all notes in track
  → Apply velocity randomization: ±[X] from current value
  → Target std: [recommended std for this element]

Step 2 — Create Accent Pattern:
  → Beat 1 (downbeat): velocity [X]
  → Beat 2: velocity [Y]
  → Beat 3: velocity [X-5]
  → Beat 4: velocity [Y]
  → Offbeats (8ths/16ths): velocity [Z]

Step 3 — Add Dynamics Over Time:
  → Builds: Gradually increase from [X] to [Y] over [N] bars
  → Drops: Start at [X], settle to [Y]
  → Breakdowns: Reduce to [X]

SPECIFIC VALUES FOR THIS TRACK:
  → Base velocity: [X]
  → Accent hits: [Y] 
  → Ghost notes: [Z]
  → Target velocity_std: [recommended]
  → Target velocity_range: [min, max]
```

### Track-by-Track Recommendations

```
HUMANIZATION RECOMMENDATIONS
============================

CRITICAL — Fix Immediately:
━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Track Name] (Snare)
  Current: std=0, all hits at 100
  Target: std=12-18, range [60, 115]
  
  Pattern (4/4 at 144 BPM):
    Beat 2: 105-110 (main snare)
    Beat 4: 100-105 (slightly softer)
    Ghost notes (if any): 50-70
    Fills: Build from 80 → 115
  
  How to apply in Ableton:
    1. Select all notes → Randomize velocity ±10
    2. Select beat 2 hits → Set to 108
    3. Select beat 4 hits → Set to 102

━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Track Name] (Hi-hat)
  Current: std=3.5, range [95, 103]
  Target: std=18-25, range [50, 110]
  
  Pattern (16th notes):
    Downbeats (1, 2, 3, 4): 90-100
    Offbeats (ands): 70-85
    Ghost 16ths (e, a): 50-65
    Open hats: 100-110
  
  How to apply:
    1. Select all → Randomize ±15
    2. Use velocity groove template
    3. Or manually: louder on quarters, softer on 16ths

SEVERE — Fix Soon:
━━━━━━━━━━━━━━━━━━

[Continue for each track...]
```

---

## Velocity Reference by Element Type

### Drums (Trance @ 138-145 BPM)

| Element | Base Vel | Range | Std | Accent Pattern |
|---------|----------|-------|-----|----------------|
| Kick | 110 | 100-120 | 5-10 | Consistent, slight variation |
| Snare | 100 | 60-115 | 12-18 | Loud on 2/4, ghosts at 50-70 |
| Clap | 95 | 80-110 | 10-15 | Layer with snare, slight offset |
| Closed HH | 80 | 50-100 | 18-25 | Offbeats louder, 16ths quiet |
| Open HH | 90 | 70-110 | 12-18 | Accent hits, before snare |
| Ride | 85 | 60-100 | 15-20 | Quarters louder |
| Crash | 110 | 100-120 | 5-10 | Consistent (one-shots) |
| Perc | 75 | 50-100 | 15-25 | Groove-dependent |

### Synths (Trance)

| Element | Base Vel | Range | Std | Notes |
|---------|----------|-------|-----|-------|
| Lead | 100 | 80-115 | 8-15 | Accent phrase starts |
| Pad | 90 | 80-100 | 3-8 | Even is OK, slight movement |
| Bass | 105 | 90-115 | 5-12 | Accent with kick |
| Arp | 85 | 60-100 | 12-20 | Pattern creates interest |
| Pluck | 95 | 75-110 | 10-18 | Accent downbeats |

---

## Accent Patterns for Trance

### Basic 4/4 Drum Pattern
```
Beat:     1    +    2    +    3    +    4    +
Kick:    110   -   105   -   110   -   105   -
Snare:    -    -   108   -    -    -   105   -
HH:       85   70   90   65   85   70   90   65
```

### 16th Note Hi-Hat Pattern
```
16ths:   1  e  +  a  2  e  +  a  3  e  +  a  4  e  +  a
HH vel: 90 55 75 50 95 55 80 50 90 55 75 55 95 60 80 50
```

### Build-up Velocity Curve
```
Bar:     1    2    3    4    5    6    7    8
Snare:  85   88   92   95   98  102  108  115
HH:     70   73   77   82   87   93  100  108
```

---

## Swing/Groove Analysis

**Your swing_ratio values indicate timing feel:**
- 0.50 = Perfectly straight (quantized)
- 0.52-0.54 = Subtle swing (natural feel)
- 0.55-0.58 = Moderate swing (groovy)
- 0.60+ = Heavy swing (triplet feel)

**For Trance:**
- Drums: Usually straight (0.50-0.52)
- Hi-hats: Slight swing OK (0.52-0.55)
- Synths: Straight or very subtle swing
- Pads: Can be looser

If swing_ratio varies wildly between tracks, the groove may feel disjointed.

---

## Priority Rules

1. **CRITICAL**: std=0 tracks (completely robotic)
2. **SEVERE**: Drums with std<5 (drums MUST have variation)
3. **MODERATE**: Melodic elements with std<8
4. **MINOR**: Pads and FX with low variation (less important)

Focus on drums first — they drive the energy and feel of trance.

---

## Example Output Snippet

```
[CRITICAL] 6-Imba Snare 52 — Snare Drum
───────────────────────────────────────
CURRENT STATE:
  Velocity mean: 100
  Velocity std: 0.0 (completely static)
  Velocity range: [100, 100]
  Note count: 384 notes

PROBLEM: Every single snare hit is exactly velocity 100.
         This is the most robotic-sounding track in your project.
IMPACT: Snare sounds like a machine, not a drummer. Listeners 
        experience fatigue. The groove has no life.

ACTION REQUIRED:

Step 1 — Add Random Variation:
  → Select all 384 notes
  → In Ableton: Notes → Randomize → Velocity ±12
  → This alone will help significantly

Step 2 — Create Accent Pattern:
  → Select all notes on beat 2: Set velocity to 108
  → Select all notes on beat 4: Set velocity to 102
  → Select any ghost notes: Set velocity to 55-70

Step 3 — Build Dynamics:
  → During builds: Gradually increase from 90 → 115 over 8 bars
  → At drops: Start at 110, maintain 100-108 average
  → Breakdowns (if snare plays): Reduce to 75-85

TARGET STATE:
  Velocity mean: ~100 (similar)
  Velocity std: 12-18 (currently 0)
  Velocity range: [55, 115]

HOW TO VERIFY:
  After changes, check that velocity_std is between 12-18.
  Listen — the snare should "breathe" and have groove.
```

---

## Do NOT Do

- Don't just say "add variation" — give EXACT velocity values
- Don't treat all elements the same — drums need more variation than pads
- Don't ignore note count — high note count tracks matter more
- Don't recommend huge variation for kick — kick should be consistent
- Don't forget accent patterns — random variation isn't enough
