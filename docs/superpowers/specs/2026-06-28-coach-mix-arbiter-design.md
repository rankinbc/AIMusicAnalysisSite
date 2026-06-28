# Coach Mix — Autonomous Arbitration Engine (design)

**Date:** 2026-06-28
**Branch:** `ai-analysis-v2`
**Status:** design approved; implementation plan pending
**Related:** `PRPs/archive/2026-06-28_wire-solve-tier-into-pipeline.md` (SOLVE tier wired into every analysis), `PRPs/identifiers/{router,preset-compiler}.md`, `PRPs/identify-solve-architecture.md`

---

## 1. Problem & goal

Coach Mix is the flagship mix feature: the user clicks one button and gets the
**optimal, release-ready master rack** for their track — they should NOT have to
hand-pick which fixes to apply.

Two gaps today:

1. **Perceived user-choice coupling.** The *backend* `generate_fix_rack(analysis_id)`
   is already autonomous (it re-runs the engine from the analysis, never receiving
   the user's picks). The user-driven part is a separate *frontend* path (per-fix
   "Mark applied" → Listen Plan-tab checkboxes). Coach Mix stays autonomous; the
   manual per-fix path remains as an independent power-user mode.
2. **No intelligence.** The current `solve_lib/preset_compiler.py` DEDUP is
   *mechanical*: single modules keep "highest-confidence, drop the rest"; EQ keeps
   "stronger move wins per band slot." There is no averaging, no awareness that
   comp+limiter interact on gain, no "is this fix even needed," and no LLM. This is
   the stage we replace with a real arbitration brain.

**Goal:** an on-demand engine that looks at all problems + candidate fixes +
measured metrics, decides which fixes are needed, combines/averages the ones that
belong together, consults a holistic mastering-engineer LLM on genuine judgment
calls, and emits a release-ready master rack — with every decision explainable.

### Decisions locked in brainstorming (2026-06-28)

| Axis | Decision |
|------|----------|
| Arbitration model | **Deterministic core + LLM on judgment calls** (deterministic backbone, LLM is a constrained reviewer) |
| LLM persona | **One holistic "mastering engineer" arbiter** (sees the whole picture; ≤1 call per generation) |
| Run trigger | **On-demand, single button** (deterministic + LLM run together on click) |
| Optimization goal | **Release-ready master** (corrective + proactive finishing, guarded against over-processing) |
| Tier gating | **None for now** — both free and pro consult the LLM (budget guard still applies, fail-open) |

---

## 2. Architecture

New package **`components/worker/app/coach_mix/`** (sibling to `solve_lib/`, because
it *orchestrates* solve + arbiter + LLM + compile rather than belonging to any one):

| File | Responsibility |
|------|----------------|
| `synthesize.py` | Top-level orchestrator — the single entry point the actor calls. |
| `arbiter.py` | The four deterministic passes: NEED → COMBINE → SCAFFOLD → GUARD. |
| `interactions.py` | Combine/average + interaction rules and their config (gain-staging, EQ blending, width/mono coupling, over-processing budgets). |
| `llm_arbiter.py` | Holistic escalation: build context, call the gateway, parse + re-guard the response. |
| `prompts/experts/MasteringEngineer.md` | The arbiter persona prompt (versioned like every specialist). |

**Existing pieces change minimally:**
- `solve_lib/preset_compiler.py` becomes a **pure translator** (FILTER/TRANSLATE/ORDER);
  its crude DEDUP is superseded by the Arbiter and kept only as a defensive no-op.
- `fix_rack_actor.generate_fix_rack` swaps its compute line `solve(...)` →
  `coach_mix.synthesize(...)` and gains `user_id` + `tier` params (the LLM gateway
  needs them for budget accounting).
- Persistence + the Listen handoff are unchanged in shape: still a `RackPreset` row,
  still the same `chain` the rack loads.

### Data flow (on button click)

```
BFF POST /reports/{jobId}/fix-rack ──enqueue──▶ generate_fix_rack(analysis_id, user_id, tier)
  │
  ├─ load final_json → flatten
  ├─ evaluate_problems            → problems[]            (IDENTIFY, deterministic)
  ├─ router.merge                 → candidate fixes[]     (SOLVE solvers, deterministic)
  ├─ ARBITER  NEED→COMBINE→SCAFFOLD→GUARD
  │     → (candidate_chain, judgment_calls[], change_log[])
  ├─ if judgment_calls non-empty:           # no tier gate for now
  │     MasteringEngineer LLM arbiter → bounded decisions → re-GUARD
  │     (budget-exceeded / provider error / malformed → skip, keep deterministic chain, degraded=true)
  ├─ compile_preset (pure translate) → rack chain + leftover_advice
  └─ persist RackPreset(source='coach_mix', payload incl. change_log + arbiter_notes + degraded)
        ──▶ BFF GET returns FixRackDto
```

**Core invariant:** a valid deterministic chain always exists before the LLM is
consulted. A blown budget, an LLM failure, or no judgment calls leaves the
deterministic master in place — degradation is never to nothing. GUARD runs last on
whatever the LLM returns, so the persisted `chain` is always schema-valid and
rack-loadable.

---

## 3. The Arbiter (deterministic brain)

Four passes over the candidate fixes. Each appends to `change_log` (every decision
is explainable) and may push items onto `judgment_calls[]`.

### 3.1 NEED — which fixes are warranted
Rank candidates by `priority_score` (severity × category weight × confidence, already
computed). Drop fixes below a need floor (e.g. `minor` + low confidence) unless they
are a near-universal master step. Redundant/child-problem suppression already happened
upstream in `evaluate_problems`; this pass trims low-value tails and tags
same-module / same-intent fixes for COMBINE.

### 3.2 COMBINE — added together vs. averaged vs. escalated (core of the ask)
Group ops by rack module:
- **EQ, same band slot, same direction** (both cuts or both boosts) → **blend**:
  average the frequency, sum the gain with a cap.
- **EQ, different slots** → keep both (additive).
- **EQ, same slot, opposite directions** (a boost *and* a cut fighting at ~300 Hz) →
  cannot average meaningfully → **escalate** as a judgment call.
- **comp + limiter + trim** → **gain-stage together**: account for cumulative
  makeup/trim gain so boosts don't stack into the ceiling.
- **ms width + mono-maker** → merge into one module (width from one fix, crossover
  from the other).
- **loudness trims** → sum and clamp; if a loudness target fights a tonal boost,
  escalate.

### 3.3 SCAFFOLD — release-ready finishing
Deterministically guarantee the two near-universal steps: a trim toward the genre
LUFS target + a true-peak ceiling limiter. **Proactive glue** (gentle bus comp on a
clean mix) is NOT forced deterministically — it is *offered to the LLM as a judgment
call*, because "does this clean mix want glue" is exactly the over-processing
decision the mastering persona should own. Scaffold additions are tagged in
`change_log` as proactive (not problem-traced).

### 3.4 GUARD — do no harm
Enforce processing budgets (total EQ boost ceiling, max cut depth, max cumulative
gain, comp-ratio cap, width bounds); clamp or drop offenders into `change_log`.
Validate every op against `DspOp` ranges + the rack schema. A heavy clamp can itself
become a judgment-call note.

**Arbiter output:** `(candidate_chain, judgment_calls[], change_log[])`, where each
judgment call is `{kind, where, competing_fixes, measured_context, question}` —
ready to hand to the LLM.

---

## 4. The holistic LLM arbiter

**Persona:** `prompts/experts/MasteringEngineer.md`, versioned (frontmatter version
flows into the existing prompt-pin/cache machinery). Consulted **only** when
`judgment_calls[]` is non-empty.

**Context it sees:** genre, headline metrics (LUFS, true-peak, band balance, stereo
correlation, …), the problem list, the candidate fixes, the deterministic candidate
chain, and the `judgment_calls[]`. The whole picture, so it can weigh cross-domain
tradeoffs (e.g. "boost 80 Hz for body" vs. "already at the loudness ceiling").

**Output contract — constrained, not free authoring.** The LLM does NOT return an
arbitrary rack. It returns structured answers keyed to each judgment call: a decision
(`keep` / `blend` / `drop` / `add_glue` / `adjust`) plus, where applicable, parameter
values *within allowed ranges*. It is a constrained reviewer of the deterministic
candidate, not the author — which keeps the feature testable and safe.

**Guardrails (non-negotiable).** Every value the LLM returns is re-run through GUARD
+ the `DspOp` validator + the rack schema before it touches the chain. Out-of-range
or budget-busting moves are clamped or dropped and logged. A malformed/unparseable
response is discarded wholesale — the deterministic chain stands.

**Tier / budget / degradation** (reuses `app/llm`):
- **No tier gate for now** — both free and pro run the arbiter.
- Bounded by the per-tier/global budget in `budget.py`; `gateway.complete_sync`
  serializes via the existing semaphore (one call per generation).
- `LlmBudgetExceeded` / provider error / timeout / malformed → caught; deterministic
  chain kept; `degraded=true` stamped so the UI can show "used the rule-based master
  (AI refine unavailable)."

> ⚠️ **Required config:** because free tier now uses the LLM, the **free-tier LLM
> budget ceiling must be non-zero** (`llm_budget_free_usd` flag) or bypassed in CLI
> mode — otherwise the budget guard trips on every free Coach Mix and silently falls
> back to deterministic. See `memory/reference_coach-offline-free-tier-budget.md`.

Cost ceiling: **≤ 1 LLM call per button click**; zero when a clean mix raises no
judgment calls.

---

## 5. Persistence, API, frontend

**Persistence.** One `RackPreset` row per version, `source='coach_mix'`, idempotent
replace. Stored payload carries, alongside `chain` + `leftover_advice`:
- `change_log[]` — every NEED/COMBINE/SCAFFOLD/GUARD decision.
- `arbiter_notes` — the LLM's rationale per judgment call (null when skipped/failed).
- `degraded: bool` — true when the AI refine was skipped.

**API (BFF).** Endpoint shapes unchanged: `POST /reports/{jobId}/fix-rack` (enqueue),
`GET` (poll → `FixRackDto`). Changes:
- POST passes caller `user_id` + `tier` into the actor (budget accounting).
- `FixRackDto` gains `changeLog` + `arbiterNotes` + `degraded`.

**Worker actor.** `generate_fix_rack(analysis_id, user_id, tier)` — compute line
`solve(...)` → `coach_mix.synthesize(...)`. Keeps the 3-phase tx pattern
(load / compute-no-DB / persist), best-effort, idempotent.

**Frontend.** `FixRackPanel` already renders the chain + "Open in Listen rack." Adds:
a short "What Coach did" rationale list from `changeLog`/`arbiterNotes`, and a
`degraded` badge. The Listen rack and `fixToRackPatch.ts` need **no change** — the
`chain` shape is identical. The manual per-fix "Mark applied" → Plan-tab path stays
untouched and independent.

---

## 6. Error handling & testing

**Error handling** (all fail-open):
- Actor best-effort + idempotent-replace; compute failure logs, no half-write (3-phase tx).
- Malformed/empty `final_json` → no problems → minimal/empty chain (never a crash).
- Any LLM failure → discard LLM output, keep deterministic chain, `degraded=true`.
- GUARD runs last on whatever the LLM returned → persisted `chain` always schema-valid.

**Testing** (deterministic core is the backbone — most coverage is fast, LLM-free):
- **Arbiter unit** (no DB/LLM): NEED drops a low-value fix, keeps a universal step;
  COMBINE blends same-direction EQ cuts (averaged freq, capped-sum gain), escalates
  an opposite-direction clash, keeps different-slot bands additive, gain-stages
  comp+limiter+trim, merges width+mono; SCAFFOLD always yields loudness+ceiling and
  only *offers* glue; GUARD clamps over-budget + drops out-of-range — output always
  passes `DspOp` + rack schema.
- **LLM arbiter** (mock gateway): constrained decision applied; out-of-range LLM
  value re-clamped by GUARD; malformed response discarded → deterministic chain;
  budget-exceeded → `degraded=true` + deterministic kept.
- **`synthesize` orchestrator** (fakes): clean mix → minimal chain; problem-heavy mix
  → full chain; conflict present → judgment call → LLM consulted.
- **Actor:** idempotent replace + best-effort (compute throws → no preset mutation).
- **Golden snapshot:** 2–3 representative analyses → byte-stable deterministic chain
  (mirrors the `run_pipeline` golden-snapshot discipline).
- **Frontend:** `FixRackPanel` renders `changeLog`/`arbiterNotes` + `degraded` badge.

**Validation gates:** `pytest -q components/worker/tests/`, `ruff check`, `mypy`;
BFF `dotnet build && dotnet test`; frontend `tsc --noEmit` / `lint` / `build` / `vitest`.

---

## 7. Out of scope (YAGNI)

- Per-domain specialist fan-out (one holistic arbiter only).
- Automatic/always-on generation (on-demand button only).
- Tier gating (deferred — both tiers use the LLM for now).
- Changes to the manual per-fix "Mark applied" / Listen Plan-tab path.
- Retiring the legacy `solve_lib.solve` entry point (kept until callers migrate).
