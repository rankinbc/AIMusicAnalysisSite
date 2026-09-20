# Listen — Rack & Visuals page — current architecture

This folder **is the canonical Listen page**, mounted at
**`/listen-rack/$versionId`** (`src/routes/_app/listen-rack.$versionId.tsx`).
It began as a visual port of the design handoff at
`PRPs/design_handoffs/design_handoff_listen_rack/`; the port is done, the legacy
`/listen/$versionId` page is deleted, and the pre-cutover wiring instructions
that used to live here are obsolete (see git history if you need them). This
file now records what is real vs. still mock.

The page is a **private workbench**: no rooms, no Work/View/Room mode
switcher, no Invite, no roster/chat/reactions, no guest (non-owner) path, no
fork-to-suggest, no bookmarks rail. It only renders for the version's owner.

---

## What is real

| Piece | Where |
|---|---|
| Audio playback + DSP rack | Real `<audio>` + the shared engine `features/listen/useAudioGraph` (see that folder's README); rack bound via `rackBindings.ts` / `rackState.ts`. |
| Track header / sections / notes / stats | Built from the real version + 7-phase analysis (`trackFromAnalysis.ts`, `useNotes`), with honest loading/error shells on the route. |
| Presets / draft autosave / viz presets | Server-backed (`useRackPresets.ts`, `useVizPresetsServer.ts`). |
| Fix-rack carry-over | `?fixPreset=<uuid>` → `fixToRackPatch.ts` / `listenFixes.ts` overlay + "Fixes applied" chip. |
| Stem deck | `features/listen/StemDeck` + `useStemEngine`, fed by real stem proposals. |

## What is still mock

Per the `ListenRackPage.tsx` header comment:

- **Coach panel content** — `COACH_SUGGESTIONS` / `PLAN_ITEMS` fixtures in `data.ts`.
- **Some rail meters** — `VisualMeters` values not yet driven by the engine.

## Module map (this folder)

| File | Role |
|---|---|
| `ListenRackPage.tsx` | Page container — owns rack/viz/transport state, the `<audio>`, the rAF meter loop, dev harness `window.__spectrRackGraph`. |
| `NotesSidebar.tsx` | Notes-only sidebar beside the rack panel. |
| `data.ts` | Engine truth (`RACK_MANIFEST` / `MODULE_DEFAULTS`) + remaining fixtures + viz config. |
| `rackState.ts` / `rackBindings.ts` / `rackCore.tsx` / `rackLayouts.tsx` | Rack state mirror, engine binding, control renderers, `InlineRack`. |
| `viz.tsx` / `viz-canvases.tsx` / `ui.tsx` / `helpers.ts` | Visual stage (`VizStage` + its canvas layers), control primitives. |
| `useRackPresets.ts` / `useVizPresetsServer.ts` / `chain.ts` | Server persistence + the `Chain` currency. |
| `fixToRackPatch.ts` / `listenFixes.ts` / `useFixOverlay.ts` | Fix-rack → rack overlay. |
| `trackFromAnalysis.ts` | Real analysis → `Track` shape for header/stats/scrubber. |

## Dev affordances

- `window.__spectrRackGraph` — dev-only engine handle (`ListenRackPage.tsx`);
  used by the browser smoke (`PRPs/listen-smoke-script.md`).
- The **⌁ Bindings** toggle (`rackCore.tsx`) + `<BindTag>` reveal each module's
  engine `bind` string — hide/remove before public exposure.
