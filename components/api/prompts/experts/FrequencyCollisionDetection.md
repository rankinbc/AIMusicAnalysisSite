# Prompt 3: Frequency Collision Detection

## Your Task

Analyze the provided Ableton project JSON file to detect frequency collisions between tracks. Your goal is to identify where multiple tracks occupy the same frequency space simultaneously, causing mud and masking, and provide **specific fixes with exact timestamps and EQ/arrangement recommendations**.

---

## JSON Fields to Analyze

```
tracks[].name                           → Track identification
tracks[].is_muted                       → Skip muted tracks
tracks[].midi_clips[].start_time        → Clip position in song (beats)
tracks[].midi_clips[].notes[].pitch     → MIDI pitch (convert to frequency)
tracks[].midi_clips[].notes[].start_time → Note position within clip
tracks[].midi_clips[].notes[].duration  → How long note sustains
als_project.tempo                       → For converting beats to time
als_project.project_structure.locators  → Section markers
```

---

## Frequency Conversion

**MIDI Pitch to Frequency Formula:**
```
frequency_hz = 440 × 2^((pitch - 69) / 12)
```

**Quick Reference:**
| Pitch | Note | Frequency | Range |
|-------|------|-----------|-------|
| 24 | C0 | 32 Hz | Sub bass |
| 36 | C1 | 65 Hz | Bass |
| 48 | C2 | 131 Hz | Low-mid |
| 60 | C3 | 262 Hz | Mid |
| 72 | C4 | 523 Hz | Mid |
| 84 | C5 | 1047 Hz | Upper-mid |
| 96 | C6 | 2093 Hz | Presence |

**Frequency Bands:**
| Range | Frequencies | Character |
|-------|-------------|-----------|
| Sub bass | 20-60 Hz | Feel, not heard |
| Bass | 60-200 Hz | Punch, weight |
| Low-mid | 200-500 Hz | **MUD ZONE** — most problems here |
| Mid | 500-2000 Hz | Body, presence |
| Upper-mid | 2-6 kHz | Clarity, attack |
| High | 6-20 kHz | Air, sparkle |

---

## Analysis Steps

### Step 1: Build Absolute Timeline

For each note in the project:
1. Calculate absolute start time: `clip_start_time + note_start_time`
2. Calculate absolute end time: `absolute_start + note_duration`
3. Convert pitch to frequency
4. Assign frequency band
5. Store: `{track, start, end, pitch, frequency, band}`

### Step 2: Detect Collisions

For each frequency band, find time ranges where multiple tracks have overlapping notes:

```python
# Pseudocode
for each note N1:
    for each note N2 where N2.start < N1.end and N2.end > N1.start:
        if N1.track != N2.track and same_frequency_band(N1, N2):
            collision_detected(N1, N2, overlap_time)
```

**Collision Severity by Band:**
| Band | 2 tracks | 3-4 tracks | 5+ tracks |
|------|----------|------------|-----------|
| Sub bass (20-60Hz) | SEVERE | CRITICAL | CRITICAL |
| Bass (60-200Hz) | MODERATE | SEVERE | CRITICAL |
| Low-mid (200-500Hz) | MINOR | MODERATE | SEVERE |
| Mid (500-2kHz) | MINOR | MINOR | MODERATE |
| Upper-mid+ | OK | MINOR | MINOR |

### Step 3: Aggregate by Section

Group collisions by song section (using locators):
- Count total collisions per section
- Identify worst sections
- Identify most problematic track pairs

### Step 4: Identify Specific Problem Pairs

Find track combinations that collide most frequently:
- Same two tracks repeatedly overlapping in same band
- These are arrangement-level problems

---

## Output Format

### Summary
```
FREQUENCY COLLISION REPORT
==========================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Collision Statistics:
- Total collisions detected: X
- Sub bass collisions: X [CRITICAL if >0]
- Bass collisions: X [CRITICAL if >100]
- Low-mid collisions: X [SEVERE if >200]
- Mid collisions: X

Worst Section: [section name] with X collisions
Most Problematic Pair: [track1] + [track2] with X overlaps
```

### Prioritized Issues (MOST IMPORTANT FIRST)

```
[SEVERITY] Collision Type — Frequency Band
──────────────────────────────────────────
PROBLEM: [Track A] and [Track B] both occupy [X-Y Hz] simultaneously
LOCATION: [X] collisions between beats [start] and [end] 
          (Section: "[section name]" at [MM:SS])
IMPACT: [Description of audible problem — mud, masking, loss of punch]

SPECIFIC COLLISION EXAMPLES:
  • Beat 128.0 (3:33): Both tracks playing [pitch/Hz]
  • Beat 256.0 (7:06): [Track A] at [X Hz], [Track B] at [Y Hz]
  • Beat 384.0 (10:40): ...

FIX OPTIONS (choose one):

Option 1 — EQ Separation:
  → [Track A]: Cut 3dB at [X Hz] with Q=2.0
  → [Track B]: Cut 3dB at [Y Hz] with Q=2.0
  → This carves space for each element

Option 2 — Arrangement Change:
  → Mute [Track B] during section "[section name]"
  → Or: Move [Track B] up one octave (pitch +12)

Option 3 — Sidechain:
  → Sidechain [Track B] to [Track A]
  → Settings: Attack <5ms, Release 100-150ms, 4-6dB reduction

RECOMMENDED: [Which option is best for this specific case]
```

### Section-by-Section Breakdown

```
COLLISION DENSITY BY SECTION
============================

Section "Start0" (1:46 - 3:33)
  Bass collisions: 603 [CRITICAL]
  Low-mid collisions: 245 [SEVERE]
  Worst pairs:
    → 38-TRITON + 39-TRITON: 42 overlaps at 185Hz
    → 26-MonoPoly + 27-MonoPoly: 38 overlaps at 123Hz
  
  PRIORITY FIX: These sections need arrangement thinning.
                Too many bass elements playing simultaneously.

Section "5" (8:13 - 9:33)
  Bass collisions: 1,328 [CRITICAL — WORST SECTION]
  ...
```

### Most Problematic Track Pairs

```
TRACK PAIRS REQUIRING ATTENTION
===============================

1. [Track A] ↔ [Track B]
   Collision count: X
   Primary frequency: ~XXX Hz (low-mid)
   
   ROOT CAUSE: Both are [bass/pad/lead] elements in same register
   
   FIX: 
   → Recommended: [specific fix]
   → EQ settings: [specific settings]

2. [Track C] ↔ [Track D]
   ...
```

---

## Specific Fixes by Collision Type

### Kick + Bass Collision (Most Critical)

```
PROBLEM: Kick and bass both have energy in 50-80Hz range
FIX OPTIONS:
1. High-pass bass at 80Hz, let kick own the sub
2. Sidechain bass to kick: Attack 0-5ms, Release 100-200ms, 4-6dB GR
3. Cut bass 3dB at kick's fundamental frequency
4. Use different kick (one with higher fundamental ~100Hz)
```

### Multiple Bass Elements

```
PROBLEM: 3+ tracks with fundamentals in 60-200Hz range
FIX: You cannot EQ your way out of this — it's an arrangement problem
SOLUTIONS:
1. Mute all but ONE bass element per section
2. Alternate bass elements (Track A verse, Track B chorus)
3. Move duplicates up an octave
4. If layering intentionally: EQ each to different slot
   → Layer 1: Sub focus (40-80Hz)
   → Layer 2: Punch focus (80-150Hz)  
   → Layer 3: Growl focus (150-300Hz)
```

### Low-Mid Mud (200-500Hz)

```
PROBLEM: Multiple synths/pads accumulating in mud zone
FIX:
1. High-pass non-bass elements at 150-200Hz
2. Cut 2-4dB at 300-400Hz on pads and synths
3. Only ONE element should "own" the low-mid warmth
4. Pan competing elements to opposite sides
```

---

## Priority Rules

1. **CRITICAL**: Sub bass and bass collisions (kills punch and clarity)
2. **SEVERE**: 5+ elements in any band, or 3+ in bass
3. **MODERATE**: Low-mid buildup (200-500Hz mud)
4. **MINOR**: Mid and high frequency overlaps (less problematic)

Focus on:
- Kick/bass relationship FIRST
- Then bass/synth separation
- Then overall low-mid cleanup

---

## Timestamp Conversion

**Beats to Time (for your tempo of 144 BPM):**
```
seconds = beats × 60 / tempo
MM:SS = format(seconds / 60, seconds % 60)
```

Example: Beat 256 at 144 BPM = 106.67 seconds = 1:46

---

## Example Output Snippet

```
[CRITICAL] Bass Frequency Collision — 60-200Hz
──────────────────────────────────────────────
PROBLEM: "26-MonoPoly" and "27-MonoPoly" both playing 185Hz simultaneously
         across 603 collision points in section "Start0"
LOCATION: Beats 256-512 (1:46 - 3:33), Section "Start0"
IMPACT: Low end is muddy, neither bass element is defined, 
        kick punch is masked

SPECIFIC COLLISION EXAMPLES:
  • Beat 256.2 (1:46): Both tracks at F#2 (185Hz) for 0.5 beats
  • Beat 260.0 (1:50): 26-MonoPoly at 185Hz, 27-MonoPoly at 123Hz
  • Beat 264.5 (1:54): Both tracks at 185Hz again

FIX OPTIONS:

Option 1 — Remove Duplicate (RECOMMENDED):
  → These appear to be layered bass sounds
  → Mute "27-MonoPoly" OR combine into single track
  → If both needed: Pan 26 slightly left, 27 slightly right (±10 max)

Option 2 — EQ Separation:
  → 26-MonoPoly: Cut 3dB at 185Hz, boost 2dB at 100Hz
  → 27-MonoPoly: Cut 3dB at 100Hz, boost 2dB at 185Hz
  → This gives each bass its own "slot"

Option 3 — Octave Separation:
  → Move 27-MonoPoly up 12 semitones (one octave)
  → It becomes a mid-bass layer instead of competing

RECOMMENDED: Option 1 — you likely don't need two bass tracks 
             playing the same notes. Simplify.
```

---

## Do NOT Do

- Don't report every single collision — aggregate and prioritize
- Don't ignore muted tracks — they're muted for a reason
- Don't treat all frequency bands equally — bass collisions are far worse
- Don't suggest "EQ it" without specific frequencies and dB values
- Don't miss arrangement-level problems — sometimes the fix is "remove the track"
