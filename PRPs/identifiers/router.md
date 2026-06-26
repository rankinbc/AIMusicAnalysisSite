# MixCoach Router — Specification

The router sits between IDENTIFY and SOLVE. It takes the full set of problem
records — from the rule engine, the discovery identifiers, and the composite
refiner — resolves their relationships into a clean queue, maps each to the right
solver, fans out and merges multi-domain fixes, and hands the assembled result to
RANK + PRESENT.

The router writes nothing diagnostic and nothing prescriptive. It only **decides
which records survive and which solver sees each one.** All judgment about *what's
wrong* lives upstream; all judgment about *how to fix* lives downstream.

```
records in ──▶ 1. RECONCILE ──▶ 2. ROUTE ──▶ 3. FAN-OUT ──▶ solvers ──▶ 4. MERGE ──▶ queue out
              (suppress/refine)   (→ solver)   (multi-domain)            (reattach fixes)
```

---

## Stage 1 — Reconcile

Resolve the three relationships among records *before* routing anything, so a
solver never sees a record that's about to be replaced or absorbed.

### 1a. Suppression (composites absorb their children)

Each Tier C composite carries a `suppresses[]` list. For every composite present
in the input:

- Drop every record whose `problem_id` is in `suppresses[]`.
- Suppression is one-directional and explicit: a child never references its
  parent, so a dropped single is always traceable to the composite that consumed
  it. Keep a `suppressed_by` audit field on the dropped record (for debugging /
  "why did this card vanish?"), even though it won't be presented.

Conflict rule (from `rules.md`): if two composites claim the same child, the
higher-severity composite wins the child. The losing composite still fires, but
only keeps the shared child if its *other* inputs stand on their own; otherwise it
proceeds without it.

### 1b. Refinement (refiner output replaces or expands its parent)

The composite refiner emits records carrying a `refines` field naming a parent
composite. Two cases:

- **Enrich in place** — exactly one refined record, with `problem_id` equal to the
  parent's. It *replaces* the parent: the parent record is removed and the refined
  one takes its slot (sharper summary, added evidence, a `where`, possibly an
  upgraded `data_tier`). This is the C4 case.
- **Split into children** — multiple refined records with new `problem_id`s, each
  `refines` the parent. The parent is removed; the children enter the queue
  independently, each routed on its own. This is the C1 case (crushed-drops +
  ceiling-pinned).

Rule: **a refined record always supersedes its parent.** Never route both — that
double-counts one problem. If the refiner ran but produced nothing (no series
available, couldn't localize), the parent composite survives unrefined and routes
as-is.

Ordering: run **1a before 1b**. Suppression clears the absorbed singles first, so
the refiner's parent is the only survivor of its cluster before refinement
replaces it. Net result after Stage 1: one record per distinct problem, no
parent/child duplication, no absorbed singles.

### 1c. Observation pass-through

Records with `fixable: false` (wins, key-confidence notes, modal-ambiguity
observations) skip routing entirely. They go straight to the output queue with no
solver and render as observation cards (the render-states doc's "Observation
only"). Don't send them to a solver — there's nothing to fix.

---

## Stage 2 — Route to a solver

Each surviving `fixable` record maps to one **primary** solver. The mapping is a
function of `category` + `data_tier`, with a few problems that legitimately want a
specific tool. Solvers are the tool-experts: EQ Surgeon, Dynamics Engineer,
Sidechain Specialist, Stereo Engineer, Arrangement Coach, Gain/Routing.

| category | default solver | tier-dependent override |
|---|---|---|
| `low_end` | EQ Surgeon | masking + no-duck → **Sidechain**; `audio_only` masking → **EQ** (can't separate sources) |
| `frequency_balance` | EQ Surgeon | — |
| `clarity` | EQ Surgeon | if root cause is arrangement density → **Arrangement Coach** |
| `frequency_collision` | EQ Surgeon | `stems` + rhythmic overlap → **Sidechain**; same-note overlap → **Arrangement Coach** |
| `dynamics` | Dynamics Engineer | source-level (MIDI velocity) → **Dynamics Engineer** still, but targets MIDI |
| `loudness` | Dynamics Engineer | — |
| `clipping` | Dynamics Engineer | (limiter ceiling) |
| `stereo_phase` / `stereo_field` / `spatial` | Stereo Engineer | — |
| `mono_compatibility` | Stereo Engineer | — |
| `sections` / `section_contrast` / `trance_arrangement` | Arrangement Coach | — |
| `humanization` | Dynamics Engineer | `project_midi` → MIDI-velocity targeting |
| `gain_staging` | Gain/Routing | `project_midi` only |
| `harmonic` / `chord_harmony` | (usually observation) | route only if `fixable` |
| `device_chain` | Gain/Routing | `project_midi` only |

Routing principles:

- **`data_tier` gates the move, not just the solver.** A `low_end` masking problem
  at `audio_only` goes to EQ (you can't sidechain a rendered mix); the *same*
  problem at `stems` goes to Sidechain with both stems named. The solver then
  adapts its target (master/bus vs named stem) — but the router has already made
  the tier-correct solver choice.
- **Carry the genre.** Attach `phase2.genre` to every routed record so the solver
  can aim at the genre's target (the config). A fix for techno and a fix for
  classic trance differ even for an identical diagnosis.
- **Never invent a route.** If `category` + `data_tier` has no valid solver (e.g.
  a `gain_staging` problem with no project data), the record can't be solved —
  flag it as `unsolvable_missing_data` and pass it through as an observation, never
  a fabricated fix.

---

## Stage 3 — Fan-out (multi-domain problems)

Some problems need two domains in one coherent fix. The canonical case: kick/bass
masking solved by *both* a complementary EQ carve *and* a sidechain duck. A single
solver would give half a fix.

When a record's diagnosis implies more than one remedy domain, the router fans it
out to multiple solvers, each told **which slice it owns**:

- Tag each fan-out call with a `role` so solvers don't collide — e.g. Sidechain
  owns the dynamic ducking, EQ owns the static frequency carve.
- Fan-out is the exception, not the default. Most records have one primary solver.
  Only fan out when the diagnosis genuinely spans domains; over-fanning produces
  redundant, conflicting advice.

Which records fan out is itself a small routing rule, keyed off category +
evidence — e.g. a `low_end` masking record with *both* a frequency band in
evidence *and* a missing-duck metric is the fan-out trigger. The C4 refined record
is the model: it has the 55–70 Hz band (EQ's concern) and the no-LF-dip metric
(Sidechain's concern).

---

## Stage 4 — Merge

Each solver returns the envelope: `problem_id` + a `fix`. The merge step:

- **Reattaches** each fix to its problem record by `problem_id`.
- **For fan-out records, orders the steps into one chain.** A masking fix becomes:
  EQ carve first (static), then sidechain (dynamic) — a sensible signal order the
  producer applies top to bottom. The merge step owns this ordering; solvers don't
  know about each other.
- **Reconciles conflicts.** If two fan-out solvers propose overlapping moves (both
  touch 60 Hz), keep the one whose domain owns that move and note the other only if
  complementary. Never present two fixes that fight.
- **Drops empty fixes honestly.** A solver may return an empty `dsp_chain` with a
  "not my domain — route to X" note (the hand-back case). If every solver for a
  record hands back, the record is solvable in principle but landed wrong — re-route
  once to the suggested solver; if it hands back again, pass through as an
  observation with the solvers' note, never a forced fix.

Output of Stage 4: the problem queue, each `fixable` record now carrying a
validated `fix` (or flagged unsolvable), each observation carrying none. This is
what RANK + PRESENT sorts by `priorityScore` and renders.

---

## What the router guarantees downstream

- **No double-counting.** Suppression and refinement collapse every cluster to one
  record before routing.
- **One coherent fix per problem**, even when assembled from two solvers.
- **Tier-correct routing** — the audio-only producer never gets a per-stem
  instruction they can't apply.
- **Genre-aware** — every solver knows the target it's aiming at.
- **Honest gaps** — missing-data and hand-back cases become observations, never
  invented fixes. (Mirrors the render-states doc: never a failing grade or a fake
  action for absent data.)

---

## Edge cases worth handling explicitly

- **Composite fired but refiner unavailable** (degraded/free tier): route the raw
  composite. It's coarse but correct — the whole point of the rule engine is that
  it works with no LLM. The solver gets less to scope with, but a valid fix.
- **Refined child changed `data_tier`** (C4 upgraded audio_only→stems): route on
  the *refined* tier. The upgrade is exactly what unlocks the better solver.
- **Two refined children route to different solvers** (C1 → Dynamics for crushed
  drops, Dynamics again for ceiling — or split across Dynamics + a limiter-specific
  path): fine; they're independent records now.
- **A suppressed single also had a `refines` pointer** (shouldn't happen, but):
  suppression wins — if a composite absorbed it, it's gone before refinement runs.
- **Everything suppressed, nothing left** (one giant composite ate the tab): the
  composite itself is the record. The tab shows one strong, certain card — that's
  correct, not empty.
