# Build plan — Results page redesign (Actions / Analysis / Files)

> Source: `C:\Users\badmin\Downloads\design_handoff_results_page\` (README + `Results Page.html` hi-fi
> prototype). Implements the **Finding → Move → Game Plan** model. Decisions (2026-06-16): **map the
> prototype's mint → existing `--cyan` (no new tokens)**; **build all three tabs in one pass**.
> Supersedes the source-based 7-tab layout in `src/features/results/`.

## Principle (non-negotiable)
**Lead with the directive; bury the numbers.** Each Move leads with what to *do*. Metric line + "why"
are behind `data` / `why` toggles. Confidence is the only number shown up front (the rank signal).
**Never fabricate values** — render exact `steps`/params only when `fix.dsp_chain` carries them;
otherwise render directional prose. Rule-engine Moves (from `top_fixes`/`coached_fixes`, plain strings)
are therefore always directional. The free analysis must already yield a useful plan.

## Data mapping (all data already exists — no BFF/worker change)
- **AI Moves** ← `GET /api/reports/{jobId}/verdicts/` → `VerdictDto`:
  `headline`→title · `fix.target.name`→scope · `fix.dsp_chain[]` (`{type,params}`)→steps + directive ·
  `whyItMatters`/`body`→why · `severity` (`critical|severe|moderate|minor|win`)→sev
  (`crit|warn|info|low`) · `confidence`→confidence · `specialist`→source · `metricLine`/`evidence`/
  `chartType`→evidence · `userState` (`applied`/`dismissed`)→triage.
- **Rule-engine Moves (free baseline)** ← `FinalJson.top_fixes` + `coached_fixes` (string[]) → directional
  Moves, `source:'rule engine'`, no steps. Quick/deep + sev inferred from string heuristics + phase facts.
- **Deepen** ← `routing_plan.specialists_to_run` (`{name,priority,focus}`). Running a specialist = the
  priced action (`useRunSpecialist`); on completion refetch verdicts → new Move appended ("just added").
- **Analysis tab** ← existing charts from `phases[]` (reused as-is).
- **Degradation** ← `degradation` → existing `DegradationBanner`.
- **Triage** state lifts to page state; map to `useApplyVerdict`/`useDismissVerdict`; committed/trying
  are local (committed persisted via `applied`). Only **committed** Moves export to `.md`.
- **Audition** ▶ → deep-link to the Listen route for the version. **Re-run** → existing rerun endpoint.

## Quick wins vs Deeper work
`group: 'quick'` = high impact / low effort (and rule-engine baseline) → lead. `'deep'` = specialist /
higher-effort. Within each, sort by confidence desc. Section labels: **⚡ Quick wins**, **🛠 Deeper work**.

## Files
**New** (`src/features/results/`):
- `move-model.ts` — `Move` type + `verdictToMove`, `ruleFixToMove`, `groupMoves`, `moveToMarkdown`. Pure, unit-tested.
- `MoveCard.tsx` / `.module.css` — the atom (directive hero, conf+source line, why/data toggles, steps,
  severity left-bar, ▶ Audition, triage "+ Add to plan"→"✓ In plan").
- `GamePlan.tsx` — the Actions screen body: groups + DeepenZone + ExportBar (composition).
- `SongHeader.tsx` / `.module.css` — cover + name + `version·genre·bpm·key·duration` + "Analyzed from"
  input chips + **Open in Listen** / **Get human feedback**. No grade/score.
- `CoachBanner.tsx` / `.module.css` — TranceBot card wrapping existing `CoachChat`, recolored cyan.
- `DepthBanner.tsx` / `.module.css` — conditional (mix-only).
- `DeepenZone.tsx` / `.module.css` — priced specialist prompts from routing plan (+ "Browse all" → full roster).
- `ExportBar.tsx` + `ExportModal.tsx` / `.module.css` — committed Moves → `.md` checklist + visual preview.
- `MovesContext` (or props) — triage state shared across cards + export.

**Evolve:**
- `ResultsTabs.tsx` → 3 tabs (Actions/Analysis/Files); keep Radix-less button strip; drop spectrum/reference/arrangement/raw/coach.
- `ReportView.tsx` → new shell: SongHeader, JobTabs, GamePlan (Actions) / AnalysisTab / FilesTab. Default `actions`.
- `AnalysisTab.tsx` → demoted dashboard: reuse `FrequencyBars`/`StereoCard`/`StreamingReadiness`/clash/arrangement
  in `.an-grid`; add `→ used in Move #N` chip per card; intro copy.
- `FilesTab.tsx` → Inputs (present/add) + Versions + Export history + Re-analyze + Add-files-to-deepen.

**Reused as-is:** `CoachChat`, `TranceBot`, `FrequencyBars`, `StereoCard`, `GenreScorePanel`,
`StreamingReadiness`, `ArrangementTab` internals, `DegradationBanner`, `CoverArt`/`hueFromId`,
hooks (`useVerdicts`/`useRunSpecialist`/`useApplyVerdict`/`useDismissVerdict`/`useReanalyzeVersion`).

**Retire from primary nav:** `VerdictHero`/`GradeHero` (no grade anywhere), `SpectrumTab`,
`ReferenceTab` (folds into Files/Analysis), `RawTab` (drop or → Files), `VerdictsPanel` full roster moves
under DeepenZone "Browse all". Keep files; just unwire from the tab strip.

## States
running (per-phase via `PhaseTimeline`) · shallow (directional + prominent DepthBanner) · clean (lead
"clean mix — here's the polish", info/low only) · failed phase (render surviving phases) · degraded (banner).

## Verification (4 gates)
`cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build && npx vitest run`.
New unit tests: `move-model` (verdict→Move, rule→Move directional, grouping, markdown), MoveCard triage,
export markdown. Visual parity check vs the four prototype screenshots.

## Out of scope
No BFF/worker/DB change. No live room / publish-react (separate plan). PDF export stays stubbed; `.md` is the deliverable.
