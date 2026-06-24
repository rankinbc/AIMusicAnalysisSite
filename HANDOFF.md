# HANDOFF — Listen-page DSP Rack Revamp

Date: 2026-06-24
Current position: **Engine Phases 1–5 ALL complete, merged to `master`, and pushed. UI-design handoff prepped. Next = run the manual smoke, then hand the UI redesign to Claude design.**

`origin/master` tip: `52a7b63` (everything below is pushed; `git pull` on any machine gets it all).

---

## Resume on another machine

```bash
git clone https://github.com/rankinbc/AIMusicAnalysisSite.git   # or: git fetch && git pull
cd AIMusicAnalysisSite/components/frontend-spectr-v2 && npm install
```
- **git push auth on the new machine:** use the GitHub CLI — `gh auth login` then `gh auth setup-git` (the Windows Credential Manager path hangs; gh's token works). 
- **`.superpowers/sdd/` ledgers + task briefs do NOT transfer** (git-ignored, local-only) — but they're historical scratch from completed phases; the git history + the PRP docs are the source of truth.
- To run the full app for the smoke test: `docker compose -f docker/docker-compose.yml up -d` + the BFF + worker + frontend per the root `CLAUDE.md` "How to run" commands, with a logged-in user + a version that has uploaded audio.

---

## Where things stand

The Listen page's real-time Web Audio DSP **engine is DONE** — a 13-module, reorderable rack
(EQ, compressor, saturator, M/S width, DJ filter, delay, reverb, pan, tremolo, gate, bitcrusher,
limiter, output trim) + a pitch lane, with per-unit dry/wet bypass, async AudioWorklet boot,
and live meters. Behavior-preserving throughout (transparent at defaults). All five build phases
are merged; the **UI rack redesign** is the next track (handed to "Claude design").

| Phase | What | State |
|---|---|---|
| 1 | Modular `EffectUnit` refactor | DONE (merged) |
| 2 | Reorder + generic handle API | DONE (merged) |
| 3 | Unhide existing params (EQ/comp/sat/M-S full surface) | DONE (merged) |
| 4 | New native modules (DJ filter, delay, reverb, pan, tremolo, trim) | DONE (merged) |
| 5 | Worklet modules (gate, bitcrusher, limiter) + boot infra | DONE (merged) |
| 6 | Meter **display** | ABSORBED into the UI redesign — engine is meter-complete (`readEffectMeter`/`readFrame` expose all data); no separate engine phase needed |

Also done post-Phase-5: EQ given a real unit bypass (now uniform with the other 12 — `setEffectParams('eq',{enabled,bands})`); full UI-design handoff prep.

All four gates green at `master` (run from `components/frontend-spectr-v2`):
`npx tsc -b` · `npm run lint` · `npx vitest run` (432) · `npm run build` (emits 3 worklet chunks).
NOTE: the real typecheck is `tsc -b`, NOT `tsc --noEmit` (root tsconfig uses project references → `--noEmit` is a no-op).

---

## What's left (in order)

1. **Run the manual browser smoke** — `PRPs/listen-smoke-script.md`. The engine has NEVER run in a
   browser (Web Audio/AudioWorklet can't run in jsdom), so the AudioNode wiring + worklet loading +
   reorder + meters are unverified by the 432 unit tests. The handle is exposed in dev as
   `window.__spectrGraph`. This is the one remaining risk; ~10 min.
2. **Hand the UI redesign to Claude design** — give it `PRPs/listen-ui-design-prompt.md` (the
   consolidated prompt) + the repo. It designs + builds the new rack UI against the engine handle.
3. (Optional) Phase 7 "perf hardening" — lazy-connect heavy effects (reverb), O(1) limiter.

---

## Key documents

| File | Purpose |
|---|---|
| `components/frontend-spectr-v2/src/features/listen/README.md` | **Living system guide** — architecture, signal graph, handle API, modules, metering, gotchas. Start here. |
| `PRPs/listen-ui-design-prompt.md` | The consolidated UI-design handoff prompt (give to Claude design). |
| `PRPs/listen-dsp-rack-capabilities.md` | UI control-surface manifest + handle binding + module tiering. |
| `PRPs/listen-smoke-script.md` | Browser smoke procedure. |
| `components/frontend-spectr-v2/src/features/listen/rackManifest.ts` | Typed per-module/param descriptors for the UI to render from. |
| `components/frontend-spectr-v2/src/features/listen/meterHooks.ts` | Design-agnostic meter polling hooks (`useEffectMeter`, `useAudioLevels`). |
| `PRPs/listen-dsp-rack-engine-design.md` + `-phase{1..5}.md`/`-design.md` | Master architecture + per-phase plans/specs (history). |

---

## Architecture orientation (what exists)

Engine lives in `components/frontend-spectr-v2/src/features/listen/` — see the README for the full
map. In short: `useAudioGraph.ts` (thin composer hook + the public `AudioGraphHandle`) → `audio/`
(`EffectUnit.ts` contract + `makeDryWet` bypass, `composer.ts` reorder, `worklets.ts` boot,
`effects/*` units, `dsp/*` pure-tested math, `dsp/processors/*` worklet processors).

The UI drives it ONLY through the handle: `setEffectParams(id, patch)`, `reorder`/`getOrder`,
`readEffectMeter`, `readFrame`, `setMasterBypass`, `resetAll`, `ensureContext` (on the play gesture),
and the pitch methods. Engine is FROZEN for the UI track — don't edit `audio/**`.

---

## Continuity notes / gotchas

- **Web Audio can't run in jsdom.** Only `audio/dsp/*` pure math is unit-tested; AudioNode wiring +
  worklets = `tsc -b` + `build` + the manual smoke. Don't add jsdom tests for AudioNode code.
- **Worklet loading uses `?worker&url`**, NOT `new URL('./x.ts', import.meta.url)` (which emits raw TS
  that `addModule` rejects). The build must emit `*.processor-*.js` chunks.
- **EQ takes a band array** and now has a real unit bypass: `setEffectParams('eq',{enabled,bands})`.
- **Pitch couples tempo** (Web Audio detune scales playback rate) — out of scope to decouple.
- **Branching rule:** never commit DSP-rack engine work directly on `master` — branch per phase, merge
  when reviewed. (Engine phases are done; the doc/prep commits since were low-risk and went on master.)
- Sessions ran with **caveman mode** (terse) + **superpowers** skills — context, not required to continue.
