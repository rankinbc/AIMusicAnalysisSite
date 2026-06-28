# Story 5.6: .als Project Panel & Track-Name Attribution

Status: review

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

- [x] **Task 1: Worker — emit structured track attribution on `.als` verdicts (AC: 2)**
  - [x] 1.1 Audited all `data_tier="project_midi"` rules. Exactly two cite a specific named track: `robotic_velocity` (`rule_engine.py:1470`, `worst_name`) and `lifeless_at_source` (`rule_engine.py:1283`, `robotic[:3]`). The other three (`no_headroom`, `quantization_issues`, `project_clutter`) are project-wide, correctly NOT track-attributed.
  - [x] 1.2 Populated `where={"track_names": [...]}` on both: `robotic_velocity` → `[worst_name]`; `lifeless_at_source` → `robotic[:3]`. Validator still passes (`validate_verdict(...).ok`).
  - [x] 1.3 Confirmed no migration: ORM `where` is `JSONB nullable` (`aimusic_shared/models.py:338`); `degraded._to_row` passes `where=v.where` verbatim. A dict serializes cleanly.
  - [x] 1.4 Updated `test_rules_stem_midi.py` (robotic_velocity asserts `where == {"track_names": ["Lead"]}`) + `test_composites.py` (lifeless asserts `["Lead", "Bass"]`). 51 rule/composite/identifier tests pass in isolation.

- [x] **Task 2: Frontend types — surface `track_names` on the verdict `where` (AC: 2)**
  - [x] 2.1 Added `track_names?: string[]` to `ProblemWhere` (`types.ts:1216`). No BFF DTO change needed (`VerdictDto.Where` is pass-through `JsonElement?`).

- [x] **Task 3: Frontend — `TrackChip` + inline highlight in verdict text (AC: 2)** — ⚠️ DEVIATION, see Completion Notes
  - [x] 3.1 Created `TrackChip.tsx` + `TrackChip.module.css` (cyan inline chip; focus-visible ring).
  - [x] 3.2 **Implemented in the LIVE findings surface `FindingsTab.tsx`/`FindingCard`, NOT the dead `VerdictCard.tsx`** (VerdictsPanel/VerdictCard are unrendered in the redesign — see Completion Notes). Added pure tokenizer `track-highlight.ts` (`tokenizeTrackNames`) + `withTrackChips()` helper; highlights `headline`/`summary` against `v.where?.track_names`. Exact, case-sensitive, longest-first — no fuzzy matching.
  - [x] 3.3 `onTrackActivate` wired from `ReportView` → `onTabChange('project')`. Chip click switches to the Project tab via the existing URL `?tab=` mechanism.
  - [x] 3.4 Tests: `track-highlight.test.ts` (6 pure-tokenizer cases incl. case-sensitivity + longest-match) + `FindingsTab.trackchip.test.tsx` (3 render cases: chip present / plain-text when no attribution / no chip when no handler).

- [x] **Task 4: Frontend — no-.als unlock invitation (AC: 3)**
  - [x] 4.1 Created self-contained `ProjectUnlock.tsx` + `.module.css` (benefit chip "Track-named fixes" + invitation + hint), replacing the plain `ReportView` placeholder. Self-contained rather than reusing `AnalysisTab`'s local `UnlockZone` (coupled to that module's CSS).
  - [x] 4.2 `ProjectUnlock.test.tsx`: asserts benefit chip + `.als` invitation render and the old placeholder text is gone.

- [x] **Task 5: Gates (AC: all)**
  - [x] 5.1 Worker: my-change tests pass in isolation (51). Full suite shows 12 pre-existing failures (db_sync test-isolation pollution) — **proven pre-existing**: the clean baseline (changes stashed) fails the identical 12/514. Not a regression.
  - [x] 5.2 Frontend: `tsc`/`npm run build` ✓ (fixed an `exactOptionalPropertyTypes` forward-prop error), `npm run lint` clean, `npx vitest run` 561 passed.

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

claude-opus-4-8[1m] (dev-story workflow)

### Debug Log References

- Worker full-suite 12/514 failures investigated: pass in isolation; same 12 fail on the
  stashed clean baseline → pre-existing db_sync test-isolation pollution, not this change.
- `npm run build` surfaced an `exactOptionalPropertyTypes` error (`FindingsTab.tsx:172`) that
  `tsc --noEmit` (looser tsconfig) missed — fixed by widening `FindingCard`'s `onTrackActivate`
  to `((name: string) => void) | undefined`.

### Completion Notes List

- ⚠️ **Deviation (AC2 target component):** the story specified injecting chips into
  `VerdictCard.tsx`, but `VerdictCard`/`VerdictsPanel` are **unrendered in the live redesign**
  (only a stale comment in `AnalysisTab` references them). The live findings surface is
  `FindingsTab.tsx` → `FindingCard`. Implemented the highlight there instead, satisfying AC2's
  intent (chips in the verdict text the user actually sees). `VerdictCard` left untouched (dead).
- Track attribution is structured, not text-scraped: rule engine emits authoritative
  `where.track_names`; the frontend highlights only those exact strings (case-sensitive,
  longest-first) so a track literally named "Bass" never lights up the word "bass" in prose.
- Chip → Project tab uses the existing `onTabChange('project')` URL mechanism; deeper
  scroll-to-track-row was left out of scope (tab-switch satisfies "link to the panel").
- AC1 (`ProjectTab` structure summary) verified shipped, untouched.

### File List

- `components/worker/app/verdict_lib/rule_engine.py` (M — `where.track_names` on 2 rules)
- `components/worker/tests/verdict_pipeline/test_rules_stem_midi.py` (M — assert track_names)
- `components/worker/tests/verdict_pipeline/test_composites.py` (M — assert track_names)
- `components/frontend-spectr-v2/src/api/types.ts` (M — `ProblemWhere.track_names`)
- `components/frontend-spectr-v2/src/features/results/track-highlight.ts` (A)
- `components/frontend-spectr-v2/src/features/results/TrackChip.tsx` (A)
- `components/frontend-spectr-v2/src/features/results/TrackChip.module.css` (A)
- `components/frontend-spectr-v2/src/features/results/ProjectUnlock.tsx` (A)
- `components/frontend-spectr-v2/src/features/results/ProjectUnlock.module.css` (A)
- `components/frontend-spectr-v2/src/features/results/FindingsTab.tsx` (M — highlight + thread onTrackActivate)
- `components/frontend-spectr-v2/src/features/results/ReportView.tsx` (M — ProjectUnlock + onTrackActivate wiring)
- `components/frontend-spectr-v2/src/features/results/__tests__/track-highlight.test.ts` (A)
- `components/frontend-spectr-v2/src/features/results/__tests__/FindingsTab.trackchip.test.tsx` (A)
- `components/frontend-spectr-v2/src/features/results/__tests__/ProjectUnlock.test.tsx` (A)

### Change Log

- 2026-06-27 — Implemented Story 5.6 AC2 (structured `.als` track attribution + TrackChip in the
  live FindingsTab) and AC3 (ProjectUnlock invitation). AC1 already shipped. Status → review.
