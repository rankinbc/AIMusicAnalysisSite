name: "VerdictCard decision-field parity (AI Coach tab)"
description: |
  Bring the Problem-record badges/treatments (source, kind, suspected, where) to
  the AI Coach tab's VerdictCard, matching the canonical ProblemsTab. Plus a tiny
  BFF SSE-projection fix so streamed verdicts carry the new fields.

## Goal

The AI Coach tab (`VerdictsPanel` → `VerdictCard`) renders verdicts WITHOUT any of
the new decision-layer fields. A user can't tell an `llm_identifier` finding from a
deterministic one, can't see a `suspected`/`observation` treatment, and gets no
`where` localization. Bring `VerdictCard` to visual parity with `ProblemsTab` so the
two surfaces read consistently.

## Why

- LLM identifiers now run (pro tier) and appear as verdicts; users must see they're
  AI judgment calls (`source='llm_identifier'`), not measured facts.
- `suspected` findings (placeholder-threshold rules + all identifiers) must read as
  "unverified", not as hard faults — trust calibration.
- Consistency: the same finding shown in Problems and in the Coach tab should carry
  the same badges.

## What

Render, on each `VerdictCard`, mirroring `ProblemsTab.tsx`:
- **source** badge — "AI" (`llm_identifier`) / "Measured" (`rule_engine`).
- **kind** badge — "FYI" (`observation`) / "Data" (`integrity`); none for `fault`.
- **suspected** — "Unverified" badge + dashed-border treatment (`[data-suspected]`).
- **where** — section·time chip via the existing `formatWhere` helper.
- Keep the existing `headline === 'Specialist failed'` fail-marker behavior unchanged.

### Success Criteria
- [ ] A `source='llm_identifier'` verdict shows an "AI" badge; a `rule_engine` one shows "Measured".
- [ ] An `observation` verdict shows "FYI"; `integrity` shows "Data"; `fault` shows neither.
- [ ] A `suspected` verdict shows "Unverified" + the dashed-border card treatment.
- [ ] A verdict with `where` shows the section·time chip (reusing `formatWhere`).
- [ ] Fail-marker (`headline === 'Specialist failed'`) rendering is unchanged.
- [ ] BFF `StreamVerdicts` SSE payload includes `source`/`kind`/`dataTier`/`fixable`/`suspected`.
- [ ] All four frontend gates pass; `dotnet build` passes for the BFF change.

## Data points & actions (for the design pass)

**Contract:** `VerdictDto` — all fields already present (`types.ts:1232-1239`). No type change.
**Render (mirror ProblemsTab exactly):** `source` → AI / Measured badge · `kind` → FYI (observation) /
Data (integrity), none for fault · `suspected` → "Unverified" badge + dashed-border card · `where` →
section·time chip (reuse `formatWhere`).
**Actions / buttons:** existing apply / dismiss / feedback unchanged. **GATE the fix CTA off** when
`!verdict.fixable` OR `verdict.kind === 'observation'` (observations are FYI, not actionable). Keep the
`headline === 'Specialist failed'` fail-marker path untouched.

## All Needed Context

```yaml
- file: components/frontend-spectr-v2/src/features/results/ProblemsTab.tsx
  why: CANONICAL reference. Lines 81-146 (ProblemCard) show the exact badge logic to
       mirror — KIND_BADGE (:84), source badge (:98-100), suspected (:90,101), where (:110).
- file: components/frontend-spectr-v2/src/features/results/ProblemsTab.module.css
  why: Badge classes to REUSE/mirror — .badge, .ai, .measured, .fyi, .data, .unverified,
       .whereChip, [data-suspected] dashed border. Do not invent a new badge system.
- file: components/frontend-spectr-v2/src/features/results/problems-helpers.ts
  why: `formatWhere(where)` already exists (~:75). Reuse it; do not reimplement.
- file: components/frontend-spectr-v2/src/features/results/VerdictCard.tsx
  why: The component to extend. Insertion points: after the severity pill (~:71) for the
       badge row; after metricLine (~:95) for the where chip; the .card data-attrs (~:53)
       for data-suspected. Keep the isFailMarker logic (:22,53,124) intact.
- file: components/frontend-spectr-v2/src/api/types.ts
  why: VerdictDto already carries the fields (:1232-1239); ProblemSource/ProblemKind/
       DataTier/ProblemWhere types (:1199-1208). No type changes needed.
- file: PRPs/design_handoffs/design_handoff_results_phase2/prototype/rp-problems.jsx
  why: Visual intent — .pr-srcbadge.measured/.ai (mint/violet), .pr-badge.unverified
       (amber, dashed), .pr-where (blue anchor chip). Tone mapping: source measured=--accent,
       source ai=--violet, suspected=--orange, where=--blue.
- file: components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs
  why: StreamVerdicts (~:340-356) projects only ~10 fields in its .Select(); the new
       fields are omitted. ToDto (~:238-276) already maps them for the list endpoint —
       mirror that projection into the stream select.
```

### Known Gotchas
```text
# Strict TS + verbatimModuleSyntax: type-only imports MUST be `import type`.
# Reuse ProblemsTab.module.css classes by mirroring them in VerdictCard.module.css
#   (CSS Modules are component-scoped — copy the rule, keep the class name parallel),
#   OR lift the shared badge classes to a small shared module if duplication grows.
# Do NOT route VerdictCard through the Move model — Moves intentionally drop decision
#   metadata (move-model.ts). Render straight off the VerdictDto.
# GamePlan/MoveCard are intentionally decision-field-agnostic — leave them as-is.
```

## Implementation Blueprint

```yaml
Task 1 — BFF: stream the new fields
MODIFY components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs:
  - FIND the StreamVerdicts .Select(...) projection (~line 343)
  - ADD v.Source, v.Kind, v.DataTier, v.Fixable, v.Suspected to the projected object
  - MIRROR the field set already in ToDto (~:238-276)

Task 2 — Frontend: badge row in VerdictCard
MODIFY components/frontend-spectr-v2/src/features/results/VerdictCard.tsx:
  - AFTER the severity pill (~:71): render a badge row:
      source -> "AI" | "Measured"; kind!=fault -> "FYI" | "Data"; suspected -> "Unverified"
  - MIRROR ProblemsTab.tsx:84,98-101 logic exactly (same labels/conditions)
  - GUARD: render nothing extra for a fail-marker verdict

Task 3 — Frontend: suspected treatment + where chip
MODIFY VerdictCard.tsx:
  - ADD data-suspected={verdict.suspected || undefined} to the .card root (~:53)
  - AFTER metricLine (~:95): render formatWhere(verdict.where) as a chip when where != null
MODIFY VerdictCard.module.css:
  - MIRROR ProblemsTab.module.css: .ai/.measured/.fyi/.data/.unverified badges,
    [data-suspected] dashed border, .whereChip

Task 4 — Tests
ADD a VerdictCard test (mirror __tests__ patterns):
  - llm_identifier -> "AI"; rule_engine -> "Measured"
  - observation -> "FYI"; suspected -> "Unverified" + data-suspected
  - where present -> chip rendered; fail-marker -> unchanged
```

## Validation Loop

```bash
# Frontend (from components/frontend-spectr-v2/)
npx tsc --noEmit
npm run lint        # --max-warnings 0
npm run build
npx vitest run

# BFF (from components/bff/)
dotnet build && dotnet test
```

## Final Checklist
- [ ] VerdictCard badges match ProblemsTab labels/tones exactly.
- [ ] `formatWhere` reused (not reimplemented).
- [ ] Fail-marker path untouched.
- [ ] StreamVerdicts carries the new fields.
- [ ] All four frontend gates + dotnet build green.

## Anti-Patterns to Avoid
- Don't invent a new badge system — mirror ProblemsTab.
- Don't push decision fields through the Move model.
- Don't touch GamePlan/MoveCard (intentionally move-centric).
