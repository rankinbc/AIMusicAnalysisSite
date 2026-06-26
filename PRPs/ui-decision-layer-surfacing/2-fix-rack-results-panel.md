name: "Fix Rack results panel — mono-maker module + solver coaching"
description: |
  Surface the deterministic Fix Rack on the Results page: render the new bass
  mono-maker (ms) module, deep-link "Open in Listen rack", and replace the
  placeholder coaching panel with the solver's change_log + leftover_advice.
  Has a BACKEND prerequisite (persist + expose change_log/leftover_advice).

## Goal

The SOLVE tier compiles problems into a deterministic Fix Rack (limiter / EQ /
mono-maker / trim …) plus a `change_log` ("what changed") and `leftover_advice`
("what a master rack can't fix"). `FixRackPanel.tsx` renders the module chain but
its coaching panel is a hard-coded placeholder ("Why these settings · what's left
soon"), and the new `ms` mono-maker module is unverified. Make the panel show the
real rack + real coaching.

## Why

- Phase-4 solvers now emit a bass mono-maker (`ms.monoMakerHz`) for mono/stereo-phase
  problems — users should see and audition it.
- The solver already computes `change_log` + `leftover_advice` (`compile_preset`),
  but they're discarded at persist time — the most useful "why" is invisible.
- "Open in Listen rack" closes the loop from diagnosis → audition.

## What

1. **Mono-maker module** — verify the `ms` module (with `monoMakerHz`) renders in the
   chain bar + module params; polish the label/glyph/units if needed.
2. **Open in Listen rack** — deep-link the ready-state CTA to load the preset chain
   into the Listen page rack.
3. **Coaching panel** — replace the placeholder with two columns: "What changed"
   (`change_log`) and "What a rack can't fix" (`leftover_advice`), gracefully showing
   the placeholder only while the backend fields are absent.

### Success Criteria
- [ ] A rack containing the `ms` mono-maker shows the module + its `monoMakerHz` value (Hz).
- [ ] The ready-state CTA deep-links into the Listen rack with the preset loaded.
- [ ] When `change_log`/`leftover_advice` are present, the coaching panel renders them;
      when absent, it shows the existing graceful placeholder (no crash, no empty box).
- [ ] All four frontend gates pass.
- [ ] (Backend prerequisite) `change_log` + `leftover_advice` persisted by the actor and
      exposed in `FixRackDto`.

## All Needed Context

```yaml
- file: components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx
  why: The component. Empty (~:41-50) / ready (~:54-125) states; module list (~:69-111);
       placeholder coaching (~:113-122). Add the ms module, the deep-link CTA, and the
       real coaching panel here.
- file: components/frontend-spectr-v2/src/features/results/fix-rack-helpers.ts
  why: readFixChain (~:17), enabledModuleIds (~:29), moduleParams (~:38-58) — renders eq
       bands or manifest params per module. Confirm moduleParams formats the ms module's
       monoMakerHz (manifest already defines it; see below).
- file: components/frontend-spectr-v2/src/features/listen-rack/data.ts
  why: RACK_MANIFEST ms module already defines monoMakerHz (~:148: label "Mono <", unit Hz,
       0-400, 0=off) + the `ms` defaults (~:81). The chain_json round-trips opaquely, so
       monoMakerHz already flows through — this PRP is verify + render, not new plumbing.
- file: PRPs/design_handoffs/design_handoff_results_phase2/prototype/rp-fixrack.jsx
  why: Visual intent. Ready state (~:133-166): .fx-chainbar signal flow, .fx-modules grid,
       .fx-actions ("Regenerate" + "Open in Listen rack"). Coaching: .fx-coach two-column
       (.fxc-col "What changed" / "What a rack can't fix") with .fx-coach.placeholder fallback.
- file: components/frontend-spectr-v2/src/api/types.ts
  why: FixRackDto (~:1269-1273) currently { name, chain, createdAt } — chain is opaque.
       change_log/leftover_advice are NOT exposed yet (backend prerequisite below).
- file: components/frontend-spectr-v2/src/api/hooks.ts
  why: useGenerateFixRack (~:549) + useFixRack (~:559) already poll the BFF; reuse.
- file: components/worker/app/fix_rack_actor.py
  why: BACKEND prerequisite. generate_fix_rack persists ONLY chain_json=result["chain"]
       (~:67-72); result also has result["leftover_advice"] + result["change_log"] that are
       DROPPED. Persist them too.
- file: components/worker/app/solve_lib/preset_compiler.py
  why: compile_preset returns {chain, leftover_advice, change_log} (~:140) — the shapes to persist.
```

### Known Gotchas
```text
# chain_json shape is { order, modules, masterBypass } and the frontend readFixChain
#   depends on it — DO NOT widen chain_json. Persist change_log/leftover_advice as
#   SEPARATE fields (recommended: two nullable jsonb columns on rack_presets, OR a single
#   coaching_json column). That is an EF migration + SQLAlchemy mirror + DTO change.
# The ms module mono-maker monoMakerHz=0 means "off" — render only when > 0.
# "Open in Listen rack" must load the preset chain into the existing rack state — reuse the
#   listen-rack preset-load path (useRackPresets), not a bespoke loader.
# CSS Modules only; mirror rp-fixrack.jsx class intent into FixRackPanel.module.css.
```

## Implementation Blueprint

```yaml
# ── BACKEND PREREQUISITE (do first; or track as a separate backend ticket) ──
Task 0a — persist solver coaching
MODIFY components/shared/aimusic_shared/models.py (RackPreset) + EF entity + migration:
  - ADD nullable jsonb columns change_log + leftover_advice (or one coaching_json)
MODIFY components/worker/app/fix_rack_actor.py (~:67-72):
  - PERSIST result["change_log"] + result["leftover_advice"] alongside chain_json
MODIFY components/bff FixRackDto + FixRackEndpoints mapper:
  - EXPOSE changeLog + leftoverAdvice on the DTO

# ── FRONTEND ──
Task 1 — mono-maker module renders
VERIFY components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx + fix-rack-helpers.ts:
  - a chain with an enabled `ms` module shows in .chainbar + module list
  - moduleParams('ms') prints monoMakerHz (Hz) when > 0 (manifest defines it)
  - add a vitest fixture with an ms+monoMakerHz chain (mirror __tests__/FixRackPanel.test.ts)

Task 2 — Open in Listen rack
MODIFY FixRackPanel.tsx ready-state actions (~:54-125):
  - add an "Open in Listen rack" CTA that loads the preset chain into the Listen rack
    (reuse the listen-rack preset-load path)

Task 3 — coaching panel
MODIFY FixRackPanel.tsx (~:113-122):
  - REPLACE the placeholder with a two-column panel: changeLog -> "What changed",
    leftoverAdvice -> "What a rack can't fix" (mirror rp-fixrack.jsx .fx-coach)
  - KEEP the placeholder as the graceful fallback when both are absent/empty
```

## Validation Loop

```bash
# Frontend (components/frontend-spectr-v2/)
npx tsc --noEmit && npm run lint && npm run build && npx vitest run
# Worker (backend prerequisite)
cd components/worker && python -m pytest tests/test_fix_rack_actor.py -q
# BFF
cd components/bff && dotnet build && dotnet test
```

## Final Checklist
- [ ] ms mono-maker module renders with its Hz value.
- [ ] "Open in Listen rack" loads the preset via the existing rack-load path.
- [ ] Coaching panel renders change_log/leftover_advice when present; placeholder otherwise.
- [ ] chain_json shape unchanged; coaching stored separately.
- [ ] All gates green (frontend + worker + BFF).

## Anti-Patterns to Avoid
- Don't widen `chain_json` to carry coaching — the frontend reads it as the chain.
- Don't build a bespoke rack loader — reuse the Listen preset-load path.
- Don't block the whole panel on the backend — coaching degrades to the placeholder.
