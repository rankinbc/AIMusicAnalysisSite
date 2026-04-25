# Prompt 9: Priority Problem Summary

## Your Task

Analyze the provided Ableton project JSON file and generate a **prioritized executive summary** of all mixing problems. Your goal is to identify the highest-impact issues across all categories and provide a clear **"Fix These First"** action list that will produce the biggest improvement in mix quality.

This prompt aggregates findings from all analysis categories and ranks them by impact.

---

## JSON Fields to Analyze

**ALL fields are relevant — this is the master analysis:**

```
Track Settings:
  tracks[].volume_db          → Gain staging
  tracks[].pan                → Stereo field
  tracks[].is_muted           → Active state
  tracks[].devices[]          → Processing chain

MIDI Analysis:
  midi_analysis[].velocity_std         → Humanization
  midi_analysis[].humanization_score   → Robotic detection
  midi_analysis[].note_density_per_bar → Busyness
  midi_analysis[].chords[]             → Harmony

Note Data:
  tracks[].midi_clips[].notes[].pitch      → Frequency collision
  tracks[].midi_clips[].notes[].velocity   → Dynamics
  tracks[].midi_clips[].notes[].start_time → Timing/overlap

Structure:
  als_project.project_structure.locators[] → Section analysis
  als_project.tempo                        → Time calculations
```

---

## Priority Scoring System

Each problem type has a base severity and multiplier:

| Problem Type | Base Score | Impact Multiplier |
|--------------|------------|-------------------|
| Mono collapse (all center pan) | 100 | ×3.0 |
| No headroom (all tracks maxed) | 100 | ×3.0 |
| Bass frequency collision (kick/bass) | 90 | ×2.5 |
| Multiple tracks >100 notes/bar same freq | 80 | ×2.5 |
| No section contrast | 85 | ×2.0 |
| Robotic velocity (std=0) on drums | 70 | ×2.0 |
| Missing EQ on bass tracks | 75 | ×2.0 |
| Breakdown as full as drop | 70 | ×1.8 |
| Low-mid mud (200-500Hz buildup) | 65 | ×1.5 |
| Missing compression on drums | 50 | ×1.5 |
| Robotic velocity on synths | 40 | ×1.2 |
| Quantization issues | 20 | ×1.0 |
| Minor EQ recommendations | 15 | ×1.0 |

**Final Priority Score = Base Score × Impact Multiplier × (affected_track_count / total_tracks)**

Problems scoring >150 = CRITICAL
Problems scoring 100-150 = SEVERE  
Problems scoring 50-100 = MODERATE
Problems scoring <50 = MINOR

---

## Analysis Steps

### Step 1: Run All Detection Checks

1. **Gain Staging**
   - Count tracks at volume_db ≥ 20
   - Find outliers (>8dB from mean)
   - Calculate overall headroom

2. **Stereo Field**
   - Count tracks at pan = 0
   - Check if bass/kick are centered
   - Calculate pan distribution

3. **Frequency Collision**
   - Map all notes to frequencies
   - Find simultaneous overlaps in bass range
   - Count collisions per section

4. **Dynamics/Humanization**
   - Find tracks with velocity_std = 0
   - Find tracks with velocity_std < 5
   - Categorize by element type (drums worse than pads)

5. **Section Contrast**
   - Calculate metrics per section
   - Compare drops to breakdowns
   - Check for kick in breakdown

6. **Density**
   - Rank tracks by note_density_per_bar
   - Find competing busy tracks
   - Calculate combined density

7. **Device Chains**
   - Check for missing essential processing
   - Identify unprocessed high-density tracks

### Step 2: Score All Problems

Apply the scoring formula to each detected issue.

### Step 3: Rank and Group

Sort by priority score, group related issues.

---

## Output Format

### Executive Summary

```
═══════════════════════════════════════════════════════════════════
                    MIX ANALYSIS: PRIORITY SUMMARY
═══════════════════════════════════════════════════════════════════

PROJECT: [project name]
ANALYZED: [date]
DURATION: [X minutes]
TRACKS: [X total, Y active]

OVERALL MIX STATUS: [CRITICAL / NEEDS SIGNIFICANT WORK / NEEDS WORK / GOOD]

┌─────────────────────────────────────────────────────────────────┐
│                        SEVERITY BREAKDOWN                        │
├─────────────────────────────────────────────────────────────────┤
│  🔴 CRITICAL issues:  X     (fix immediately)                   │
│  🟠 SEVERE issues:    X     (fix before release)                │
│  🟡 MODERATE issues:  X     (should address)                    │
│  🟢 MINOR issues:     X     (polish)                            │
└─────────────────────────────────────────────────────────────────┘

TOP 3 ISSUES HURTING YOUR MIX:
1. [Issue #1 - one sentence]
2. [Issue #2 - one sentence]  
3. [Issue #3 - one sentence]

ESTIMATED TIME TO ADDRESS CRITICAL ISSUES: [X hours]
```

### The "Fix These 5 First" List

```
═══════════════════════════════════════════════════════════════════
                      🎯 FIX THESE FIRST 🎯
═══════════════════════════════════════════════════════════════════

These 5 changes will have the BIGGEST impact on your mix quality.
Do these before anything else.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#1 [PRIORITY SCORE: XXX] — CATEGORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE PROBLEM:
[2-3 sentence description of what's wrong and why it matters]

THE DATA:
• [Key metric 1]
• [Key metric 2]
• [Affected tracks/sections]

THE FIX (do this now):

Step 1: [Specific action]
        → [Exact parameter or value]
        
Step 2: [Specific action]
        → [Exact parameter or value]

Step 3: [Specific action]
        → [Exact parameter or value]

TIME REQUIRED: ~[X] minutes
EXPECTED IMPROVEMENT: [What will change]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#2 [PRIORITY SCORE: XXX] — CATEGORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Same format...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#3 [PRIORITY SCORE: XXX] — CATEGORY
...

#4 [PRIORITY SCORE: XXX] — CATEGORY
...

#5 [PRIORITY SCORE: XXX] — CATEGORY
...
```

### Detailed Issue List (All Problems by Category)

```
═══════════════════════════════════════════════════════════════════
                     DETAILED ISSUE BREAKDOWN
═══════════════════════════════════════════════════════════════════

GAIN STAGING ISSUES
───────────────────
[List all gain staging problems with severity indicators]

🔴 CRITICAL: All 48 tracks at maximum volume
   Score: 300 | Affects: 100% of tracks
   Quick fix: Select all → reduce 12dB

🟠 SEVERE: Track "17-MonoPoly" at 29.5dB (clipping risk)
   Score: 85 | Affects: 1 track
   Quick fix: Reduce to 18dB

───────────────────────────────────────────────────────────────────

STEREO FIELD ISSUES  
───────────────────
🔴 CRITICAL: Complete mono collapse — all tracks center panned
   Score: 300 | Affects: 100% of tracks
   Quick fix: Pan hi-hats ±25%, percussion ±50%, pads wide

───────────────────────────────────────────────────────────────────

FREQUENCY COLLISION ISSUES
──────────────────────────
🔴 CRITICAL: 5,236 bass frequency collisions detected
   Score: 225 | Worst section: "5" with 1,328 collisions
   Quick fix: Mute duplicate bass layers, add sidechain

🟠 SEVERE: "26-MonoPoly" + "27-MonoPoly" constantly clashing
   Score: 140 | 603 overlaps in "Start0" section
   Quick fix: Mute one, or EQ separate

───────────────────────────────────────────────────────────────────

DYNAMICS & HUMANIZATION ISSUES
──────────────────────────────
🟠 SEVERE: 7 tracks with robotic velocity
   Score: 120 | Includes snare and hi-hat
   Quick fix: Add velocity randomization ±10-15

[Continue for each category...]
```

### Quick Win Summary

```
═══════════════════════════════════════════════════════════════════
                         ⚡ QUICK WINS ⚡
═══════════════════════════════════════════════════════════════════

Changes that take <5 minutes but have big impact:

□ Select all tracks → Reduce volume 12dB (2 min)
□ Pan hi-hats to ±25% (1 min)  
□ Mute "27-MonoPoly" — redundant with "26-MonoPoly" (30 sec)
□ Remove kick from "intermission" section (1 min)
□ Add velocity randomization to snare (2 min)

TOTAL TIME: ~7 minutes
ESTIMATED IMPROVEMENT: Your mix will sound noticeably more professional
```

### What's Actually Working

```
═══════════════════════════════════════════════════════════════════
                      ✓ WHAT'S WORKING WELL
═══════════════════════════════════════════════════════════════════

Not everything needs fixing. These aspects are solid:

✓ Kick drum has proper processing (EQ, Compressor)
✓ Tempo is appropriate for trance (144 BPM)
✓ Song structure has clear sections (11 markers)
✓ Good variety of elements (48 tracks = full production)
✓ Some tracks show natural humanization

Keep these as they are.
```

---

## Category Priority Order

When ranking issues, prioritize in this order:

1. **Stereo/Gain issues** — affect the ENTIRE mix instantly
2. **Bass frequency collisions** — destroys low-end (foundation of trance)
3. **Section contrast** — makes or breaks arrangement
4. **High-density conflicts** — causes overall mud
5. **Missing processing** — prevents polish
6. **Humanization** — affects feel/groove
7. **Individual track issues** — localized problems

---

## Aggregation Rules

**Combine related issues:**
- All MonoPoly tracks missing EQ → ONE issue, not five
- Multiple bass collisions → ONE issue with count
- All tracks at same volume → ONE issue about hierarchy

**Don't over-report:**
- Maximum 5 CRITICAL issues (any more dilutes importance)
- Maximum 10 SEVERE issues
- Group similar MODERATE/MINOR issues

---

## Example Output Snippet

```
═══════════════════════════════════════════════════════════════════
                    🎯 FIX THESE FIRST 🎯
═══════════════════════════════════════════════════════════════════

#1 [PRIORITY SCORE: 300] — STEREO FIELD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE PROBLEM:
Your entire mix is mono. All 48 tracks are panned dead center. This
is the single biggest factor making your mix sound amateur. Professional
trance tracks use the full stereo field to create space and separation.

THE DATA:
• 48 of 48 tracks at pan = 0 (100% center)
• Pan range: 0 to 0 (no variation)
• Elements that SHOULD be wide: hats, rides, pads, FX

THE FIX (do this now):

Step 1: Keep these centered (no change needed):
        → 3-Imba Kick 53: pan = 0 ✓
        → 6-Imba Snare 52: pan = 0 ✓
        → All bass tracks: pan = 0 ✓

Step 2: Pan hi-hats and percussion:
        → 5-Imba Open Hat 41: pan = -25 (left)
        → 9-US_RIDE_08: pan = +30 (right)
        → 8-018 Clap: pan = +10 (slight right)

Step 3: Pan synth layers opposite sides:
        → TRITON pads: pan = -60 / +60 (split layers)
        → FX and risers: pan = ±50 or automate

Step 4: Widen pads and atmosphere:
        → Use Utility plugin → Width > 100%
        → Or duplicate, pan hard L/R

TIME REQUIRED: ~15 minutes
EXPECTED IMPROVEMENT: Mix will sound 50% more professional instantly.
                      Elements will have space. Less fighting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#2 [PRIORITY SCORE: 300] — GAIN STAGING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

THE PROBLEM:
Every track is maxed out. 46 of 48 tracks are at 20dB, with one track
at 29.5dB (likely clipping). You have zero headroom for mastering and
all elements are competing at equal loudness.

THE DATA:
• 96% of tracks at volume_db = 20.0
• One track at 29.5dB (3-Imba Kick 53)
• Volume range: 5.5dB to 29.5dB (all near max)
• No level hierarchy = everything fights

THE FIX (do this now):

Step 1: Select ALL tracks
        → Reduce all faders by 12dB

Step 2: Set new reference levels:
        → Kick: -10dB (anchor)
        → Snare: -11dB
        → Bass: -12dB
        → Leads: -14dB
        → Pads: -20dB
        → FX: -18dB

Step 3: Fix the outlier:
        → 17-MonoPoly: Reduce from 29.5dB to 15dB

TIME REQUIRED: ~10 minutes
EXPECTED IMPROVEMENT: Clean headroom, clearer mix, punchier master.
                      This is why your mix is "loud but not interesting."
```

---

## Do NOT Do

- Don't list every single issue — prioritize ruthlessly
- Don't use vague language like "needs work" — be SPECIFIC
- Don't forget to highlight what's working (encouragement matters)
- Don't give 50 things to fix — give 5 that matter most
- Don't skip the time estimates — users need to know effort required
- Don't end without clear next steps — what should they do RIGHT NOW
