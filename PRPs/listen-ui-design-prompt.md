# Listen-page UI Design — Handoff Prompt

Give this (and the repo) to "Claude design" to design + build the new Listen-page rack UI.

---

You are designing AND implementing the new UI for the **Listen page** of SPECTR — a music-producer web app where users hear their track through a real-time Web Audio DSP "rack." The audio ENGINE is complete, reviewed, and merged; your job is the UI that drives it. Do NOT modify the engine — bind to its typed handle.

## Read these first (authoritative, in order)

1. **`components/frontend-spectr-v2/src/features/listen/README.md`** — the living **system guide**: architecture, signal-graph diagram, the EffectUnit/bypass model, composer/reorder, worklet boot, pitch lane, the full handle API, state flow, modules, metering, gotchas, testing. Start here.
2. `components/frontend-spectr-v2/src/features/listen/useAudioGraph.ts` — the engine contract: the `AudioGraphHandle` interface + `EffectParamMap`. Everything you build calls this handle.
3. `components/frontend-spectr-v2/src/features/listen/audio/state.ts` — the SOURCE OF TRUTH for every module's params, exact ranges, and neutral defaults. `audio/EffectUnit.ts` has the `EffectId` union (13) + `EffectMeter`.
4. `PRPs/listen-dsp-rack-capabilities.md` — human-readable manifest of every module/param/range/default/format, the handle-binding contract, and module tiering. If it disagrees with `state.ts`, **state.ts wins**.
5. `components/frontend-spectr-v2/src/routes/_app/listen.$versionId.tsx` + `features/listen/PreviewTools.tsx` + the rest of `features/listen/**` — the CURRENT Listen UI you are evolving/replacing. Reuse its transport, spectrum, scope, and pitch wiring.
6. `components/frontend-spectr-v2/src/styles/{tokens.css,global.css}` + a few existing `features/**` components — the design system + visual language to match.
7. The repo `CLAUDE.md` — stack rules + Listen-page gotchas.

## Prep artifacts (ready for you)

- **`features/listen/rackManifest.ts`** — typed, machine-readable per-module/param descriptors (control kind, range, step, unit, default, enum options, tier). Render controls by mapping over `RACK_MANIFEST`; use `MASTERING_IDS` / `CREATIVE_IDS` for the primary-vs-creative tiering.
- **`features/listen/meterHooks.ts`** — design-agnostic metering glue: `useEffectMeter(graph, id)` (live GR + gate-open for comp/gate/limiter) and `useAudioLevels(graph)` (RMS/short-LUFS/true-peak/correlation). rAF-throttled + change-gated. Use these for scalar meter/level readouts; draw the spectrum/scope canvases from `graph.readFrame()` imperatively in your own rAF (don't route the reused Float32Array buffers through React state).
- **`PRPs/listen-smoke-script.md`** — browser-console procedure to confirm the engine works (the handle is exposed in dev as `window.__spectrGraph`). Run it first.
- `PRPs/listen-dsp-rack-capabilities.md` "Engine binding" + "Module tiering" sections — canonical handle usage and the per-effect tiers.

## What exists vs what you build

- DONE (don't touch): `features/listen/useAudioGraph.ts` and everything under `features/listen/audio/**` — a 13-module, reorderable, real-time DSP rack with per-unit dry/wet bypass, async AudioWorklet boot, meters, and a pitch lane.
- YOUR JOB: the rack UI — controls, panels, meters, reorder, and information architecture — wired to the handle.

## The binding contract (drive everything through this)

- `ensureContext()` — MUST be called from the play-button click handler (browser autoplay policy) before `audio.play()`.
- `setEffectParams(id, patch)` — the generic, type-safe param setter. `id` ∈ the 13 `EffectId`s; `patch` is `Partial<EffectParamMap[id]>`. Examples:
  - `setEffectParams('comp', { enabled: true, thresholdDb: -18, ratio: 4, mix: 0.6 })`
  - `setEffectParams('reverb', { enabled: true, ir: 'plate', decaySec: 3, mix: 0.3 })`
  - `setEffectParams('eq', { enabled: true, bands: [...] })` — EQ takes a full `EqBand[]` (each band: `type/freq/gainDb/q/enabled`); `enabled:false` truly bypasses the unit like every other module. Own the band array in the UI.
  - Per-unit ON/OFF is the module's own `enabled` field.
- `reorder(order: EffectId[])` / `getOrder(): EffectId[]` — the rack is runtime-reorderable; reorder is click-free during playback. Build a drag-to-reorder chain that calls `reorder()`.
- `readEffectMeter(id): EffectMeter | null` — `comp` → `{reductionDb}`, `gate` → `{reductionDb, open}`, `limiter` → `{reductionDb}`; others null. (Prefer the `useEffectMeter` hook.)
- `readFrame(): AudioFrame` — spectrum / scope / RMS / short-LUFS / true-peak / correlation for visualizers.
- `setMasterBypass(b)`, `resetAll()`.
- Pitch lane (NOT an insert effect): `enterPitchMode`/`exitPitchMode`/`setPitchDetune`/`pitch*`. Pitch + tempo are coupled — surface it.
- At defaults every module is transparent (dry passthrough). The UI's per-module "enabled" toggle maps to its `enabled` param.

## The 13 modules — and how to tier them (IA matters; 13 is a lot)

Primary use is listening to a FULL mixed song (a mastering/loudness preview), not individual stems. Tier the UI accordingly:

- **Primary "mastering" rack (surface prominently):** EQ (8-band), Compressor (+GR meter), Saturator, M/S Width, **Limiter** (+GR meter — the core "-1 dBTP" loudness preview), Output Trim.
- **Secondary "creative / per-element" FX (tuck behind a disclosure, lower priority):** DJ Filter, Delay (BPM-sync + ping-pong), Reverb, Stereo Pan, Tremolo/Auto-pan, Gate (+GR meter), Bitcrusher. Less useful on a whole mix (reverb/delay/gate on a full kit muddies it) — keep them fully functional; they shine if a per-stem Listen view is added later.

Exact params/ranges/defaults per module: read `state.ts` / `rackManifest.ts`.

## Hard requirements

- Reorderable rack (drag) bound to `reorder()`/`getOrder()`, defaulting to `DEFAULT_ORDER`.
- Per-module: enable/bypass, full param surface (controls per `rackManifest.ts`), dry/wet where the module has a `mix`.
- Live GR meters for comp/gate/limiter (via `useEffectMeter`), plus the existing spectrum / scope / LUFS / true-peak readouts (`readFrame` / `useAudioLevels`).
- Keep + integrate the existing transport and pitch controls.
- Master A/B bypass + Reset.

## Stack constraints (match the v2 frontend exactly)

- React 19 + Vite 6 + TypeScript strict (`verbatimModuleSyntax` — `import type`).
- **CSS Modules + `src/styles/tokens.css` + the global utility classes** (`.card`, `.pill`, `.btn`, `.label`, `.mono`, …). NO Tailwind, NO shadcn/MUI/Chakra, NO styled-components.
- Radix UI primitives, Recharts (charts), WaveSurfer v7 (waveform), Sonner (toasts) — already in the stack.
- Feature-based folders under `src/features/listen/`. No inline styles unless dynamic (color-from-value).
- All four gates must pass (run from `components/frontend-spectr-v2`): `npx tsc -b`, `npm run lint` (--max-warnings 0), `npx vitest run`, `npm run build`. NOTE: the real typecheck is `tsc -b`, NOT `tsc --noEmit` (root tsconfig uses project references — `--noEmit` is a no-op).

## Engine boundary — do NOT edit

`useAudioGraph.ts` and `audio/**` are frozen. If you think you need an engine change, STOP and flag it — don't reach past the handle.

## Performance to design around

Native nodes are cheap, but the **reverb convolver** (long IR) and the **limiter** (lookahead) are the cost centers, and bypassed time-based effects still process. For low-end devices, prefer UX that doesn't leave many heavy effects enabled needlessly (clear per-effect on/off, sensible defaults off). Don't over-engineer this — just be aware.

## Process

1. Start with the superpowers **brainstorming** skill (or frontend-design): explore the current Listen UI, then PROPOSE 2–3 layout/IA approaches for a 13-module reorderable rack (tiered rack vs tabbed vs collapsible panels; where meters/transport/visualizers sit; reorder UX) with mockups. Get the user's approval on the design BEFORE implementing.
2. Then write a plan and implement against the handle, keeping each component focused and the four gates green.
3. At defaults the page must sound identical to today (the engine is behavior-preserving) — verify nothing regresses.

Deliverable: an approved design, then a working, gates-green Listen-page rack UI wired to the engine handle.
