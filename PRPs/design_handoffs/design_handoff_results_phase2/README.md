# Handoff: Results page — Phase 2 (`actions` tab) extensions

Implements three surfaces on the analysis-results dashboard in `frontend-spectr-v2`:

1. **Problems surface** — render the live Problem-engine fields on every verdict.
2. **AI Analysis modal** — "which specialists ran (and why) + what's left to run."
3. **Generate Fix Rack** — committed fixable Moves → a mastering chain you open in Listen.

> Extends `PRPs/design_handoffs/design_handoff_analysis_results/README.md` (the field-level
> Problem guidance) and the Listen-rack handoff. This is the **"act on the problems"** layer.

---

## About the design files

The files in `prototype/` are a **design reference built in HTML/React-via-Babel** (it renders
in a browser with no build step). They are **not production code to copy**. The job is to
**recreate these surfaces in `frontend-spectr-v2`** using its real stack — React + TypeScript +
TanStack Query + **CSS Modules + `tokens.css` + the global utility classes** (`.card`,
`.pill[.tone]`, `.dot[.tone]`, `.btn[.primary/.ghost/.sm]`, `.label`, `.mono`). Do **not**
introduce Tailwind/shadcn/MUI/styled-components or a new design language.

Open `prototype/Results Page.html` in a browser to interact with it. The **Tweaks** panel
(toolbar) toggles every state below — use it to see loading / clean / degraded, input depth
(mix↔stems↔.als), the three metric-viz variants, and all four Fix-Rack states.

The prototype's tokens (`--accent` mint, `--surface`, `--orange/--red/--green/--violet/--blue`,
`--muted`, the `JetBrains Mono` mono face) were chosen to mirror the app — when you implement,
**use the app's `tokens.css` values**, not the prototype's hexes.

## Fidelity: **high**

Pixel-level intent — spacing, type scale, color tone, and interaction are deliberate. Recreate
faithfully with the codebase's primitives. Where the prototype invented a token, snap to the
nearest existing app token.

---

## What already exists vs. what's new

Most of the data is **already in the codebase** — these surfaces are largely *rendering* work.

**Already shipped (no new types/endpoints):**
- `VerdictDto` already carries all 8 Problem fields (`problemId`, `kind`, `source`, `dataTier`,
  `fixable`, `suspected`, `where`, `refines`) — see `src/api/types.ts`. Plus `ProblemKind`,
  `ProblemSource`, `DataTier`, `ProblemWhere`, `Severity`.
- `useVerdicts(jobId)` returns `{ verdicts, specialists: SpecialistStatus[], routing_plan?:
  RoutingPlanDto, degradation? }` — everything the AI-Analysis modal needs.
- `useRunSpecialist(jobId)` (POST `/reports/{jobId}/verdicts/run/{slug}`) — the Run action.
- `SPECIALIST_CATALOG` + `specialistGroup`/`groupColor`/`specialistLabel` in
  `helpers/specialists.ts` — the roster, groups, `needsStems` gating, persona colors.
- `move-model.ts` (`buildMoves`, `verdictToMove`, `Move`) — the Actions-tab atom.
- `GamePlan.tsx` is the `actions`-tab body; it already wires `useVerdicts`, `useRunSpecialist`,
  `DeepenZone`, `VerdictsPanel`, `ExportBar`, and an `audition()` nav to `/listen-rack/$versionId`.

**New (must be added):**
- `FixRackDto` + `useGenerateFixRack(jobId)` + `useFixRack(jobId)` — see §3. (The backend BFF
  endpoints are live; the FE types/hooks may still be unwritten — check `types.ts`/`hooks.ts`.)
- Three components (Problems list/group, AI-Analysis modal, Fix-Rack panel) + their `.module.css`.
- If Problems is its own tab: a `'problems'` key in `results-tab-keys.ts` + the route's
  `validateSearch`.

---

## 1 · Problems surface

**What it is.** The de-suppressed verdict list, surfaced so the 8 Problem fields read clearly.
Each problem is a diagnosis that cross-links to the **Move** that fixes it (in `actions`).

**Where it lives — decision.** The prototype shows it as a **dedicated tab** ("Problems",
between Actions and Analysis) with its own count badge. The earlier analysis-results README
suggested folding it into `actions`. **Recommendation: ship the dedicated tab** — it keeps the
diagnosis list (ranked, groupable, threaded) distinct from the prescription list (Moves), which
is the whole point of the split. If you prefer to avoid a route change, render the same
`ProblemsList` as a collapsible section at the top of `GamePlan` instead — the component is
identical; only its mount point differs.

**Files to touch / add:**
- `results-tab-keys.ts` — add `'problems'` to `ResultsTabKey` + `RESULTS_TAB_KEYS` (the tab
  route already narrows via `isResultsTabKey`; the `$jobId` route's `validateSearch` picks it up).
- `ResultsTabs.tsx` (+ `.module.css`) — add the tab trigger + count badge.
- **New** `ProblemsList.tsx` / `ProblemCard.tsx` (+ `.module.css`) — or reuse `VerdictCard.tsx`
  if its surface is close enough; the prototype's card is richer, so a dedicated card is cleaner.
- `MoveCard.tsx` (+ `move-model.ts`) — add the **problem-reference kicker** (see §1.4).

### 1.1 Group by `dataTier` → three sections

`audio_only` → **"From your mix"** · `stems` → **"From your stems"** · `project_midi` →
**"From your project"**. A tier whose inputs aren't uploaded renders an **unlock affordance**
(dashed card, "Upload stems / Drop your .als to surface …") instead of its problems. Gate on the
same input signal `GamePlan` uses (`inputs.stems` / `inputs.als` from `SongHeaderInputs`).

### 1.2 Order within a group

`severity` desc, then `priorityScore` desc. (Same rule as `coach-suggestion-templates.ts` /
`VerdictCard`.) Show `priorityScore` as a small `P{n}` chip.

### 1.3 Per-field rendering

| Field | UI |
|---|---|
| `kind` | `fault` → alert glyph, severity tone (default, no badge). `observation` → eye glyph + **"FYI"** badge, no fix CTA. `integrity` → layers glyph + **"Data"** badge (blue), data/input issue. |
| `source` | `rule_engine` → **"Measured"** badge (mint). `llm_identifier` → **"AI"** badge (violet). |
| `suspected` | `true` → soft **"Unverified"** badge (amber) + dashed card border + lower-confidence read. |
| `fixable` | `true` + linked Move → **"→ Fixed by Move N"** (jumps to the Move). `true` + no Move → **"Generate a fix"** (the SOLVE tier). `false` → **"no auto-fix"** (muted, no CTA). |
| `where` | non-null → an anchor chip **"◍ Breakdown · 2:33–3:35"** that deep-links the waveform to `where.start_seconds…end_seconds` (in-app: scrub the Listen/timeline view; the prototype links to the Listen page). |
| `refines` | non-null → render this verdict **nested under** the verdict whose `problemId === refines` (indented, with an elbow connector). Children are excluded from the flat sort. |
| `problemId` | React key + the target of `refines`. |
| `confidence` | `{Math.round(confidence*100)}% conf`. |
| `specialist` | small producer chip (the human label, distinct from the `source` enum). |
| `metricLine`/`evidence`/`whyItMatters` | the measured line + a `why ▾` toggle. |

### 1.4 Moves reference their problem

Extend `Move` (`move-model.ts`) so a verdict-sourced Move carries its problem context:
`problemId`, `problemHeadline` (the verdict `headline`), `kind`, `fixable`, `where`. In
`verdictToMove`, copy them from the `VerdictDto`. `MoveCard` then renders a **kicker** above the
title: `● Fixing · {problemHeadline} — {metricLine} · {severity}` (or `● Working` for
`kind === 'win'`/observation Moves, which render as no-action cards). This is the back-link that
makes the Problems↔Actions split legible.

### 1.5 Degraded / clean

- **Degraded** (`VerdictsListResponse.degradation` present): filter to `source === 'rule_engine'`
  and show `DegradationBanner` above the list. (Rule rows still render as normal cards.)
- **Clean** (no `fault` problems): show an "all-clear" state + any `win`/observation rows.
- The **tab badge** counts visible `fault` problems (tier-unlocked; `rule_engine`-only when degraded).

---

## 2 · AI Analysis modal

**What it is.** A modal opened from an **"AI Analysis"** button at the top of the `actions` tab.
Two sections: **Called — why each ran**, and **Available to run**. It's a presentation of data
`GamePlan` already fetches — no new endpoint.

**Files:** **New** `AiAnalysisModal.tsx` (+ `.module.css`); button mounted in `GamePlan.tsx`
(next to the coach/plan header). Reuses `SpecialistTile.tsx` styling vocabulary if helpful.

**Data binding:**
- **Called + why** ← `useVerdicts(jobId).data.routing_plan` (`RoutingPlanDto`):
  `specialists_to_run[]` gives `{ name, priority, focus }` — `focus` is the *why-it-ran* line —
  plus a top-level `rationale`. Cross-reference `data.specialists` (`SpecialistStatus.status ∈
  idle|cached|failed`) to mark which actually produced verdicts; overlay local `running`.
  The rule engine is always-on (free) — show it as a "Measured · baseline" row.
- **What each produced** ← the verdicts whose `specialist === slug` (link to the Move/Problem).
- **Available to run** ← `SPECIALIST_CATALOG` minus the run slugs. Group by `SpecialistGroup`,
  color via `groupColor`. Disable `needsStems` specialists when no stems (show "needs stems");
  likewise gate `device_chain`/project specialists on `.als`. Each row's **Run** button calls
  the SAME `useRunSpecialist` flow `GamePlan` already owns (lift `handleRun`/`optimisticRunning`
  to a shared hook, or pass them in) so credits + optimistic state stay consistent.
- **Degraded:** if `degradation` present, show only the rule engine ran + a "specialists paused"
  note with a resume affordance.

**States:** the header summarizes `{ran} ran · {available} available`; rows show a spinner while
`optimisticRunning` holds the slug, then move to "Called" once the verdict lands.

---

## 3 · Generate Fix Rack

**What it is.** Turns the user's **committed fixable Moves** into a mastering **`Chain`** they
can hear in Listen. Lives as a section in `actions`, between *Deepen your plan* and the Export bar.

### 3.1 The contract (add to `api/`)

The BFF endpoints are live; add the FE types + hooks if absent.

```
POST /api/reports/{jobId}/fix-rack   → 202 { status: "queued" }   (400 if no song version)
GET  /api/reports/{jobId}/fix-rack   → 200 FixRackDto | 204 (not generated yet)
```
Flow: **POST to dispatch → poll GET until 200** (async; a worker generates it).

```ts
// api/types.ts
export interface FixRackDto {
  name: string;        // "Fix rack — <song>"
  chain: Chain;        // features/listen-rack/chain.ts — { order, modules, masterBypass }
  createdAt: string;
}
```
`chain` is **byte-identical** to what the Listen rack loads, so the existing rack loader/import
path (`useRackPresets` / the rack state loader) takes it directly — **no new rack schema**.

```ts
// api/hooks.ts
export function useGenerateFixRack(jobId: string) {            // POST → 202
  return useMutation({
    mutationFn: () => fetcher<{ status: string }>({ url: `/reports/${jobId}/fix-rack`, method: 'POST' }),
  });
}
export function useFixRack(jobId: string, enabled: boolean) {  // GET, poll 204→200
  return useQuery<FixRackDto | null>({
    queryKey: ['fix-rack', jobId],
    queryFn: () => fetcher<FixRackDto | null>({ url: `/reports/${jobId}/fix-rack`, method: 'GET' }),
    enabled: enabled && Boolean(jobId),
    // fetcher must surface 204 as null (no body); keep polling while null.
    refetchInterval: (q) => (q.state.data == null ? 1500 : false),
    retry: false,
  });
}
```
Confirm `fetcher` maps a `204 No Content` to `null` rather than throwing — the poll keys off that.

### 3.2 States

`idle` → `generating` → `ready` → `empty`.

- **idle** — card: "Generate fix rack" + subtitle ("Bundle your committed fixes into a mastering
  chain you can hear in Listen — built from {N} moves"). Gate visibility on ≥1 committed **fixable**
  Move; otherwise render **empty**. Primary button "Generate" → `useGenerateFixRack().mutate()`.
- **generating** — after the 202, while `useFixRack` polls (GET=204): spinner + "Solving your
  chain…". (The prototype shows a `POST /fix-rack · 202 queued · polling…` debug line — drop it
  in prod or keep as a quiet status.)
- **ready** — GET=200 `FixRackDto`. Render: name + `{modules} modules · from {moves} moves`, a
  **signal-flow bar** (`in → {order.map(label)} → out`), and a card per module
  (`chain.modules[id]`: glyph/accent from the rack manifest, enabled dot, key params). Actions:
  **"Open in Listen rack"** (primary) → load `chain` into the rack for this `versionId` (reuse
  `audition()`'s nav to `/listen-rack/$versionId` + hand the chain via `useRackPresets`/the loader)
  and **"Regenerate"** (→ back to idle / re-POST).
- **empty** — `FixRackDto.chain` has **no enabled modules**: "This master is already clean —
  nothing to apply." (Also the state when there are no committed fixable Moves.)

### 3.3 Module presentation

Map `chain.order` → `chain.modules[id]` and present with the rack manifest's metadata
(`features/listen-rack` data: per-module `label`, `glyph`, `accent`, params). The prototype shows
EQ / glue comp / limiter / output trim with their accents and a `ctl: value` list per module.

### 3.4 The coaching layer (⚠️ not day-one)

The solver also computes **`change_log`** (why each module was set) and **`leftover_advice`**
(problems a master rack can't fix — e.g. per-stem sidechain, arrangement edits). These are **not
in `FixRackDto` yet** — leave room for a **"What changed · What's left"** panel but render its
**placeholder** until the fields ship (the prototype shows a `SOON` placeholder by default, and a
populated preview behind a tweak — mirror the placeholder in prod). When the DTO grows
`changeLog: string[]` and `leftovers: {headline, why, fixMove?}[]`, fill the two columns.

---

## Interactions & behavior (shared)

- **Cross-links:** Problem "→ Fixed by Move N" and Fix-Rack "Move N" chips scroll to and briefly
  flash the target `MoveCard`. (Prototype: scroll via `getBoundingClientRect` + `window.scrollTo`,
  add a 1.2 s flash class — **do not** use `scrollIntoView`.)
- **Where-anchor:** deep-links to the waveform/timeline at `start_seconds…end_seconds`.
- **Run specialist:** optimistic running state → poll `useVerdicts` (3 s) → card moves to "Called".
- **Generate fix rack:** POST (202) → poll GET (1.5 s) until 200 → ready.
- Respect **reduced-motion** for the flash + spinner; keep entrance states visible without JS.

## State management

- Problems/AI-Analysis are **read models** over `useVerdicts` — no new store.
- Committed-Move set lives in `GamePlan` already; Fix-Rack reads it to gate idle/empty + count.
- Fix-Rack lifecycle: `useGenerateFixRack` (mutation) + `useFixRack` (polling query). The query's
  null-until-ready drives the `generating → ready` transition; a local `requested` flag enables it.

## Design tokens (use the app's `tokens.css`)

Severity → tone: critical/severe `--red`/`--orange`, moderate `--orange`/`--yellow`,
minor `--muted`/`--blue`, win `--green`. Source: Measured = `--accent` (mint), AI = `--violet`,
Data = `--blue`, Unverified = `--orange`. Mono readouts use the existing `.mono` face. Radii,
borders, surfaces, shadows: existing `.card` / global utilities.

## Acceptance criteria

- [ ] Every `VerdictDto` Problem field has a visible treatment (kind, source, suspected, fixable,
      where, refines, dataTier, priorityScore) and degraded/clean states are handled.
- [ ] Problems group by `dataTier` with unlock affordances; `refines` children nest; ordering is
      severity→priorityScore.
- [ ] A Move shows the problem it fixes; the Problem links back to that Move (bidirectional).
- [ ] AI-Analysis modal lists called specialists with their `routing_plan.focus` reason + what they
      produced, and an available-to-run roster (grouped, `needsStems`-gated) wired to `useRunSpecialist`.
- [ ] Fix Rack: idle→generating→ready→empty against the real POST/poll contract; "Open in Listen
      rack" loads the returned `Chain`; coaching panel shows its placeholder.
- [ ] CSS Modules + `tokens.css` + global utilities only; no new UI libs; lint clean (AR39 no-literals
      where applicable).

## Files in this bundle (`prototype/`)

- `Results Page.html` — entry; open in a browser. Loads the scripts below + `tweaks-panel.jsx`.
- `rp-data.jsx` — all mock data: `RP_PROBLEMS` (the 8 fields), `RP_SPECIALISTS`, `RP_FIXRACK`,
  Moves, metrics, tiers, helpers (`rpTierVisible`, `rpFmtTime`).
- `rp-problems.jsx` — Problems tab (grouping, threading, badges, where-anchors).
- `rp-specialists.jsx` — AI Analysis modal.
- `rp-fixrack.jsx` — Fix Rack (4 states + coaching panel).
- `rp-plan.jsx` — Move card (problem kicker, win variant), banners, coach, deepen, song header.
- `rp-secondary.jsx` — Analysis tab, Files tab, export modal.
- `rp-metrics.jsx` — the new Phase-1 metric cards (loudness/dynamics/tone, 3 viz variants).
- `rp-ui.jsx` — shared primitives (badges, rings, gauges, icons).
- `rp-app.jsx` — shell: tabs, tweaks wiring, the AI-Analysis + Fix-Rack mount points.
- `rp.css`, `rp-extras.css` — styles (prototype tokens; map to `tokens.css`).

> Mapping cheatsheet (prototype → codebase): `rp-problems.jsx` → ProblemsList/Card + ResultsTabs;
> `rp-specialists.jsx` → AiAnalysisModal (binds `useVerdicts.routing_plan` + `SPECIALIST_CATALOG`);
> `rp-fixrack.jsx` → FixRack panel + `useGenerateFixRack`/`useFixRack`; the Move kicker →
> `move-model.ts` + `MoveCard.tsx`.
