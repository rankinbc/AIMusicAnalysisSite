# Genre Configuration — thresholds for the rule engine + refinement pass

Values grounded in the genre-reference research. Each genre carries a
**streaming** loudness profile and a **club** profile (the single most important
distinction — streaming normalizes loud masters down, club delivery wants
density). Dynamics, tempo, spectral tilt, and stereo conventions follow.

Confidence tags on the numbers:
- **[std]** — formal standard (ITU-R BS.1770, EBU R128, published platform targets)
- **[rot]** — production rule-of-thumb, widely repeated
- **[interp]** — interpolated where sources gave ranges or were silent

Store ranges, not single points, wherever a value is tagged `[interp]` or sources
disagreed. These are tuning knobs, not code — and the techno DR figures and 90s
LUFS figures are the weakest-sourced, so treat them as provisional until you
measure your own reference corpus.

```yaml
# Cross-genre platform facts (apply to every streaming profile)
platform_targets:           # [std]
  spotify:      { lufs: -14, truepeak_dbtp: -1.0 }   # -2 dBTP if louder than -14
  youtube:      { lufs: -14, truepeak_dbtp: -1.0 }
  apple_music:  { lufs: -16, truepeak_dbtp: -1.0 }
  tidal:        { lufs: -14, truepeak_dbtp: -1.0 }
  amazon:       { lufs: -14, truepeak_dbtp: -1.0 }
  deezer:       { lufs: -15, truepeak_dbtp: -1.0 }
  universal_master: { lufs: -14, truepeak_dbtp: -1.0 }  # translates across the -14 cluster

genres:

  classic_trance:           # 90s / classic (~1994–2001)
    loudness:
      streaming: { lufs: -14, truepeak_dbtp: -1.0 }            # [std]
      club:      { lufs_range: [-10, -8], truepeak_dbtp: -1.0 } # [interp from DR]
    dynamics:
      crest_db:   { ideal: [9, 12], warn_below: 8 }   # DR10–11 era center [rot/measured]
      lra_lu:     { ideal: [6, 10], static_below: 3 } # long breakdowns → higher LRA [interp]
      plr:        { warn_below: 8 }                    # for a streaming master [rot]
    tempo:
      bpm: { range: [130, 140], center: 135 }         # [std/rot]
    spectral:
      character: "bright, airy; de-emphasized kick relative to bassline; supersaw sheen"
      brightness_rank: 2   # 1=brightest. modern ≥ classic > techno [interp]
      air_floor: present   # warn if air band thin/dark
    stereo:
      mono_below_hz: 100   # [rot] (100–120 range)
      width: "wide; pads/supersaws spread, kick/bass/lead centered"
      bass_correlation: "must stay positive; negative LF correlation = fail"

  modern_trance:            # uplifting / festival / tech-trance, current
    loudness:
      streaming: { lufs: -14, truepeak_dbtp: -1.0 }            # [std]
      club:      { lufs_range: [-8, -6], truepeak_dbtp: -1.0 } # [rot] festival → louder end
    dynamics:
      crest_db:   { ideal: [5, 8], warn_below: 4 }    # DR5–7 center [measured]
      lra_lu:     { ideal: [4, 7], static_below: 3 }  # breakdown raises LRA vs techno [interp]
      plr:        { warn_below: 8 }
    tempo:
      bpm: { range: [136, 142], center: 138 }         # uplifting signature ~138 [rot]
      progressive_melodic: { range: [128, 134], center: 132 }  # slower strand [rot]
    spectral:
      character: "very bright; supersaw stacks 1–3.5 kHz, M/S air ~8 kHz on sides"
      brightness_rank: 1
      air_floor: present
    stereo:
      mono_below_hz: 120   # Armada tutorial crossover [rot]
      width: "widest of the three; supersaw stereo fields, but must survive mono"
      bass_correlation: "positive; supersaws need a centered core layer"

  techno:                   # peak-time / driving, loud club end
    loudness:
      streaming: { lufs: -14, truepeak_dbtp: -1.0 }            # [std]
      club:      { lufs_range: [-7, -6], hot_to: -5, truepeak_dbtp: -1.0 } # [rot] loudest in practice
    dynamics:
      crest_db:   { ideal: [5, 7], warn_below: 4 }    # PROVISIONAL [interp] — not directly measured
      lra_lu:     { ideal: [3, 5], static_below: 2.5 }# inherently static beat [rot]
      plr:        { warn_below: 6 }                    # low PLR by design at -6 LUFS
    tempo:
      bpm: { range: [125, 150], center: 132 }         # broad [std]
      peak_time: { range: [128, 135], center: 132 }   # sources vary 126–135 [rot]
      hard_techno: { range: [140, 150], center: 145 }
      melodic_dub: { range: [125, 128], center: 126 }
    spectral:
      character: "mid-forward, driving; kick often loudest element; less top-end air"
      brightness_rank: 3   # least bright
      air_ceiling: present # warn on EXCESSIVE air relative to mids
    stereo:
      mono_below_hz: 100   # [rot]
      width: "narrowest; tight, punchy, mono-robust groove; perc panned"
      bass_correlation: "positive; low end kept tight and centered"

# Notes the refinement pass should respect:
# - crest of 4.8 is SEVERE for classic_trance (ideal 9–12) but NORMAL for techno (ideal 5–7).
#   The same measured value gets a different verdict per genre. This is the point of the config.
# - LRA below ideal is "possibly over-limited" EXCEPT in techno, where a constant beat
#   legitimately sits ~3–4 LU regardless of compression. Don't flag techno for being techno.
# - Treat tonal tilt as relative-to-reference, not absolute — there is no authoritative
#   per-genre spectral target curve; brightness_rank is interpolated ordering.
```
