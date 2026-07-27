# INITIAL — Results Page v4

## Feature

Port the v4 results-page design (`PRPs/design_handoffs/design_handoff_results_v4/` — a delta over v3; read its README first) into `components/frontend-spectr-v2/src/features/results/`. The v3 port is complete and committed on `feat/results-page-v3-port` (through `df2cfe5`). This was assessed in depth on 2026-07-26; the readiness facts below are verified against the codebase — trust them over re-derivation, but confirm file paths still exist.

**Agreed scope decisions (user, 2026-07-26):**
1. **Frontend-first with stubs.** Build all v4 UI against existing data. Features needing new backend render degraded/hidden until a later backend pass — EXCEPT priority-breakdown persistence, which IS in scope (see below).
2. **Priority breakdown persisted (the one backend item).** `compute_priority_score` in `components/shared/aimusic_shared/verdicts/scoring.py` computes `base[severity] × categoryWeight[category] × scopeMultiplier[scope]` but persists only the final int; `scope` is a local arg in `components/worker/app/verdict_lib/rule_engine.py` (~line 92), never stored. Change: scoring returns components; rule engine persists them on the verdict (aimusic_shared model + EF entity `Spectr.Data/Entities/Verdict.cs` + migration + `VerdictDtos.cs` + TS mirror in `src/api/types.ts`). While in there, verify the true score scale — the math yields ~20–300 but the TS comment on `priorityScore` claims 0–100.
3. **Four data-we-already-have additions are in scope:**
   - Bookmarks lane on the Notes/Feedback timeline (`track_bookmarks` entity, `BookmarkEndpoints.cs`, aggregate `GET /versions/{id}/signal`).
   - Coach Mix rationale: `FixRackDto.CoachMeta` already carries the arbiter's `change_log` + `judgment_calls` — render a "why the Coach chose these" disclosure.
   - `refines` parent/child threading in the Findings list — revive the currently-dead `groupProblems`/`TIER_LABEL`/`formatWhere` in `features/results/problems-helpers.ts`.
   - Reviewer suggestions surfaced in Actions (`ReviewerSuggestion` entity; propose/accept/reject endpoints exist).

**Stub policy for missing backend:**
- 1–10 rating modal → submit via existing `POST /api/verdicts/{id}/feedback` (enum string helpful/wrong/unclear); keep the richer payload client-side or mark TODO.
- Emoji-reactions timeline lane → seed from `listening_sessions.recap_json` when the version has session recaps; otherwise hide the lane. (Version-scoped reactions are ephemeral live-room Redis events only — no table.)
- Plan log → localStorage until a table exists.
- Genre targets → read per-verdict `evidence.expected_range` (already populated by the rule engine); no genre-targets API exists (config lives in `components/worker/app/verdict_lib/config/genre-profiles.json`, incl. `_platform_targets`).

**Suggested PRP split (4 tasks or 4 PRPs):**
1. Priority-breakdown persistence + Findings/Actions split (the FixBoard dual-mode board).
2. Stems tab.
3. Notes/Feedback tab (comments + bookmarks real; reactions stubbed).
4. Improvement Plan tab + real export generator.

## What the v4 design wants (delta over v3)

Read `design_handoff_results_v4/README.md` + prototype JSX for full detail. Key points with verified data-readiness:

### Tab bar
Left: Track Analysis · Project (**disabled with tooltip** when no .als) · Stems (**disabled** when no stems) · Reference (omitted when absent) · Notes/Feedback (badge = comment count) · Debug. Right-aligned "hot" group: Findings (badge = fault count, alert tint) · Actions (badge = actionable count) · Improvement Plan (badge = plan-log count).
→ Today: `results-tabs-model.ts` `TabDef` has NO `disabled` field (absent tabs are hidden); no right group. `coach` key is already labeled "Findings" and renders `FixBoard.tsx`. Add `disabled`+`tooltip` to TabDef, new keys (actions/stems/notes/dawplan), hot/right styling.

### Priority model (cross-cutting)
Finding chips `P{score}` with hover breakdown, priority slider in filters, P-chips in DAW plan. Per-finding fields `pr{score,base,catW,scopeM}`, `conf`, `tier`, `where`, `suspected`, `ev2` evidence rows, `spec`.
→ `VerdictDto` ALREADY carries `confidence, priorityScore, problemId, kind, source, dataTier, fixable, suspected, where (ProblemWhere), refines` end-to-end — the v3 UI just doesn't render most of them. Only the breakdown components are missing (backend item above).
→ **ev2 rows**: `VerdictDto.evidence` is an untyped `JsonElement`, unrendered. The Python `Evidence` model (`aimusic_shared/verdicts/models.py:33`) is `{metric, value, expected_range: (lo,hi), delta_pct, label, frequency_range_hz, stems}` — maps directly to the metric/yours/expected/delta table. Type it in TS and render (auto-expanded, with plain-language caption). Bonus in scope: use `frequency_range_hz` to deep-link ev2 rows to the band region on the Track Analysis spectrum chart.

### Findings tab (diagnosis-first)
`FixBoard mode="findings"`: wider list grouped by severity, per-row ignore / ask-the-coach / checkbox (every finding checkable, even fix-less — those surface on Actions as notes). Filter dropdown: Fixable only · group · device/scope · min-priority slider (portal-positioned, viewport-capped). Detail: severity + group chip + source tag ("Measured" vs "AI · specialist" — we have `source === 'llm_identifier'` and `specialist`), richer "why it matters" with fallback copy, ev2 table, glossary tooltips (Glossify over ~10 terms), footer with "Show Suggested Fix →" deep-link to Actions.
→ Current `FixBoard.tsx` is single-mode; extend to dual-mode. `refines` threading via revived `groupProblems`. `formatWhere` for the `where` chip.

### Actions tab (fix-first, new)
Same board `mode="actions"`, list = fix titles. Detail: chip row (severity · group · "Addresses Finding: X" jump-back · source), confidence row, sub-tabs **Applicable Fix** (rack via shared `RackView`/`RackModules` renderer + add-to-rack toggle) | **Quick DAW Instructions** (`move.ab` steps with device names highlighted + `move.listen`), expected outcome, **Mark applied** → ✓ View, **Rate this Suggestion** modal (stubbed per policy). Checked fix-less findings appear as notes. Actions bar: Try Fixes · Create Preset · Coach Mix — each logs to the plan log (localStorage).
→ `move-model.ts` `Move` already has directive/ops/confidence/scope/source/suspected; `verdictToMove()` exists. Fixes carry machine-readable `ops: VerdictDspOp[]` (validated `DspOp` schema server-side) — much better than the prototype's display-string racks. Mark-applied: BFF `POST /verdicts/{id}/applied` + `/dismiss` exist but the frontend hooks were removed in story 12.5 (`api/hooks.ts:696` notes it) — restore hooks; NOTE the queue is deliberately localStorage-only (`listenFixes:{versionId}`, "78-fixes-queued footgun" comment in `ReportView.tsx:129`) — sync policy: mark-applied/dismiss write to server, queue stays local. Reviewer suggestions (scope addition) render as "Suggested by <listener>" rows.

### Stems tab (new)
Findings-style sidebar: per-stem detail (role, files w/ classifier confidence, level/width/spectral stats, play button), issues link to Findings, EQ-overlap collision viz.
→ Data-ready in `final_json`: `phase4.stems.per_stem.<role>` = `{lufs_integrated, rms_db, peak_db, dynamic_range_db, spectral_centroid_hz, stereo_width, pan_estimate, is_mono, band_energy_db{7}, dominant_frequencies_hz[], duration_s}`; `phase4.stems.clash_matrix[] = {stem_a, stem_b, band, overlap_severity, severity_tier}`; `phase4.stems.balance_flags[]`; `phase5.per_stem_reference_deltas[] = {role, metric, user_value, reference_value, delta, severity_tier, interpretation}`. Per-stem audio endpoint exists: `GET /versions/{id}/stems/{stemId}/audio`. Golden fixtures: `components/analysis/tests/integration/golden/phase{4,5}_with_stems.json`. NOTE: `final_json.phases` arrives as a LIST `[{phase,name,data}]`, not flattened `phaseN` keys.
→ **The prototype's overlap viz is 100% hardcoded synthetic Gaussians** — do NOT port it. Redesign around the 7-band `band_energy_db` + `clash_matrix` (band-level overlap, not smooth curves). No analysis-pipeline change.

### Notes/Feedback tab (new)
User notes · listener comments (name, timestamp-in-track) · emoji totals + a feedback timeline (0:00→end density curve, emoji markers, comment lane).
→ Comments are data-ready: `track_comments` (threaded, `timestamp_seconds`, anon-capable, moderated) via `FeedbackEndpoints.cs` `GET/POST /versions/{id}/comments`. Bookmarks lane (scope addition): `track_bookmarks` + `GET /versions/{id}/signal`. Reactions: stub policy above. Owner's-notes section: consider `VersionUserRating` / `VersionCompareNote` before inventing a new store. Prototype timeline parses `m:ss` only — use numeric seconds from the DTOs instead.

### Improvement Plan tab (replaces Create DAW Plan)
1. **Listen in Studio** — checkable Active fixes + Presets columns, button opens Listen Rack with picks pre-selected. Prototype left the contract undefined; **ours already exists and wins**: `ListenFix {fixId, verdictId, title, scope, sev, specialist, ops, notApplicable}` via localStorage `listenFixes:{versionId}` + `?fixPreset=` for presets (`features/listen-rack/listenFixes.ts`, `send-to-listen-model.ts`). Extend so the Improvement-Plan picks (fixes AND presets) travel — the prototype dropped its own picks-set.
2. **Create DAW Plan** — by-move view (priority-sorted, P-chips) and per-device view (Master first, exact per-device actions annotated with originating fix + priority), timestamped moments (`where.start_seconds/end_seconds` exists on verdicts), genre targets (via `evidence.expected_range`), export.
→ **Export**: `ExportModal.tsx` has the full config UI (format/detail/order/opts/per-fix checkboxes + live preview) but `downloadGamePlan()` in `ReportView` ignores ALL of it and always emits the plain `moveToMarkdown` checklist — the same bug the prototype has. Build a real generator honoring the config, incl. the new actions-per-device section. PDF may be deferred (md/txt first) — decide in the PRP.
→ Product decision recorded in the handoff: device-scoped presets are NOT applied to the Listen rack (master-chain only); device-scoped moves go to the DAW plan.
→ Presets: standardize on the existing `RackPreset` (`source ∈ user|coach|analysis`, `RackPresetEndpoints.cs`); the prototype has two incompatible client shapes — ignore them. Coach Mix already generates server-side (`generate_fix_rack` actor → `FixRackDto{PresetId, Name, Chain, CoachMeta}` via `GET/POST /reports/{jobId}/fix-rack`).

### Misc
- Static coach icon: `design_handoff_results_v4/prototype/ar-assets/coach.svg` — add as a static export beside the animated `ui/Coach.tsx`.
- Glossary/Glossify, source tags, filter dropdown: pure frontend, port from prototype behavior (not code).
- Orphaned components to be aware of: `MoveCard.tsx`, `FixRackPanel.tsx`, `TriagePlanPanel.tsx` are test-only imports — retire or cannibalize, don't extend.

## Examples

- Prototype: `PRPs/design_handoffs/design_handoff_results_v4/prototype/` — `ar-app.jsx` (tab model/state), `ar-actions.jsx` (dual-mode board, filters, glossary, rating modal), `ar-improve.jsx`/`ar-dawplan.jsx`, `ar-stems.jsx`, `ar-notes.jsx`, `ar-data.jsx` (data shapes). **Reference for behavior/layout only — do not port the JSX.** Ignore prototype chrome (top bar, toast host, Tweaks panel).
- Current code: `features/results/FixBoard.tsx`, `ReportView.tsx`, `results-tabs-model.ts`, `move-model.ts`, `problems-helpers.ts`, `send-to-listen-model.ts`, `ExportModal.tsx`; shared rack renderer `RackView.tsx`/`RackModules.tsx`.
- Source briefs: `PRPs/source/finding-fix-details-design-brief.md`, `PRPs/source/stems-tab-data-brief.md`.

## Documentation

- Handoff README: `PRPs/design_handoffs/design_handoff_results_v4/README.md` (and v3's README for the base).
- Verdict/problem schema: `components/shared/aimusic_shared/verdicts/models.py` (Evidence, Fix, DspOp), `scoring.py`; BFF `DTOs/VerdictDtos.cs`, `Endpoints/VerdictEndpoints.cs`; TS `src/api/types.ts` (VerdictDto ~line 1356).
- Full readiness assessment (2026-07-26): `C:\Users\badmin\.claude\plans\drifting-roaming-creek.md`.

## Other considerations

- All four frontend gates must pass per task (`tsc --noEmit`, lint --max-warnings 0, build, vitest) + `dotnet build && dotnet test` and worker `pytest -q components/worker/tests/` for the priority-breakdown task.
- TS strict + `verbatimModuleSyntax` (`import type`); CSS Modules + global utility classes, no Tailwind; the v3 port added `redesign-v3.css`/`redesign-v3-tabs.css` — extend those, don't fork a new style system.
- The worker mirrors verdict columns in THREE places: EF `Verdict.cs` (canonical) → `aimusic_shared.models.Verdict` → both worker mappers (`degraded._to_row`, `verdict_actor._persist_verdict`) → `VerdictDto`. The priority-breakdown columns must ride through all of them.
- EF Core 10 migration gotcha and dramatiq wire format: see CLAUDE.md.
- Keep the additive-only product philosophy (memory: score is not the product; audio-file-first; .als is bonus tier).
