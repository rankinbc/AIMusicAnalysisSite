# DJ-tab audio-reactive features — copy-paste build prompt

Status: draft brief (not yet executed)
Created: 2026-06-16
Target surface: Listen / DJ page (`components/frontend-spectr-v2/src/features/listen/`)
Related: `PRPs/brainstorming/brainstorming-session-2026-06-16.md` (live concert / DJ room vision)

This is a self-contained copy-paste prompt for Claude Code. It is scoped to the DJ-tab
visual features plus the shared infra patterns they need. Feature 2 (reactive laser
effects) carries the full laser-show spec inline.

Constraints baked in: don't touch the audio graph, read from the existing analysers,
keep frame data in refs (never per-frame setState), honor the reduced-motion contract,
and route every flash/strobe through one shared ≤3 Hz rate limiter.

---

```
# Task: Add audio-reactive features wired into the DJ tab

## Context
This is a React 19 + Vite + TypeScript music app with rave-style visuals.
- Audio comes from existing Web Audio AnalyserNodes exposed by `useAudioGraph.ts`.
  DO NOT create a new audio graph or take ownership of playback — only READ from
  the existing analyser(s) via getByteFrequencyData / getByteTimeDomainData.
- Rendering house style is Canvas 2D + CSS/SVG. Do not add three.js/Pixi/p5.
- There is a reduced-motion contract: everything must pause to a single static
  frame (or a calm low-motion variant) when prefers-reduced-motion is set or a
  user toggle is off.
- The "DJ tab" sidebar already has: EQ Bar Color swatches, Backdrop options,
  Laser Light (on/off, Intensity slider, Color swatches, Effect buttons:
  Sweep / Strobe / Flash / Beat), and a "Launch fireworks" button.

## Before writing code
1. Explore the repo and report back: where the rAF loop(s) live, how visualizers
   currently read analyser data, how DJ-tab controls store their state, and
   whether a shared parameter store exists.
2. Propose a short plan. If there is no single shared rAF loop or parameter
   store, propose introducing: (a) ONE shared rAF loop that reads analyser data
   once per frame into reusable Uint8Arrays and calls registered draw callbacks,
   and (b) a small external param store consumed via useSyncExternalStore so the
   DJ tab writes config and the loop reads it via refs.
   Wait for my OK before building if it's a large refactor; otherwise proceed.

## Features to build (all controllable from the DJ tab unless noted)
1. Beat detection module: a lightweight live onset detector (band-pass ~100–800Hz
   energy vs. rolling average, with a refractory window) exposed as a per-frame
   `beat` flag + `energy` value. No external lib required for live; you may use
   web-audio-beat-detector only for offline BPM if a decoded AudioBuffer is handy.

2. Laser show upgrade (Canvas 2D, additive blending — no WebGL)

   Replace the laser visual with a beam-fan engine modeled on a real laser show:
   many beams radiating from a tight origin, fanning across the scene, with fast
   strobing, a radial Burst mode, and beams that "land" on a ground plane. The
   existing Laser Light Effect buttons (Sweep / Strobe / Flash / Beat) drive it.

   Geometry & rendering:
   - Beams emit from a configurable origin (default top-center or center). Render
     N beams (default 12–24) spread across a sweep angle that slowly oscillates.
   - Each beam = a thin bright CORE stroke + a wider, lower-alpha HALO stroke under
     it (soft glow / haze scatter). Use ctx.globalCompositeOperation = 'lighter'
     (additive) so overlapping beams blow out to white where they cross. Stroke
     with a linear gradient: bright at origin, fading along length.
   - Two-color palette from the existing Laser Color swatches (e.g. green + violet);
     alternate or mix beam colors across the fan.

   Ground hit / lit-up ground:
   - Define a horizontal "floor" line (configurable Y). For each downward beam that
     crosses the floor, compute the intersection and draw:
       (a) a bright radial-gradient POOL (ellipse) at the hit point, sized by intensity,
       (b) a faint vertical mirror REFLECTION below the floor at low alpha,
       (c) optional brief scatter sparkle on beats.
   - Aerial beams (above floor) render with no pool.

   Modes:
   - Fan: steady oscillating spread of beams (the default wide look).
   - Sweep: the whole fan rotates/sweeps its center angle back and forth.
   - Burst: on each detected beat, emit a short-lived radial EXPLOSION of beams from
     the origin in all directions (like the bright center of a real laser fan), which
     rapidly fade out before the next beat. Burst beam count + decay time configurable;
     bursts get bigger/brighter with the Energy macro and on drops.

   Flash / strobe:
   - Strobe mode toggles whole-fan or per-beam visibility; Beat mode flashes on
     detected beats. On a drop, do a brief full-intensity strobe burst.

   ### HARD SAFETY CONSTRAINT — photosensitivity (non-negotiable)
   - Global flash/strobe rate is HARD-CLAMPED to a maximum of 3 Hz (3 flashes per
     second) anywhere in the app — Strobe mode, Beat flashes, Burst, and drop bursts
     all route through one shared rate limiter that enforces this ceiling. Never
     exceed it regardless of slider/knob values; the UI may allow lower but not higher.
   - No large full-screen luminance flashes: cap the area and peak brightness of any
     single flash, and avoid red-flash extremes. Stay clear of the 3–30 Hz seizure band.
   - prefers-reduced-motion OR the global motion toggle = ALL strobing/flashing/burst/
     oscillation disabled, frozen to one static frame. This path is mandatory, not
     optional, and overrides every laser control.
   - Add a one-time "this scene contains flashing lights" notice/opt-in before any
     strobe-capable mode runs.

   DJ-tab controls:
   - Mode (Fan / Sweep / Burst), Beam Count, Spread, Beam Speed, Flash Speed
     (clamped ≤3 Hz), Burst decay, Ground Glow on/off + floor height, Color, Intensity.

   Performance: precompute beam angles per frame, single draw pass, reuse gradients
   per color, all inside the shared rAF loop. Strong TS types for the laser config.

3. "Auto" mode for EQ Bar Color and Backdrop: add an Auto toggle next to the
   existing swatches that drives hue from the spectral centroid (bass=warm,
   bright=cool). Manual swatch selection overrides Auto.

4. Energy macro knob in the DJ tab: one 0–100 control that scales laser intensity,
   EQ bar gain, and effect rates together.

5. Radial pulse / ripple visualizer (Canvas 2D): bars/points around a circle,
   radius modulated by bass; ripples spawn on beats. Selectable from the DJ tab.

6. Spectrogram waterfall (Canvas 2D, putImageData column-scroll): toggle in DJ tab.

7. Drop detection: when energy collapses then slams back, fire a one-shot
   "moment" (max laser intensity + fireworks). Add a DJ-tab toggle to enable it.

8. Snapshot presets: save/restore the full DJ-tab visual state (laser color,
   intensity, backdrop, EQ palette, active visualizer, toggles) as named presets
   with a crossfade. Persist to localStorage.

## Constraints / acceptance criteria
- One shared rAF loop; never setState per frame; store frame data and IDs in refs.
- StrictMode-safe: idempotent loop setup/teardown (cancel before scheduling).
- Honor devicePixelRatio so canvases are sharp on retina.
- prefers-reduced-motion AND an in-app toggle both pause animation to a static
  frame; CSS animations also gated behind @media (prefers-reduced-motion: reduce).
- Strong TypeScript types for the param store, beat module, and visualizer API.
- No new heavy deps without asking. Keep changes incremental and well-commented.
- After building, give me a brief summary of files changed and how to test each
  feature from the DJ tab.
```

---

## Notes for whoever runs this

- The shared 3 Hz rate-limiter is a single chokepoint by design: Strobe, Beat,
  Burst, and drop-bursts all route through it, so no individual control (or future
  feature) can accidentally exceed the photosensitivity ceiling.
- Existing laser code to build on / replace: `features/listen/laser.ts` (intensity
  CSS-var math), `LaserRig.tsx`, plus `Fireworks.tsx`, `StageDisplay.tsx`,
  `VizControls.tsx`.
- Reduced-motion: a `useReducedMotion()` hook already exists
  (`src/hooks/useReducedMotion.ts`) but per `PRPs/deferred-work.md` it is only wired
  into TranceBot — the Listen-page rAF visualizers still run at 60 fps under
  reduced-motion. This prompt's reduced-motion requirement closes that gap.
- Tweak the file path / DJ-tab control names to match the actual code before pasting.

## Possible smaller first-PR scope

If the first change should be easy to review, cut to: feature 1 (beat module) +
feature 2 (reactive laser effects) + feature 5 (radial pulse). That delivers a
visible reactive result while deferring the auto-color, spectrogram, drop, and
presets work to follow-ups.
