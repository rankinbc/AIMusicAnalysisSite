# HANDOFF — Listen-page DSP Rack Revamp

Date: 2026-06-23
Current position: **Phase 2 of 6 complete and pushed (unmerged). Phase 1 merged to `master` and pushed.**

This document lets you resume the DSP-rack revamp from another machine. Read it first.

---

## Resume on a new machine

```bash
git clone https://github.com/rankinbc/AIMusicAnalysisSite.git   # or: git fetch
cd AIMusicAnalysisSite
git checkout listen-dsp-rack-phase2        # the active branch (Phase 2 work lives here)
cd components/frontend-spectr-v2 && npm install
```

Where you are: the audio-engine layer for the Listen page has been rebuilt over two phases. The remaining work is engine Phases 3-6 plus the UI redesign. Pick up at "Recommended next step" below.

Note: the subagent-driven execution ledgers + task briefs under `.superpowers/sdd/` are **git-ignored (local-only)** and do NOT transfer between machines. The git history + the PRP docs below are the source of truth.

---

## What this project is

SPECTR — a music-producer web app. The **Listen page** (`components/frontend-spectr-v2/src/features/listen/`) lets users hear their track through a real-time Web Audio DSP "rack" (EQ, compressor, saturator, M/S width, pitch, …). The revamp turns a thin, mostly-hidden rack into a full, reorderable ~14-module effects rack and rebuilds the engine to support it. **This work is engine-only so far; the UI redesign is a parallel track (see below).**

The v2 frontend stack: React 19 + Vite 6 + TS strict (`verbatimModuleSyntax`) + CSS Modules + Vitest. No Tailwind.

---

## Status

| Phase | What | State |
|---|---|---|
| 1 | Modular `EffectUnit` refactor (behavior-preserving) | **DONE — merged to `master`, pushed** |
| 2 | Reorder + generic handle API | **DONE — on `listen-dsp-rack-phase2`, pushed, NOT merged** |
| 3 | Unhide existing params (comp knee/makeup/GR, full per-band EQ, sat curves/tone, M/S split/mono-maker) | not started |
| 4 | New native modules (DJ filter, delay, reverb, pan, tremolo, output trim) | not started |
| 5 | Worklet modules (gate, bitcrusher, true limiter) | not started |
| 6 | Metering display wiring (GR meters → UI) | not started |

### Branch / commit map
- `master` @ `7d0dda9` — Phase 1 merged. Pushed to `origin/master`.
- `listen-dsp-rack-phase2` @ `e4b7ec0` (+ this handoff commit) — Phase 2. Pushed to `origin/listen-dsp-rack-phase2`. PR not opened.
  - Open a PR: https://github.com/rankinbc/AIMusicAnalysisSite/pull/new/listen-dsp-rack-phase2

All four validation gates were green at each phase's tip (run from `components/frontend-spectr-v2`):
`npx tsc --noEmit` · `npm run lint` · `npx vitest run` (370 tests) · `npm run build`.

---

## Key documents (all under `PRPs/`)

| File | Purpose |
|---|---|
| `listen-dsp-rack-engine-design.md` | Master architecture spec — all 13 modules, the EffectUnit model, reorder, worklet plan, 6-phase roadmap |
| `listen-dsp-rack-engine.md` | Phase 1 implementation plan (executed) |
| `listen-dsp-rack-engine-phase2-design.md` | Phase 2 design delta (reorder + handle API) |
| `listen-dsp-rack-engine-phase2.md` | Phase 2 implementation plan (executed) |
| `listen-dsp-rack-capabilities.md` | **UI-design handoff** — every module + param + range/default/format, for Claude design |

---

## Architecture orientation (what exists now)

Engine lives in `components/frontend-spectr-v2/src/features/listen/`:

```
useAudioGraph.ts          thin composer hook; owns boundary nodes + pitch lane + analysers + the public handle
audio/
  EffectUnit.ts           EffectUnit<S> contract + makeDryWet() per-unit dry/wet bypass helper
  state.ts                shared param types + defaults + DEFAULT_ORDER (leaf — no import cycle)
  composer.ts             buildInsertChain: stable chainIn/chainOut + reorder()+duck + getOrder()
  effects/                eq.ts, compressor.ts, saturator.ts, width.ts (each an EffectUnit)
  dsp/                    pure, unit-tested math: curves, msMatrix, mix, chainLinks
```

The public handle (`AudioGraphHandle` in `useAudioGraph.ts`) now exposes — for the future UI:
- `setEffectParams(id, patch)` — generic param setter (old `setCompressor`/etc. are wrappers over it)
- `reorder(order)` / `getOrder()` — chain reordering (no caller yet; the UI wires it)
- `readEffectMeter(id)` — live meter read (only compressor has data today)

Signal flow: `MediaElementSource → masterIn → [insert chain: chainIn → units(reorderable) → chainOut] → masterProcessed → masterOut → analysers → destination`, with a parallel dry-passthrough (master bypass) lane and a separate pitch BufferSource lane.

---

## Outstanding items (do these to fully close out the current work)

1. **Manual smoke test — Phase 1** (deferred; needs the running app + a version with audio + analysis results). On the Listen page confirm EQ/comp/sat/M-S/bypass/reset/pitch/loop/scope behave as before the refactor. Both phases are behavior-preserving, so "same as before" is the bar.
2. **Manual smoke test — Phase 2** (narrow, per final review): (a) **Reset produces no audio blip**; (b) one `graph.reorder([...])` during playback is **click-free** (drive via dev console on the page's audio graph handle). The `setEffectParams`/`readEffectMeter` paths are low-risk (typed, exercised by existing setters).
3. **Merge Phase 2** — after the smoke check, merge `listen-dsp-rack-phase2` → `master` (fast-forward, or via the PR link above) and delete the branch. It is reviewed-clean and behavior-preserving.
4. **UI track** — hand `PRPs/listen-dsp-rack-capabilities.md` + the existing Listen code to Claude design to design the revamped rack UI against the full end-state. The engine handle API is the binding contract; design against it.

---

## Recommended next step

**Build Phase 3 (unhide existing params)** — highest user-visible value on the modules already there (compressor knee/makeup + GR meter, full per-band EQ freq/Q/type, saturator curve-select/tone/oversample/asymmetry, M/S independent mid/side + mono-maker). It binds to the `setEffectParams` API shipped in Phase 2.

The established workflow for each phase (used for Phases 1-2):
1. `superpowers:brainstorming` — confirm the phase's open design decisions, write a `PRPs/...-phaseN-design.md`.
2. `superpowers:writing-plans` — write `PRPs/...-phaseN.md` as bite-sized TDD tasks.
3. `superpowers:subagent-driven-development` — fresh implementer subagent per task + spec/quality review per task + a final opus whole-branch review, on a `listen-dsp-rack-phaseN` branch.
4. `superpowers:finishing-a-development-branch` — merge.

Phases 3-6 are fully specced in `PRPs/listen-dsp-rack-engine-design.md` (module param tables + worklet plan) — start each from there.

---

## Continuity notes / gotchas

- **Web Audio can't run in jsdom.** AudioNode-wiring code (units, composer, the hook) is verified by `tsc` + `build` + a manual browser check — NOT unit tests. Only pure math (`audio/dsp/*`) is unit-tested. This is the established pattern; don't add jsdom tests for AudioNode code.
- **EQ enable is special.** `applyEq` always applies the unit with `enabled: true`. The only consumer pre-gates each band gain (`PreviewTools.tsx`: `setEqBand(i, eqEnabled ? gainDb : 0)`) and never calls the graph's `setEqEnabled`. Do not route EQ enable through a unit flag — it would silently kill EQ. (comp/sat/width DO carry `enabled` from consumer state.)
- **`reorder` has a no-op guard** (skips the duck when the order is unchanged) — added because `resetAll` calls `reorder(DEFAULT_ORDER)` and was blipping audio on every Reset.
- **Pitch couples tempo** (Web Audio detune scales playback rate). True independent pitch/tempo + formant preservation is a future phase-vocoder worklet, explicitly out of the current roadmap's scope.
- **Worklets (Phase 5)** need async `ctx.audioWorklet.addModule()` before their nodes exist; the design specs a placeholder-then-swap boot. Vite serves processors via `new URL('...', import.meta.url)`.
- **Branching rule** (from this repo's CLAUDE.md): never commit DSP-rack work directly on `master` — branch per phase, merge when reviewed.
- This session ran with **caveman mode** (terse comms) and **superpowers** skills active — not required to continue, just context for the conversation tone if you reopen the transcript.
