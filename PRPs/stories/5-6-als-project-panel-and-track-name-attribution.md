# Story 5.6: .als Project Panel & Track-Name Attribution

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Ableton producer,
I want verdicts that name my actual project tracks,
So that I know exactly where to click in my DAW.

## Acceptance Criteria

1. **Given** an .als-attached analysis, **When** the report renders, **Then** the .als panel shows the project structure summary (FR4). _(Already shipped — regression-guard only.)_
2. **Given** project-attributed verdicts (FR12), **When** rendered, **Then** track-name chips (e.g. `SUB-DEEP`) highlight cyan inside verdict text **And** clicking a chip navigates to the .als (Project) panel.
3. **Given** no .als attached, **When** the panel area renders, **Then** it shows the unlock invitation with a benefit chip instead of plain placeholder text.

## Context — what already ships (verified 2026-06-27, code-truth)

This story **closes out** a mostly-built story. Do NOT rebuild AC1. Verified state:

| AC | Status | Evidence |
|---|---|---|
| 1 | ✅ DONE | `ProjectTab.tsx:20–66` renders intro + health/arrangement/tracks cards (health ring, device chains) from `phase8` data. |
| 2 | ❌ MISSING | `VerdictCard.tsx:88/90/92` render `headline`/`summary`/`body` as **plain text** (`{verdict.headline}`). No chip injection, no `TrackChip` component anywhere. Backend embeds track names in prose only (not machine-readable). |
| 3 | 🟡 PARTIAL | `ReportView.tsx:298` shows plain text "No Ableton project was uploaded…"; missing the `UnlockZone`-style CTA + benefit chip. |

## Tasks / Subtasks

- [ ] **Task 1: Worker — emit structured track attribution on `.als` verdicts (AC: 2)**
  - [ ] 1.1 Audit every rule in `components/worker/app/verdict_lib/` carrying `data_tier="project_midi"` that references a track name. Confirmed two so far: `robotic_velocity` (~`rule_engine.py:1469`, extracts `worst_name` from `phase8.per_track_analysis`) and `lifeless_at_source` (~`rule_engine.py:1284`, names up to 3 tracks in `summary`). **Grep `per_track_analysis` and `track_name` across `verdict_lib/` to find any others** — do not assume the list is complete.
  - [ ] 1.2 For each such rule, populate the existing `where` payload with an optional `track_names: list[str]` of the attributed track name(s) it already computed (e.g. `robotic_velocity` → `["<worst_name>"]`; `lifeless_at_source` → the `robotic[:3]` list). Today these pass `where=None` — keep all other `where` keys (`section_type`, `start_seconds`, `end_seconds`) optional/absent when not applicable.
  - [ ] 1.3 **No DB migration required.** `where` is a `jsonb` string column (`Verdict.cs:104`) whose shape is not schema-enforced; you are adding a key to the serialized dict, not a column. Verify the worker's verdict mapper (`degraded._to_row` / `verdict_actor._persist_verdict`) serializes the full `where` dict verbatim (it already does for the section keys).
  - [ ] 1.4 Add/extend a unit test in `components/worker/tests/` asserting that a `project_midi` rule fixture with named tracks emits `where.track_names == [...]`.

- [ ] **Task 2: Frontend types — surface `track_names` on the verdict `where` (AC: 2)**
  - [ ] 2.1 In `components/frontend-spectr-v2/src/api/types.ts`, extend the `ProblemWhere` type (consumed by `VerdictDto.where`, ~`types.ts:1218–1250`) with `track_names?: string[]`. Keep it optional — most verdicts have no track attribution. No BFF DTO change is needed: `VerdictDto.Where` already passes the jsonb through as `JsonElement?` (`VerdictDto.cs:41`).

- [ ] **Task 3: Frontend — `TrackChip` + inline highlight in verdict text (AC: 2)**
  - [ ] 3.1 Create `components/frontend-spectr-v2/src/features/results/TrackChip.tsx` — a cyan chip for a track name. Reuse the global `.pill` utility (tone cyan) and mirror the **existing `EvidenceChips` pattern** (`CoachChat.tsx:488`: cyan `Pill`, click → scroll/navigate). Props: `{ name: string; onActivate: () => void }`.
  - [ ] 3.2 In `VerdictCard.tsx`, where `headline`/`summary`/`body` render (lines 88/90/92), tokenize each string against `verdict.where?.track_names`: split on exact-name occurrences and wrap matches in `<TrackChip>`, leaving the rest as text. Use the authoritative `track_names` strings — **do NOT** fuzzy-match arbitrary words (avoids false positives like the word "bass" matching a "Bass" track). Render plain text unchanged when `track_names` is empty/absent.
  - [ ] 3.3 `onActivate` switches the results tab to **Project** via the URL tab param (`?tab=project`, the mechanism `ResultsTabs` already uses). If a lightweight scroll-into-view of the matching track row in `ProjectTab` is feasible, add it; otherwise tab-switch alone satisfies "link to the panel."
  - [ ] 3.4 Static-render unit test (existing vitest style, `renderToStaticMarkup`): a verdict with `where.track_names=["SUB-DEEP"]` and `headline` containing `SUB-DEEP` renders a `TrackChip`; a verdict with no `track_names` renders plain text (no chip).

- [ ] **Task 4: Frontend — no-.als unlock invitation (AC: 3)**
  - [ ] 4.1 Replace the plain placeholder at `ReportView.tsx:298` (the "No Ableton project was uploaded…" branch) with an unlock-invitation block following the established `UnlockZone` pattern (`AnalysisTab.tsx:864–876`: title + description + hint + benefit chip). Copy tone: invite re-upload with the .als; benefit chip e.g. "Track-named fixes". Keep it in `ProjectTab`/`ReportView` consistent with how other tabs render their locked state.
  - [ ] 4.2 Static-render test: with no `phase8`/`alsProject`, the Project tab renders the unlock invitation (benefit chip present), not the plain placeholder.

- [ ] **Task 5: Gates (AC: all)**
  - [ ] 5.1 Worker: `pytest -q components/worker/tests/`.
  - [ ] 5.2 Frontend (all four, per CLAUDE.md): `npx tsc --noEmit`, `npm run lint` (`--max-warnings 0`), `npm run build`, `npx vitest run`.

## Dev Notes

### Data sources (verified)
- **.als track names** live at `phase8.data.tracks[].name` and `phase8.data.midi_analysis[].track_name` (worker `phase8_als.py`), exposed in `final_json` and flattened into the analysis dict rules consume. Rules also read `phase8.per_track_analysis` (dict keyed by track name).
- **Frontend .als types:** `AlsProjectTrack` (`types.ts:839–845`, `{index, name, type, devices[]}`), `AlsProjectJson` (`types.ts:847–859`), `Phase8Data` (`types.ts:1102–1134`). `ProjectTab` already consumes these for AC1.

### Why structured `where.track_names`, not frontend text-matching
FR12 says attribute "where **determinable**." The worker already knows the exact offending track (it computed `worst_name`/`robotic[:3]`), so it must emit that — the frontend then highlights only those authoritative strings. Frontend-only matching against the full `.als` track list would produce false positives (common words = track names) and miss paraphrased attributions. This also stays consistent with the project's single-source-structured-data stance (see project memory `final-json-schema-drift`). The `where` field is the natural carrier — it's the localization slot and is already persisted end-to-end (problem-engine-reconcile-persist), so **no migration, no new column**.

### Regression guards
- AC1 (`ProjectTab` structure summary) is shipped — don't refactor it; just confirm it still renders.
- The `where` section keys (`section_type`/`start_seconds`/`end_seconds`) are used elsewhere — **add** `track_names`, don't replace the shape. Verdicts with section-timing `where` and no track attribution must be unaffected.
- Verdict provenance: rule-engine findings already carry a `RULE` chip (UX-DR42); the new `TrackChip` is additive to the verdict body, not a replacement for the persona/RULE chip row.

### Project Structure Notes
- New component `TrackChip.tsx` lives in `features/results/` beside `VerdictCard.tsx` (feature-folder rule). CSS via a `*.module.css` or the global `.pill` utility — no inline styles except dynamic color.
- TS strict + `verbatimModuleSyntax`: `import type` for the `ProblemWhere` type import.

### References
- AC source: [PRPs/epics.md#Story 5.6] (lines 905–916); FR4/FR12 [PRPs/prd.md] (lines 304 / 315).
- Verdict render: `components/frontend-spectr-v2/src/features/results/VerdictCard.tsx:88-92`.
- Evidence-chip precedent: `CoachChat.tsx:488` + `EvidenceChips.test.tsx:21` (`{label:'SUB-DEEP 65 Hz', path:'spectrum'}`).
- UnlockZone precedent: `AnalysisTab.tsx:864-876`.
- No-.als placeholder to replace: `ReportView.tsx:298` (+ `ReportView.module.css:56-61`).
- Worker rules: `verdict_lib/rule_engine.py` `robotic_velocity` (~1469), `lifeless_at_source` (~1284).
- `where` column: `components/bff/src/Spectr.Data/Entities/Verdict.cs:104`; DTO `VerdictDto.cs:41`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
