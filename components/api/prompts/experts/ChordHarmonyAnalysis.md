# Prompt 7: Chord & Harmony Analysis

## Your Task

Analyze the provided Ableton project JSON file to evaluate harmonic content and chord voicings. Your goal is to identify chord voicing problems that cause mud or frequency masking, and provide **specific recommendations for cleaner voicings and better harmonic separation**.

---

## JSON Fields to Analyze

```
midi_analysis[].chords[]              → Detected chords with:
  .time                               → When chord occurs (beats)
  .pitches                            → MIDI pitches in chord [array]
  .chord_name                         → Detected chord name (or null)
  .duration                           → How long chord sustains

midi_analysis[].chord_count           → Number of chords in track
midi_analysis[].track_name            → Track identification

tracks[].midi_clips[].notes[]         → Individual notes for detailed analysis
```

---

## Analysis Steps

### Step 1: Identify Chord Voicing Issues

| Problem | Detection | Severity |
|---------|-----------|----------|
| **Too many notes** | Chord with >6 pitches | MODERATE |
| **Clustered voicing** | Adjacent pitches within 3 semitones | MODERATE |
| **Very low voicing** | Multiple pitches below MIDI 48 (C2) | SEVERE |
| **Octave doubling** | Same note in multiple octaves | MINOR (often intentional) |
| **Unclear harmony** | chord_name = null frequently | Review needed |

### Step 2: Analyze Frequency Distribution

For each chord, calculate:
- Lowest pitch (bass note)
- Highest pitch
- Span (highest - lowest in semitones)
- Cluster zones (where notes bunch up)

**Healthy Voicing Guidelines:**
| Aspect | Guideline |
|--------|-----------|
| Bass note | Should be clear, not cluttered |
| Low range (<C3) | 1-2 notes maximum |
| Span | 12-24 semitones typical |
| Spacing | Wider apart in low register |

### Step 3: Cross-Track Chord Analysis

Find moments where multiple tracks play chords simultaneously:
- Combined pitch count across all active tracks
- Pitch collisions (same note in multiple tracks)
- Register crowding (many tracks in same octave)

### Step 4: Identify Harmonic Conflicts

Detect:
- Different chords playing at same time (key clash)
- Dissonant combinations (unless intentional)
- Bass notes conflicting with chord roots

---

## Output Format

### Summary
```
CHORD & HARMONY ANALYSIS
========================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Chord Statistics:
- Total chords detected: X
- Tracks with chords: X
- Dense chords (>6 notes): X
- Unclear harmonies (null): X

Key Issues:
- [Primary issue summary]
```

### Dense Chord Report

```
DENSE CHORD VOICINGS
====================

Chords with too many notes create mud. Here are the densest voicings:

CHORD 1:
────────
Location: Beat 4.0 (0:01.67) in [track name]
Pitches: [54, 57, 61, 62, 64, 66, 74] (7 notes)
Detected as: F#m
Frequency range: 185Hz to 587Hz

PROBLEM: 7 notes span only 20 semitones — very crowded voicing.
         Notes 61, 62, 64, 66 are clustered (5 semitones apart).
         This creates a muddy, undefined chord sound.

RECOMMENDED FIX:

Option 1 — Remove doubled/clustered notes:
  Remove: 62 (D#4) — close to 61 and 64
  Remove: 66 (F#4) — octave of 54
  Keep: [54, 57, 61, 64, 74]
  Result: Cleaner 5-note voicing

Option 2 — Spread the voicing:
  Original: [54, 57, 61, 62, 64, 66, 74]
  Spread:   [42, 54, 61, 69, 74]
  Result: Same harmony, better separation

Option 3 — Split across tracks:
  Bass track: [42] (F#1) — low root
  Pad track: [54, 61, 69] — mid voicing
  High track: [74, 78] — top voicing

[Continue for other dense chords...]
```

### Low Register Voicing Issues

```
LOW REGISTER CHORD PROBLEMS
===========================

Chords voiced too low create undefined, muddy bass.

ISSUE: Chord at beat 12.0 has 3 notes below C3 (MIDI 48)
───────────────────────────────────────────────────────
Location: Beat 12.0 in [track name]
Low pitches: [40, 45, 47] (E1, A1, B1)
All pitches: [40, 45, 47, 52, 59, 64]

PROBLEM: Three notes below 130Hz creates harmonic mud.
         Bass frequencies should be simple (1-2 notes max).
         This voicing will sound unclear on any playback system.

RECOMMENDED FIX:
  → Move 45 (A1) up octave to 57 (A2)
  → Move 47 (B1) up octave to 59 (B2)
  → Keep only 40 (E1) in sub range
  
  New voicing: [40, 52, 57, 59, 64]
  Result: Clear bass note, open voicing above
```

### Simultaneous Chord Conflicts

```
CHORD TIMING CONFLICTS
======================

Multiple tracks playing different harmonic content at same time:

CONFLICT at Beat 128.0 (5:20):
──────────────────────────────
Track "20-TRITON": F#m chord [42, 54, 61, 69]
Track "26-MonoPoly": Playing [43, 55] — suggests G
Track "29-TRITON": Playing [40, 52] — suggests E

PROBLEM: Three different root notes (F#, G, E) at same moment.
         Either intentional tension or a mistake.

CHECK: Is this an intended polyharmonic moment?
  → If YES: Mix carefully, ensure one dominates
  → If NO: Align all tracks to same chord (F#m)

RECOMMENDED FIX (if not intentional):
  → 26-MonoPoly: Change [43, 55] to [42, 54] (F# root)
  → 29-TRITON: Change [40, 52] to [42, 54] (F# root)
```

### Track-by-Track Chord Summary

```
CHORD VOICING BY TRACK
======================

TRACK: 20-TRITON
────────────────
Chord count: 45
Average notes per chord: 4.2
Voicing style: Open, well-spaced ✓
Issues: None significant

TRACK: 26-MonoPoly  
─────────────────
Chord count: 120
Average notes per chord: 5.8
Voicing style: Dense, clustered ⚠️
Issues: 
  • 23 chords have >6 notes
  • Often clustered in 300-500Hz range
  • Contributes to low-mid mud

RECOMMENDATIONS:
  → Thin chord voicings to 3-4 notes
  → Spread notes across wider range
  → Remove octave doublings

[Continue for each track with chords...]
```

---

## Voicing Guidelines for Trance

### Bass Range (Below C2 / 65Hz)
```
✓ DO: Single root notes only
✗ DON'T: Chords, thirds, complex harmony
WHY: Low frequencies need space and clarity
```

### Low-Mid Range (C2-C3 / 65-130Hz)
```
✓ DO: Root + fifth maximum
✓ DO: Wide intervals (5ths, octaves)
✗ DON'T: Thirds, clusters, dense voicings
WHY: Harmonics overlap, causes mud
```

### Mid Range (C3-C5 / 130-520Hz)
```
✓ DO: Full chord voicings OK
✓ DO: Can include thirds, sevenths
⚠️ CAUTION: Don't stack too many tracks here
WHY: This is where most elements live
```

### High Range (Above C5 / 520Hz+)
```
✓ DO: Add brightness, air
✓ DO: Doubled notes for shimmer
✓ DO: Clustered voicings can work (tension)
WHY: Less critical for clarity
```

---

## Common Voicing Fixes

### Thick Chord → Open Voicing
```
Before (clustered): C3-E3-G3-B3-D4  (all within 14 semitones)
After (spread):     C2-G3-B3-E4-D5  (spread across 26 semitones)

Same notes, much clearer.
```

### Dense Pad → Split Layers
```
Before (one track): [C2, E2, G2, C3, E3, G3, C4]
After (three tracks):
  Bass: [C2]
  Low pad: [E3, G3]  
  High pad: [C4, E4, G4]

Each layer can be EQ'd and panned separately.
```

### Muddy Chord → Remove Doublings
```
Before: [C2, G2, C3, E3, G3, C4, E4, G4] (8 notes, C and G doubled)
After:  [C2, E3, G3, C4] (4 notes, clear voicing)

Removing doublings often sounds BIGGER, not thinner.
```

---

## Priority Rules

1. **SEVERE**: Multiple notes below 65Hz (sub mud)
2. **SEVERE**: Harmonic conflicts (different chords same time)
3. **MODERATE**: Dense voicings >6 notes in low-mid range
4. **MODERATE**: Heavy clustering in 200-500Hz
5. **MINOR**: Octave doublings (often intentional)
6. **INFO**: Null chord names (just needs review)

---

## Example Output Snippet

```
[SEVERE] Low Register Chord Mud
───────────────────────────────
PROBLEM: Track "26-MonoPoly" contains 34 chords with 3+ notes 
         below C3 (130Hz). This creates undefined bass harmony.

EXAMPLE — Beat 256.0:
  Pitches: [40, 43, 47, 52, 55, 59, 64]
  Notes below C3: E1, G1, B1 (3 notes)
  
  This voicing has a third (G) and seventh (B) in the bass range.
  These intervals create beating frequencies and mud.

IMPACT: Bass sounds washy and undefined. Kick can't punch through.
        This is a primary contributor to your low-end problems.

ACTION REQUIRED:

Step 1 — Identify the root note:
  Root appears to be E (40, 52, 64 are all E)
  
Step 2 — Move non-root bass notes up:
  → Move 43 (G1) to 55 (G2) or 67 (G3)
  → Move 47 (B1) to 59 (B2) or 71 (B3)
  
Step 3 — New voicing:
  Before: [40, 43, 47, 52, 55, 59, 64]
  After:  [40, 52, 55, 59, 64, 67] 
  
  Only E (40) remains in sub-bass.
  Chord clarity improves dramatically.

APPLY TO: All 34 flagged chords in this track.
Consider: Using a chord voicing plugin or manually adjusting.
```

---

## Do NOT Do

- Don't flag all dense chords as bad — context matters
- Don't ignore that some "null" chords might be intentional clusters
- Don't suggest removing notes without considering the harmony
- Don't treat all octave doublings as problems — they add power
- Don't forget that this is TRANCE — some harmonic tension is stylistic
