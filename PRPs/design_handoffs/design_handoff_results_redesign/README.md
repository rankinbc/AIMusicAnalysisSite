# Handoff: Analysis Results page redesign

## Overview
A redesign of the **analysis results page** (`src/features/results/`) — the screen a producer
lands on after SPECTR analyzes a track. The redesign reorganizes the information architecture
around a **diagnose → fix → audition** flow, makes the **AI Coach** the primary surface, folds the
loose stats into a focused **Track Info** tab, adds a **Reference** comparison tab, and removes the
letter-grade hero in favor of a single neutral *findings* vital.

**The prototype's layout, content, and information architecture ARE the design** — build them as
shown. The one thing that needed to match the rest of the site is the **look & feel** (fonts,
colors, tokens), and that has already been aligned to `src/styles/tokens.css` (see Fidelity). Build
this inside `frontend-spectr-v2` (React + TypeScript + CSS Modules), **reusing the existing
`src/features/results/` components and helpers as building blocks for data + logic** — but follow
the prototype for structure, layout, copy, and flow.

## About the design files
The files in `prototype/` are a **design reference built in HTML/JSX** (React 18 + Babel-in-browser,
plain CSS). They are **not** production code to copy. They exist to show intended look, layout,
copy, interactions, and states. Recreate them with the codebase's real components, hooks, router,
data layer, and CSS-Module conventions. Do **not** introduce Babel-in-browser, the `window.*`
global-component pattern, or the Tweaks panel into the app.

To view the prototype: open `prototype/Results Page.html` in a browser. Toggle scenarios and report
states from the **Tweaks** panel (prototype-only affordance).

## Fidelity: HIGH
Pixel-level intent — final colors, type, spacing, copy, and interactions.

> **The prototype's design tokens were deliberately realigned to your real `src/styles/tokens.css`.**
> Fonts (**Syne** + JetBrains Mono), the cyan accent **`#00e5b0`**, violet **`#a78bfa`**, the
> **`#070a12`** background with the radial-glow + 48px grid, the surface/border/text neutrals, the
> radii (12/8/16), and the **severity palette** (critical `#f43f5e` · severe `#fb923c` · moderate
> `#fbbf24` · **minor `#00e5b0`** · win `#34d399`) all match `tokens.css`. Treat the prototype's
> colors/type as 1:1 with your tokens — bind to the CSS variables, don't hard-code hexes.

---

## Screens
Annotated full-tab captures in `screenshots/` (deep "Lumen" scenario, complete report):

1. `01-ai-coach.png` — **AI Coach** (default): coach chat, Specialist Team, Generate Coach Mix, prioritized move list below.
2. `02-findings.png` — **Findings**: severity-sorted, filterable by severity & group; evidence chips + fix bridges.
3. `03-track-info.png` — **Track Info**: facts row, loudness & dynamics, 7-band tonal balance, stereo, waveform/spectrogram, frequency clashes, mix translation.
4. `04-reference.png` — **Reference**: profile-led range comparison with the uploaded ref track folded in (◇), tonal fingerprint hero, gap rows.
5. `05-project.png` — **Project** (.als only): per-track device chains, MIDI health, arrangement.
6. `06-debug.png` — **Debug**: phase pipeline, per-phase I/O, raw payloads.

Report-level states (clean · degraded · running · failed) and the short-clip scenario are togglable in the prototype's Tweaks panel.

---

## Tab structure (build this)

**Build the prototype's tabs:** `AI Coach · Findings · Project* · Reference* · Track Info · Debug`
( * = conditional ). For orientation, today's tabs are `actions · findings · analysis · project ·
files` — the table below lists the **existing components/helpers to reuse** for each prototype tab
(for data + logic). **The prototype is the source of truth for layout, content, and IA;** the
existing code is plumbing to lean on, not a structure to preserve.

| Prototype tab | Existing components/helpers to reuse | Notes |
|---|---|---|
| **AI Coach** (primary, default) | `CoachPanel` + `CoachChat` + `CoachFilters` + `CoachCapChip` + `SpecialistTile`/`DeepenZone` **and the `MoveCard` list** | The **Actions** tab is dissolved: the prioritized `MoveCard` list now lives **under** the coach chat on this one tab. Specialist Team + **Generate Coach Mix** sit in the coach header. |
| **Findings** | `FindingsTab` + `VerdictsPanel` + `VerdictCard` + `EvidenceChips` | Severity-sorted, filter pills by severity **and** group; evidence chips deep-link to Track Info; out-of-range → "see in Findings" bridges. Largely your existing tab, restyled. |
| **Project*** | `ProjectTab` + `ArrangementTab` + `SongMap` | Unchanged in spirit; conditional on an `.als` project map. Full-width Tracks card (device chain in signal order, disabled struck-through), MIDI health, arrangement. |
| **Reference*** | `ReferenceTab` (extend) | **Biggest new work.** Profile-led range comparison **+** the single uploaded reference track folded into the same rows (◇ overlay) and the tonal-fingerprint curve. Conditional on a reference profile or track. See "Reference tab" below. |
| **Track Info** | `SpectrumTab` + `StereoCard` + `StreamingReadiness` + `TranslationCard` + `GenreScorePanel` | New composition: facts row (genre/duration/tempo/key) → loudness & dynamics → tonal balance (7-band) → stereo → waveform/spectrogram images → **frequency clashes** → **mix translation** → streaming readiness (demoted to bottom). |
| **Debug** | `RawTab` + `AnalysisTab` + `PhaseTimeline` | The **Analysis** tab is removed as a top-level tab; its **phase pipeline diagram** + per-phase I/O move **into Debug** alongside the raw `finalJson`/verdicts payloads. |

**Removed:** `GradeHero` (the letter grade) is **not** in the design — leave it out of the page. The
only header vital is a neutral "**N findings · N suggestions**" stat (no color, no grade).

**`results-tab-keys.ts`** becomes: `'coach' | 'findings' | 'project' | 'reference' | 'trackinfo' | 'debug'`
(project & reference conditional). Update `RESULTS_TAB_KEYS`, `isResultsTabKey`, the route's
`validateSearch`, and `ResultsTabs.tsx` (labels/icons/badges/order). Default tab → `coach`.

---

## Orchestration (maps to `ReportView.tsx`)
`ReportView` stays the container. New responsibilities:
- Owns `selectedFixes: Set<fixId>` → on change, **writes the Listen handoff** to
  `sessionStorage["coachMix:{versionId}"]` (shape in "Data" below). This is the producer side only —
  **no DSP/audio here**; the Listen page consumes it.
- Owns `coachMixState: 'idle' | 'generating' | 'ready'` for the Generate Coach Mix affordance.
- Owns specialist-run state, coach thread, and the cross-tab **flash/scroll** (evidence chip →
  Track Info datapoint; "see fix" → the move; move kicker → the finding).
- Report-level states wrap the whole view: **complete · clean · degraded · running · failed**
  (reuse `DegradationBanner`/`DepthBanner`; running = `PhaseTimeline` progress; failed = error +
  re-analyze).

Persistent frame (maps to `SongHeader.tsx` + the page shell): cover, title + version, **"Analyzed
from" input chips** (Primary mix · Stems · Ableton project · Reference profile · Reference track —
each with a ✓), genre line, a tiny waveform transport (mock; persist position to `localStorage`),
the tab bar, and the **right sidebar**.

### Right sidebar — maps to `FixRackPanel.tsx` + `GamePlan.tsx`/`ExportBar.tsx`
- **Fixes for Listen** — the checked moves (click a row → Fix detail modal; × to remove);
  "Open in Listen" deep-link; **Generate Coach Mix** → after a short compile, a **Coach Mix** row
  appears that opens the whole-rack modal.
- **Coach Mix modal** — the selected fixes **computed into one mastering rack** (EQ bands solved
  together into a single EQ; dynamics/loudness folded into the limiter — *not* one device per fix).
  Reuse `fix-rack-helpers.ts` / `move-model.ts`.
- **Game Plan** — distinct from Coach Mix: the **DAW export** (checklist `.md` to hand-apply in
  Ableton). Maps to `GamePlan.tsx` + `ExportModal.tsx`.

---

## Reference tab (new detail)
Extend `ReferenceTab.tsx` (`GapRow`, the percentile ring, `GAP_LABELS`) — don't rebuild.
1. **Target identity bar** — profile hue ● + name + kind chip ("Your profile" / "Genre preset") +
   "based on N tracks"; if a single ref track is attached, "overlaying *Title* — Artist" plus
   **closest / biggest-gap** callout chips.
2. **Verdict** — percentile ring + "M of N metrics in range" + plain-language takeaway.
3. **Tonal fingerprint (hero)** — 7-band curve: target `mean ± 2σ` shaded band, **your** line
   overlaid, **◇ ref-track** markers; out-of-range bands flagged + "see in Findings".
4. **Metric gap rows** — scalars (LUFS · True Peak · Dynamic Range · Stereo Width · Stereo
   Correlation · BPM) as range bars: `▒▒` range · `│` mean · `●` you · `◇` ref, with percentile and a
   **vs ◇ ref** delta (tinted when they essentially match). Out-of-range rows deep-link to Findings.
   *(The uploaded-track A/B — phase 5 — is folded into these rows, not a separate section.)*

**States:** profile+track (full) · profile only (no ◇) · single track only (no spread → delta read) ·
profile not ready (`analyzed_count==0`) · profile partial (note "based on N of M").
Legend everywhere: `● you · ▒▒ acceptable range · │ target mean · ◇ ref track`.

---

## Data bindings
The prototype's `ar-data.jsx` documents every binding in comments. Sources:
- **Findings / verdicts** → `GET /api/reports/{id}/verdicts` (rule_engine = "Measured", llm = "AI").
- **finalJson / phases** → `GET /api/jobs/{id}/results` → `finalJson.phases[]` (Debug tab I/O).
- **Reference profile gaps** → `phase6.gaps` (`user_val, genre_mean, genre_std, acceptable_range,
  delta, percentile, in_range, description`); profile aggregate → `GET /reference-sets/{id}` →
  `profileJson.feature_statistics`.
- **Uploaded ref-track A/B** → `phase5` deltas / the attached `ReferenceDto` (◇ values).
- **Listen handoff (write):** `sessionStorage["coachMix:{versionId}"] =
  { versionId, jobId, selectedFixes:[{ fixId, findingId, label, dspChain, section }], savedAt }`.
- Waveform/spectrogram → `results.waveformImageUrl` / `results.spectrogramImageUrl` (the prototype
  ships real sample renders in `prototype/ar-assets/`).

## Interactions
- Tab change via router search param (keep deep-linkable). Default `coach`.
- Cross-tab **flash + smooth-scroll** to a target element (never `scrollIntoView`; use
  `getBoundingClientRect` + `window.scrollTo`).
- Move select ↔ sidebar queue ↔ `sessionStorage` stay in sync; selecting resets `coachMixState`.
- Specialist run → optimistic "running" → cached + found-count → templated coach line
  ("**{Specialist} Specialist:** I found N additional findings…") + bumps the findings vital.
- Respect `prefers-reduced-motion`. CSS Modules + `tokens.css` + global utilities; **no Tailwind**.

## Deliverable vs. scaffold (do NOT port)
Per the project's working notes, the prototype is shown inside mock SPECTR chrome. **Do not port**:
the top bar (brand/nav/credits/avatar), the **Tweaks** hint + panel (`tweaks-panel.jsx`), and the
toast host — these only host the prototype. The deliverable is everything inside the page `.wrap`:
header, tabs, tab bodies, sidebar, and modals.

## Design tokens
Use `src/styles/tokens.css` directly — the prototype already matches it. Reference:
accent `#00e5b0` / bright `#00f3bd`; violet `#a78bfa`; bg `#070a12`; text `#e2e8f4` / `#c0cad8` /
muted `#64748b`; borders `rgba(255,255,255,.07/.12/.16)`; radii 12/8/16; severity critical `#f43f5e` ·
severe `#fb923c` · moderate `#fbbf24` · minor `#00e5b0` · win `#34d399`; fonts Syne (UI) + JetBrains
Mono (numerics, `.mono`).

## Assets
- `prototype/ar-assets/waveform.webp`, `spectrogram.webp` — sample server renders (magma palette).
  In the app, bind to `results.waveformImageUrl` / `results.spectrogramImageUrl`.
- Coach avatar = your existing `TranceBot.tsx`. Icons are inline SVG in `ar-ui.jsx` (match to your
  icon set).

## Files (in `prototype/`)
- `Results Page.html` — entry; load order + scenario/state tweaks.
- `ar-data.jsx` — two scenarios (deep "Lumen" + short clip) + the **data-contract bindings** (read this first).
- `ar-app.jsx` — orchestration → **`ReportView.tsx`**.
- `ar-frame.jsx` — header, tabs, sidebar, tiny player → `SongHeader`, `ResultsTabs`, `FixRackPanel`.
- `ar-coach.jsx` — coach + specialist modal → `CoachPanel`/`CoachChat`/`SpecialistTile`/`DeepenZone`.
- `ar-actions.jsx` — the move list (now under Coach) → `MoveCard`/`move-model.ts`.
- `ar-findings.jsx` → `FindingsTab`/`VerdictsPanel`/`VerdictCard`.
- `ar-trackinfo.jsx` → `SpectrumTab`/`StereoCard`/`StreamingReadiness`/`TranslationCard`/`GenreScorePanel`.
- `ar-reference.jsx` → extend `ReferenceTab`.
- `ar-project.jsx` → `ProjectTab`/`ArrangementTab`/`SongMap`.
- `ar-debug.jsx` — pipeline diagram + raw payloads → `RawTab` + folded-in `AnalysisTab`/`PhaseTimeline`.
- `ar-ui.jsx` — shared primitives/icons. `ar.css` / `ar-tabs.css` — token-aligned styles (reference only).
