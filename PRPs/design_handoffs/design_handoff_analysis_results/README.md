# Design Handoff — Analysis Results Dashboard

Context pack for a design/UI agent extending the **analysis results dashboard**
in `components/frontend-spectr-v2`. The trigger for this handoff: the deterministic
**Problem engine** is now live and persisted, so every analysis carries a
structured, de-suppressed **problem list** with 8 new fields that the dashboard
should surface.

> This is a **redesign/extension of an existing dashboard, not greenfield.** Match
> the existing card/pill/token vocabulary — do not introduce a new design language,
> a CSS framework, or a component library.

---

## 0. The one-paragraph orientation

A user uploads a track → the worker runs a 7-phase analysis → a results page renders
at `/songs/{songId}/results/{jobId}`. That page (`ReportView` → `ResultsTabs`) shows a
hero/summary band plus tabs (`actions · analysis · project · files`). Each finding is a
**`VerdictDto`**. As of the Problem-engine reconcile, every completed analysis also runs
a deterministic rule engine that emits **Problem-shaped verdicts** carrying
`problemId / kind / source / dataTier / fixable / suspected / where / refines`. The
design job is to surface those problems well — most naturally in the **`actions`** tab,
which already turns verdicts into "Moves" via `move-model.ts`.

---

## 1. Start-here files

| File | Why |
|---|---|
| `src/routes/_app/songs.$songId.results.$jobId.tsx` | Page entry / route. |
| `src/features/results/ReportView.tsx` (+ `.module.css`) | Top-level dashboard layout. |
| `src/features/results/ResultsTabs.tsx` + `results-tab-keys.ts` (+ `.module.css`) | The tab strip: **`actions · analysis · project · files`**. |
| `src/styles/tokens.css` | **Design system** — colors, spacing, type, radii. |
| `src/styles/global.css` | Global utility primitives: `.card`, `.pill[.tone]`, `.dot[.tone]`, `.btn[.primary/.ghost/.sm]`, `.label`, `.mono`. |
| `CLAUDE.md` → "frontend-spectr-v2" | Stack rules (read before writing any styling). |

## 2. Data contracts (what you can render)

| File | Why |
|---|---|
| `src/api/types.ts` | **`VerdictDto`** (incl. the 8 Problem fields) + `ProblemKind` / `ProblemSource` / `DataTier` / `ProblemWhere`; `JobResultsDto`; `Severity`. |
| `src/api/hooks.ts` | `useVerdicts(jobId)` → `GET /reports/{jobId}/verdicts/`; `useJobResults(jobId)` → `/jobs/{jobId}/results` (`finalJson`); `useJob`, `useRunSpecialist`, `useRerunPhase`. |
| `src/api/fetcher.ts` | Fetch wrapper (auth/refresh). |
| `components/shared/aimusic_shared/verdicts/models.py` | Backend source of truth: `Category` (26 values), `Severity`, Problem literals. |

## 3. The verdict / problem surface — primary integration point

| File | Why |
|---|---|
| `src/features/results/move-model.ts` | **Where verdicts become "Moves."** The new fields plug in here. |
| `MoveCard.tsx`, `GamePlan.tsx` (+ `.module.css`) | The `actions`-tab cards — likely home for the Problems list. |
| `VerdictsPanel.tsx`, `VerdictCard.tsx`, `EvidenceChips.tsx` (+ `evidence-chips-helpers.ts`) | Existing verdict-rendering + evidence chips. |
| `coach-suggestion-templates.ts` | Canonical **severity → priorityScore** ordering. |
| `helpers/severity.ts`, `helpers/grade.ts`, `helpers/format.ts` | Severity tone, A–F grade colors, value formatting. |

## 4. Supporting surfaces

- **Hero/summary:** `VerdictHero.tsx`, `GradeHero.tsx`, `MetadataBar.tsx`, `GenreScorePanel.tsx`, `SongHeader.tsx`.
- **Tabs:** `AnalysisTab.tsx`, `SpectrumTab.tsx` + `FrequencyBars.tsx` + `StereoCard.tsx`, `ReferenceTab.tsx`, `ArrangementTab.tsx` + `SongMap.tsx`, `ProjectTab.tsx`, `FilesTab.tsx`, `RawTab.tsx`, `StreamingReadiness.tsx`, `PhaseTimeline.tsx`.
- **Coach + states:** `CoachChat.tsx`, `CoachPanel.tsx`, `CoachFilters.tsx`, `TranceBot.tsx`, `CoachGateInline.tsx` / `CoachCapChip.tsx`, `DegradationBanner.tsx` + `degradationCopy.ts`.

---

## 5. The new Problem fields (on every `VerdictDto`)

Top-level fields serialize **camelCase**. `where` is a **jsonb passthrough**, so its
*inner* keys stay snake_case (same as `evidence`/`fix`).

| Field | Type | Values | UI semantics |
|---|---|---|---|
| `problemId` | `string \| null` | `"<category>.<slug>.<index>"` e.g. `"low_end.sub_rumble.0"` | Stable identity → React key; the target of `refines`. `null` on legacy/LLM rows. |
| `kind` | `ProblemKind` | `fault` · `observation` · `integrity` | **fault** = actionable problem · **observation** = informational (usually `fixable:false`) · **integrity** = data/input issue. Drives icon/tone. |
| `source` | `ProblemSource` | `rule_engine` · `llm_identifier` | Badge "Measured" vs "AI". Today everything is `rule_engine`. |
| `dataTier` | `DataTier` | `audio_only` · `stems` · `project_midi` | **Group/section the list.** Empty stems/project groups → "upload stems / .als to unlock". |
| `fixable` | `boolean` | — | `false` → no "Apply fix" CTA. |
| `suspected` | `boolean` | — | Placeholder-threshold / low-confidence → soft "Unverified" badge. |
| `where` | `ProblemWhere \| null` | `{ section_type?, start_seconds?, end_seconds? }` | Section-localized → deep-link/scrub the waveform. `null` = whole-track. |
| `refines` | `string \| null` | a parent `problemId` | This record is a refined child of a composite → **nest under the parent**. `null` today. |

Existing fields you'll also use: `severity` (`critical|severe|moderate|minor|win`),
`category` (26-value set), `confidence`, `priorityScore`, `headline`, `summary`,
`whyItMatters`, `metricLine`, `evidence`, `fix`.

---

## 6. How to drive the Problems surface

- **Group** by `dataTier` → three sections: **Audio** (`audio_only`) · **Stems** (`stems`) · **Project** (`project_midi`). Empty Stems/Project sections become "unlock" affordances.
- **Order within a group:** `severity` desc, then `priorityScore` desc — the rule already in `coach-suggestion-templates.ts`.
- **Badges:** `suspected` → "Unverified" · `source === 'llm_identifier'` → "AI" · `kind === 'observation'` → "FYI" (no fix CTA).
- **Fix CTA:** only when `fixable === true` (and, once the SOLVE tier ships, when `fix !== null`).
- **Section anchor:** if `where` is set, scrub the waveform/timeline to `where.start_seconds…end_seconds`.
- **Threading:** if `refines` is set, render nested under the verdict whose `problemId === refines`.

---

## 7. Constraints — do NOT

- ❌ Add Tailwind / shadcn / MUI / Chakra / styled-components. **CSS Modules + `tokens.css` + the global utility classes only.**
- ❌ Use inline styles except for genuinely dynamic values (e.g. a color computed from grade/severity).
- ❌ Invent a new design language — reuse `.card`, `.pill[.tone]`, `.dot[.tone]`, `.btn`, etc.
- ❌ Add a new top-level layout-state store — feature folders own their pieces.
- ❌ Build a new API endpoint — `GET /reports/{jobId}/verdicts/` (via `useVerdicts`) already returns the Problem fields.

## 8. Reference (deeper context)

- `PRPs/problem-engine-reconcile-persist.md` — how the fields flow DB → BFF → frontend.
- `PRPs/problem-engine-mixcoach-rules.md` — the rule catalog (which problems exist, per tier/genre).
- `CLAUDE.md` → worker "Two-pass Problem engine" note — the engine + persistence summary.
