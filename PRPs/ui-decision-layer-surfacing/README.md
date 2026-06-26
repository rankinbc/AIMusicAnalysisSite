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

## What these PRPs cover (the gaps)

1. **`1-verdictcard-decision-fields.md`** — the AI Coach tab's `VerdictCard.tsx`
   renders NONE of the new fields. Bring it to parity with ProblemsTab so
   `llm_identifier` + `suspected` findings read consistently. Includes a tiny BFF
   `StreamVerdicts` SSE-projection fix (the stream omits the new fields).
2. **`2-fix-rack-results-panel.md`** — surface the new mono-maker module +
   replace the placeholder coaching panel with the solver's `change_log` /
   `leftover_advice`. **Backend prerequisite:** the `generate_fix_rack` actor
   currently persists only `chain_json` — it must also persist change_log +
   leftover_advice for the DTO to expose them.
3. **`3-run-trace-diagnostics-viewer.md`** — OPTIONAL / dev-facing. Surface the
   per-run trace JSON + flow diagram (the run-trace harness writes gzipped JSON
   under `output/worker/<date>_run-traces/`).

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
