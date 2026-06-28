# Results page redesign — Integration plan (frontend wiring)

**Status:** plan (2026-06-26)
**Goal:** Replace the analysis results page with the delivered prototype **exactly** — same layout, IA, copy, and interactions — re-skinned only as far as needed to match SPECTR's `tokens.css`, and wired to the real data layer. This is a **port + wire**, not a redesign and not a rebuild: reuse the existing `features/results/` components/hooks as the data+logic spine; the prototype is the source of truth for structure, layout, and flow.
**Source of truth:** `PRPs/design_handoffs/design_handoff_results_redesign/prototype/` (the `ar-*.jsx` files) + `screenshots/01..06`. Read `prototype/ar-data.jsx` first (data contract) and the handoff `README.md` (fidelity + token notes).
**Backend gaps:** five data items the prototype shows are **not produced by the pipeline today** — tracked separately in `PRPs/results-redesign-backend-spec.md`. The frontend ships against real data now and **gracefully degrades** the gap regions until the backend lands (see §7).

> **Do NOT port (scaffold only):** the prototype top bar (`TopBar` — brand/nav/credits/avatar), the **Tweaks** panel (`tweaks-panel.jsx` / `ARTweaks`), the in-prototype `ToastHost` (use the app's `sonner`), Babel-in-browser, and the `window.*` global-component pattern. The deliverable is everything inside `.wrap`: header, tab bar, tab bodies, the right sidebar, and the four modals.

---

## 1. Information-architecture changes

**Tabs (new):** `AI Coach · Findings · Project* · Reference* · Track Info · Debug` ( `*` = conditional ). Default tab = **`coach`**. The old `actions` tab is **dissolved** — the prioritized move list now lives **under the coach chat** on the AI Coach tab. The old `analysis` tab is **folded into Debug**.

`src/features/results/results-tab-keys.ts`:
```ts
export type ResultsTabKey = 'coach' | 'findings' | 'project' | 'reference' | 'trackinfo' | 'debug';
export const RESULTS_TAB_KEYS = ['coach','findings','project','reference','trackinfo','debug'] as const;
```
Then update `isResultsTabKey`, the `$jobId` route's `validateSearch` default (`'coach'`), and `ResultsTabs.tsx` (labels/icons/order/badges). `project` shows only when `alsProject` (or phase 8) is present; `reference` shows only when a reference profile or track is attached (phase 5/6 present).

**Removed:** no `GradeHero` / letter grade anywhere on the page. The only header vital is the neutral **"N findings · N suggestions"** stat (no color, no grade) — `FindingsVital` in `ar-frame.jsx`. Faults exclude `kind==='integrity'` and `sev==='win'`; suggestions = findings with a linked fix.

---

## 2. Region → existing component → data map

| Prototype region (file) | Real target in `features/results/` | Data / hook |
|---|---|---|
| `ResultsHeader` — cover, title+version, genre line, **InputChips** ("Analyzed from" ✓), **FindingsVital** (`ar-frame.jsx`) | **`SongHeader.tsx`** (extend) | `useVersionFiles` → `inputs`; `faultCount(verdicts)` → vital |
| `Player` — tiny waveform transport, play/seek, position persisted (`ar-frame.jsx`) | **new** `ResultsPlayer.tsx` (small) mounted in `SongHeader` | mock-bars OK; or `<audio>` `versions/{id}/audio` + `localStorage` pos. Optional `results.waveformImageUrl` |
| `TabBar` (`ar-frame.jsx`) | **`ResultsTabs.tsx`** (rewrite tab defs) | tab keys + `findingCount` badge + `alert` flag |
| `CoachTab` — coach card, **Specialist Team** button (run/suggested counts), **Generate Coach Mix** button, chat input, cap line (`ar-coach.jsx`) | **`CoachPanel`/`CoachChat`/`CoachCapChip`/`TranceBot`** (reuse) + new header actions | `useCoachView(jobId)`, `useVerdicts(jobId).specialists`, `useGenerateFixRack`/`useFixRack`, coach caps via `CoachCapChip` |
| `SpecialistModal` — 26-tile grid grouped by 7 groups, found-counts, `needsStems` lock (`ar-coach.jsx`) | **new** `SpecialistTeamModal.tsx` | `SPECIALIST_CATALOG` + `specialistGroup`/`groupColor` (`helpers/specialists.ts`), `useVerdicts.specialists`, `useRunSpecialist` |
| `ActionsModule` move list w/ "Added" toggle + problem kicker (`ar-actions.jsx`) | **reuse `GamePlan` move rendering / `move-model.ts`** (extract a `MoveCard` if not already standalone) | `buildMoves({verdicts, top_fixes, coached_fixes})` |
| `RackSidebar` — **Fixes for Listen** (checked moves, ×), **Coach Mix** row (when ready), **Open in Listen**, **Game Plan** card (`ar-app.jsx`) | **new** `RackSidebar.tsx` (may absorb parts of `FixRackPanel`) | `selected` set (ReportView), `useGenerateFixRack`/`useFixRack`, nav to `/listen-rack/$versionId` |
| `FixModal` — single-fix detail + rack preview (`ar-app.jsx`) | **new** `FixModal.tsx` | move + `fix-rack-helpers` module meta |
| `CoachMixModal` — selected fixes **solved into one rack** + signal-flow (`ar-app.jsx`) | **`FixRackPanel`** "ready" view in a modal | `useFixRack(jobId)` → `FixRackDto.chain` (already byte-identical to the Listen rack) |
| `GamePlanModal` — DAW `.md` checklist of selected fixes (`ar-app.jsx`) | **`GamePlan.tsx` / `ExportModal.tsx`** | selected moves → markdown |
| `FindingsTab` — severity+group filter pills, evidence chips, "see fix" bridges (`ar-findings.jsx`) | **`FindingsTab.tsx`** (restyle + add filters) | `useVerdicts`, `groupProblems`, `helpers/severity` |
| `TrackInfoTab` — facts row, loudness/dynamics, 7-band tonal, stereo, waveform/spectrogram, clashes, translation, streaming (`ar-trackinfo.jsx`) | **compose** `SpectrumTab` + `StereoCard` + `StreamingReadiness` + `TranslationCard` (+ a facts row) | phase 1/2/4/9 + `results.{waveform,spectrogram}ImageUrl` |
| `ReferenceTab` — target identity, percentile verdict, **tonal-fingerprint hero**, gap rows, `◇` overlay (`ar-reference.jsx`) | **`ReferenceTab.tsx`** (extend — see `PRPs/reference-tab-design.md`) | phase 6 `gaps` + reference-set profile + phase 5 `◇` |
| `ProjectTab` — health ring, arrangement bar, **per-track device chains** (`ar-project.jsx`) | **`ProjectTab.tsx`** + `ArrangementTab`/`SongMap` | phase 8 + `alsProject` |
| `DebugTab` — pipeline graph, per-phase I/O, raw payloads (`ar-debug.jsx`) | **`RawTab.tsx`** + a pipeline diagram (lift from `AnalysisTab`) + `PhaseTimeline` | `finalJson.phases[]` |

**Everything in the left column except `ResultsPlayer`, `SpecialistTeamModal`, `FixModal`, `RackSidebar` already exists** — most of this is recomposition + restyle, not new logic.

---

## 3. New components to build (the only genuinely-new FE work)

1. **`ResultsPlayer.tsx`** — tiny transport in the header (play/pause, bar waveform, click-seek, position to `localStorage`). Mock bars are acceptable (prototype does this); upgrade to real `<audio>` later.
2. **`SpecialistTeamModal.tsx`** — the 26-tile grid grouped by group, run/cached/running/locked states, found-count badges, footer "ran · available · credits". Pure read over `useVerdicts.specialists` + `SPECIALIST_CATALOG`; **Run** → `useRunSpecialist` (same flow `GamePlan` already owns). On run-complete: optimistic running → templated coach line (`"{Specialist} Specialist: I found N additional findings…"`) + bump the findings vital.
3. **`RackSidebar.tsx`** — "Fixes for Listen" queue (checked moves, click→`FixModal`, ×→deselect), the **Coach Mix** row (visible once `coachMixState==='ready'` → opens `CoachMixModal`), **Open in Listen** deep-link, and the **Game Plan** card (→ `GamePlanModal`). May reuse `FixRackPanel` internals.
4. **`FixModal.tsx`** — single-fix detail: finding headline + severity + chip, directive, rack preview (from `fix-rack-helpers` module meta), time-anchor, Remove.
5. **`CoachMixModal.tsx`** — thin wrapper around the `FixRackPanel` "ready" view (signal-flow bar + module cards + "Open Coach Mix in Listen"). Reads the real `FixRackDto.chain`, not the prototype's client-side `compileCoachMix` (that solver lives server-side in the `generate_fix_rack` actor).

Everything else = restyle/recompose existing components.

---

## 4. Orchestration (`ReportView.tsx`)

`ReportView` stays the container and gains this state (mirrors `ar-app.jsx::App`):

- `selected: Set<fixId>` — the checked moves. On change: (a) reset `coachMixState` to `'idle'`; (b) **write the Listen handoff** to `sessionStorage["coachMix:{versionId}"]` =
  `{ versionId, jobId, selectedFixes:[{ fixId, findingId, label, dspChain, section }], savedAt }`.
  **Producer side only — no DSP/audio on the results page.** The Listen page consumes this.
- `coachMixState: 'idle' | 'generating' | 'ready'` — drives the Generate Coach Mix button + the sidebar Coach Mix row. `generating→ready` is driven by the real `useGenerateFixRack` (POST 202) → `useFixRack` (poll 204→200), **not** a `setTimeout`.
- specialist run state — lifted from `useVerdicts` + local optimistic `running` (reuse `GamePlan`'s `optimisticRunning` pattern).
- coach thread — `CoachChat` already owns this; specialist-run completion appends a templated line.
- **cross-tab flash + smooth-scroll** — `flashTo(tab, selector)` sets the tab then `getBoundingClientRect` + `window.scrollTo` + a 1.3 s `.flash` class. **Never `scrollIntoView`.** Anchors: evidence chip → `[data-ti-anchor]` on Track Info; "see fix" → `[data-move-id]` on Coach; move kicker → `[data-finding-id]` on Findings. Respect `useReducedMotion`.
- **Coach Mix = the existing fix-rack flow.** "Generate Coach Mix" → `useGenerateFixRack(jobId).mutate()` then `useFixRack(jobId, true)` polls; the returned `Chain` is byte-identical to what the Listen rack loads. No new backend, no new rack schema.

**Report-level states** wrap the whole view: `complete · clean · degraded · running · failed` (reuse `DegradationBanner` for degraded, `PhaseTimeline` for running, an error + re-analyze for failed — `AnalysisCompleteModal`/`UpgradeSheet` already exist).

---

## 5. Per-tab wiring notes

- **AI Coach** — coach card is `CoachChat` + `CoachCapChip` (cap line) + `TranceBot`; the two header buttons are new (Specialist Team → modal; Generate Coach Mix → fix-rack). Below the card: the move list (severity-sorted, "Added" toggle syncs `selected`). Empty/clean/degraded handled by existing coach states.
- **Findings** — `FindingsTab` restyled: filter pills by **severity** (All/Critical/Severe/Moderate/Minor/Win) **and** by **group** (All/Spectrum/Loudness/Stereo/Sections/Stems…). Cards show source badge (Measured/AI), evidence chips (deep-link to Track Info), and **"See fix in Actions →"** → flash the move on Coach. Largely the existing tab.
- **Track Info** — top-to-bottom: facts row (genre+confidence / duration / tempo / key) → **Loudness & dynamics** (LUFS meter, sample/true-peak, DR, clipping) → **Tonal balance** (7-band bars; per-band genre median is a **backend gap** — render bars without the median line until it lands) → **Stereo** (`StereoCard`) → waveform + spectrogram images → **Frequency clashes** (phase 4) → **Mix translation** (`TranslationCard`; phone/laptop/club mapping is a **backend gap**) → **Streaming readiness** (`StreamingReadiness`, demoted to the bottom).
- **Reference** — extend `ReferenceTab` per `PRPs/reference-tab-design.md`: identity bar, percentile verdict, **tonal-fingerprint hero** (mean±2σ band, your line, `◇` ref), gap rows. **Most backend-dependent tab** — see §7 + the backend spec. Conditional on phase 5/6 presence.
- **Project** — `ProjectTab`: health ring + tempo/timesig/devices/clutter, **Arrangement** bar (phase 8 `arrangement.sections` — produced today), **Tracks** card with per-track **device chains in signal order** (disabled = struck-through). Device-chain ordering is a **backend gap** — until it lands, render the existing `alsProject.tracks[].devices` name list (unordered, no disabled flags) and omit the struck-through styling.
- **Debug** — `RawTab` for raw `finalJson.phases[]`/verdicts + a **pipeline diagram** (lift the phase-graph from `AnalysisTab`, edges from `AR_PIPE_DEPS`) with click-to-inspect per-phase `inputs`/`data`. The old Analysis tab's content lives here now.

---

## 6. Styling / token discipline

**Guiding principle (locked 2026-06-26):** take **layout, content, IA, and copy from the prototype**, but take the **visual look-and-feel from the existing SPECTR pages** — so the result feels native, not transplanted. Concretely: **do NOT port `ar.css` verbatim.** Reproduce the prototype's structure using the site's existing `features/results/` components, the global utilities, the real tokens, and the styling patterns the current results components already use (e.g. `SongHeader.module.css` is already labelled "rebuilt to prototype fidelity"; the existing `.rtab`/tab styling already matches the prototype). New components (`ResultsPlayer`, `SpecialistTeamModal`, `RackSidebar`, `FixModal`) are styled in that same house vocabulary, not the prototype's raw CSS.


- **CSS Modules + `src/styles/{tokens.css,global.css}` + global utilities** (`.card`, `.pill[.tone]`, `.btn[.primary/.ghost/.sm]`, `.label`, `.mono`, `.dot`). No Tailwind/styled-components/shadcn/MUI. No inline styles except genuinely dynamic values (severity color, computed widths) — the prototype uses many inline styles; **convert them to module classes / tokens** on port.
- The prototype's hexes already match `tokens.css` (handoff Fidelity note). **Bind to CSS variables, never hard-code hexes** — `lint:css` (`check-css-tokens.mjs`) fails on raw hex in `*.module.css`. Severity → `--sev-{critical,severe,moderate,minor,win}`; accent `--accent`; violet `--violet`; surfaces/borders/radii from tokens.
- Respect `prefers-reduced-motion` via `hooks/useReducedMotion.ts` for the flash, the eq-dots spinners, and entrance `fade-up`.
- Icons: map the prototype's inline SVGs (`ar-ui.jsx`) to the app's icon set; coach avatar = existing `TranceBot.tsx`.

---

## 7. Backend-gap handling (graceful degradation)

The five gaps (full detail + spec in `PRPs/results-redesign-backend-spec.md`). The FE wires the region and **degrades cleanly** until the data lands — no blocking, no fake data:

| Region | Gap | Degrade-until-ready behavior |
|---|---|---|
| Track Info · Tonal balance | per-band **genre median** (all 7 bands) | render 7 bars from `phase1.bands`; **omit** the median tick + the over/under tint |
| Reference · gap rows | phase-6 scalar gaps for **lufs / true_peak / dynamic_range** | show only the metrics that have gaps today (bpm, stereo_width, stereo_corr); hide the rest until produced |
| Reference · `◇` overlay + band ref line | phase-5 **per-metric ref-track values** | when absent, render **profile-only** state (no `◇`) — already a defined Reference state |
| Track Info · Mix translation | phase-9 **phone/laptop/club** ratings | map from `phase9.playback.{headphone,speaker}_score` to a 2-system read, or hide the systems row and keep the note until the 3-system data lands |
| Project · Tracks | per-track **ordered device chain + disabled flags** | render `alsProject.tracks[].devices` as an unordered name list; no signal-order, no struck-through |

This keeps every tab structurally identical to the prototype; the gap regions fill in automatically once the backend ships.

---

## 8. Increments (each ends green on all gates)

1. **Frame + IA** — `results-tab-keys.ts`, route `validateSearch`, `ResultsTabs.tsx` (new tabs/order/icons/default `coach`), `SongHeader` (InputChips + FindingsVital, remove any grade hero), `ResultsPlayer`. Wire `ReportView` to render the new tab set with existing bodies temporarily. *(no behavior loss)*
2. **AI Coach tab** — coach card (reuse `CoachChat`/`CoachCapChip`/`TranceBot`) + move list under it + the two header buttons stubbed; `SpecialistTeamModal` wired to `useRunSpecialist`. Generate Coach Mix → `useGenerateFixRack`/`useFixRack`.
3. **Sidebar + modals** — `RackSidebar` (Fixes for Listen + Coach Mix row + Game Plan card), `FixModal`, `CoachMixModal` (FixRackPanel ready-view), `GamePlanModal` (ExportModal). `selected` set + `sessionStorage` handoff + cross-tab flash.
4. **Findings** — restyle + severity/group filters + evidence/fix bridges.
5. **Track Info** — compose the metric stack; degrade the median + translation gaps per §7.
6. **Reference** — extend `ReferenceTab` per `reference-tab-design.md`; profile-only until phase-5 `◇` lands.
7. **Project + Debug** — `ProjectTab` (degrade device chains per §7) + arrangement; `DebugTab` pipeline diagram + raw I/O.
8. **States + polish** — running/failed/clean/degraded wrappers, reduced-motion, token/lint cleanup, remove all leftover artifacts.

---

## 9. Validation gates (run after every increment — all must pass)

```bash
cd components/frontend-spectr-v2
npx tsc --noEmit
npm run lint          # eslint --max-warnings 0 + check-no-google-fonts
npm run lint:css      # check-css-tokens.mjs — no raw hex in *.module.css
npm run build         # vite + tsc -b
npx vitest run
```

## 10. Out of scope
- Any DSP/audio on the results page (the player is a simple transport; Coach Mix DSP lives on the Listen page).
- The Listen page itself (it *consumes* the `coachMix:{versionId}` handoff — unchanged here).
- The References **library**/profile detail views (`references-ui-requirements.md`).
- The five backend data items — `PRPs/results-redesign-backend-spec.md`.
