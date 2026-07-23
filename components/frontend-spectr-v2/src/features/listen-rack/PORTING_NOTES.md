# Listen — Rack & Visuals page — current architecture

This folder **is the canonical Listen page**, mounted at
**`/listen-rack/$versionId`** (`src/routes/_app/listen-rack.$versionId.tsx`).
It began as a visual port of the design handoff at
`PRPs/design_handoffs/design_handoff_listen_rack/`; the port is done, the legacy
`/listen/$versionId` page is deleted, and the pre-cutover wiring instructions
that used to live here are obsolete (see git history if you need them). This
file now records what is real vs. still mock.

---

## What is real

| Piece | Where |
|---|---|
| Audio playback + DSP rack | Real `<audio>` + the shared engine `features/listen/useAudioGraph` (see that folder's README); rack bound via `rackBindings.ts` / `rackState.ts`. |
| Track header / sections / notes / stats | Built from the real version + 7-phase analysis (`trackFromAnalysis.ts`, `useNotes`), with honest loading/error shells on the route. |
| Presets / draft autosave / viz presets | Server-backed (`useRackPresets.ts`, `useVizPresetsServer.ts`). |
| Fix-rack carry-over | `?fixPreset=<uuid>` → `fixToRackPatch.ts` / `listenFixes.ts` overlay + "Fixes applied" chip. |
| Mode / access / identity | `useRoomOrchestration.ts` resolves real `GET /api/versions/{id}/access`; `capabilities.ts` + `MODE_SURFACE_MATRIX` (`access.ts`) drive the Work/View/Room layout. |
| Room protocol | Live SSE by default (`VITE_ROOM_LIVE_SSE=0` falls back to `useMockRoomOrchestration`): `features/listen/useRoomStream` → `roomStateReducer.ts` fold; sends via `features/listen/useRoomActions`; session lifecycle via `useRoomSession`. The room **UI** (real roster, wire chat, transport follow, ended/reconnect states) is being wired live by `PRPs/listen-rack-room-completion.md`. |
| Stem deck | `features/listen/StemDeck` + `useStemEngine`, fed by real stem proposals. |

## What is still mock

Per the `ListenRackPage.tsx` header comment (lines 11–12):

- **Coach panel content** — `COACH_SUGGESTIONS` / `PLAN_ITEMS` fixtures in `data.ts`.
- **Ambient presence pops / reaction sim** — the `setInterval` fixture spawner
  (disabled whenever `roomLive` is set; kept for the no-room demo rendering).
- **Some rail meters** — `VisualMeters` values not yet driven by the engine.
- **Room fixtures** (`ROOM_LISTENERS`, seeded chat) — the fallback rendering when
  no live room data is present; live rooms render server state instead.

## Module map (this folder)

| File | Role |
|---|---|
| `ListenRackPage.tsx` | Page container — owns orchestration state, the `<audio>`, the rAF meter loop, dev harness `window.__spectrRackGraph`. |
| `useRoomOrchestration.ts` / `useMockRoomOrchestration.ts` | Real (SSE) vs. mock room seam behind the same `RoomOrchestration` shape. |
| `roomStateReducer.ts` / `sessionEvents.ts` | Pure fold of the room SSE protocol (`sync` snapshot + typed deltas). |
| `access.ts` / `capabilities.ts` / `identity.ts` | Mode contract: server authority (`AccessDto`) + client layout matrix + per-mode capabilities. |
| `data.ts` | Engine truth (`RACK_MANIFEST` / `MODULE_DEFAULTS`) + remaining fixtures + viz config. |
| `rackState.ts` / `rackBindings.ts` / `rackCore.tsx` / `rackLayouts.tsx` | Rack state mirror, engine binding, control renderers, `InlineRack`. |
| `transport.tsx` / `viz.tsx` / `rail.tsx` / `ui.tsx` / `helpers.ts` | Transport, visual stage, right rail (People/Chat/Coach/Stats/Visuals), control primitives. |
| `useRackPresets.ts` / `useVizPresetsServer.ts` / `chain.ts` | Server persistence + the `Chain` currency. |
| `fixToRackPatch.ts` / `listenFixes.ts` / `useFixOverlay.ts` | Fix-rack → rack overlay. |
| `trackFromAnalysis.ts` | Real analysis → `Track` shape for header/stats/scrubber. |

## Dev affordances

- `window.__spectrRackGraph` — dev-only engine handle (`ListenRackPage.tsx`);
  used by the browser smoke (`PRPs/listen-smoke-script.md`).
- The **⌁ Bindings** toggle (`rackCore.tsx`) + `<BindTag>` reveal each module's
  engine `bind` string — hide/remove before public exposure.
