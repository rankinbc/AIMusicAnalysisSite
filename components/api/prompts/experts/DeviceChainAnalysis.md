# Prompt 8: Device Chain Analysis

## Your Task

Analyze the provided Ableton project JSON file to evaluate the processing chains on each track. Your goal is to identify missing essential processing, potentially problematic device combinations, and provide **specific recommendations for what processing each track type needs**.

---

## JSON Fields to Analyze

```
tracks[].name                → Track identification
tracks[].devices[]           → List of device names on the track
tracks[].track_type          → "midi" or "audio"
tracks[].is_muted            → Skip muted tracks for active analysis

midi_analysis[].note_density_per_bar  → Context for processing needs
midi_analysis[].velocity_std          → Dynamics context
```

---

## Analysis Steps

### Step 1: Parse Device Names

Common Ableton devices to recognize:
```
EQ:          Eq8, EQ Three, EQ Eight, Channel EQ
Compressor:  Compressor, Compressor2, Glue Compressor
Limiter:     Limiter
Saturator:   Saturator, Overdrive, Amp
Filter:      Auto Filter, Filter
Reverb:      Reverb, Convolution Reverb
Delay:       Delay, Echo, Ping Pong Delay
Sidechain:   Compressor with external key (check for sidechain)
Gate:        Gate
Utility:     Utility (mono, phase, gain)

Instruments: OriginalSimpler, Sampler, Operator, Analog, etc.
Third-party: Names like "MonoPoly", "TRITON", "SPAN", "Serum", etc.
```

### Step 2: Categorize Tracks by Element Type

Parse track names to determine expected processing:

| Element Type | MUST Have | SHOULD Have | NICE TO Have |
|--------------|-----------|-------------|--------------|
| **Kick** | EQ | Compressor | Saturator, Transient Shaper |
| **Snare** | EQ | Compressor | Reverb Send, Transient |
| **Hi-hat** | EQ (high-pass) | - | Saturator |
| **Bass** | EQ, Compressor | Sidechain | Saturator |
| **Lead** | EQ | Compressor | Reverb, Delay Sends |
| **Pad** | EQ (low cut) | - | Reverb, Stereo Widener |
| **FX/Riser** | - | EQ | Reverb, Delay |

### Step 3: Identify Missing Essential Processing

For each track:
1. Determine element type from name
2. Check devices list
3. Flag missing essential processors

### Step 4: Identify Potentially Problematic Chains

| Pattern | Potential Issue |
|---------|-----------------|
| No EQ on high-density track | Mud contributor |
| Compressor before EQ | May compress unwanted frequencies |
| Multiple compressors without reason | Over-compression |
| Reverb as insert (not send) | May be too wet |
| No high-pass on non-bass track | Low-end buildup |

---

## Output Format

### Summary
```
DEVICE CHAIN ANALYSIS
=====================
Overall Status: [CRITICAL / NEEDS WORK / ACCEPTABLE / GOOD]

Processing Statistics:
- Tracks analyzed: X
- Tracks with EQ: X of Y (Z%)
- Tracks with Compression: X of Y (Z%)
- Tracks missing essential processing: X

Key Issues:
- [Primary issue summary]
```

### Missing Essential Processing

```
MISSING ESSENTIAL PROCESSORS
============================

These tracks are missing processing they likely need:

CRITICAL MISSING:
─────────────────

[KICK] 3-Imba Kick 53
  Current devices: [OriginalSimpler, Eq8, Compressor2, Kick Reducer]
  Status: ✓ Has EQ and Compression — Good
  
[BASS] 26-MonoPoly
  Current devices: [MonoPoly]
  Status: ✗ MISSING EQ, ✗ MISSING COMPRESSOR
  
  IMPACT: Bass is likely muddy and inconsistent in level.
  
  RECOMMENDED ADDITIONS:
  1. Add EQ8:
     → High-pass at 30Hz (remove sub rumble)
     → Cut 2-3dB at 200-300Hz (reduce mud)
     → Optional: Boost 1-2dB at 80-100Hz for punch
     
  2. Add Compressor:
     → Ratio: 3:1
     → Attack: 15-25ms
     → Release: 100-150ms
     → Threshold: Adjust for 4-6dB gain reduction
     
  3. Add Sidechain (to kick):
     → Route kick to external sidechain input
     → Attack: <5ms
     → Release: 100-150ms (adjust to tempo)
     → Target: 4-6dB ducking

[SNARE] 6-Imba Snare 52
  Current devices: [OriginalSimpler]
  Status: ✗ MISSING EQ, ✗ MISSING COMPRESSOR
  
  RECOMMENDED ADDITIONS:
  1. Add EQ8:
     → High-pass at 80-100Hz
     → Cut 2-3dB at 300-400Hz (remove boxiness)
     → Boost 2-4dB at 3-5kHz (crack/presence)
     
  2. Add Compressor (optional for punch):
     → Ratio: 4:1
     → Attack: 10-20ms (let transient through)
     → Release: 50-100ms
     → Target: 3-5dB gain reduction

[Continue for each track missing processing...]
```

### Tracks With No Processing

```
TRACKS WITH MINIMAL/NO PROCESSING
=================================

These tracks only have an instrument — no mixing processing:

⚠️ 15-MonoPoly: [MonoPoly] only
   Element type: Synth (lead/pad?)
   Note density: 99.8 notes/bar (very busy)
   
   PROBLEM: High-density synth with no EQ or compression.
            Almost certainly contributing to frequency buildup.
   
   ADD: EQ8 → High-pass 100Hz, cut 300Hz, presence boost 2-4kHz

⚠️ 21-MonoPoly: [MonoPoly] only
   Element type: Synth
   Note density: 102.7 notes/bar (very busy)
   
   ADD: EQ8 → Same as above

⚠️ 24-MonoPoly: [MonoPoly] only
⚠️ 26-MonoPoly: [MonoPoly] only
⚠️ 27-MonoPoly: [MonoPoly] only

PATTERN DETECTED: All MonoPoly tracks have no processing.
RECOMMENDATION: Create a processing template for these:
  → EQ8: HP 80Hz, cut 300Hz by 2-3dB
  → Compressor: 3:1, 15ms attack, 100ms release
  → Apply to all MonoPoly tracks
```

### Device Order Recommendations

```
DEVICE CHAIN ORDER RECOMMENDATIONS
==================================

Optimal signal flow for different track types:

KICK DRUM:
──────────
1. Instrument/Sampler
2. EQ (subtractive first)
3. Compressor
4. Saturator (if needed)
5. EQ (additive/tone shaping)
6. Limiter (if needed)

Current: [OriginalSimpler, Eq8, Compressor2, Kick Reducer]
Status: ✓ Good order

BASS:
─────
1. Instrument
2. EQ (high-pass, cut mud)
3. Compressor
4. Sidechain Compressor (keyed to kick)
5. Saturator (for harmonics)
6. EQ (final tone)

LEAD SYNTH:
───────────
1. Instrument
2. EQ (high-pass, shape tone)
3. Compressor (if needed)
4. [Send to Reverb]
5. [Send to Delay]

PAD:
────
1. Instrument
2. EQ (definitely high-pass at 150-200Hz)
3. [Send to Reverb]
4. Stereo Widener (optional)
```

### Third-Party Plugin Notes

```
THIRD-PARTY PLUGINS DETECTED
============================

MonoPoly
────────
  Type: Synthesizer
  Used on: 8 tracks
  Note: This is a synth, not a processor.
        All MonoPoly tracks need additional mixing plugins.

SPAN
────
  Type: Spectrum Analyzer
  Used on: [list tracks]
  Note: Analysis tool only — doesn't affect sound.
        Good for monitoring but not mixing.

TRITON
──────
  Type: Synthesizer (Korg Triton emulation)
  Used on: 12 tracks
  Note: Synth — needs additional mixing processors.
```

---

## Essential Processing by Element

### KICK — Must Have
```
EQ Settings:
  → High-pass at 25-30Hz (remove sub rumble)
  → Cut 2-4dB at 200-400Hz (remove mud/boxiness)
  → Boost 2-4dB at 50-80Hz (sub weight) OR 100-150Hz (punch)
  → Boost 2-4dB at 3-6kHz (click/attack)

Compressor Settings:
  → Ratio: 4:1 to 6:1
  → Attack: 10-30ms (let transient through)
  → Release: 50-100ms
  → Gain reduction: 3-6dB
```

### SNARE — Must Have
```
EQ Settings:
  → High-pass at 80-100Hz
  → Cut 2-4dB at 300-500Hz (boxiness)
  → Boost 2-4dB at 2-4kHz (crack)
  → Optional: Boost at 200Hz (body)

Compressor Settings:
  → Ratio: 4:1 to 8:1
  → Attack: 5-15ms
  → Release: 50-100ms
  → Gain reduction: 4-8dB
```

### BASS — Must Have
```
EQ Settings:
  → High-pass at 30-40Hz (clean up sub)
  → Cut 2-3dB at 200-300Hz (mud)
  → Boost at fundamental (usually 60-100Hz)
  → Cut at kick's fundamental frequency

Compressor Settings:
  → Ratio: 3:1 to 4:1
  → Attack: 15-25ms
  → Release: 100-200ms (tempo-dependent)
  → Gain reduction: 4-6dB

Sidechain Settings:
  → Keyed to kick drum
  → Attack: <5ms
  → Release: 100-200ms
  → Gain reduction: 4-8dB
```

### PADS/SYNTHS — Should Have
```
EQ Settings:
  → High-pass at 100-200Hz (ESSENTIAL — leave room for bass)
  → Cut 2-3dB at 300-500Hz if muddy
  → Shape top end to taste

Compression (optional):
  → Light compression: 2:1, slow attack/release
  → Often not needed for pads
```

---

## Priority Rules

1. **CRITICAL**: Bass/sub tracks with no EQ (guaranteed mud)
2. **CRITICAL**: High-density tracks with no EQ (frequency buildup)
3. **SEVERE**: Drums with no EQ or compression (lack punch)
4. **MODERATE**: Synths/leads with no high-pass (low-end bleed)
5. **MINOR**: Missing optional processing (saturators, etc.)

---

## Example Output Snippet

```
[CRITICAL] Bass Tracks Missing Essential Processing
───────────────────────────────────────────────────
PROBLEM: 5 MonoPoly bass/synth tracks have NO EQ or compression:
  • 24-MonoPoly (104.7 notes/bar)
  • 26-MonoPoly (113.9 notes/bar)  
  • 27-MonoPoly (150.8 notes/bar)
  • 21-MonoPoly (102.7 notes/bar)
  • 28-MonoPoly (58.1 notes/bar)

IMPACT: All low/mid frequency content from these tracks is passing
        through unfiltered. Combined with their high note density,
        this is a PRIMARY cause of your muddy mix.

ACTION REQUIRED:

For ALL MonoPoly tracks, add this processing chain:

1. EQ8 (add first in chain):
   ┌─────────────────────────────────────┐
   │ Band 1: High-pass 80Hz, 24dB/oct    │
   │ Band 2: Cut 3dB at 300Hz, Q=1.0     │
   │ Band 3: Cut 2dB at 500Hz, Q=0.8     │
   │ Band 4: Boost 2dB at 2.5kHz (leads) │
   └─────────────────────────────────────┘

2. Compressor (add after EQ):
   ┌─────────────────────────────────────┐
   │ Ratio: 3:1                          │
   │ Attack: 15ms                        │
   │ Release: 120ms                      │
   │ Threshold: Adjust for 4-6dB GR     │
   │ Makeup gain: Match levels           │
   └─────────────────────────────────────┘

QUICK FIX: Create this as a preset, apply to all 5 tracks.
           Time required: 5 minutes.
           Impact: Significant improvement to low-mid clarity.
```

---

## Do NOT Do

- Don't recommend processing for muted tracks (they're inactive)
- Don't suggest every track needs a compressor (pads often don't)
- Don't ignore third-party plugins — they're instruments, not processors
- Don't recommend complex chains when simple EQ would fix the issue
- Don't forget that SOME tracks might intentionally have no processing
