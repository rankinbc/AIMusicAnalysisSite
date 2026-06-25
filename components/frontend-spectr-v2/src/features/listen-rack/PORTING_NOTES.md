# Listen — Rack & Visuals redesign — port status & wiring map

This folder is the in-codebase port of the design handoff at
`PRPs/design_handoffs/design_handoff_listen_rack/`. It is mounted at the route
**`/listen-rack`** (`src/routes/_app/listen-rack.tsx`) and is, today, a faithful
**visual** replica driven almost entirely by **mock data**. The shipping
`/listen/$versionId` page is untouched.

This document records exactly what is real, what is mock, and the call-for-call
map to wire each mock seam to the real engine (`features/listen/useAudioGraph.ts`
+ the real transport / analysis / real-time layers).

> Read alongside the handoff's `README.md` (the *what*) and `PORTING_GUIDE.md`
> (the *how*). This file is the codebase-specific delta.

---

## What is already real

| Piece | Status |
|---|---|
| Top navigation | The `_app` layout's real top bar (brand · Report/Listen/Library · search · Upload · avatar). The prototype's standalone `TopNav` was intentionally **not** ported to avoid a duplicate bar. |
| Brand mark | `ui/BrandMark` (via the app nav). |
| Cover art | `ui/CoverArt` (`TrackHeader` + the "Track Info" stage). |
| Coach avatar | `ui/Coach` (the canonical SPECTR coach head). The Claude-design mascot was saved separately as `ui/SpecialistBot` for reuse. |
| Mode model | **Work / View / Room** (replaces Solo/Room), implemented against the locked `LISTEN_V3_UI_CONTRACT.md` — server-authority `AccessDto` (mock) + client-layout `MODE_SURFACE_MATRIX`. Per-mode rail tabs, coach gating, read-only-rack-in-View, and a View Comments panel are wired (mock data). See §7. |
| Design tokens / utilities | `styles/tokens.css` + `styles/global.css` (`.card/.pill/.btn/.dot/.label/.mono`, `pulseGlow`/`fade-in`). Page-only CSS lives in `listenRack.css` (`lr-` prefixed). |
| Rack manifest / defaults | `data.ts` `RACK_MANIFEST` / `MODULE_DEFAULTS` / `DEFAULT_ORDER` were ported from `rackManifest.ts` + `audio/state.ts`. **Verify against the live source before wiring** (see step 0 below). |
| All interaction behavior | Knobs, faders, EQ band editor, drag-reorder, A/B bypass, reset, coach/plan apply, visuals console, room presence/chat/grant — all functional against local state. |

Everything else below is **mock** and needs wiring.

---

## Module map (this folder)

| File | Role | Production fate |
|---|---|---|
| `data.ts` | Engine truth (manifest/defaults/`fmtVal`) **+** mock fixtures (`TRACK`, `COACH_SUGGESTIONS`, `ROOM_*`, `PLAN_ITEMS`) **+** config (`STAGES`, `DIRECTORS`, laser/bg). | Keep the manifest/config; replace the fixtures. |
| `access.ts` | Work/View/Room contract: `AccessDto` (+`MOCK_ACCESS`), `MODE_SURFACE_MATRIX` (spec §04), View `CommentDto`/`SuggestionDto`/`MOCK_COMMENTS`. | Keep the matrix/types; swap `MOCK_ACCESS`/`MOCK_COMMENTS` for real endpoints (§7). |
| `chain.ts` | PRP-1 `Chain` currency (save/recall/coach-apply/suggestion). | Keep; consumed by `chainApply.ts` once PRP-1 lands. |
| `rackState.ts` | `useRackState` (live rack mirror) + `useFakeGR` + `useChainReorder`. | **Primary engine binding point** — see §3. |
| `helpers.ts` | `cssVar`, `hslToHex`, `useDragValue`, `freqToX`, `LASER_COLORS`, `fmtTime`. | Keep. |
| `ui.tsx` | Control primitives (`Knob`/`Fader`/`Switch`/`Segmented`/`SelectChip`/`HSlider`/`GRMeter`/`ModuleIcon`/`WorkletPill`/`BindTag`/`ParamControl`/`SegBar`/`Avatar`/`BotFace`/`HueSlider`). | Keep — the page's design system. |
| `viz.tsx` | `VizStage` + canvas engines (`StageCanvas`/`LaserFan`/`Fireworks`/`EqCurveOverlay`). | Keep; swap synthetic audio for a real `AnalyserNode` (§4). |
| `transport.tsx` | `Transport` (scrubber + section ribbon + notes + reaction ticker). | Keep; bind to the real playback clock. |
| `rackCore.tsx` | `RackChrome` / `EqBandEditor` / `RichControls` renderers. | Keep — they bind to `RackState`'s shape. |
| `rackLayouts.tsx` | `InlineRack` (the chosen IA) + chain map / pitch lane. | Keep. (Pedalboard/Console/Studio + the Tweaks panel were **not** ported per `PORTING_GUIDE §1e`.) |
| `rail.tsx` | Right rail tabs + `VisualMeters` + `VisualsPanel`. | Keep; bind People/Chat to real-time, Coach/Stats to real analysis. |
| `ListenRackPage.tsx` | Page container — owns all orchestration state + the mock clocks. | The page container; see §1–§2. |

---

## 0. Before wiring — re-verify the manifest

`data.ts`'s `RACK_MANIFEST` / `MODULE_DEFAULTS` / `DEFAULT_ORDER` were copied from
`features/listen/rackManifest.ts` + `features/listen/audio/state.ts` at design
time. If those have moved, regenerate from the live source — the engine wins.

## 1. Transport clock  ·  `ListenRackPage.tsx`

- **Mock:** `playing` / `position` are driven by a `requestAnimationFrame` loop
  (`p0 + elapsed`), reset/pause at `TRACK.durationSec`.
- **Wire:** mount a real `<audio>` (see `/listen/$versionId` for the
  `audioUrl = /api/versions/{id}/audio?t=<jwt>` + `crossOrigin="anonymous"`
  pattern), call `useAudioGraph(audioRef)`, and drive `position` from the
  `timeupdate` event (or `graph.pitchCurrentTime()` in pitch mode). `togglePlay`
  must `graph.ensureContext()` on the user gesture **before** `audio.play()`.
- This route currently takes **no `$versionId` param** — give it one
  (`listen-rack.$versionId.tsx`) when wiring real audio.

## 2. Track + analysis fixtures  ·  `data.ts`

- **Mock:** `TRACK` (name/author/loudness/stereo/sections/notes),
  `COACH_SUGGESTIONS`, `PLAN_ITEMS`.
- **Wire:** replace with selectors over the real version + analysis — mirror
  `/listen/$versionId`: `useVersion` / `useSong` / `useJobResults`, then
  `pickPhase<Phase1/2/7>`. Sections come from `phase7.section_scores`; notes from
  `useNotes(versionId)` (+ `useCreateNote/usePatchNote/useDeleteNote`).
  `StatsPanel`, `VisualMeters`, and the scrubber all read from `TRACK` today.

## 3. The rack  ·  `rackState.ts → useRackState`  (highest-value slice)

`useRackState` returns the shape below. Keep the shape; swap the bodies for the
real audio-graph store. The exact call per module is in each manifest entry's
`bind` string (visible in-app via the **⌁ Bindings** toggle — hide it in prod).

| `useRackState` member | Replace with |
|---|---|
| `mod[id]` (live params) | selector over engine effect state for `id` |
| `setParam(id, key, val)` | `graph.setEffectParams(id, { [key]: val })` |
| `setEnabled(id, on)` | `graph.setEffectParams(id, { enabled: on })` |
| `setEqBands(bands)` | `graph.setEffectParams('eq', { bands })` |
| `order` / `setOrder(next)` | chain-order selector / `graph.setChainOrder(next)` |
| `masterBypass` / `setMasterBypass` | master rack-bypass flag on the graph |
| `applyCoach(patch)` | batch: for each `id` in patch → `setEffectParams(id, patch[id])` in one transaction |
| `reset()` | reset to `MODULE_DEFAULTS` + `DEFAULT_ORDER`, clear bypass |
| `savePreset/recallPreset/presets` | persist/restore a rack snapshot — **see §6** |
| `useFakeGR(id)` (separate hook) | poll/subscribe `graph.readEffectMeter(id)` for `comp`/`gate`/`limiter` (NOTE: the GR meter is still `null` in the shipping page — `readEffectMeter` may need to land first) |

- **Pitch is not an insert.** `PITCH_MODULE` lives in its own buffer lane: bind
  the pitch-lane switch + knobs to `graph.enterPitchMode()` /
  `graph.setPitchDetune(semitones, cents)` (tempo-coupled), **not**
  `setEffectParams`. Do not add `pitch` to the insert chain order.
- **Worklet modules** (`gate`, `bitcrusher`, `limiter`) carry `worklet: true` —
  `<WorkletPill ready={…}>` should reflect real worklet-ready, not `playing`.

## 4. Visualizer  ·  `viz.tsx → StageCanvas` / `VizStage`

- **Mock:** the spectrum + energy + beat + drop are **synthetic math** in the
  `VizStage` rAF loop.
- **Wire:** tap a real `AnalyserNode` post-rack. `getByteFrequencyData` → EQ /
  spectrogram stages; `getByteTimeDomainData` → radial/orbit/bloom; an RMS/peak
  follower → `energy`, drop detection (`onDrop`), and the `autoReact`/`*Sync`
  behaviors. The shipping page already has these primitives
  (`beatDetector`, `dropDetector`, `flashLimiter`, `autoColor`, `useAudioGraph.readFrame()`)
  — reuse them rather than re-deriving. `freqToX` / `EqCurveOverlay` already map Hz→x.
- **Photosensitivity:** the shipping page routes every full-field flash through a
  shared ≤3 Hz limiter and respects `prefers-reduced-motion`. The ported
  `LaserFan` flash + `bgFlash` do **not** yet — gate them on the same limiter +
  reduced-motion before shipping.

## 5. Collaboration (Room)  ·  `ListenRackPage.tsx` + `rail.tsx` + `sessionEvents.ts`

The Room realtime protocol is **locked** (PRP-4) and lives in code as
**`sessionEvents.ts`** (`SessionEvent` union + `ControlGrant`), matched verbatim
to `LISTEN_V3_ROOM_UI_SEAMS.md` + the backend contract.

- **Mock:** `pops` / `feed` are spawned by a `setInterval` with random fixtures;
  `grantControl` sets local state (bare handle); chat/people read `ROOM_LISTENERS`.
- **Wire (the consumer contract — see `sessionEvents.ts` header):**
  1. **Hydrate from the connect-only `{type:'sync'}` frame FIRST** (chain,
     transport, visuals, roster, feed) before any delta — a late joiner can't
     rebuild the shared chain from the delta tail.
  2. Then apply deltas: `rack` → `graph.setEffectParams(effectId, params)`;
     `transport` (host) → mirror playing/position (clients play the file locally
     at the synced position — **no host audio stream**); `visuals`
     (visuals-grant holder) → patch viz/stages/director; presence/status/reaction/
     chat → roster + ticker; `grant` → holder chips (authority = server echo).
  3. **One shared chain per session** — every client applies the rack-controller's
     param changes to its own playback, so all hear the same processing.
- **Decision §0 (locked):** every event actor + grant grantee is an `ActorRef`,
  not a bare handle. The mock still uses bare handles — **swap to `ActorRef`**
  (`actor.handle ?? actor.displayName`) when wiring; `spawnPresence` /
  `spawnReaction` / `grantControl` become the `presence` / `reaction` / `grant`
  handlers, and `grant.id` is the real FK on a grantee's `Suggestion` /
  `RackPreset` (`viaGrantId`).
- `announcement` / `CoachToast` fire from real coach-apply + grant events.

## 6. Presets ↔ versions  (unsettled — decide first)

Two independent local stores exist and are **not** bound to a track version:
`rs.presets` (rack snapshots) and `vizPresets` (visual looks). Per the handoff's
`docs/Listen Feature Reference.html §6`, settle the data model (a `RackPreset`
carrying a `versionId`; a `Suggestion` wrapping a reviewer's preset) before
implementing `savePreset/recallPreset` against real persistence.

## 7. Mode model  (Work/View/Room) — DONE, against the locked contract

Implemented per `../../../PRPs/design_handoffs/design_handoff_listen_rack/LISTEN_V3_UI_CONTRACT.md`
and `docs/Listen Modes Spec.html`. The old Solo/Room is gone.

- **`access.ts`** holds the contract:
  - `AccessDto` (Q1) — the *resolved* per-actor decision. `MOCK_ACCESS` (owner,
    all-true) stands in until **`GET /api/versions/{id}/access`** is wired (anon
    link viewers get the `gates` from `GET /api/v/{token}`). The SegBar renders
    `availableModes(access)`; the rail mounts `railTabsFor(mode, access)`.
    **Wire:** replace `MOCK_ACCESS` with the real fetch — nothing else changes.
  - `MODE_SURFACE_MATRIX` (Q2) — the spec §04 matrix in code = the **client
    layout authority** (rack full/readonly/host · visuals utility/personal/full ·
    coach primary/reference/hidden · metering · presence · chat · rail tabs).
    Server is authority (what you *can* do); client is layout (what *shows*).
  - View comments/suggestions (Q4) — `CommentDto` / `SuggestionDto` / `ActorRef`
    shapes + `MOCK_COMMENTS`. **Wire:** the PRP-3 endpoints
    (`GET/POST /api/versions/{id}/comments`, `/suggestions`); audition/accept
    reuse the apply loop (below).
- **`chain.ts`** — the PRP-1 `Chain { order, modules, masterBypass }` currency
  (Q3). When PRP-1 lands, `features/listen/chainApply.ts →
  applyChainToGraph / snapshotChainFromGraph` consumes exactly this; the page's
  `savePreset`/`recallPreset`/`applyCoach`/autosave seams map 1:1.
- **Rack read-only in View** is presentation-only (the matrix); enforcement is
  that no non-owner write endpoint exists — a non-owner's only write path is
  creating a `Suggestion`.

**Still owed (per-mode polish, not blocking):** the Work "visuals = utility
monitor" downgrade is approximated (the full console still mounts under the
VISUALS toggle); fully collapsing it to a spectrum/meters scope is a refinement.

---

## Dev affordance to remove before shipping

- The **⌁ Bindings** toggle in `RackChrome` (`rackCore.tsx`) + `<BindTag>`
  (`ui.tsx`) are a handoff dev aid that reveals each module's `bind` string.
  Hide/remove for production.
