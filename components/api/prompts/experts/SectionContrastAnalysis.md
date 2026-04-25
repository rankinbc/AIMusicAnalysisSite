# Prompt 5: Section Contrast Analysis

## Your Task

Analyze the provided Ableton project JSON file to evaluate energy contrast between song sections. Your goal is to identify arrangement-level problems where sections lack differentiation, causing the track to feel flat or exhausting, and provide **specific recommendations for creating dynamic contrast**.

---

## JSON Fields to Analyze

```
als_project.project_structure.locators[]  → Section markers with time and name
als_project.tempo                         → For time calculations
als_project.total_duration_beats          → Song length

tracks[].name                             → Track identification
tracks[].is_muted                         → Track state
tracks[].midi_clips[].start_time          → When clips start (beats)
tracks[].midi_clips[].end_time            → When clips end (beats)
tracks[].midi_clips[].notes[]             → Notes in each clip

midi_analysis[].note_count                → Notes per track
midi_analysis[].velocity_mean             → Average energy per track
midi_analysis[].note_density_per_bar      → Activity level
```

---

## Analysis Steps

### Step 1: Map Song Sections

Using locators, define sections:
```
Section 1: Start at locator[0].time, end at locator[1].time
Section 2: Start at locator[1].time, end at locator[2].time
...
```

Identify section types by name (parse locator names):
- **Intro**: "intro", position at start
- **Breakdown**: "break", "breakdown", "bd"
- **Buildup**: "build", "buildup", "riser"
- **Drop**: "drop", "main", numbered sections without qualifier
- **Outro**: "outro", "end", position near end

### Step 2: Calculate Per-Section Metrics

For each section, calculate:

```
section_metrics = {
    "name": section_name,
    "start_beat": X,
    "end_beat": Y,
    "duration_bars": (Y - X) / 4,
    "active_tracks": count of tracks with clips in this range,
    "total_notes": sum of notes in this section,
    "note_density": total_notes / duration_bars,
    "average_velocity": mean velocity of all notes,
    "bass_tracks_active": count of bass elements playing,
    "kick_active": boolean,
    "tracks_list": [list of track names active]
}
```

### Step 3: Compare Section Energy Levels

Calculate contrast ratios:
- `drop_vs_breakdown_tracks`: How many more tracks in drop vs breakdown?
- `drop_vs_breakdown_density`: Note density ratio
- `drop_vs_breakdown_velocity`: Average velocity difference
- `buildup_progression`: Does activity increase through buildup?

**Target Contrasts (Professional Trance):**
| Metric | Target Ratio | Notes |
|--------|--------------|-------|
| Track count (drop/breakdown) | 1.5-2.5x | Drop should have 50-150% more |
| Note density (drop/breakdown) | 1.5-3x | Drop busier |
| Velocity (drop/breakdown) | +5-15 | Drop hits harder |
| Bass in breakdown | 0-1 tracks | Usually removed |
| Kick in breakdown | No | Almost always removed |

### Step 4: Identify Problems

| Problem | Detection | Severity |
|---------|-----------|----------|
| **No contrast** | drop/breakdown track ratio < 1.2 | CRITICAL |
| **Breakdown too full** | Breakdown has >70% of drop's density | SEVERE |
| **Kick in breakdown** | Kick track active during breakdown | MODERATE |
| **Build doesn't build** | Activity doesn't increase through buildup | SEVERE |
| **All sections same** | <20% variation in any metric across all sections | CRITICAL |
| **Drop not impactful** | Drop has ≤ breakdown's track count | CRITICAL |

---

## Output Format

### Summary
```
SECTION CONTRAST ANALYSIS
=========================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Song Structure:
- Total duration: X minutes (Y bars)
- Sections identified: X
- Section types: [list]

Contrast Statistics:
- Track count range: [min] to [max] active tracks
- Density range: [min] to [max] notes/bar
- Drop/Breakdown track ratio: X (target: 1.5-2.5)
- Drop/Breakdown density ratio: X (target: 1.5-3.0)

Main Issue: [Biggest problem identified]
```

### Section-by-Section Breakdown

```
SECTION ANALYSIS
================

SECTION: "Start0" (1:46 - 3:33)
Type: DROP (inferred from position/content)
Duration: 64 bars

Activity Metrics:
  • Active tracks: 28 of 48
  • Total notes: 4,521
  • Note density: 70.6 notes/bar
  • Average velocity: 94
  • Kick active: Yes
  • Bass tracks: 4 active

Key Tracks:
  [list of track names playing in this section]

────────────────────────────────────

SECTION: "intermission" (6:13 - 6:26)
Type: BREAKDOWN (inferred from name)
Duration: 8 bars

Activity Metrics:
  • Active tracks: 24 of 48
  • Total notes: 1,245
  • Note density: 155.6 notes/bar
  • Average velocity: 91
  • Kick active: Yes ⚠️ PROBLEM
  • Bass tracks: 3 active ⚠️ PROBLEM

ISSUES DETECTED:
  → Kick should be removed in breakdown
  → Too many bass elements (reduce to 0-1)
  → Track count too similar to drop (24 vs 28)

[Continue for each section...]
```

### Contrast Comparison

```
SECTION CONTRAST COMPARISON
===========================

                    Breakdown    Drop      Ratio    Target    Status
────────────────────────────────────────────────────────────────────
Active tracks:         24         28       1.17x    1.5-2.5x   ⚠️ LOW
Note density:         155         71       0.46x    0.5-0.7x   ✓ OK
Avg velocity:          91         94       +3       +5-15      ⚠️ LOW
Bass tracks:            3          4       —        0-1 vs 2+  ✗ BAD
Kick playing:         YES        YES       —        NO vs YES  ✗ BAD

VERDICT: Insufficient contrast between breakdown and drop.
         Your breakdown is almost as full as your drop.
```

### Prioritized Issues

```
[SEVERITY] Issue Description
────────────────────────────────────
PROBLEM: [Specific description with data]
LOCATION: Section "[name]" at [timestamp]
IMPACT: [Why this hurts the track]

ACTION REQUIRED:

For the BREAKDOWN section:
→ REMOVE these tracks:
  • [kick track name]
  • [bass track 1]
  • [bass track 2]
  
→ KEEP these tracks (filtered/quieter):
  • [pad track] — add low-pass filter at 2kHz
  • [atmosphere track]
  • [high element]

→ MUTE or FILTER:
  • [track name]: Automate low-pass from 500Hz → 8kHz through section

For the BUILDUP section:
→ Remove kick for first 8 bars, bring in at bar 9
→ Start with 4 tracks, add one every 4 bars
→ Increase velocity from 80 → 110 over 16 bars
→ Add snare roll in final 4 bars

For the DROP:
→ Keep current track count but REMOVE buildup elements:
  • Mute riser at drop
  • Mute buildup snare roll
  • This makes drop feel "cleaner" despite same density

EXPECTED RESULT: 
Breakdown will feel spacious. Buildup creates anticipation.
Drop will hit harder by contrast, even at same loudness.
```

---

## Section Type Targets

### INTRO (typically 16-32 bars)
- Track count: 3-8 elements
- No kick or filtered kick
- Atmospheric elements only
- Purpose: Set mood, introduce theme

### BREAKDOWN (typically 16-64 bars)
- Track count: 4-12 elements (40-60% of drop)
- NO kick (almost always)
- Bass: Removed or heavily filtered
- Main elements: Pads, atmosphere, lead melody (filtered), FX
- Velocity: 10-20% lower than drop
- Purpose: Emotional moment, tension release

### BUILDUP (typically 16-32 bars)
- Track count: Starts low, increases each 4-8 bars
- Kick: Comes in halfway or stays out until drop
- Snare roll: Accelerates (8ths → 16ths → 32nds)
- Risers/FX: Crescendo upward
- Velocity: Increases 80 → 110+ over section
- Filter: Open up from 500Hz → full by end
- Purpose: Create tension and anticipation

### DROP (typically 32-64 bars)
- Track count: Maximum (20-30+ elements for trance)
- Kick: Full and present
- Bass: Full weight
- All main elements: Active
- Velocity: Peak energy (100-115)
- Purpose: Maximum energy, main hook

### OUTRO (typically 16-32 bars)
- Mirror intro or extended breakdown
- Gradual removal of elements
- Purpose: Smooth DJ mixing

---

## Energy Curve Visualization

```
IDEAL TRANCE ENERGY CURVE (6-8 min track)

Energy
Level
  █                                              █
  █    █████                          █████      █
  █    █   █                          █   █      █
  █    █   █     ████         ████    █   █      █
  █    █   █     █  █         █  █    █   █  ████
  █████   █     █  █████████  █████   █████  █
  █       █████                            ████
  ─────────────────────────────────────────────────
  Intro │Break│Build│DROP │Break│Build│DROP │Outro
  
Your track should follow this shape. If it's flat, there's no journey.
```

---

## Priority Rules

1. **CRITICAL**: No difference between sections (flat energy)
2. **CRITICAL**: Drop has fewer/equal elements to breakdown
3. **SEVERE**: Kick playing in breakdown
4. **SEVERE**: Buildup doesn't escalate
5. **MODERATE**: Too many bass elements in breakdown
6. **MODERATE**: Velocity doesn't change between sections

---

## Example Output Snippet

```
[CRITICAL] Breakdown Almost as Full as Drop
───────────────────────────────────────────
PROBLEM: Section "intermission" (breakdown) has 24 active tracks.
         Section "Start0" (drop) has 28 active tracks.
         Ratio: 1.17x (Target: 1.5-2.5x)

IMPACT: Your breakdown doesn't provide contrast. The drop won't hit
        because there's no release before it. Listeners experience
        fatigue because energy never dips. This is why your track
        sounds "loud but not interesting."

LOCATION: "intermission" at 6:13

ACTION REQUIRED:

Remove from breakdown:
  → 3-Imba Kick 53 (MUST remove kick)
  → 26-MonoPoly (bass layer)
  → 27-MonoPoly (bass layer)
  → 29-TRITON (bass/low synth)
  → 38-TRITON, 39-TRITON (reduce synth layers)

Keep in breakdown (but filter):
  → Main pad/atmosphere tracks
  → Lead melody (low-pass at 2-4kHz)
  → High percussion only (remove low perc)

TARGET: Reduce from 24 → 10-14 active tracks

EXPECTED RESULT: 
  When the drop hits, it will feel massive by comparison.
  The breakdown creates space and emotional contrast.
  This is the #1 change that will make your track more professional.
```

---

## Do NOT Do

- Don't just report numbers — explain what they MEAN
- Don't ignore section names — they indicate intent
- Don't assume more = better — contrast matters more than density
- Don't forget to recommend SPECIFIC tracks to remove/add per section
- Don't treat all sections equally — breakdowns and drops need different advice
