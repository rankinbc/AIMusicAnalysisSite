---
slug: true_peak_ceiling
category: clipping
aliases: [true peak, dbtp, ceiling, clipping, inter-sample, intersample, codec, distortion on loud, peak limit]
reference_paths: [phase1.true_peak_db, phase1.clipping_detected]
title: Setting the true-peak ceiling
---
## Explain
Set your limiter's output ceiling to -1.0 dBTP for streaming. The reason is
real, not superstition: between samples the reconstructed waveform can overshoot
0 dBFS (inter-sample peaks), and lossy encoders add their own overshoot, so a
file that reads "0 dBFS clean" can clip on playback. The -1 dBTP headroom
absorbs that. For hot masters (louder than about -14 LUFS) drop to -2 dBTP for
extra codec safety; -2 dBTP is also the single safest ceiling if you want one
master to satisfy every platform.

## Anchor to your track
Check your measured true peak against the -1.0 dBTP target, and whether
clipping was detected. A true peak at or above the ceiling — or detected
clipping — means you're risking codec distortion and should pull the ceiling
down.

## Genre notes
The -1 dBTP ceiling holds across genres. Club/DJ masters sometimes push the
ceiling closer to 0, but that's a deliberate, riskier choice for systems you
control — for streaming, keep the headroom.

## When it's the wrong tool
A ceiling fixes overshoot, not loudness. If you need heavy limiting just to feel
competitive, the fix is upstream (control the low end, lower the crest factor
with clipping/saturation), not a hotter ceiling.
