# Audio Analysis Module: Overall Score & Mix Quality Specialist

## Your Task

Analyze the provided audio analysis JSON file to interpret the overall mix quality score and identify the most impactful areas for improvement. Your goal is to provide a **prioritized action plan based on the weighted score components** and help achieve professional-grade mix quality.

---

## JSON Fields to Analyze

### Primary Overall Score Data
```
audio_analysis.overall_score.overall_score       → 0-100 weighted quality score
audio_analysis.overall_score.grade               → Letter grade (A, B, C, D, F)
audio_analysis.overall_score.grade_description   → Human-readable grade meaning
audio_analysis.overall_score.component_scores    → Individual component scores
audio_analysis.overall_score.component_weights   → How much each component matters
audio_analysis.overall_score.weakest_component   → Lowest scoring component
audio_analysis.overall_score.strongest_component → Highest scoring component
audio_analysis.overall_score.summary             → Auto-generated summary
```

### Component Score Breakdown
```
component_scores:
  frequency_balance  → 0-100 (weight: ~20%)
  dynamics           → 0-100 (weight: ~15%)
  stereo             → 0-100 (weight: ~15%)
  loudness           → 0-100 (weight: ~10%)
  clarity            → 0-100 (weight: ~15%)
  harmonic           → 0-100 (weight: ~10%)
  transients         → 0-100 (weight: ~10%)
  surround           → 0-100 (weight: ~5%)
```

---

## Grade Reference

### Grade Interpretation
| Grade | Score Range | Meaning | Action |
|-------|-------------|---------|--------|
| **A** | 85-100 | Release ready - professional quality | Minor polish only |
| **B** | 70-84 | Good mix with minor issues | Address weak areas |
| **C** | 55-69 | Decent mix, several issues | Prioritized work needed |
| **D** | 40-54 | Significant work needed | Major fixes required |
| **F** | 0-39 | Fundamental problems | Start from basics |

### What Each Grade Sounds Like
```
GRADE A (85-100):
─────────────────
- Sounds professional and polished
- Translates well across all systems
- No obvious issues
- Ready for commercial release
- Comparable to reference tracks

GRADE B (70-84):
─────────────────
- Generally good, pro-sounding
- Minor issues that pros would catch
- Could be released but not "A-tier"
- 1-2 areas need attention
- Close to reference quality

GRADE C (55-69):
─────────────────
- Decent but clearly amateur aspects
- Multiple issues across areas
- Noticeable gaps vs. reference tracks
- Needs work before release
- Foundation is there

GRADE D (40-54):
─────────────────
- Significant quality issues
- Multiple fundamental problems
- Would not pass professional QC
- Needs substantial rework
- Some good elements buried

GRADE F (0-39):
─────────────────
- Major problems throughout
- Fundamental mixing issues
- Phase, balance, or loudness broken
- Essentially needs remix
- Start from scratch in some areas
```

---

## Component Weight Reference

### Default Weights
```
COMPONENT WEIGHTS (Total = 100%)
================================

frequency_balance: 20%  ████████████████████
  → Most important: Spectral balance defines "pro" sound
  → Issues: Mud, harshness, thin, boomy

dynamics: 15%           ███████████████
  → Punch, energy, dynamic range
  → Issues: Over-compressed, flat, lifeless

stereo: 15%             ███████████████
  → Width, phase, mono compatibility
  → Issues: Phase cancellation, too narrow, too wide

clarity: 15%            ███████████████
  → Element separation, masking
  → Issues: Elements fighting, muddy, undefined

loudness: 10%           ██████████
  → LUFS compliance, streaming targets
  → Issues: Too quiet, too loud, clipping

harmonic: 10%           ██████████
  → Key detection, harmonic coherence
  → Issues: Key clashes, unstable key

transients: 10%         ██████████
  → Attack quality, punch
  → Issues: Soft attacks, over-compressed transients

surround: 5%            █████
  → Mono compatibility verification
  → Issues: Mono collapse, phase issues
```

### Priority Order for Fixes
```
FIX IN THIS ORDER (highest impact first):
=========================================

1. frequency_balance (20%) - Foundation of pro sound
2. dynamics (15%) - Energy and punch
3. stereo (15%) - Width and phase safety
4. clarity (15%) - Element separation
5. loudness (10%) - Streaming compliance
6. harmonic (10%) - Key and harmony
7. transients (10%) - Attack quality
8. surround (5%) - Mono safety check
```

---

## Analysis Steps

### Step 1: Interpret Overall Score and Grade
```
GRADE A (85-100):
    Minor polish - look at weakest component for final touches

GRADE B (70-84):
    Good foundation - focus on 1-2 weakest components

GRADE C (55-69):
    Multiple issues - prioritize by weight (frequency > dynamics > stereo)

GRADE D (40-54):
    Significant work - start with highest-weight weak components

GRADE F (0-39):
    Fundamental issues - likely phase, loudness, or frequency problems
    Focus on critical failures first
```

### Step 2: Identify Weak Components
```
For each component with score < 70:
    Add to priority fix list

Order by:
    1. Weight (higher weight = higher priority)
    2. Score (lower score = higher priority)
    3. Impact (phase > frequency > dynamics > other)
```

### Step 3: Calculate Improvement Potential
```
For each weak component:
    Current score: X
    Target score: 75 (minimum "good")
    Improvement needed: 75 - X

    Weight × Improvement needed = Impact on overall score

    Higher impact = Fix first
```

### Step 4: Generate Action Plan
```
Create prioritized fix list:
    1. [Highest impact component] - Current: X, Target: 75+
    2. [Second highest] - Current: Y, Target: 75+
    3. ...

Include estimated score improvement for each fix.
```

---

## Output Format

### Summary
```
OVERALL MIX QUALITY ANALYSIS
============================
Overall Score: [X]/100
Grade: [A/B/C/D/F] - [grade_description]

Component Breakdown:
  [Component Name]     [Score] [Bar Graph]  [Status]
  frequency_balance    [XX]    ████████░░   [Good/Needs Work]
  dynamics             [XX]    ███████░░░   [Good/Needs Work]
  stereo               [XX]    ██████░░░░   [Good/Needs Work]
  clarity              [XX]    █████░░░░░   [Good/Needs Work]
  loudness             [XX]    ████████░░   [Good/Needs Work]
  harmonic             [XX]    ███████░░░   [Good/Needs Work]
  transients           [XX]    ██████░░░░   [Good/Needs Work]
  surround             [XX]    █████████░   [Good/Needs Work]

Weakest Component: [X] ([score])
Strongest Component: [Y] ([score])

Path to Grade [Next Grade]: Fix [component] (+[X] points potential)
```

### Prioritized Action Plan

```
PRIORITY FIX ORDER
==================

#1: [Component Name] (Current: [X], Target: 75+)
────────────────────────────────────────────────
Weight: [X]%
Potential Impact: +[Y] overall points
Status: [description]

SPECIFIC FIX:
→ See [SpecialistPrompt.md] for detailed instructions
→ Quick summary: [one-line fix description]

#2: [Component Name] (Current: [X], Target: 75+)
────────────────────────────────────────────────
[Same format...]
```

---

## Common Scenarios & Strategies

### Scenario: Grade A (85-100) - Release Ready
```
STATUS: Mix is professional quality

ACTION:
- Review weakest_component for final polish
- A/B test against reference tracks
- Minor tweaks only - don't over-process
- Focus on mastering-level adjustments

COMMON FINAL TWEAKS:
- Slight EQ adjustments (±1dB)
- Final limiting/loudness
- Dithering and format export
```

### Scenario: Grade B (70-84) - Almost There
```
STATUS: Good mix, minor issues

ACTION:
- Identify the 1-2 weakest components
- Focus improvement there
- Don't touch what's working
- Goal: Push weakest areas above 75

TYPICAL B→A FIXES:
- If frequency_balance low: Minor EQ carving
- If dynamics low: Adjust compression/limiting
- If stereo low: Check mono compatibility
- If clarity low: EQ separation between elements
```

### Scenario: Grade C (55-69) - Work Needed
```
STATUS: Multiple issues to address

ACTION:
- Prioritize by weight × score deficit
- Fix frequency issues first (20% weight)
- Then dynamics and stereo (15% each)
- Work systematically, re-analyze after each fix

TYPICAL C→B FIXES:
- Fix mud (250-500Hz cut)
- Fix harsh frequencies (3-6kHz)
- Improve dynamics (reduce limiting)
- Check phase/stereo issues
```

### Scenario: Grade D (40-54) - Significant Work
```
STATUS: Major issues present

ACTION:
- Look for critical failures first
- Phase issues? Fix before anything else
- Loudness way off? Address early
- Then work through frequency and dynamics
- May need to revisit arrangement/mix decisions

TYPICAL D→C FIXES:
- Fix phase cancellation (if present)
- Balance frequency spectrum
- Adjust overall loudness to reasonable range
- Improve element clarity (EQ carving)
```

### Scenario: Grade F (0-39) - Fundamental Problems
```
STATUS: Critical issues throughout

ACTION:
- Check for phase cancellation first
- Check for extreme loudness issues
- Look for frequency disasters (all mud or all harsh)
- May need to partially or fully remix
- Focus on one major issue at a time

TYPICAL F→D FIXES:
- Fix phase (if correlation negative)
- Fix extreme frequency imbalance
- Get loudness in reasonable range
- Establish basic element clarity
```

---

## Component-Specific Improvement Tips

### Frequency Balance (20% weight)
```
IF score < 60:
  - Major spectral issues
  - Check for mud (250-500Hz)
  - Check for harshness (3-6kHz)
  → Use FrequencyBalance.md prompt

IF score 60-74:
  - Minor imbalances
  - Fine-tune EQ
  - Check against reference
```

### Dynamics (15% weight)
```
IF score < 60:
  - Over-compressed or too dynamic
  - Check crest factor
  → Use Dynamics.md prompt

IF score 60-74:
  - Minor dynamics issues
  - Adjust limiter/compressor settings
```

### Stereo (15% weight)
```
IF score < 60:
  - Phase issues or width problems
  - CHECK MONO COMPATIBILITY
  → Use StereoPhase.md prompt

IF score 60-74:
  - Minor width/correlation issues
  - Fine-tune panning and width
```

### Clarity (15% weight)
```
IF score < 60:
  - Elements masking each other
  - Frequency clashes
  → Use ClarityAnalysis.md prompt

IF score 60-74:
  - Some masking present
  - EQ carving needed
```

### Loudness (10% weight)
```
IF score < 60:
  - Way off streaming targets
  - Possible clipping issues
  → Use Loudness.md prompt

IF score 60-74:
  - Close to targets
  - Minor adjustment needed
```

### Harmonic (10% weight)
```
IF score < 60:
  - Key detection issues
  - Possible key clashes
  → Use HarmonicAnalysis.md prompt

IF score 60-74:
  - Minor harmonic concerns
  - Check layered elements for key
```

### Transients (10% weight)
```
IF score < 60:
  - Attack quality issues
  - Possibly over-compressed
  → Use Dynamics.md prompt (transient section)

IF score 60-74:
  - Minor transient issues
  - Transient shaper adjustment
```

### Surround (5% weight)
```
IF score < 60:
  - Mono compatibility issues
  - Phase concerns
  → Use SurroundCompatibility.md prompt

IF score 60-74:
  - Minor mono translation issues
  - Check stereo widening
```

---

## Priority Rules

1. **CRITICAL**: Grade F - fundamental issues
2. **SEVERE**: Grade D - significant work needed
3. **MODERATE**: Grade C - multiple fixes required
4. **MINOR**: Grade B - polish needed
5. **INFO**: Grade A - release ready

---

## Example Output Snippet

```
OVERALL MIX QUALITY ANALYSIS
============================
Overall Score: 62/100
Grade: C - Decent mix but several issues to address

Component Breakdown:
  frequency_balance    72    ███████░░░   Good
  dynamics             58    █████░░░░░   Needs Work ⚠️
  stereo               68    ██████░░░░   Needs Work
  clarity              54    █████░░░░░   Needs Work ⚠️
  loudness             75    ███████░░░   Good
  harmonic             68    ██████░░░░   OK
  transients           52    █████░░░░░   Needs Work ⚠️
  surround             78    ███████░░░   Good

Weakest Component: transients (52)
Strongest Component: surround (78)

Path to Grade B: Fix clarity and transients (+8-12 points potential)

─────────────────────────────────────────────────────
PRIORITY FIX ORDER
─────────────────────────────────────────────────────

#1: CLARITY (Current: 54, Target: 75+)
──────────────────────────────────────
Weight: 15%
Potential Impact: +3.2 overall points
Status: High masking risk, elements fighting

SPECIFIC FIX:
→ See ClarityAnalysis.md for detailed instructions
→ Quick: EQ carve space between bass (100-200Hz) and pads (500-800Hz)
→ Quick: Cut lead -2dB at 2kHz to make room for vocals/synths

#2: TRANSIENTS (Current: 52, Target: 75+)
─────────────────────────────────────────
Weight: 10%
Potential Impact: +2.3 overall points
Status: Soft attack quality, lacking punch

SPECIFIC FIX:
→ See Dynamics.md transients section
→ Quick: Add transient shaper to drums (+15% attack)
→ Quick: Reduce overall limiting to preserve transients

#3: DYNAMICS (Current: 58, Target: 75+)
───────────────────────────────────────
Weight: 15%
Potential Impact: +2.6 overall points
Status: Over-compressed, crest factor low

SPECIFIC FIX:
→ See Dynamics.md for detailed instructions
→ Quick: Reduce limiter ceiling by 2dB
→ Quick: Target crest factor 10-12dB instead of current 6dB

EXPECTED OUTCOME:
After fixing these three components:
  Current score: 62
  Potential score: 70-72 (Grade B)
```

---

## Do NOT Do

- Don't ignore the weakest component - it's dragging your score down
- Don't focus on high-scoring components - they're already fine
- Don't try to fix everything at once - prioritize by weight
- Don't expect Grade A on first mix - iterate and improve
- Don't over-process to chase score - use ears too
- Don't ignore the grade description - it tells you what's wrong
