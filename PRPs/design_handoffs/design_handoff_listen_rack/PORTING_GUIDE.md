# Porting Guide — Listen Rack Redesign → SPECTR codebase

This is the mechanical companion to `README.md`. It covers three things, in order:
1. **Module conversion** — `window`-globals → ES modules (the only structural change the components need).
2. **The mock→engine swap** — what to delete and what to wire, file by file.
3. **The state→audio-graph binding map** — the exact calls that replace the rack's local state.

The components themselves are production-shaped React already. The work is *wiring*, not *rewriting*.

---

## 0. Before you start
- Confirm `src/data.jsx`'s manifest still matches `features/listen/rackManifest.ts` and `audio/state.ts` **as of today** — it was ported at design time and your engine may have moved. The manifest is the contract; if they disagree, the live source wins (regenerate `RACK_MANIFEST`/`MODULE_DEFAULTS`/`DEFAULT_ORDER` from it).
- Decide the **mode model** first (Solo/Room as built, or Work/View/Room per `docs/Listen Modes Spec.html`). It changes which rail panels mount. Everything else is mode-agnostic.
- Pick **one rack layout** (`InlineRack`) unless you genuinely want the runtime toggle.

---

## 1. Module conversion: `window`-globals → ES modules

Every file ends with `Object.assign(window, { A, B, C })`. That exists **only** because the prototype loads each file as a bare `<script>` with no bundler. Two mechanical edits per file:

**a) Replace the export footer.** Turn:
```js
Object.assign(window, { useRackState, useFakeGR, RackChrome /* … */ });
```
into:
```js
export { useRackState, useFakeGR, RackChrome /* … */ };
```
(or convert each `function Foo` / `const Foo` to `export function Foo` / `export const Foo` and drop the footer — either is fine).

**b) Add an import header** for the symbols the file consumes from siblings + React. The consumed set is exactly the sibling **exports** the file references (dependency edges are listed in `README.md → Cross-module dependencies`). Example for `rack-core.jsx`:
```js
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MODULE_DEFAULTS, DEFAULT_ORDER, MANIFEST_BY_ID } from './data';
import { cssVar, ParamControl, GRMeter, ModuleIcon, Switch, BindTag, WorkletPill } from './ui';
import { freqToX } from './viz';
```

**c) Drop the React aliasing.** The prototype writes `const { useState: useA } = React;` to avoid identifier collisions across `<script>` scopes. With real modules each file has its own scope — use normal hooks (`useState`, …) and delete the alias lines. (Mechanical find/replace per file: `useA→useState`, `useAE→useEffect`, `useAR→useRef`, `useAM→useMemo`, `useAC→useCallback`; `useRS/useRR/useRE/useRC` likewise in `rack-core.jsx`.)

**d) Styles.** `src/styles.css` ports as-is. Fold its `:root` tokens into your global stylesheet (or keep as a module). Keep the Google Fonts (Syne, JetBrains Mono) or substitute your loaded equivalents.

**e) Delete from the build:** `tweaks-panel.jsx` (prototype variant UI), the `RedesignTweaks` component at the bottom of `app.jsx`, every `<BindTag>`/"⌁ Bindings" affordance (dev aid), and the prototype host in `preview/`.

**f) Babel/script tags** in the host are gone — your bundler compiles JSX.

That is the entire structural conversion. Nothing about the component bodies changes.

---

## 2. The mock→engine swap, file by file

### `data.jsx`
Split per `README.md → Data layer`. Keep the manifest/defaults/`fmtVal`; replace `TRACK`/`COACH_SUGGESTIONS`/`ROOM_*`/`PLAN_ITEMS` with selectors over real state; keep `STAGES`/`DIRECTORS`/laser+bg config as tunable config.

### `app.jsx`
- `playing`/`position` rAF loop → bind to the **real player transport**. Keep `position` as the single source the stage + transport read.
- The Room `setInterval` that spawns `pops`/`feed` → replace with subscriptions to your **presence/reaction** stream. `spawnPresence`/`spawnReaction` become handlers for inbound events; `grantControl` becomes a real control-delegation message.
- `announcement`/`CoachToast` → fire from real coach-apply results.
- Keep all the derived memos (`currentSection`, `activeModules`, `eqOn`) — they read from real state once the inputs are real.

### `rack-core.jsx → useRackState`
This hook **is** the rack's local mirror of the engine. Replace its internals with your audio-graph store (Zustand/Redux/context — whatever the page uses), preserving the **same return shape** so the renderers don't change. See the binding map below.

### `rack-core.jsx → useFakeGR`
Synthetic gain-reduction. Replace with a poll/subscription of `readEffectMeter(id)` for `comp`/`gate`/`limiter`; feed the real reduction (dB) into `<GRMeter>`.

### `viz.jsx → StageCanvas`
The spectrum/levels are **synthetic** (math, not audio). Replace the synthetic source with a real `AnalyserNode`:
- Tap the graph post-rack (the same signal the limiter previews).
- `getByteFrequencyData` → the EQ/spectrogram stages; `getByteTimeDomainData` → radial/orbit/bloom motion; an RMS/peak follower → `energy`, drop detection (`onDrop`), and the `autoReact`/`*Sync` behaviors.
- `freqToX`/`EqCurveOverlay` already map Hz→x; keep them.

### `rail.jsx`
- `PeoplePanel`/`ChatPanel` → real-time presence + messages + the grant-control UI.
- `CoachPanel` → real analysis/coach feed (each item keeps an `apply` patch onto the rack).
- `VisualMeters`/`StatsPanel` → real loudness/stereo/analysis selectors.
- `NotesPanel` → real per-track notes (create/edit/pin/seek).

---

## 3. State → audio-graph binding map

`useRackState` returns the shape below. Keep the shape; swap the bodies for these engine calls. The exact call per module is also in that module's `bind` string in `RACK_MANIFEST` (visible in-app via "⌁ Bindings").

| `useRackState` member | Replace with |
|---|---|
| `mod[id]` (live params) | Selector over engine effect state for `id`. |
| `setParam(id, key, val)` | `setEffectParams(id, { [key]: val })` |
| `setEnabled(id, on)` | `setEffectParams(id, { enabled: on })` |
| `setEqBands(bands)` | `setEffectParams('eq', { bands })` |
| `order` / `setOrder(next)` | Chain order selector / `setChainOrder(next)` (drag-reorder commits here). |
| `masterBypass` / `setMasterBypass` | Master rack bypass flag on the graph. |
| `applyCoach(patch)` | Batch: for each `id` in patch → `setEffectParams(id, patch[id])` in one transaction. |
| `reset()` | Reset effects to `MODULE_DEFAULTS` + `DEFAULT_ORDER`, clear bypass. |
| `savePreset/recallPreset/presets` | Persist/restore a rack snapshot — **see Presets below.** |
| `useFakeGR(id)` (separate hook) | `readEffectMeter(id)` poll for `comp`/`gate`/`limiter`. |

**Pitch is not an insert.** `PITCH_MODULE` lives in a separate buffer lane: bind to `enterPitchMode()` / `setPitchDetune(semitones, cents)` (tempo coupled), **not** `setEffectParams`. Don't add it to the insert chain order.

**Worklet modules** (`gate`, `bitcrusher`, `limiter`) carry `worklet: true` — they have a brief async init; `<WorkletPill>` is the placeholder UI for that "initializing" state. Gate it on real worklet-ready.

---

## 4. Presets ↔ versions — resolve before building

This is the part flagged as unsettled. The prototype has **two independent local stores** that are **not** bound to a track version:
- `rs.presets` (rack snapshots: `{ order, mod }`) — saved via the bottom module's Save when `bottomView==='rack'`.
- `vizPresets` (visual looks: `{ viz, stages, director }`) — saved when `bottomView==='lights'`.

`docs/Listen Feature Reference.html → §6 "Presets & versions"` separates the **five** preset-like concepts on the page (track versions, rack presets, visual presets, suggested presets, director presets) and proposes a data model where a `RackPreset` carries a `versionId` binding it to a track version, and a `Suggestion` wraps a reviewer's preset. **Settle that model first**, then implement `savePreset/recallPreset` (and the visual equivalent) against real persistence instead of the local arrays. Until then, the two stores are deliberately minimal so they're easy to replace.

---

## 5. Suggested order of work
1. Convert modules to ESM (§1) and get the page rendering in-app with **mock data still in place** — pure structural port, no behavior change. Verify visual parity against `preview/`.
2. Map `components.jsx` → real `BrandMark`/`CoverArt`; fold tokens.
3. Bind the **transport** (real `playing`/`position`).
4. Bind the **rack** (`useRackState` → audio graph, §3) — the highest-value slice; the manifest already matches.
5. Swap **`useFakeGR` → `readEffectMeter`** and **`StageCanvas` → real `AnalyserNode`**.
6. Wire **Coach** (real suggestions + apply) and **analysis** panels.
7. Decide the **mode model**, then wire **Room** real-time (presence/chat/control granting).
8. Implement **presets/versions** per the settled data model (§4).
