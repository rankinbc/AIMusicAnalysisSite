---
version: 1.0.0
---

# Audio Analysis Module: Loudness & Mastering

## Your Task

Analyze the provided audio analysis JSON file to evaluate loudness levels, true peak, and streaming platform readiness. Your goal is to identify loudness problems that will cause issues on streaming platforms and provide **specific limiter adjustments and LUFS targets**.

---

## JSON Fields to Analyze

```
audio_analysis.loudness.integrated_lufs     → Main loudness measurement (whole track)
audio_analysis.loudness.short_term_max_lufs → Loudest 3-second window
audio_analysis.loudness.momentary_max_lufs  → Loudest moment
audio_analysis.loudness.loudness_range_lu   → Dynamic loudness variation
audio_analysis.loudness.true_peak_db        → CRITICAL - must be < -1.0 dBTP

audio_analysis.loudness.spotify_diff_db     → Distance from Spotify's -14 LUFS
audio_analysis.loudness.apple_music_diff_db → Distance from Apple's -16 LUFS
audio_analysis.loudness.youtube_diff_db     → Distance from YouTube's -14 LUFS

audio_analysis.dynamics.peak_db             → Peak level
audio_analysis.dynamics.rms_db              → Average level
audio_analysis.dynamics.crest_factor_db     → Dynamic range (peak - RMS)

audio_analysis.clipping.has_clipping        → Over-limited?
audio_analysis.clipping.clip_count          → Severity of clipping
audio_analysis.clipping.clip_positions      → Timestamps of clips
```

---

## Streaming Platform Targets

| Platform | Target LUFS | True Peak Max | What Happens If Louder |
|----------|-------------|---------------|------------------------|
| Spotify | -14 LUFS | -1.0 dBTP | Track turned DOWN, loses punch |
| Apple Music | -16 LUFS | -1.0 dBTP | Sound Check normalizes |
| YouTube | -14 LUFS | -1.0 dBTP | Turned down, sounds worse |
| Tidal | -14 LUFS | -1.0 dBTP | Same as Spotify |
| SoundCloud | None | -1.0 dBTP | No normalization (louder = louder) |
| Beatport/Club | -8 to -10 LUFS | -0.3 dBTP | Designed for DJ/club systems |

**The Loudness Penalty Reality:**
- Track at -8 LUFS on Spotify → turned down 6dB → loses impact vs -14 LUFS tracks
- Track at -6 LUFS → turned down 8dB → sounds QUIETER than properly mastered tracks
- You CANNOT win the loudness war on streaming platforms

---

## Severity Thresholds

| Problem | Detection | Severity |
|---------|-----------|----------|
| True peak > 0 dBTP | `true_peak_db > 0` | CRITICAL |
| True peak > -1.0 dBTP | `true_peak_db > -1.0` | SEVERE |
| Way too loud (will be crushed) | `integrated_lufs > -8` | SEVERE |
| Too loud for streaming | `integrated_lufs > -11` | MODERATE |
| Slightly hot | `integrated_lufs > -13` | MINOR |
| Too quiet | `integrated_lufs < -16` | MODERATE |
| Way too quiet | `integrated_lufs < -20` | SEVERE |
| Clipping detected | `has_clipping = true` | SEVERE |
| Excessive clipping | `clip_count > 100` | CRITICAL |
| No dynamics (over-compressed) | `crest_factor_db < 6` | SEVERE |
| Loudness range too wide | `loudness_range_lu > 12` | MODERATE |

---

## Analysis Steps

### Step 1: Check True Peak (MOST CRITICAL)
```
IF true_peak_db > -1.0:
    SEVERITY = CRITICAL if > 0, else SEVERE
    FIX = Reduce output by (true_peak_db - (-1.0)) dB
```

### Step 2: Check Integrated Loudness
```
Target: -14 LUFS for streaming, -9 LUFS for club

IF integrated_lufs > -11:
    Track will be turned down significantly on streaming
    Calculate: penalty_db = integrated_lufs - (-14)
    
IF integrated_lufs < -16:
    Track is too quiet, will sound weak
    Calculate: boost_needed = (-14) - integrated_lufs
```

### Step 3: Check for Clipping
```
IF has_clipping AND clip_count > 10:
    Limiter is working too hard
    Need to reduce input gain or address peaks earlier in chain
```

### Step 4: Check Dynamic Range
```
IF crest_factor_db < 6:
    Over-compressed, no punch
    
IF crest_factor_db > 14:
    Too dynamic for electronic music, may sound weak
    
TARGET: 8-12 dB crest factor for trance
```

---

## Output Format

### Summary
```
LOUDNESS & MASTERING ANALYSIS
=============================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / RELEASE READY]

Current Loudness:
  Integrated LUFS: [X] LUFS
  True Peak: [X] dBTP → [OK / EXCEEDS LIMIT BY X dB]
  Crest Factor: [X] dB → [interpretation]
  Loudness Range: [X] LU → [interpretation]

Streaming Readiness:
  Spotify (-14 LUFS): [X dB adjustment needed]
  Apple Music (-16 LUFS): [X dB adjustment needed]
  Club/DJ (-9 LUFS): [X dB adjustment needed]
```

### Platform Impact Table

```
STREAMING PLATFORM ANALYSIS
===========================

| Platform     | Target  | Current | Difference | What Will Happen          |
|--------------|---------|---------|------------|---------------------------|
| Spotify      | -14     | [X]     | [+/-X]     | [Turned down/OK/Boost]    |
| Apple Music  | -16     | [X]     | [+/-X]     | [Turned down/OK/Boost]    |
| YouTube      | -14     | [X]     | [+/-X]     | [Turned down/OK/Boost]    |
| SoundCloud   | N/A     | [X]     | N/A        | [Plays as-is]             |
| Club/Beatport| -9      | [X]     | [+/-X]     | [Too quiet/OK/Too loud]   |

VERDICT: [Summary of streaming readiness]
```

### Prioritized Issues

```
[SEVERITY] Issue Title
─────────────────────────────────
PROBLEM: [Specific description with exact numbers]
IMPACT: [What will happen on streaming platforms / in clubs]
CURRENT VALUE: [X]
TARGET VALUE: [Y]

FIX:

Step 1: [Specific action]
        → [Exact parameter value]
        
Step 2: [Specific action]
        → [Exact parameter value]

LIMITER SETTINGS:
  Input Gain: [current] → [target] ([+/- X] dB change)
  Ceiling: -1.0 dBTP (enable True Peak limiting)
  Release: [X] ms (based on [tempo] BPM)
  
EXPECTED RESULT: [What the new values will be]
```

---

## Common Problems & Specific Fixes

### Problem: True Peak Exceeds -1.0 dBTP
```
CRITICAL — True peak at [X] dBTP (exceeds -1.0 limit by [Y] dB)

WHY THIS MATTERS:
- Streaming platforms will clip or distort your track
- Inter-sample peaks cause additional distortion on playback
- Some platforms reject uploads exceeding true peak limits

FIX:
1. Enable TRUE PEAK limiting on your limiter (not just sample peak)
   → Ableton Limiter: Set Ceiling to -1.0dB
   → Pro-L2 / Ozone: Enable "True Peak" mode
   
2. Reduce limiter ceiling by [Y + 0.5] dB for safety margin
   → Current ceiling: [X] → New ceiling: [Y]
   
3. If still exceeding, reduce input gain by [Y] dB

VERIFY: After changes, true_peak_db should read < -1.0 dBTP
```

### Problem: Track Too Loud for Streaming
```
SEVERE — Integrated loudness at [X] LUFS (target: -14 LUFS)

WHY THIS MATTERS:
- Spotify will turn your track DOWN by [X - (-14)] dB
- After normalization, your track will sound QUIETER than 
  properly mastered tracks at -14 LUFS
- You're sacrificing dynamics for zero benefit

FIX:
1. Reduce limiter input gain by [X - (-14)] dB
   → This will bring you to approximately -14 LUFS
   
2. Accept that streaming loudness wars are over
   → -14 LUFS masters sound BETTER than -8 LUFS after normalization
   
3. Consider TWO masters:
   → Streaming master: -14 LUFS integrated
   → Club/DJ master: -9 LUFS integrated

LIMITER ADJUSTMENT:
  Current input gain: [X] dB
  Reduce by: [Y] dB
  New input gain: [X - Y] dB
```

### Problem: Track Too Quiet
```
MODERATE — Integrated loudness at [X] LUFS (target: -14 LUFS)

WHY THIS MATTERS:
- Track will sound weak compared to other tracks
- Apple Music will turn it UP but only to a point
- Spotify won't boost tracks significantly

FIX:
1. Increase limiter input gain by [(-14) - X] dB
   → Target: -14 LUFS integrated
   
2. If gain increase causes clipping:
   → Add Glue Compressor before limiter (2:1, 10-20ms attack)
   → This adds density without just slamming the limiter
   
3. Check if mix itself is too dynamic:
   → Bus compression on drums (2-4dB GR)
   → Subtle master compression (1-2dB GR)

LIMITER ADJUSTMENT:
  Current input gain: [X] dB
  Increase by: [Y] dB
  New input gain: [X + Y] dB
  Watch for: Clipping, loss of transients
```

### Problem: Clipping from Over-Limiting
```
SEVERE — [X] clips detected at [timestamps]

WHY THIS MATTERS:
- Audible distortion on playback
- Indicates limiter is working too hard
- Peaks should be controlled BEFORE the limiter

FIX:
1. Reduce limiter input gain by 2-3dB

2. Address peaks earlier in chain:
   → Add soft clipper BEFORE limiter (catches transients)
   → Ableton: Saturator with "Soft Clip" mode, Drive at 0dB
   
3. Check which element is causing peaks:
   → Solo kick — is it too hot?
   → Check timestamps [X, Y, Z] to identify culprit
   
4. If kick is the problem:
   → Reduce kick by 1-2dB
   → Or add transient control to kick bus

CLIP LOCATIONS TO CHECK:
  [timestamp 1]: Check what's hitting here
  [timestamp 2]: Check what's hitting here
```

### Problem: No Dynamics (Over-Compressed)
```
SEVERE — Crest factor at [X] dB (target: 8-12 dB)

WHY THIS MATTERS:
- Track sounds flat, lifeless, fatiguing
- Kick and snare have no punch
- "Loud but not exciting" syndrome

FIX:
1. Reduce limiter input gain by 3-4dB
   → This alone will restore some dynamics
   
2. Check compression earlier in chain:
   → Are drum buses over-compressed?
   → Is master bus compression too heavy?
   
3. Target settings:
   → Master limiter: 3-6dB gain reduction MAX
   → Master compressor: 1-2dB gain reduction MAX
   → Drum bus: 3-4dB gain reduction MAX

CURRENT: Crest factor [X] dB (over-compressed)
TARGET: Crest factor 8-12 dB (punchy but loud)
```

---

## Mastering Chain Recommendations

### For Streaming (-14 LUFS target)
```
1. EQ Eight — Surgical fixes only (problem frequencies)
2. Glue Compressor — 2:1, 30ms attack, auto release, 1-2dB GR
3. EQ Eight — Tonal shaping (air boost at 10kHz if needed)
4. Limiter — Ceiling -1.0dB (true peak), target -14 LUFS

Settings for -14 LUFS:
  Limiter input gain: Adjust until LUFS meter reads -14 integrated
  Expected gain reduction: 3-6dB on peaks
```

### For Club/DJ (-9 LUFS target)
```
1. Same chain as above
2. Increase limiter input gain by ~5dB from streaming version
3. Accept more gain reduction (6-10dB on peaks)
4. Ceiling: -0.3dBTP (true peak) for club systems
```

---

## Quick Reference: LUFS Math

```
To reach target LUFS:
  adjustment_db = target_lufs - current_lufs
  
Example:
  Current: -8 LUFS
  Target: -14 LUFS
  Adjustment: -14 - (-8) = -6dB (reduce by 6dB)
  
Example:
  Current: -18 LUFS
  Target: -14 LUFS  
  Adjustment: -14 - (-18) = +4dB (increase by 4dB)
```

---

## Priority Rules

1. **CRITICAL**: True peak > 0 dBTP (will distort on all platforms)
2. **CRITICAL**: Excessive clipping (>100 clips)
3. **SEVERE**: True peak > -1.0 dBTP (streaming rejection risk)
4. **SEVERE**: Way too loud (> -8 LUFS) or too quiet (< -20 LUFS)
5. **SEVERE**: Over-compressed (crest factor < 6dB)
6. **MODERATE**: Slightly off target loudness (fixable in 2 minutes)
7. **MINOR**: Loudness range issues

---

## Example Output Snippet

```
[CRITICAL] True Peak Exceeds Streaming Limit
────────────────────────────────────────────
PROBLEM: True peak at +0.8 dBTP (exceeds -1.0 limit by 1.8dB)
IMPACT: Track will clip/distort on Spotify, Apple Music, and YouTube.
        Some platforms may reject the upload entirely.

CURRENT: true_peak_db = +0.8 dBTP
TARGET: true_peak_db < -1.0 dBTP

FIX:

Step 1: Enable True Peak limiting
        → Ozone/Pro-L2: Enable "True Peak" mode
        → Ableton Limiter: Not true-peak aware, use third-party

Step 2: Reduce limiter ceiling
        → Current: 0.0 dB
        → New: -1.5 dB (gives 0.5dB safety margin)

Step 3: If still exceeding, reduce input gain by 2dB

VERIFY AFTER FIX:
  true_peak_db should read between -1.5 and -1.0 dBTP
```

---

## Do NOT Do

- Don't aim for maximum loudness — streaming normalization makes it pointless
- Don't ignore true peak — it's the #1 cause of streaming rejection
- Don't sacrifice dynamics for loudness — you'll sound worse after normalization
- Don't use the same master for streaming AND club — make two versions
- Don't just say "too loud" — give the EXACT dB adjustment needed
- Don't forget to verify changes with a LUFS meter

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
