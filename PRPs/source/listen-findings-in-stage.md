# Feature seed — Findings & Actions on the Listen page (in the stage box)

_Captured 2026-09-19 from a product-owner idea + a read-only code survey on `solo` @ `3366fbe`. Not a PRP yet — feed this to `/new-feature` → `/generate-prp` after the solo strip lands._

## The idea

Bring all Findings and Actions (ideally the Improvement Plan too) into `/listen-rack`. They live **inside the stage box** (where the spectrum/visualizer renders); the visualizer plays **full-screen in the background by default**. Read a finding → jump to where it happens → apply its fix to the live rack and A/B it, without leaving the page.

## What already exists (verified in code)

- The Listen page root is already `<div className="rdx lr-shell">` — results components are styled under `.rdx`, so CSS reuse is **one import** (`features/results/redesign-v3-tabs.css`), plus ~20 lines of glass overrides.
- `FixBoard`, `FindingDetail`, `ActionDetail`, `FixBoardFilters`, `OpRack` are pure-prop components: no queries, no router, no context. All state is threaded from `ReportView.tsx` as props (committedIds, checkedNoteIds, focus, mutation callbacks).
- The per-action apply/un-apply engine is built: `fixToRackPatch(ops)`, `isApplyable`, `combineFixes` (weighted, order-independent), `useFixOverlay` (per-fix toggle with baseline restore). Today it is fed by a localStorage snapshot written by the report (`listenFixes`), rendered by `CoachTabV2 → RealFixes`. `Move[] → ListenFix[]` is a ~5-line adapter.
- Background-visualizer mode exists: `const [bgMode] = useState(false)` in `viz.tsx` (~L384) — local, not persisted, portals the stage to `document.body`, leaves a frosted ghost with "Visualizer is playing full-screen in the background / Bring it back". The `SECTION` / `CHAIN` chips and `TransportV2` (scrubber, note pins) are SIBLINGS in `StageCardV2.tsx` and survive a content swap. `seek(t)` + the note-pin `onNote` pattern are the click-to-seek precedent.
- Data: `useVerdicts(jobId)` (`GET /reports/{jobId}/verdicts/`), `buildMoves(...)`, `useApplyVerdict` / `useDismissVerdict` / `useFeedbackVerdict` — all jobId-keyed; the Listen route already has `song.latestResult.jobId`.

## The hard parts

1. **Timestamps barely exist (measured on the local DB, 740 verdicts):** `where.start_seconds` = **0**; `where.section_type` = **0**; `fix.section.start_seconds` = **19 (2.6%)**, and no frontend code reads `fix.section` today. 417 (56%) have an applyable `dsp_chain`. ⇒ "apply this fix" is well covered; **"jump to where it happens" is a worker/rule-engine story first** (populate time ranges), not a frontend one.
2. **Stage height.** `STAGE_HEIGHT = 210` (ListenRackPage.tsx ~L52, used once). A master-detail board needs ~360–480px (`.fb-detail.empty` alone is `min-height:220px`). Needs a compact/expanded or resizable stage; `.lr-stagecard { overflow:hidden }` must be scoped to the viz layer; `.fb-detail { position:sticky }` is inert inside it.
3. **Version/analysis mismatch.** The route loads the SONG's latest analysis and computes `statsSource.mismatch` — then `ListenRackPage` never reads it. Findings (with timestamps) from another version's analysis over the playing audio is worse than nothing. `VersionDto.latestResult` has no `jobId`; needs a small BFF field or a client-side `useJobs()` filter by `versionId`.
4. **Three sources of truth for "applied":** server `userState.applied`, report-side localStorage (`listenFixes` / `listenApplied`), live rack state. The code already carries a scar ("the 78-fixes footgun", ReportView.tsx ~L151, FixBoard.tsx ~L26). Also: the `?fixPreset=` carry-over uses last-writer-wins `overlayChain`, per-fix toggling uses `combineFixes` — mixing both in one session is undefined today.
5. **Perf.** `LightShow` is a never-idle full-viewport canvas; in bgMode `VizStage`'s three canvases go ~7–10× in pixel fill; `backdrop-filter` over a repainting canvas recomposites per frame, and a hover-heavy list inside that region is the worst case. Unmeasured — spike it.
6. **No component tests** exist for `FixBoard` / `FindingDetail` / `ActionDetail` / `FixBoardFilters` / `ImprovementPlanTab` (their pure models are well covered).
7. Copy that becomes wrong on the Listen page: `ActionDetail` "add to apply live on the Listen page", `SendToListenCard`, `ActionsBar.tryFixes`, `ImprovementPlanTab.openStudio()` (navigates to Listen).

## Suggested slicing

- **Slice 0 (worker):** make findings carry time ranges (rule engine + specialist prompts), otherwise click-to-seek is a dead button on ~97% of rows.
- **Slice 1:** live findings/actions board on the Listen page as a TAB first (no height problem) — `useVerdicts` + `FixBoard mode="actions"` + `useFixOverlay` fed from live moves + mismatch banner + per-version job resolution. ~4.5–5.5 dev-days.
- **Slice 2:** move it into the stage box: lift + persist `bgMode`, default it on, resizable/two-step stage, overflow/sticky fixes, perf spike. +2–3 dev-days.
- **Slice 3 (full):** findings mode + filters + deep-link focus, Improvement Plan port (apply-in-place), preset-vs-per-fix reconciliation, applied-state sync back to the report, shared `useFindingsBoard` hook, BFF `jobId` on `VersionDto`, tests + a11y + copy. Total ≈ 18–24 dev-days.

## Open product decisions

- Does the Listen board WRITE server state (applied/dismissed/feedback), or stay local/read-only like today's carry-over?
- Does the "one preset chain only" rule of the Improvement Plan still hold when the plan lives on the rack page?
- What replaces the Coach tab's hand-off card and the `COACH_SUGGESTIONS` / `PLAN_ITEMS` demo fixtures?
