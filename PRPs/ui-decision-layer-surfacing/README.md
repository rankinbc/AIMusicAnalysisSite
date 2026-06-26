# Decision-Layer UI Surfacing — Design Handoff PRPs

Handoff package for the frontend (Claude design) to surface the rebuilt + extended
analysis decision layer in the Results UI. Implement at a later pass.

## Context

The IDENTIFY/SOLVE decision layer was hardened and expanded on the
`decision-layer-hardening` branch. Verdict rows now carry Problem-record fields
and the Fix Rack gained a bass mono-maker:

- **Verdict fields** (already in `VerdictDto` + `src/api/types.ts:1199-1242`):
  `source` (`rule_engine | llm_identifier`), `kind` (`fault | observation | integrity`),
  `dataTier` (`audio_only | stems | project_midi`), `fixable`, `suspected`,
  `problemId`, `where`, `refines`.
- **LLM identifiers** now run (pro tier): findings tagged `source='llm_identifier'`
  (e.g. `trance_arrangement` — "weak drop payoff").
- **New solvers** produce a Fix Rack `ms` module with `monoMakerHz` (bass mono-maker),
  plus `change_log` + `leftover_advice` from the compiler.

## Already shipped — DO NOT rebuild

`ProblemsTab.tsx` is the **canonical surface** and renders 7/8 fields end-to-end
(reference implementation for these PRPs):

| Field | Treatment in ProblemsTab | Ref |
|---|---|---|
| `source` | "AI" / "Measured" badge | `ProblemsTab.tsx:98-100` |
| `kind` | "FYI" (observation) / "Data" (integrity) badge | `:84` `KIND_BADGE` |
| `suspected` | "Unverified" badge + `[data-suspected]` dashed border | `:90,101` |
| `where` | section·time chip via `formatWhere` | `:110` |
| `fixable` | "Fix in Actions" button when true | `:116` |
| `dataTier` | grouped sections (mix / stems / project) | `problems-helpers.ts:50` |
| `refines` | child nesting | `problems-helpers.ts:42-54` |

## Contracts (already wired end-to-end — the data is there)

The BFF + frontend already carry the new fields; most rework is **rendering**, not plumbing.

- **`VerdictsListResponse`** = `{ verdicts: VerdictDto[], specialists: SpecialistStatus[],
  routing_plan?, degradation? }` (`VerdictDtos.cs:77-85`, `types.ts:1309-1319`).
- **`VerdictDto`** carries all 8 Problem fields: `source` (rule_engine|llm_identifier),
  `kind` (fault|observation|integrity), `dataTier` (audio_only|stems|project_midi),
  `fixable`, `suspected`, `problemId`, `where`, `refines` (`VerdictDtos.cs:13-44`).
- **`SpecialistStatus`** = `{ slug, status }` (idle|cached|failed; frontend overlays "running").
- **`FixRackDto`** = `{ name, chain (opaque), createdAt }` (`RackPresetDtos.cs:24-26`). The
  `chain` already carries `ms.monoMakerHz`. **NOT carried:** `change_log` / `leftover_advice`
  (solver computes them; the actor + RackPreset don't persist them — see PRP-2's backend prereq).
- **`DegradationNoticeDto`** = `{ reason, detail?, occurredAt }` (budget/circuit-breaker banner).

## What these PRPs cover (the gaps, priority order)

1. **`1-verdictcard-decision-fields.md`** — the AI Coach tab's `VerdictCard.tsx` renders NONE
   of the new fields. Bring it to parity with ProblemsTab so `llm_identifier`/`suspected`
   findings read consistently. **Includes the tiny BFF `StreamVerdicts` SSE-projection fix**
   (the stream omits `source`/`kind`/`dataTier`/`fixable`/`suspected`).
2. **`4-specialist-roster-identifiers.md`** — the 3 always-on identifiers
   (`trance_arrangement`, `section_contrast`, `chord_harmony`) sit in the on-demand specialist
   roster and show a misleading "Run · N credits" button. Give them a passive "AI judgment ·
   runs automatically" treatment (no Run, pro-gated).
3. **`2-fix-rack-results-panel.md`** — surface the mono-maker module + replace the placeholder
   coaching panel with the solver's `change_log` / `leftover_advice`. **Backend prerequisite:**
   `generate_fix_rack` persists only `chain_json` — must also persist change_log + leftover_advice.
4. **`3-run-trace-diagnostics-viewer.md`** — OPTIONAL / dev-facing. Surface the per-run trace
   JSON + flow diagram (worker writes gzipped JSON under `output/worker/<date>_run-traces/`).

### Minor — verification, not new build
- **ProblemsTab** is essentially done. Confirm with design: the `where` chip **deep-links** to
  the waveform/section; the empty-tier **"unlock" affordances** (upload stems / drop `.als`);
  the fault-only tab count. No rebuild.
- **GamePlan / MoveCard** are intentionally decision-field-agnostic (Moves drop verdict metadata).
  Leave them as-is — do NOT thread the new fields through the Move model.

## Design source of truth

`PRPs/design_handoffs/design_handoff_results_phase2/` — prototype
`rp-problems.jsx`, `rp-fixrack.jsx`, `rp.css` / `rp-extras.css`. Mirror its badge /
pill / card language. Use the app's `tokens.css` (not prototype hexes).

## Stack rules (all PRPs)

- React 19 + Vite + TS **strict** + `verbatimModuleSyntax` → type-only imports use `import type`.
- **CSS Modules** + `src/styles/{tokens.css,global.css}` + global utility classes
  (`.pill[.tone]`, `.btn[.primary/.ghost/.sm]`, `.card`, `.label`, `.mono`). **No Tailwind / shadcn / MUI / styled-components.** No inline styles unless the value is dynamic (color-from-severity, etc.).
- All four gates before commit (from `components/frontend-spectr-v2/`):
  `npx tsc --noEmit` · `npm run lint` (`--max-warnings 0`) · `npm run build` · `npx vitest run`.
- Mirror the existing `ProblemsTab.module.css` badge classes; do not invent a new badge system.
