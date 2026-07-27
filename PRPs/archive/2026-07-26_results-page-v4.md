# PRP — Results Page v4 (delta over v3)

> Source intake: `PRPs/source/INITIAL-results-v4.md` (committed; scope decisions dated 2026-07-26).
> Design handoff: `PRPs/design_handoffs/design_handoff_results_v4/README.md` (delta doc — read v3's README for the base page).
> Every file/line fact below was re-verified against the codebase on 2026-07-26 (branch `feat/results-page-v3-port`). Line numbers may drift a few lines; symbols will not.

## Goal

Port the v4 results-page design into `components/frontend-spectr-v2/src/features/results/`:

1. **Findings/Actions split** — `FixBoard` becomes a dual-mode board (`mode="findings" | "actions"`), plus a priority model rendered end-to-end (P-chips with a real breakdown hover, priority slider filter, source tags, ev2 evidence tables, glossary tooltips, `refines` threading).
2. **One backend change**: persist the priority-score breakdown (`base`, `category_weight`, `scope_multiplier`, `scope`) on every verdict, through all three model mirrors + migration + DTO + TS.
3. **New tabs**: Stems, Notes/Feedback, Improvement Plan (replaces "Create DAW Plan"), plus tab-bar rework (disabled-with-tooltip tabs, right-aligned "hot" group).
4. **Real export generator** — `ExportModal`'s config actually drives the emitted file.

Everything else that needs new backend renders **degraded/hidden** per the stub policy below. Frontend-first.

## Why

- The DTO already carries `confidence, priorityScore, problemId, kind, source, dataTier, fixable, suspected, where, refines` end-to-end — the v3 UI just doesn't render most of them. v4 is largely "render what we already ship."
- Diagnosis-first (Findings) vs fix-first (Actions) matches the product philosophy (memory: score is NOT the product — analysis/suggestions/coaching is; additive-only).
- Stems + Notes/Feedback surface data that already exists (`phase4.stems.*`, `track_comments`, `track_bookmarks`) but has zero UI today.

## What (user-visible)

See the handoff README per-tab. Summary of the delta:

- **Tab bar** — Left: Track Analysis · Project (disabled+tooltip when no .als) · Stems (disabled when no stems) · Reference (omitted when absent) · Notes/Feedback (badge = comment count) · Debug (dev only). Right-aligned hot group: Findings (badge = fault count, alert tint) · Actions (badge = actionable count) · Improvement Plan (badge = plan-log count).
- **Findings tab** — wider severity-grouped list; per-row ignore / ask-the-coach / checkbox (every finding checkable, even fix-less); filter dropdown (Fixable only · group · device/scope · min-priority slider; portal/fixed-positioned, viewport-capped); detail = severity + group chip + source tag ("Measured" vs "AI · <specialist>") + richer why-it-matters with fallback + auto-expanded ev2 table + glossary tooltips + footer "Show Suggested Fix →" deep-link to Actions.
- **Actions tab** — list = fix titles; detail = chip row (severity · group · "Addresses Finding: X" jump-back · source), confidence row, sub-tabs **Applicable Fix** (op-based rack render + add-to-rack toggle) | **Quick DAW Instructions** (steps with device names highlighted + what-to-listen-for), expected outcome, **Mark applied** → ✓ View, **Rate this Suggestion** modal (stubbed). Checked fix-less findings appear as notes. Actions bar: Try Fixes · Create Preset · Coach Mix — each logs to the plan log.
- **Stems tab** — per-stem detail (role, files w/ classifier confidence, level/width/spectral stats, play button), issues linking to Findings, band-level EQ-overlap viz (7 bands + clash matrix — NOT the prototype's fake Gaussian curves).
- **Notes/Feedback tab** — owner notes (existing version-notes CRUD) · listener comments · bookmarks lane · feedback timeline (0:00→end); emoji lane only when session recaps exist, else hidden.
- **Improvement Plan tab** — §1 Listen in Studio (checkable Active fixes + Presets columns → opens Listen Rack with picks); §2 Create DAW Plan (by-move priority-sorted with P-chips, per-device view Master-first, timestamped moments, genre targets, real export).

### Success Criteria

- [ ] `verdicts` table + all three model mirrors + `VerdictDto` (C# and TS) carry `priority_base`, `priority_category_weight`, `priority_scope_multiplier`, `scope`; new rows populate them; old rows read as null and the UI hides the breakdown hover gracefully.
- [ ] P-chip hover shows `base × catW × scopeM = score` from real persisted data (raw scale ~18–300, NOT normalized to 100).
- [ ] Findings and Actions are two tabs sharing one `FixBoard` component; deep-links both ways (finding→fix, fix→finding) work.
- [ ] ev2 evidence table renders typed rows (metric/yours/expected/delta) auto-expanded; rows with `frequency_range_hz` deep-link to the Track Analysis spectrum region.
- [ ] `refines` children nest under parents (revived `groupProblems`); `formatWhere` renders the where-chip.
- [ ] Ignore = server dismiss; Mark applied = server applied; the Listen queue itself NEVER writes server state (78-fixes footgun).
- [ ] Stems tab renders per-stem stats + band-level overlap viz from `phase4.stems` and reference deltas from `phase5.per_stem_reference_deltas`; per-stem audio plays.
- [ ] Notes/Feedback tab: comments + bookmarks lanes real; emoji lane from session recaps or hidden; owner notes via existing version notes.
- [ ] Improvement Plan: Listen-in-Studio picks travel to the Listen Rack (fixes via localStorage contract, one preset via `?fixPreset=`); DAW plan has by-move + per-device views; export honors ALL of ExportModal's config.
- [ ] Coach Mix rationale disclosure renders `coachMeta.change_log` + `arbiter_notes`.
- [ ] Reviewer suggestions appear as "Suggested by <listener>" rows in Actions.
- [ ] All gates green per task (see Validation Loop).

---

## All Needed Context

### Documentation & references

```yaml
# Design (behavior/layout reference ONLY — do not port JSX)
- file: PRPs/design_handoffs/design_handoff_results_v4/README.md
  why: authoritative per-tab delta spec; product decision — device-scoped presets NOT applied to Listen rack
- dir: PRPs/design_handoffs/design_handoff_results_v4/prototype/
  why: ar-app.jsx (tab model), ar-actions.jsx (dual board/filters/glossary/rating modal),
       ar-improve.jsx + ar-dawplan.jsx, ar-stems.jsx, ar-notes.jsx, ar-data.jsx (data shapes).
       Ignore chrome (top bar, toast host, Tweaks panel). ar-assets/coach.svg is a real asset to copy.
- file: PRPs/source/finding-fix-details-design-brief.md
- file: PRPs/source/stems-tab-data-brief.md

# Backend chain (Task 1)
- file: components/shared/aimusic_shared/verdicts/scoring.py        # 54 lines; whole file
- file: components/shared/aimusic_shared/verdicts/models.py         # Evidence L33, DspOp L115, Fix L145, Verdict L166
- file: components/worker/app/verdict_lib/rule_engine.py            # _problem builder L81-128; scope param L92
- file: components/worker/app/verdict_lib/validator.py              # _infer_scope L79; downgrade+rescore L176-197
- file: components/worker/app/verdict_lib/degraded.py               # _to_row mapper L169-209
- file: components/worker/app/verdict_actor.py                      # _persist_verdict L127-163 (mirror of _to_row)
- file: components/shared/aimusic_shared/models.py                  # SQLAlchemy Verdict L349-395
- file: components/bff/src/Spectr.Data/Entities/Verdict.cs          # EF entity (canonical); IDENTIFY cols L83-108
- file: components/bff/src/Spectr.Bff/DTOs/VerdictDtos.cs           # VerdictDto positional record (29 members)
- file: components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs # GET list projection; dismiss/applied/feedback L16-31
- file: components/bff/src/Spectr.Data/Migrations/20260626030953_AddVerdictProblemFields.cs
  why: the exact precedent for adding verdict columns (naming, snapshot regen)

# Frontend core (Tasks 2–6)
- file: components/frontend-spectr-v2/src/api/types.ts              # VerdictDto L1356; ProblemWhere L1348; FixRackCoachMeta L1415
- file: components/frontend-spectr-v2/src/api/hooks.ts              # useVerdicts L623; useApplyVerdict L687; removed-hooks note L698-701
- file: components/frontend-spectr-v2/src/features/results/ReportView.tsx      # orchestrator; footgun comment L131-135; downloadGamePlan L162-173; pickPhaseData L478
- file: components/frontend-spectr-v2/src/features/results/FixBoard.tsx        # 455 lines; single-mode board to split
- file: components/frontend-spectr-v2/src/features/results/results-tabs-model.ts + results-tab-keys.ts
- file: components/frontend-spectr-v2/src/features/results/problems-helpers.ts # dead exports to revive
- file: components/frontend-spectr-v2/src/features/results/move-model.ts       # Move L42-85; verdictToMove L175; moveToMarkdown L337
- file: components/frontend-spectr-v2/src/features/results/ExportModal.tsx     # config UI (currently decorative)
- file: components/frontend-spectr-v2/src/features/results/send-to-listen-model.ts
- file: components/frontend-spectr-v2/src/features/results/helpers/severity.ts # SEVERITY_RANK/label/color
- file: components/frontend-spectr-v2/src/features/listen-rack/listenFixes.ts  # ListenFix contract + storage keys
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx # ?fixPreset= carry-over L260-341
- file: components/frontend-spectr-v2/src/features/results/fix-rack-helpers.ts # RackChain {order, modules, masterBypass}
- file: components/frontend-spectr-v2/src/ui/Coach.tsx               # animated coach; add static export beside it

# Data hooks that already exist (reuse, do not re-create)
- file: components/frontend-spectr-v2/src/features/listen/useComments.ts       # GET/POST /versions/{id}/comments; CommentDto.t = seconds
- file: components/frontend-spectr-v2/src/features/listen/useBookmarkSignal.ts # GET /versions/{id}/bookmarks/signal (owner-only)
- file: components/frontend-spectr-v2/src/features/listen/useSuggestions.ts    # GET/POST /versions/{id}/suggestions; accept/reject
- file: components/frontend-spectr-v2/src/features/listen-rack/useRackPresets.ts
  # hooks.ts also has: useBookmarks L848, useFixRack L675, useGenerateFixRack L662

# BFF surfaces consumed (verified routes)
- file: components/bff/src/Spectr.Bff/Endpoints/FeedbackEndpoints.cs   # comments + suggestions (incl. anon /v/{token})
- file: components/bff/src/Spectr.Bff/Endpoints/BookmarkEndpoints.cs   # GET /versions/{id}/bookmarks/signal → 403 not_owner unless owner
- file: components/bff/src/Spectr.Bff/Endpoints/RackPresetEndpoints.cs # /versions/{id}/rack/presets CRUD; source ∈ user|coach|analysis
- file: components/bff/src/Spectr.Bff/Endpoints/FixRackEndpoints.cs    # GET/POST /reports/{jobId}/fix-rack; GET returns 204 until generated
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs    # /notes CRUD (owner notes), stems list + /stems/{stemId}/audio, rating PUT/DELETE

# Stems data ground truth
- file: components/analysis/tests/integration/golden/phase4_with_stems.json
- file: components/analysis/tests/integration/golden/phase5_with_stems.json
```

### Verified data contracts (trust these; they were read from source)

**Priority scoring** (`scoring.py`): `compute_priority_score(severity, category, scope) -> int` = `round(base × catW × scopeM)`.
`_BASE_SEVERITY = {critical:200, severe:120, moderate:70, minor:30, win:20}`; `_CATEGORY_WEIGHT = {clipping:1.5, loudness:1.4, mono_compatibility:1.4, low_end:1.3}` (all others 1.0); `_SCOPE_MULTIPLIER = {full_track:1.0, multi_section:0.9, single_section:0.7, single_stem:0.6}`.
**Scale is unbounded** — real range ≈ 18 (minor·single_stem) to 300 (critical·clipping·full_track). The INITIAL's "TS comment claims 0–100" premise was wrong — there is NO such comment on `VerdictDto.priorityScore`; the actual 0–100 coupling is `move-model.ts:201` `impact = clampImpact(v.priorityScore)` (clamps to 0..100) with `impactBand` thresholds 75/45. **Decision: keep raw score for P-chips/slider; leave `impact` clamping as-is** (it feeds a different UI concept). Do not renormalize the formula.

**Who computes scores where**: `rule_engine._problem` (L102) scores at creation — but `scope` (L92) is defaulted `"full_track"` and **no rule ever overrides it** (rule-engine problems all score at ×1.0 today; that's fine, persist it anyway). For LLM verdicts, `validator.py` derives scope via `_infer_scope` (fix-less→full_track; fix.section→single_section; fix.target.type=="stem"→single_stem; never multi_section) and **recomputes/downgrades** at L176-197 — the breakdown must be (re)stamped there too, or LLM verdicts will show a stale breakdown.

**Evidence rows** (Python `Evidence`, models.py L33): `{metric: str, value: float|None, expected_range: (lo,hi)|None, delta_pct: float|None, label: str (required), frequency_range_hz: (lo,hi)|None, stems: list[str]|None}`. Persisted as jsonb list; arrives in TS as `evidence: unknown`.

**TS `VerdictDto`** (types.ts L1356): already has all IDENTIFY fields + `confidence`, `priorityScore`, `where: ProblemWhere|null` (`{section_type?, start_seconds?, end_seconds?, track_names?}` — snake_case passthrough), `userState: {dismissed, applied, feedback: 'helpful'|'wrong'|'unclear'|null}`.

**FixRack**: `GET /reports/{jobId}/fix-rack` → 204 until generated; `FixRackDto` TS = `{presetId?, name, chain, createdAt, coachMeta?: FixRackCoachMeta|null}`; `FixRackCoachMeta = {change_log?: {module, change, why?}[], arbiter_notes?: string|null, degraded?, leftover_advice?}`. (INITIAL said "judgment_calls" — the shipped TS field is `arbiter_notes`. Render change_log + arbiter_notes.)

**Listen handoff contract** (`listenFixes.ts`): `ListenFix {fixId, verdictId, title, scope, sev, specialist, ops: VerdictDspOp[], notApplicable?}`; localStorage `listenFixes:{versionId}` stored as `{fixes: [...]}`; applied-set at `listenApplied:{versionId}`. `?fixPreset=<presetId>` is consumed by `ListenRackPage.tsx` (one-shot apply, param stripped from URL). Producers today: `FixRackPanel.tsx:55` (orphaned), `SendToListenCard.tsx:34`.

**phase4/phase5 stems shapes** (from golden fixtures — these are the real key names):
- `final_json.phases` is a **LIST** `[{phase, name, data, status}]` — the only extractor is private `pickPhaseData<T>(fj, n)` in `ReportView.tsx:478-480`.
- `phase4.stems` = `{status: "ok", mode: "grouped", balance_flags: [], per_stem: {<role>: {...}}, clash_matrix: [...]}`.
- `per_stem` is a **dict keyed by role**; each value: `{lufs_integrated, rms_db, peak_db, dynamic_range_db, spectral_centroid_hz, stereo_width, pan_estimate, is_mono, band_energy_db: {sub, bass, low_mid, mid, high_mid, presence, air}, dominant_frequencies_hz: number[], duration_s}`.
- **Band-key inconsistency**: top-level `phase4.band_energy` uses `sub_bass`; per-stem `band_energy_db` uses `sub`. Don't share one key list.
- `clash_matrix[]` = `{stem_a, stem_b, band, overlap_severity: float, severity_tier: "warning"|...}`.
- `phase5.per_stem_reference_deltas` is a **flat LIST** of one row per (role, metric): `{role, metric, user_value, reference_value, delta, severity_tier, interpretation}`; `metric` includes dotted `band_energy_db.sub` etc. Group by role client-side.

**Comments/bookmarks**: `CommentDto {id, targetVersionId, parentId?, t?: number (seconds), author: ActorRefDto, body, status, suggestionId?, createdAt}` (threaded via parentId; statuses open/resolved/pinned/hidden). `BookmarkDto` has `timestamp_seconds`, `note (≤280)`, `identity_visible`. `GET /versions/{id}/bookmarks/signal` → `{count, identified: ActorRefDto[]}` — **owner-only (403 not_owner)**; results page is owner-scoped so fine, but guard the query with the owner check anyway.

**Reviewer suggestions**: entity `suggestions` (`status ∈ proposed|auditioned|accepted|rejected`, `chain_json`); routes `GET/POST /versions/{id}/suggestions`, `POST /suggestions/{id}/accept` (returns `RackPresetDto`), `POST /suggestions/{id}/reject`. Hooks exist in `features/listen/useSuggestions.ts`.

**Session recaps** (emoji stub source): `listening_sessions.recap_json` is exposed only in the room-session projection (`RoomEndpoints.cs` L157-159) and the feed — **there is no per-version recap-list endpoint**. The listen-rack v2 session sidebar lists sessions for a version — find the hook/endpooint it uses under `features/listen-rack/` and reuse it; read `recap_json` off ended sessions. If no per-version session list is reachable from the results page, **hide the emoji lane entirely** (explicitly allowed by the stub policy). Do NOT add a backend endpoint for this.

### Known gotchas (beyond CLAUDE.md)

```text
# 1. Two hand-maintained worker row mappers: verdict_actor._persist_verdict (L127) and degraded._to_row (L169)
#    are structurally identical but ONLY _to_row is under test (test_degraded_path.py). Adding the four new
#    fields to one and not the other will pass CI. Add a field-parity test (Task 1.7).
# 2. components/shared/tests/test_verdict_scoring.py pins SIX exact score literals (300/168/64/18/20/70).
#    Do NOT change the weight tables or the compute_priority_score signature/behavior — add a NEW
#    breakdown function and have the old one delegate.
# 3. The 78-fixes-queued footgun (ReportView.tsx:131-135): the Listen queue is localStorage-only BY DESIGN.
#    Checkbox/queue toggles must never call POST /verdicts/{id}/applied. Only the explicit "Mark applied"
#    button writes server state; "ignore" writes /dismiss.
# 4. Verdict.cs `where` is a SQL reserved word (already handled in the entity) — follow the existing
#    column-mapping pattern for any new columns; snake_case mapping throughout.
# 5. VerdictDto is a POSITIONAL C# record with 29 members consumed by projection in VerdictEndpoints.cs —
#    append new members and update every construction site (compiler will find them).
# 6. Pydantic Verdict/Evidence models use extra="forbid" — new fields must be declared with defaults
#    (Optional, default None) or every existing fixture/test payload breaks.
# 7. FixBoard.tsx has its OWN op-based RackModule renderer (L82-105). RackView.tsx ("THE shared renderer",
#    chain-shaped) and RackModules.tsx (MoveStep-shaped) are BOTH transitively orphaned (only reachable via
#    orphaned FixRackPanel/MoveCard). For Actions' Applicable Fix sub-tab, promote FixBoard's op-based
#    renderer into its own module — do NOT resurrect RackView/RackModules for ops they weren't shaped for.
# 8. Tab-key back-compat: results-tab-keys.ts still accepts 'findings' as a deep-link key; ReportView
#    coerces findings→coach (L67-72). Keep 'coach' as the Findings tab id; add new keys additively.
# 9. ExportModal keeps ALL config in local state and calls a zero-arg onDownload. The fix is to change the
#    callback contract to pass a config object out (Task 6), not to lift the state into ReportView wholesale.
# 10. Old verdict rows will have NULL breakdown columns. TS types must be `number|null` and the P-chip
#     hover must degrade to score-only. Do not backfill.
# 11. `evidence`/`sources`/`where` ride as jsonb→JsonElement→unknown. Write narrowing parsers
#     (parseEvidenceRows(v.evidence): EvidenceRow[]) — never cast `as` blindly; malformed legacy rows exist.
# 12. Frontend gates: TS strict + verbatimModuleSyntax (`import type`), lint --max-warnings 0.
#     CSS: extend redesign-v3.css / redesign-v3-tabs.css (imported by ReportView.tsx:50-51). No new style system.
# 13. Per-stem audio: GET /versions/{id}/stems/{stemId}/audio needs the ?t=<jwt> query-param pattern
#     (HTMLMediaElement can't set headers) — mirror how ResultsPlayer/audioUrl builds it.
```

---

## Implementation Blueprint

Ordering: Task 1 (backend) is independent — do it first so the frontend can render real breakdowns. Task 2 (tab model + board split) is the foundation for 3–6. Tasks 3/4/5 are independent of each other. Task 6 last.

### Task 1 — Priority-breakdown persistence (the one backend item)

1. **`components/shared/aimusic_shared/verdicts/scoring.py`** — add:
   ```python
   @dataclass(frozen=True)
   class PriorityBreakdown:
       score: int; base: int; category_weight: float; scope_multiplier: float; scope: str

   def compute_priority_breakdown(severity, category, scope) -> PriorityBreakdown: ...
   ```
   `compute_priority_score` delegates to it (return `.score`) — signature/values unchanged (gotcha #2).
2. **`aimusic_shared/verdicts/models.py`** — pydantic `Verdict` gains optional fields (defaults None): `priority_base: Optional[int]`, `priority_category_weight: Optional[float]`, `priority_scope_multiplier: Optional[float]`, `scope: Optional[str]`.
3. **`rule_engine.py `_problem`** — call `compute_priority_breakdown(...)` (L102) and stamp all four fields alongside `priority_score`.
4. **`validator.py`** — in the recompute/downgrade block (L176-197) and the deterministic-recompute path (L176-180), stamp the breakdown from the same call that produces the final score (scope from `_infer_scope`). Every verdict that leaves the validator has score ≡ base×catW×scopeM consistent.
5. **`aimusic_shared/models.py`** SQLAlchemy `Verdict` (L349-395) — add nullable columns `priority_base Integer`, `priority_category_weight Float`, `priority_scope_multiplier Float`, `scope String(20)`.
6. **Both worker mappers** — `degraded._to_row` AND `verdict_actor._persist_verdict`: map the four fields.
7. **New parity test** (worker or shared tests): import both mapper modules, build one `VerdictModel`, assert the set of attributes each mapper sets is identical (kills gotcha #1 permanently). Plus: extend `test_degraded_path.py`-style coverage to assert the four new fields persist; extend `test_verdict_scoring.py` with breakdown assertions (e.g. `("critical","clipping","full_track") → base=200, catW=1.5, scopeM=1.0, score=300`) WITHOUT touching existing literals.
8. **EF**: `Verdict.cs` — four new nullable properties, snake_case-mapped (`priority_base`, `priority_category_weight`, `priority_scope_multiplier`, `scope`); scaffold migration `AddVerdictPriorityBreakdown` (mirror `20260626030953_AddVerdictProblemFields`; plain nullable columns — no manual SQL step needed; snapshot regenerates). `dotnet ef migrations add ... --project src/Spectr.Data --startup-project src/Spectr.Bff`.
9. **`VerdictDtos.cs`** — append `int? PriorityBase, double? PriorityCategoryWeight, double? PriorityScopeMultiplier, string? Scope` to `VerdictDto`; update the projection in `VerdictEndpoints.cs` (compiler-driven).
10. **TS `types.ts`** — mirror on `VerdictDto`: `priorityBase: number|null; priorityCategoryWeight: number|null; priorityScopeMultiplier: number|null; scope: string|null;`. Add a doc comment stating the raw score scale (~18–300, unbounded).

### Task 2 — Tab model + FixBoard dual-mode (Findings/Actions split)

1. **`results-tab-keys.ts`** — add keys: `'actions' | 'stems' | 'notes' | 'dawplan'` (keep `'findings'` alias → coerced to `coach` in ReportView; keep `DEFAULT_RESULTS_TAB='coach'`).
2. **`results-tabs-model.ts`** — `TabDef` gains `disabled?: boolean; tooltip?: string; hot?: boolean;`. `buildResultsTabs` opts gain `hasStems, stemIssueCount?, commentCount, actionableCount, planLogCount`. Emit order: trackinfo · project (always present; `disabled: !hasProject`, tooltip "Upload the .als project to unlock") · stems (always present; `disabled: !hasStems`) · reference (still conditional-hidden) · notes (badge commentCount) · debug (dev) — then hot group: coach ("Findings", badge findingCount, alert) · actions (badge actionableCount) · dawplan ("Improvement Plan", badge planLogCount). Update the model's unit test.
3. **`ResultsTabs.tsx`** — render `disabled` (non-clickable + tooltip) and the right-aligned `hot` group. Styling in `redesign-v3-tabs.css` (hot = stand-out tint; alert tint on Findings badge).
4. **Typed evidence** — new `features/results/evidence-model.ts`: `EvidenceRow` interface mirroring the Python `Evidence`; `parseEvidenceRows(evidence: unknown): EvidenceRow[]` narrowing parser (tolerant of legacy rows). Unit-test with a real evidence payload + garbage input.
5. **Revive dead helpers** (`problems-helpers.ts`): `groupProblems` (refines threading), `TIER_LABEL`, `formatWhere` — wire into FixBoard findings mode. They already have tests.
6. **`FixBoard.tsx` → dual-mode.** Add `mode: 'findings'|'actions'` prop (+ callbacks: `onShowFix(verdictId)`, `onShowFinding(verdictId)`, `onAskCoach(verdict)`, plan-log logger). Keep it under ~500 lines by extracting: `FixBoardFilters.tsx` (dropdown: fixable-only · group checkboxes · device/scope checkboxes (distinct `move.scope` values) · min-priority slider on raw `priorityScore`; `position: fixed` + viewport-capped max-height, closes on outside click), `FindingDetail.tsx`, `ActionDetail.tsx`, `OpRack.tsx` (promoted from FixBoard's local `RackModule`/`MODULE_META`, op-based).
   - **Findings mode**: severity-grouped list (existing) but rows show P-chip, where-chip (`formatWhere`), suspected badge, source glyph; refines children nested (indented under parent). Per-row: ignore (→ restored dismiss hook; dims row + hides its action), ask-the-coach (static coach icon → existing coach entry point), checkbox (tooltip "A suggested fix is available" / for fix-less: "Add as a note to Actions"). Detail: chips (severity, group color via existing `groupForVerdict`, tier `TIER_LABEL`), source tag ("Measured" when `source==='rule_engine'`, "AI · {specialist}" when `source==='llm_identifier'`), why-it-matters with fallback copy map (port `arDefaultWhy` behavior), ev2 table auto-expanded with plain-language caption, glossary tooltips, footer: "Applicable Fix Available" + "Show Suggested Fix →" (calls `onShowFix`).
   - **Actions mode**: list rows = `move.title` for moves with fixes, sorted by `priorityScore` desc within severity; plus "note" rows for checked fix-less findings. Detail: chip row incl. "Addresses Finding: {headline}" (→ `onShowFinding`), confidence % row, sub-tabs Applicable Fix (`OpRack` + add-to-Listen-queue toggle — queue only, gotcha #3) | Quick DAW Instructions (`move.steps` with device-name `<em>` highlight + `fix.expected_outcome` as "what to listen for" framing), Expected outcome block, action row: Mark applied (`useApplyVerdict`, flips to ✓ View) · Rate this Suggestion (modal below).
7. **Glossary** — `features/results/glossary.tsx`: `GLOSSARY: Record<string,string>` (~10 terms: LUFS, True Peak, dBTP, crest factor, mono compatibility, stereo width, spectral centroid, sidechain, headroom, transient) + `<Glossify text>` that wraps known terms in a tooltip span. Pure frontend.
8. **Restore hooks** (`api/hooks.ts` — note at L698-701): re-add `useDismissVerdict(jobId)` and `useFeedbackVerdict(jobId)` (POST `/verdicts/{id}/dismiss` | `/feedback`, invalidate `['verdicts', jobId]`), mirroring `useApplyVerdict`.
9. **Rating modal** (stub policy): 1–10 slider + notes UI; on submit map to the enum the server accepts (`>=6 → 'helpful'`, else `'wrong'`; free-text kept client-side under localStorage `fixRating:{verdictId}` with a `// TODO(backend): rich rating payload` marker) via `useFeedbackVerdict`.
10. **Ev2 → spectrum deep-link**: rows with `frequency_range_hz` render a link chip that switches to the `trackinfo` tab and passes the band range via the existing `track-highlight.ts` mechanism (read it first; extend minimally if it only handles time ranges).
11. **ReportView wiring**: render FixBoard twice (once per tab) with shared state lifted: `committedIds` (existing), `checkedNoteIds` (new, localStorage `findingNotes:{versionId}`), active-verdict cross-links, plan log (Task 5's `plan-log.ts`, created here as a tiny module: `readPlanLog/appendPlanLog` on `planLog:{versionId}` — entries `{ts, kind, label}`).
12. **Static coach icon**: copy `prototype/ar-assets/coach.svg` → `src/ui/coach-static.svg`, export `<CoachStatic size>` from `ui/Coach.tsx` (an `<img>`/inline-svg wrapper; animated `Coach` untouched).

### Task 3 — Stems tab

1. **`StemsTab.tsx`** (+ `stems-model.ts` helpers, `__tests__/stems-model.test.ts`). ReportView extracts `phase4 = pickPhaseData<Phase4Data>(fj, 4)` and `phase5` already — pass `phase4.stems` + `phase5.per_stem_reference_deltas` down as props (follow the existing per-tab prop pattern; don't invent a context).
2. **Model helpers**: `stemEntries(per_stem)` (dict→sorted array; role order kick/bass/drums-ish first), `deltasByRole(deltas)` (flat list→Map), `clashesForRole(clash_matrix, role)`, `STEM_BAND_KEYS = ['sub','bass','low_mid','mid','high_mid','presence','air']` (per-stem key set — NOT `sub_bass`).
3. **Layout**: findings-style sidebar (stem rows: role, mini level bar from `rms_db`, clash-count badge) → detail: stats grid (LUFS, RMS, peak, DR, centroid, width, pan, mono badge), files with classifier confidence (from the existing stems proposals endpoint `GET /versions/{id}/stems` — reuse the polling hook family from the stems upload flow, e.g. `useStemProposals`; render role + confidence per file), play button per stem → `<audio>` with `GET /api/versions/{id}/stems/{stemId}/audio?t=<jwt>` (gotcha #13).
4. **Overlap viz (redesigned — the prototype's Gaussians are fake, do not port)**: a 7-band × N-stem grid — each cell tinted by that stem's `band_energy_db[band]`; `clash_matrix` entries draw a highlighted connector/outline on the two stems' cells in the clashing `band`, labeled with `overlap_severity` + `severity_tier`. Also list `balance_flags[]` as pills. Pure CSS/inline-SVG; no charting lib needed.
5. **Issues → Findings links**: verdicts where `dataTier === 'stems'` or `where.track_names`/evidence `stems` mention the role — row links call the same tab-switch used by "Show Suggested Fix".
6. **Reference deltas**: when `phase5.per_stem_reference_deltas` exists, per-stem detail shows a deltas table (metric / yours / ref / delta / `interpretation`), severity-tinted via `severity_tier`.
7. Tab enablement: `hasStems = phase4?.stems?.status === 'ok'`; disabled tooltip "Upload stems to unlock per-stem analysis".

### Task 4 — Notes/Feedback tab

1. **`NotesTab.tsx`** (+ `feedback-timeline-model.ts` with tests). Data: comments via `features/listen/useComments.ts` (owner path), bookmarks via hooks.ts `useBookmarks`/`useBookmarkSignal`, owner notes via the **existing version-notes CRUD** (`VersionEndpoints.cs` `/notes` — find/reuse its hook from song-detail before writing a new one), duration from `phase1.duration_seconds`.
2. **Sections**: (a) Your notes — version notes list + composer; (b) Listener comments — threaded list (name from `ActorRefDto` displayName/handle, `t` rendered m:ss, status pills; use numeric `t`, never parse strings); (c) Feedback timeline.
3. **Timeline** (`feedback-timeline-model.ts` pure functions + component): 0→duration strip; comment lane (markers at `t`, hover = who/when/body snippet); bookmarks lane (markers at `timestamp_seconds`, note on hover); emoji lane ONLY when session recaps are reachable — reuse whatever hook the listen-rack session sidebar uses to list this version's sessions, read `recap_json` events off ended sessions, plot emoji at their track positions + smoothed density curve (simple binned counts → moving average → SVG path). No recap source ⇒ lane hidden, no placeholder.
4. Badge: `commentCount` into `buildResultsTabs`.
5. Timestamp markers click → seek the results player (if `ResultsPlayer` exposes a seek — check; otherwise skip, don't hack).

### Task 5 — Improvement Plan tab

1. **`ImprovementPlanTab.tsx`** under key `dawplan`. Two sections.
2. **Listen in Studio**: two checkable columns — Active fixes (seed = current `committedIds` queue; rows show P-chip + scope chip) and Presets (user presets via `useRackPresets` + Coach Mix via `useFixRack` when 204→data; radio-select at most ONE preset — the rack applies a single chain; document this vs the prototype's unbounded picks). Coach Mix row gets the **rationale disclosure**: collapsible "Why the Coach chose these" rendering `coachMeta.change_log[]` (module/change/why) + `arbiter_notes`. Button "Listen in Studio (n)" (disabled at 0): writes the checked fixes via `writeListenFixes(versionId, ...)` (the existing contract — Improvement-Plan picks and the Actions queue are the SAME store, so picks travel by construction) then navigates to the listen-rack route, appending `?fixPreset=<id>` when a preset is selected. Device-scoped presets are NOT offered here (master-chain only — recorded product decision); device-scoped moves appear only in the DAW plan.
3. **Create DAW Plan** section: status strip (specialists run/suggested, findings count, fixes selected/suggested — reuse `triage-plan.ts` helpers if they fit); **By move** view: priority-sorted rows with orange P-chips (hover = breakdown when persisted fields present); **Per device** view: group committed moves by `move.scope` with Master first, each row "Master"/"Device: <name>" + originating fix + P-chip; **Timestamped moments**: findings with `where.start_seconds` rendered `formatWhere` style, sorted by time; **Genre targets**: rows derived from committed verdicts' `evidence.expected_range` (metric, target range, yours) — no genre-targets API (stub policy); non-fixable checked findings as a manual-notes footnote.
4. **Actions bar** (lives on the Actions tab, wired here): Try Fixes (→ same Listen handoff), Create Preset (compile queued master-scope ops into a `RackChain {order, modules}` via `fix-rack-helpers` conventions and `POST /versions/{id}/rack/presets` through `useRackPresets().save`), Coach Mix (`useGenerateFixRack` → poll `useFixRack`). Every action `appendPlanLog(versionId, {kind, label})`; plan-log count badges the tab. localStorage only (stub policy).
5. **Reviewer suggestions in Actions**: `useSuggestions(versionId)` — `status==='proposed'` rows render in the Actions list as "Suggested by {displayName}" with chain preview (`OpRack` can't render chains — use the module names from `chain_json` order) + Accept (→ becomes a preset, invalidate presets query) / Reject.

### Task 6 — Real export generator

1. **`features/results/export-generator.ts`** (pure, heavily unit-tested): 
   ```ts
   export interface ExportConfig { format: 'md'|'txt'; detail: 'brief'|'standard'|'detailed';
     order: 'order'|'area'; opts: Record<'facts'|'params'|'data'|'targets'|'coach'|'perDevice', boolean>;
     selectedIds: ReadonlySet<string>; }
   export function generateGamePlan(cfg, moves: Move[], facts: ExportFacts, extras: {...}): { filename: string; mime: string; content: string }
   ```
   Honors: per-fix selection, order (priority order vs grouped by area/scope), detail (brief = titles+directives; standard += steps/why; detailed += evidence data + params), opts.facts (BPM/key/LUFS/genre header), opts.params (op params), opts.data (ev2 rows), opts.targets (streaming targets — keep ExportModal's static table), opts.coach (coach framing lines), **new opts.perDevice** (actions-per-device section mirroring Task 5.3). `txt` = markdown stripped of syntax. **Drop `'pdf'` from the format options** (decision: md/txt now; PDF deferred — remove the radio, leave a comment).
2. **`ExportModal.tsx`**: change `onDownload: () => void` → `onDownload: (cfg: ExportConfig) => void`; add the perDevice toggle; preview uses the same generator (delete the bespoke preview builder — one source of truth).
3. **`ReportView.tsx`**: `downloadGamePlan(cfg)` calls the generator, downloads with correct extension/mime. `moveToMarkdown` stays only if the generator reuses it internally; otherwise retire it (update its tests).
4. Tests: brief/standard/detailed snapshots, selection filtering, per-device grouping (Master first), txt stripping, empty-selection guard.

### Cleanup (ride-along, end of Task 2/5)

- Retire orphans once their useful organs are harvested: `MoveCard.tsx` + `RackModules.tsx`, `FixRackPanel.tsx` + `RackView.tsx` + `DeviceModule.tsx`, `TriagePlanPanel.tsx` — delete each WITH its module.css and test file, but only after confirming the new surfaces cover their behavior (SendToListenCard stays — it's live). If uncertain about one, leave it and note it; do not extend them.

---

## Validation Loop

### Per-task frontend gates (Tasks 2–6; run all four, all green)
```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint      # --max-warnings 0
cd components/frontend-spectr-v2 && npm run build
cd components/frontend-spectr-v2 && npx vitest run
```

### Task 1 gates (backend chain)
```bash
pytest -q components/shared/tests/                    # scoring literals must still pass untouched
pytest -q components/worker/tests/                    # incl. new mapper-parity test
ruff check components/worker/ components/shared/
mypy components/worker/app/ --ignore-missing-imports
cd components/bff && dotnet build && dotnet test
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

### Integration smoke (after Tasks 1–2, and again at the end)
```bash
# Start per docs/STARTUP.md: ./scripts/start-spectr.ps1
# Upload a track with stems + reference, let analysis complete, then verify:
#  - GET /api/reports/{jobId}/verdicts returns priorityBase/priorityCategoryWeight/priorityScopeMultiplier/scope on fresh verdicts
#  - Findings tab: P-chip hover breakdown; ignore → row dims and userState.dismissed persists on reload
#  - Actions tab: Mark applied persists; add-to-rack does NOT flip applied (footgun check)
#  - Stems tab enabled, per-stem audio plays; Notes tab shows a posted comment on the timeline
#  - Improvement Plan → Listen in Studio opens /listen-rack with queued fixes present (+ preset when selected)
#  - Export: 'brief'+deselect-one produces a file matching the config (open it)
```

## Final validation checklist

- [ ] All gates above green; no `any`-casts on evidence/where/coachMeta paths (narrowing parsers only)
- [ ] Old verdict rows (null breakdown) render score-only chips without errors
- [ ] `test_verdict_scoring.py` original six literals untouched and passing
- [ ] Mapper-parity test exists and passes
- [ ] Tab deep-links: `?tab=findings` still lands on Findings (coerced); new keys round-trip
- [ ] No new top-level style system; additions live in redesign-v3*.css / component module.css
- [ ] Orphan components removed or explicitly noted as deferred

## Anti-patterns to avoid

- **Do not port the prototype JSX/CSS** — behavior/layout reference only. Ignore its chrome, its two incompatible preset shapes, its `m:ss` string parsing, and its display-string racks (our `ops: VerdictDspOp[]` are strictly better).
- **Do not port the EQ-overlap Gaussian viz** — it is 100% synthetic. Band-level grid from real `band_energy_db` + `clash_matrix` only. No analysis-pipeline changes.
- **Do not write server state from queue toggles** (78-fixes footgun) — queue is localStorage; only Mark-applied/ignore/rate hit the server.
- **Do not change `compute_priority_score` semantics** or the weight tables — six pinned test literals + UI banding depend on them.
- **Do not renormalize the score to 0–100** — raw scale is the product surface now; `clampImpact` stays as the separate impact-band input.
- **Do not extend MoveCard/FixRackPanel/TriagePlanPanel/RackView/RackModules** — cannibalize and retire.
- **Do not add backend surface beyond Task 1** — no reactions table, no rich-rating endpoint, no plan-log table, no genre-targets API, no per-version recap endpoint. Stubs per policy.
- **Do not invent a shared phase-extraction context** — follow the existing `pickPhaseData` + props-down pattern.
- **Do not backfill breakdown columns** — nullable + graceful UI.

---

**Confidence score: 8.5/10** for one-pass implementation success. Every data contract, route, hook, and gotcha above was verified against source this session; the main residual risks are (a) the exact hook the listen-rack session sidebar uses for per-version sessions (Task 4.3 — has an explicit fallback: hide the lane), and (b) FixBoard refactor size discipline (mitigated by the prescribed component extraction).
