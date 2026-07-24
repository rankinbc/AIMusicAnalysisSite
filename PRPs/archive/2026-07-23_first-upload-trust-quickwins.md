# First-Upload Trust & Accuracy Quick-Wins

## Goal

Ship five small, independently-shippable repairs to SPECTR's analysis/coaching
pipeline, each fixing a place where the system currently asserts false
confidence or drops real signal that's already computed. All five are
additive per CLAUDE.md's project rules — nothing here removes existing
behavior, only repairs or extends it. None depend on each other.

A sixth item from the source brainstorm (a "is this even a song?" content-type
gate) is **explicitly out of scope for this PRP** — see "Scope note" below.

## Why

- Grounded in `_bmad-output/brainstorming/brainstorming-session-2026-07-23-1357.md`
  (2026-07-23), which mapped the pipeline from code and live-tested two real
  artifacts (a garbled coach reply, a test-tone upload) before generating
  improvement ideas. Every item here traces to a real file:line, not a guess.
- Standing product constraints (`feedback_spectr-coaching-product-philosophy`
  memory) govern every judgment call below: **additive-only** (repair, don't
  rip out); **score/grade is not the product** (never make a score the
  payoff of anything built here); **audio-file-first** (all fixes work on a
  bare WAV/FLAC upload, no .als required); **first upload is the conversion
  moment** (the genre-confirm and suspected-flag items directly touch what a
  brand-new user sees on their very first report).
- Each item independently closes a trust gap: a rhythm score that's silently
  always wrong (item 4), a routing brain reasoning half-blind (item 5), a
  hedge the system already computes but never shows (item 6), a garbled coach
  reply that erodes trust in everything else it says (item 2), and a genre
  guess conditioning five downstream phases with no way for the user to
  correct it (item 1).

## What

Numbering below matches `PRPs/source/INITIAL.md` items 1/2/4/5/6 (item 3 is
the split-out item — see Scope note).

| # | Item | Component(s) | Nature |
|---|---|---|---|
| 4 | `onset_density` wiring fix | analysis | 1-line data-source swap |
| 5 | Triage receives rule-engine findings | worker | DB query + prompt edit |
| 6 | Surface the `suspected` flag | worker + frontend | render logic + 2 plumbing lines |
| 2 | Coach reply chunk-reordering bug | worker + bff | **repro + root-cause confirmation only, no fix** |
| 1 | Genre confirm/correct chip | analysis + worker + bff + frontend | cascade rerun + new UI affordance |

Task order below is by ascending complexity/risk, which is also a sensible
implementation sequence — each is independently committable and shippable.

### Success Criteria

- [ ] Item 4: a real (non-fixture) analyzed track's `danceability_score` changes from its
      previously-always-zero-rhythm-component value once `transients_per_second` feeds the
      rollup; `components/analysis/tests/` gains a unit test asserting the wiring.
- [ ] Item 5: `build_triage_user_message`'s `rule_engine_findings` payload is non-empty for
      any analysis that has rule-engine `Verdict` rows at the time Triage runs; `Triage.md`
      references the field so the model is instructed to use it, not just receive it.
- [ ] Item 6: a `suspected=true` finding renders with a visibly distinct treatment in
      Findings (and, if time allows within this PRP's scope, Moves); the coach's LLM prompt
      context includes `suspected` per verdict.
- [ ] Item 2: a new automated test exists that asserts **order** (not just presence) of
      rapid/concurrent coach SSE frames; its outcome (pass or documented-and-tracked
      failure) is the deliverable. **No product fix is written in this PRP.**
- [ ] Item 1: correcting the detected genre on a completed analysis re-runs phases 2/3/5/6
      (not 7) and the rule engine, and the corrected genre is reflected in `overall_score`,
      `danceability_score`, the verdict-layer `genre_map` resolution, and all rule findings —
      not just the displayed genre label.
- [ ] All four validation-gate levels pass per component touched (see Validation Loop).
- [ ] Every discovered pre-existing gap called out below (Song.GenreHint dead wiring,
      `_hydrate()`'s `source` mislabeling) is **documented, not silently fixed** — out of
      scope for this PRP.

## Scope note: item 3 (content-type gate) is split into its own PRP

`PRPs/source/INITIAL.md` flagged this explicitly: *"If /generate-prp's research finds the
surface area doesn't fit cleanly alongside the other five smaller items... it should be
split into its own PRP rather than forced into this bundle."* Research confirms the split:

- Even the **minimal** version (gate test-tone/silence/non-audio only, honest messaging,
  no partial-input scoring) touches **~17 files across all 4 components** (Python analysis
  package, Python worker, C# BFF, TypeScript frontend) — a 6-10x larger footprint than any
  other item here, and the only item that is *structurally* cross-component rather than
  contained-with-a-BFF-hop.
- It collides with `final_json`'s schema, which project memory
  (`project_final-json-schema-drift`) already flags as fragile/inconsistent across 3
  producer/consumer schemas — this deserves isolated review, not a drive-by.
- Its verification shape (synthetic degenerate-audio fixtures run end-to-end through
  deterministic phases + rule engine + LLM grounding, 3 independent surfaces) doesn't
  compose with the other four items' single-component test runs.
- A **full** version (partial-input scoping — loops/stems/single-instrument with
  per-dimension skip) is a separate, much larger effort (~25-35+ files, touches nearly
  every phase module + the full rule corpus + the prompt library + multiple frontend tabs)
  — a multi-week epic, not a quick win.

See `PRPs/content-type-honesty-gate.md` for the scoped-out PRP (minimal gate only; the
full partial-input version is named there as explicitly deferred, not dropped).

## All Needed Context

### Documentation & References

```yaml
- file: CLAUDE.md
  why: Validation gates (single source, cited not duplicated below), worker/bff/frontend
       stack rules, the `credits_enabled`/feature-flag pattern, per-phase rerun gotcha.

- file: _bmad-output/brainstorming/brainstorming-session-2026-07-23-1357.md
  why: Origin of all 5 items; "Quick-win repair list" + facilitator idea #46; the two
       live-artifact critiques (garbled coach reply, test-tone beep) that motivated
       items 2 and (split-out) 3.

- memory: feedback_spectr-coaching-product-philosophy
  why: 4 standing constraints (additive-only, score-not-product, audio-first,
       first-upload-is-conversion) — apply to every judgment call in this PRP.

- memory: project_identify-solve-architecture
  why: The two-pass `@single`/`@composite` Problem engine (rule_engine.py) and SOLVE tier
       that items 1 and 5 both touch; v3 closeout context (legacy `@rule` retired
       2026-07-23 — do not resurrect flat-rule patterns).

- memory: project_final-json-schema-drift
  why: `final_json` / prompt-field schema history. Relevant if item 1's cascade or item
       5's triage-prompt edit touches phase field names — verify against
       `schemas/final_json.contract.json`, not against older docs.

- file: PRPs/archive/2026-04-24_gap-13-danceability-score.md
  why: Original PRP that introduced the danceability scorer and the exact dead-fallback
       formula item 4 fixes; its own anti-patterns section already warns "don't use raw
       onset count in place of onset density."

- file: PRPs/archive/2026-06-16_per-phase-rerun.md
  why: Original design for the `/phases/{phase}/rerun` endpoint item 1 extends. Read
       before modifying `ReportPhaseEndpoints.cs`/`rerun_phase_actor.py` to preserve its
       "progress-vehicle AnalysisJob, never a second Analysis row" invariant.
```

### Known Gotchas specific to this PRP

```text
# item 1 — rerun_single_phase has ZERO cascade today (confirmed by its own docstring,
# components/analysis/src/audio_analysis/pipeline.py:279,284-285): "No cascade —
# re-running phase N does NOT re-run its dependents." Do not assume the existing
# /phases/{phase}/rerun endpoint already handles multi-phase correction — it doesn't.

# item 1 — run_rule_engine_for_analysis (degraded.py:73-146) is a pure EXISTENCE check
# ("returns 0 without writing if any rule-engine row already exists"), not a staleness
# check. Re-invoking it after a genre-corrected rerun silently no-ops unless stale rows
# are cleared first.

# item 1 — Phase 7 (arrangement) accepts a `genre` param but it is PROVABLY INERT
# (phase7_arrangement.py docstring: "currently informational only"; only used in a debug
# log line). Do not include phase 7 in the rerun cascade — it buys nothing and wastes
# ~1-2s of allin1-adjacent work.

# item 1 — DISCOVERED, OUT OF SCOPE: Song.GenreHint (the upload-time "genre hint"
# free-text field, components/bff/src/Spectr.Data/Entities/Song.cs:18-19) is captured
# and stored but NEVER reaches run_pipeline — analyze_audio_job's enqueue omits it
# entirely. The frontend copy ("helps analysis") is currently false. This PRP's item 1
# is about the POST-analysis correction path only; do not conflate the two or silently
# "fix" the pre-analysis path as a bonus — flag it as a separate follow-up.

# item 1/5 — DISCOVERED, OUT OF SCOPE: verdict_actor.py::_hydrate() never explicitly sets
# `source` on LLM specialist Verdicts, so the pydantic default (source="rule_engine")
# leaks through — every on-demand specialist verdict is persisted with
# source="rule_engine" despite not being a rule-engine finding. validator.py's own
# `_is_deterministic()` already works around this by ALSO checking
# `specialist == "rule_engine" OR specialist.startswith("rule_engine.")` — mirror that
# same double-condition in any new query/delete this PRP adds (items 1 and 5 both do).
# Do not fix _hydrate() itself here — undetermined blast radius, separate concern.

# item 2 — do NOT design or implement a fix. Per INITIAL.md: "needs a
# systematic-debugging-style live-repro pass BEFORE a fix is designed... scope a
# reproduction + root-cause step, then the fix once the actual site is confirmed."

# item 4 — no golden/snapshot test actually guards run_pipeline's full output
# byte-identically (components/analysis/tests/integration/test_phase_snapshots.py only
# snapshots raw phase4/phase5 dicts, bypassing run_pipeline entirely). Do not assume a
# snapshot regen step is needed — there is nothing to regenerate for this fix.

# item 6 — `suspected` is ALREADY fully plumbed end-to-end (rule_engine.py → Pydantic →
# SQLAlchemy → EF Core → VerdictDto → frontend TS type). Do not touch any of those
# layers — the only gaps are FindingsTab.tsx's render logic, MoveCard.tsx's Move
# conversion, and one dict key in the coach's prompt-assembly function.
```

## Implementation Blueprint

---
### Task 1 — `onset_density` wiring fix (item 4) — component: `analysis`

**Files:**
- `components/analysis/src/audio_analysis/pipeline.py` (fix site, lines 162-166 of
  `finalize_result`)
- `components/analysis/src/audio_analysis/phases/phase1_universal.py` (source of truth,
  `transients` dict at lines 431-442/509 — read-only, no change needed)
- `components/analysis/tests/test_pipeline.py` and/or a new
  `components/analysis/tests/test_danceability_wiring.py`

**Current dead code** (`pipeline.py:162-166`):
```python
onset_density = p2.get("onset_density")
if onset_density is None:
    dur = p1.get("duration_seconds", 0)
    onset_count = p2.get("onset_count", 0)
    onset_density = float(onset_count) / dur if dur > 0 else 4.0
```
`p2` (Phase 2 output) never emits `onset_density`/`onset_count` — confirmed by a
whole-file grep of `phase2_genre.py`, zero matches. Every real track falls through to
`onset_count=0` → `onset_density=0.0`, zeroing the 40%-weighted rhythm term in
`scorers/danceability.py:57-58` (`rhythm_score = min(1.0, onset_density / 8.0)`).

**Fix:**
```python
p1 = phase_data.get(1, {})
transients = p1.get("transients", {})
onset_density = transients.get("transients_per_second")
if onset_density is None:
    onset_density = 4.0  # preserve existing degenerate-input fallback
```
`transients_per_second` (`phase1_universal.py:434-442`) is already `len(onsets) /
duration_seconds` over the **whole track** — the exact unit `danceability.py` expects
(a per-second rate divided by an 8.0 onsets/sec ceiling). **No unit conversion needed** —
this is a pointer swap, not a formula change.

**Test note:** `components/analysis/tests/test_rerun.py`'s `_prior()` fixture has no
`"transients"` key in its phase-1 sub-dict — the new code's `.get("transients", {})`
default handles this gracefully (falls through to the `4.0` fallback), but eyeball this
fixture after the change to confirm no test silently starts asserting a stale value.
`test_pipeline.py`'s `TestPipeline` class exercises real `run_pipeline()` — add or extend
an assertion there (or the new dedicated test file) that runs the pipeline on a real
fixture track and asserts `danceability_score` reflects a non-degenerate rhythm term
(e.g. compare against the same track re-scored with the pre-fix formula, or assert
`> 0` when `transients_per_second > 0`).

**Confirmed unaffected (no changes needed):** `onset_density`/`onset_count` have no
other readers anywhere in the repo (repo-wide grep, code only). Downstream consumers of
the *output* `danceability_score` (rule_engine.py, coach_lib/context.py,
tools/inspector/stage_map.py, BFF's `ShareReportProjection.cs`/`AnonReportProjection.cs`)
all test with hand-picked literal fixture numbers, not the real calculator — unaffected.

---
### Task 2 — Triage receives rule-engine findings (item 5) — component: `worker`

**Files:**
- `components/worker/app/triage_actor.py` (fix site — **note: NOT under `verdict_lib/`,
  correcting INITIAL.md's citation**; Phase A session at lines 70-98, target call at
  line 110)
- `components/worker/app/verdict_lib/input_grounding.py`
  (`build_triage_user_message`, lines 173-203 — already correct, no change needed)
- `components/worker/prompts/experts/Triage.md` (prompt edit — **required for the fix to
  actually change triage behavior, not just its plumbing**)
- `components/worker/tests/test_triage_actor_terminal.py` (extend `_FakeSession`)
- `components/worker/tests/verdict_pipeline/test_triage.py` (pattern to mirror for a new
  actor-path test)

**Step 1 — query rule-engine rows inside Phase A's existing session.**
`SessionFactory` has `expire_on_commit=False` (`db_sync.py:29`), so ORM rows fetched
inside the `with SessionFactory.begin() as s:` block (lines 71-98) stay safely readable
as plain locals after the block closes — exactly how `raw_final`/`caller_id` are already
extracted. Add, inside that same block:
```python
from sqlalchemy import select
from aimusic_shared.models import Verdict as VerdictRow
...
rule_rows = s.execute(
    select(VerdictRow)
    .where(VerdictRow.analysis_id == aid)
    .where(VerdictRow.source == "rule_engine")
    .where(
        (VerdictRow.specialist == "rule_engine")
        | (VerdictRow.specialist.startswith("rule_engine."))
    )
    .order_by(VerdictRow.priority_score.desc())
).scalars().all()
```
The extra `specialist` condition mirrors `validator.py::_is_deterministic()` exactly —
see the gotcha above about `_hydrate()`'s `source` mislabeling. Without it, a specialist
verdict written via a direct `RunSpecialist` call before the routing plan exists (no
guard prevents this — confirmed in `VerdictEndpoints.cs`) would be wrongly swept in.

**Step 2 — pass it through.** Change line 110:
```python
user_msg = build_triage_user_message(flattened, rule_rows)
```
No shape transform needed — `input_grounding.py`'s `rule_summary` list comprehension
reads `.category`/`.severity`/`.headline` as **attributes**, which plain ORM `Verdict`
rows already satisfy (this is what the existing "duck-typed... to avoid a model import
cycle" docstring comment anticipates).

**Step 3 — make Triage.md actually use it.** `components/worker/prompts/experts/Triage.md`
currently has its own from-scratch Detection Rules table and never mentions
`rule_engine_findings` at all. Populating the field without this step achieves nothing
behaviorally. Add a short section instructing the model to treat `rule_engine_findings`
entries as already-confirmed deterministic findings — cross-reference them against its
own detection table rather than re-deriving independently, and avoid contradicting or
duplicating a finding already present there. Bump the prompt's frontmatter version (per
CLAUDE.md's "verdict cache key includes every prompt's frontmatter version" gotcha).

**Step 4 — fix the stale docstring.** `input_grounding.py:173-203`'s docstring claims
"the worker lazy-fire path never runs the rule engine" — false since Phase C2
(`tasks_dramatiq.py:428-436`) now runs it unconditionally. Update the comment as part of
this change so it doesn't mislead the next reader.

**Test changes (required, not optional):** `test_triage_actor_terminal.py`'s
`_FakeSession` implements only `__enter__`/`__exit__`/`.get()` — no `.execute()`. Two of
its three tests progress through Phase A into Phase D and **will break** with
`AttributeError` once the query is added, until `_FakeSession` gains an `.execute()`
stub (mirror `test_degraded_path.py`'s `_FakeSession._Result` pattern, extended with a
`.scalars().all()` branch). Add one new happy-path test asserting the constructed
`user=` payload (spy on `gateway.complete_sync`) contains injected rule-engine content —
mirror `test_triage.py::test_triage_includes_rule_verdicts_in_user_message`'s pattern
(that test covers the non-production `verdict_lib/triage.py` path; this one covers the
real actor).

---
### Task 3 — Surface the `suspected` flag (item 6) — component: `worker` + `frontend`

**Files:**
- `components/frontend-spectr-v2/src/features/results/FindingsTab.tsx` (primary
  deliverable — `FindingCard`, lines 184-258)
- `components/frontend-spectr-v2/src/features/results/redesign.css` (chip CSS, lines
  1684-1723 for the existing AI/Measured pattern)
- `components/frontend-spectr-v2/src/features/results/move-model.ts` (`Move` interface,
  lines 42-81; `verdictToMove`, lines 171-205) and `MoveCard.tsx`
- `components/worker/app/coach_actor.py` (`_load_verdicts_for_bundle`, lines 667-699)
- `components/worker/prompts/coach/CoachGrounded.md`

**Already fully plumbed, confirmed, do not touch:** rule definition (`rule_engine.py`) →
Pydantic `Verdict.suspected` (`aimusic_shared/verdicts/models.py:195`) → SQLAlchemy
column (`aimusic_shared/models.py:392`) → EF Core `Verdict.cs:100-101` → `VerdictDto`
(`VerdictDtos.cs:40`, mapped `VerdictEndpoints.cs:281`) → frontend TS
`VerdictDto.suspected` (`types.ts:1276`). The data already arrives at the frontend
component today — the gap is purely render logic.

**Step 1 — Findings render.** In `FindingsTab.tsx`'s `FindingCard`, add a small chip
alongside (not replacing) the existing AI/Measured source chip:
```tsx
{v.suspected && (
  <span className="src suspected" title="Threshold not yet corpus-validated — treat as a hint, not a certainty">
    Unverified
  </span>
)}
```
Add a third CSS variant next to `.src.measured`/`.src.ai` (`redesign.css:1684-1723`),
reusing the existing amber/caution tone (`--yellow`/`--sev-moderate` in `tokens.css`) or
the codebase's established dashed-border "provisional" convention (already used in
`features/listen-rack/rail.tsx:862,938`, `SuggestionCard.module.css`, etc.) — either is
in-vocabulary; do not invent a new visual language per CLAUDE.md's frontend note.
`suspected` is orthogonal to source (a Measured/rule-engine finding can itself be
suspected), so it must render as an **additional** chip, not a third mutually-exclusive
value of the existing `.src` classification.

**Step 2 — Moves render (stretch goal within this task, not blocking).** `Move`
(`move-model.ts:42-81`) has no `suspected` field; `verdictToMove` (lines 171-205) reads
`v.confidence` but drops `v.suspected` even though it's present on the source
`VerdictDto` — a straight, easy-to-restore drop. Add `suspected?: boolean` to the `Move`
interface, thread `suspected: v.suspected` through `verdictToMove`, default to `false`/
absent in `ruleFixToMove` (legacy string-array path has no such data to give). Mirror the
same chip treatment in `MoveCard.tsx` (`.move-src` pattern, lines 58/101 — same
orthogonality caveat applies: today `MoveCard` doesn't even distinguish rule-engine from
LLM-specialist provenance, so this is additive, not a collision).

**Step 3 — Coach prompt awareness.** `coach_actor.py::_load_verdicts_for_bundle`
(lines 685-694) is the single field-selection choke point — it projects exactly 7 named
fields per verdict row into the dict that gets `json.dumps`'d wholesale into the coach's
prompt. Add one key:
```python
"suspected": r.suspected,
```
This alone makes the field visible to the LLM (no changes needed in `context.py` or the
serialization code — confirmed a blind passthrough). To get the coach to actually *hedge*
its language, add a short addendum to `components/worker/prompts/coach/CoachGrounded.md`
(currently silent on `suspected` entirely): instruct the model that a `suspected: true`
verdict's threshold is unverified and its language should hedge accordingly rather than
state it as settled fact. Bump the prompt's frontmatter version.

**Tests:** `FindingsTab.trackchip.test.tsx` already has `suspected: false` boilerplate in
its `makeVerdict()` fixture (line 36) — add a `suspected: true` case asserting the new
chip renders. Extend `move-model.test.ts` similarly once Step 2 lands. No worker-side
test currently covers `_load_verdicts_for_bundle`'s exact field set — add an assertion
that `suspected` is present in its output dict.

---
### Task 4 — Coach reply chunk-reordering: repro + root-cause confirmation (item 2) — component: `worker` + `bff`

**No product fix in this task.** Deliverable is a confirmed-or-refuted root cause backed
by an automated, repeatable test, per INITIAL.md's explicit instruction.

**Background:** a real coach reply rendered two prose chunks swapped
("...cking up down there. First, the clasTwo things are sta[cking]..." — decodes to two
whole chunks reordered, not corrupted mid-chunk). `stream_parser.py`'s `StreamSplitter`
is already ruled out (publishes strictly append-only, exhaustively tested) — the swap is
at chunk granularity, upstream or downstream of it.

**Leading hypothesis (from research, not yet live-confirmed):**
`components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:442-449` subscribes
via `sub.SubscribeAsync(channelName, Handler)` — StackExchange.Redis's **delegate**
subscribe overload. Per the library's own docs
([PubSubOrder.md](https://github.com/StackExchange/StackExchange.Redis/blob/main/docs/PubSubOrder.md)),
this form gives **no ordering guarantee** under concurrent dispatch — unlike
`Subscribe(channel).OnMessage(handler)`, which processes "in exactly the same order in
which they are received (via a queue)." The bounded channel it writes into is already
configured `SingleWriter = false` (line 438), meaning the code already accommodates
`Handler` firing on multiple threads — nothing downstream re-establishes order. Notably,
the newer Listen V3 room feature's `RoomBus.cs` explicitly generalizes this exact
pub/sub pattern and adds a monotonic `seq` (Lua `INCR`+`RPUSH`) that the coach relay never
got — suggestive, not conclusive.

**Step 1 — add an order-asserting automated test.** Extend
`components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs`'s existing
`Stream_Live_Subscribe_Forwards_Published_Frames` test (which today only asserts
*presence* via `Assert.Contains`, never order). Add a new test that:
- Publishes N frames (10-50) in rapid/near-simultaneous succession with a
  **recognizable, order-obvious payload** (e.g. `"chunk-0"`, `"chunk-1"`, ... — not prose
  that needs eyeballing to detect a swap).
- Asserts the frames arrive at the SSE consumer in **publish order**, not just that all N
  are present.
- Runs at both low concurrency (1 publisher — expected to always pass) and high
  concurrency (many simultaneous conversations sharing the same
  `IConnectionMultiplexer` singleton per `Program.cs:230-238` — expected to fail if the
  hypothesis is correct) so the comparison itself is evidence.

**Step 2 — targeted diagnostic logging (temporary or permanent, implementer's call).**
- Worker: log `(assistant_message_id, chunk_index, len, chunk[:20])` immediately before
  `publisher.token(prose_chunk)` in `coach_actor.py:535`.
- BFF: log `(channel, receivedAtUtcTicks, Environment.CurrentManagedThreadId, payload)`
  the instant `Handler` fires (`CoachConversationEndpoints.cs:442`), before `TryWrite`.
  Different thread IDs across consecutive same-channel invocations is direct proof
  concurrent dispatch is actually happening (not just theoretically possible).
- BFF: log the same chunk index at the point `RelayLoop` writes each frame (line ~526),
  to localize whether inversion happens at Handler-fire time or between fire and write.

**Step 3 — manufacture concurrency for a live-stack repro.** Using `LLM_FAKE=1`'s
deterministic ≥3-chunk fake stream (`llm/streaming.py:283-286`), fire 20-50 simultaneous
coach conversations against a dev stack (start per `docs/STARTUP.md`) and capture raw SSE
bytes directly off `/stream` (bypassing the frontend, e.g. `curl -N`) to attribute any
reordering unambiguously to a specific hop.

**Step 4 — document and gate the outcome, do not fix.**
- If the new order-asserting test **fails** (reproduces the bug): that IS the confirmed
  root-cause deliverable. Mark the test `[Fact(Skip = "Confirmed bug — see
  PRPs/coach-stream-ordering-fix.md, tracked for a follow-up PRP")]` so CI stays green
  while the evidence is preserved, and open that follow-up PRP stub. **Do not attempt the
  fix here** — per INITIAL.md's explicit instruction and because a fix (e.g. switching to
  the ordered `ChannelMessageQueue` subscription form) deserves its own scoped
  review/rollout given it touches a process-wide singleton multiplexer shared with the
  Room feature.
- If it **passes** at both concurrency levels: broaden further (more simultaneous
  conversations, inject jittered delay in a diagnostic copy of `Handler` to widen the race
  window) before concluding the hypothesis doesn't hold; document whichever conclusion is
  reached and what was ruled out, so this isn't re-investigated from scratch later.

**Ruled out already (do not re-investigate):** worker's synchronous Phase D loop, the
producer-thread/queue bridge in `llm/streaming.py`, BFF's `RelayLoop` (single sequential
writer to the response body), and the frontend's SSE consumption (`CoachChat.tsx:391-451`,
single `while(true)` loop, functional `setTurns` updater — if a swap is visible in
rendered output, the browser already received it swapped over the wire).

---
### Task 5 — Genre confirm/correct chip (item 1) — component: `analysis` + `worker` + `bff` + `frontend`

**Scope correction from INITIAL.md:** this is **not** "primarily a UI + wiring problem."
`rerun_single_phase` has zero cascade behavior today, and the rule-engine's idempotency
guard is a pure existence check that will silently no-op a post-correction refresh unless
handled. This is the largest item in the bundle — still containable in one PR (no
rule-corpus-wide changes, no new classifier, no prompt-library sweep), but budget it as
such.

**Files:**
- `components/analysis/src/audio_analysis/pipeline.py` (`rerun_single_phase`,
  lines 265-337 — add a `genre_hint` param)
- `components/worker/app/rerun_phase_actor.py` (54-232 — add cascade orchestration)
- `components/worker/app/verdict_lib/degraded.py` (`run_rule_engine_for_analysis`,
  lines 73-146 — add a `force` path)
- `components/bff/src/Spectr.Bff/DTOs/VersionDtos.cs` (`RerunPhaseRequest`, line 40)
- `components/bff/src/Spectr.Bff/Endpoints/ReportPhaseEndpoints.cs` (`RerunPhase`
  handler, lines 25-82)
- `components/frontend-spectr-v2/src/features/results/AnalysisCompleteModal.tsx`
  (primary insertion point) and `SongHeader.tsx:64` (secondary/persistent surface)
- `components/frontend-spectr-v2/src/api/hooks.ts` (new hook — `useRerunPhase` was
  deleted in story 12.5; comment at lines 559-563 left explicit re-homing guidance)

**Step 1 — confirm the cascade set (already researched, do not re-derive):**

| Phase | Reads genre? | Include in cascade? |
|---|---|---|
| 3 (`phase3_genre_specific.py:136-166`) | Yes — dispatches to a different scorer per genre | **Yes** |
| 5 (`phase5_reference.py:31-99`) | Yes — builds `genre_context` from a genre preset | **Yes** |
| 6 (`phase6_gap.py:170-239`) | Yes — selects statistical profile/reference dir by genre | **Yes** |
| 7 (`phase7_arrangement.py:13-57`) | Accepted as a param but **provably inert** (docstring: "informational only"; only used in a debug log) | **No — excluded** |
| rollup (`finalize_result`) | `danceability_score` reads genre for BPM-ideal lookup | Self-corrects automatically on any rerun — no extra step |

Verdict-layer `genre_map` (`components/worker/app/verdict_lib/genre_config.py:56-59`,
reading `rule-bindings.json`'s `genre_map`) is consumed pervasively by `rule_engine.py`'s
`_genre(a)` helper across dozens of rule predicates — this is why the rule engine must
also be re-run after the cascade, not just the phases.

**Step 2 — `pipeline.py`: thread `genre_hint` into `rerun_single_phase`.** Currently
hardcodes `genre_hint=None` at line 310 when dispatching phase 2. Add a `genre_hint:
str | None = None` parameter to `rerun_single_phase`'s signature, used only when
`phase_num == 2`:
```python
new_pr = run_single_phase(
    phase_num,
    ...,
    genre_hint=genre_hint,   # was: genre_hint=None
    ...
)
```
No other change needed inside this function — `phase2_genre.classify()` already
implements the "trust it, confidence 1.0" override (`phase2_genre.py:32-34`), and
`run_single_phase`/`finalize_result` already recompute every rollup field from whatever
is in `phase_data` on every call.

**Step 3 — `rerun_phase_actor.py`: orchestrate the sequential cascade.** The existing
actor (lines 54-232) does exactly one `rerun_single_phase` call (Phase B, lines 171-197)
then persists (Phase C, lines 199-226). Extend the signature:
```python
def rerun_phase(
    rerun_job_id: str,
    analysis_id: str,
    phase: int,
    reference_profile: dict | None = None,
    genre_hint: str | None = None,
) -> None:
```
When `phase == 2 and genre_hint is not None`: after Phase A resolves `prior_final` and
source paths (unchanged), loop Phase B across `[2, 3, 5, 6]` — each call's output
`PipelineResult` becomes the next call's `prior_result`:
```python
merged = prior_final
for cascade_phase in (2, 3, 5, 6):
    merged = rerun_single_phase(
        cascade_phase, file_abs or "", merged,
        reference_path=reference_abs, als_file_path=als_abs,
        stem_paths=stem_paths, stem_mode=stem_mode,
        genre_hint=genre_hint if cascade_phase == 2 else None,
        progress_cb=_report_progress,
    )
merged_safe = json.loads(json.dumps(merged, default=str))
```
Otherwise, fall through to the existing single-phase behavior unchanged (back-compat for
the phase-6 reference-profile override, which stays a single-phase rerun). After Phase C
persists `merged_safe` (unchanged code), call the rule-engine refresh:
```python
from .verdict_lib.degraded import run_rule_engine_for_analysis
run_rule_engine_for_analysis(aid, force=True)
```

**Step 4 — `degraded.py`: add a `force` path to clear stale rows.**
`run_rule_engine_for_analysis` (lines 73-146) currently does a pure existence check
(lines 97-104) that returns `0` (no-op) if any `source="rule_engine"` row exists — correct
for the normal one-shot-per-analysis case, wrong for a deliberate refresh. Add:
```python
def run_rule_engine_for_analysis(analysis_id: uuid.UUID, force: bool = False) -> int:
    ...
    with SessionFactory.begin() as s:
        analysis = s.get(Analysis, analysis_id)
        if analysis is None:
            return 0
        if force:
            s.execute(
                delete(VerdictRow)
                .where(VerdictRow.analysis_id == analysis_id)
                .where(VerdictRow.source == "rule_engine")
                .where(
                    (VerdictRow.specialist == "rule_engine")
                    | (VerdictRow.specialist.startswith("rule_engine."))
                )
            )
        else:
            existing = s.execute(select(VerdictRow.id)...).first()
            if existing is not None:
                return 0
        ...  # existing evaluate_problems() / SOLVE merge / validate / s.add loop, unchanged
```
The `specialist` condition on the delete mirrors `validator._is_deterministic()` (see
the `_hydrate()` gotcha above) so a mis-tagged specialist row is never wrongly deleted.

**Step 5 — BFF: thread `genre_hint` through the DTO + enqueue.**
```csharp
// VersionDtos.cs:40
public sealed record RerunPhaseRequest(ReferenceProfileRef? ReferenceProfile, string? GenreHint);
```
```csharp
// ReportPhaseEndpoints.cs — RerunPhase handler
// Validation: reject GenreHint set with phase != 2 via the existing ErrorEnvelope pattern.
await queue.EnqueueAsync(
    DramatiqTasks.RerunPhase,
    new object[] { rerunJobId.ToString(), analysis.Id.ToString(), phase.ToString(), resolvedProfile!, body?.GenreHint! },
    DramatiqQueues.AnalysisPaid,
    ct);
```
This is the same extension pattern the phase-6 `ReferenceProfile` override already
established — no new endpoint, no new DTO family.

**Step 6 — frontend: hook + UI.** No live caller of the rerun endpoint exists today
(`useRerunPhase` was deleted in story 12.5) — author a new hook (e.g. `useConfirmGenre`)
in `hooks.ts` that POSTs `{ phase: 2, genreHint }` to the existing endpoint, then polls
and invalidates `['jobs', jobId, 'results']` per the guidance already left at lines
559-563. Genre correction input should be a **small fixed choice list matching Phase 2's
actual categories** (`trance`/`house`/`techno`/`dnb`/`other` — the same vocabulary
`phase2_genre.classify()` assigns), not free text, so `genre_hint` values flowing into
the pipeline are always ones the classifier and `genre_map` already know how to resolve.

Primary surface: `AnalysisCompleteModal.tsx` (the first-touch/conversion-moment surface
per its own header comment) — replace the plain genre `<span>` (~lines 177-182) with an
interactive confirm/correct affordance using the existing `.chip`/`.chip.add` pattern
already defined in `redesign.css:112-143` and used for the "+ Add stems/.als/reference"
chips in `SongHeader.tsx:77-81` — no new interactive-chip CSS needed. Secondary/persistent
surface: `SongHeader.tsx:64`'s `.rh-genre`, for users revisiting a report later.

**Tests:** worker — extend `components/worker/tests/test_rerun_phase.py` (the actor-level
test, 98 lines) with a cascade-path case (mock or fixture-drive 4 sequential
`rerun_single_phase` calls) and a `force=True` case for `degraded.py`. Analysis —
`components/analysis/tests/test_rerun.py` gains a `genre_hint` passthrough case. BFF —
new DTO field + `phase != 2` rejection test. Frontend — a component test asserting the
new hook fires with the expected `{ phase: 2, genreHint }` payload on correction.

## Validation Loop

Standard gates per CLAUDE.md — run only for components actually touched by each task.

### Level 1: Syntax & Style
```bash
# analysis / worker (Tasks 1, 2, 3, 4, 5)
ruff check components/analysis/ components/worker/
mypy components/analysis/ components/worker/app/ --ignore-missing-imports

# bff (Tasks 4, 5)
cd components/bff && dotnet build

# frontend (Tasks 3, 5)
cd components/frontend-spectr-v2 && npx tsc --noEmit
cd components/frontend-spectr-v2 && npm run lint    # --max-warnings 0
```

### Level 2: Unit Tests
```bash
# Task 1
pytest -q components/analysis/tests/test_pipeline.py components/analysis/tests/test_rerun.py

# Task 2
pytest -q components/worker/tests/test_triage_actor_terminal.py components/worker/tests/verdict_pipeline/test_triage.py

# Task 3
pytest -q components/worker/tests/test_coach_actor.py
cd components/frontend-spectr-v2 && npx vitest run src/features/results/__tests__/FindingsTab.trackchip.test.tsx

# Task 4 (repro test, not a fix — outcome documented either way)
cd components/bff && dotnet test --filter CoachStreamEndpointTests

# Task 5
pytest -q components/analysis/tests/test_rerun.py components/worker/tests/test_rerun_phase.py
cd components/bff && dotnet test

# Full aggregate before considering the bundle done
pytest -q components/analysis/tests/ components/worker/tests/
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run
```

### Level 3: Integration
```bash
# Start the stack per docs/STARTUP.md (canonical) — ./scripts/start-spectr.ps1
curl -f http://localhost:5174 && echo "Frontend OK"
curl -f http://localhost:5000/healthz && echo "BFF OK"

# Task 5 manual check: upload a track, correct the genre chip on the completed report,
# confirm overall_score/grade and danceability_score change (not just the label), and
# that new rule-engine Verdict rows reflect the corrected genre's thresholds.
# Task 4 manual check (if the automated repro test doesn't reproduce): follow the
# concurrency-manufacturing repro in Task 4 Step 3 against the live stack.
```

## Final Validation Checklist
- [ ] `ruff check` + `mypy` clean for `components/analysis/` and `components/worker/`
- [ ] `dotnet build && dotnet test` clean for `components/bff/`
- [ ] All 4 frontend gates clean: `tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run`
- [ ] Task 1: danceability score demonstrably non-zero-rhythm-component on a real track
- [ ] Task 2: `Triage.md` frontmatter version bumped; a live/fixture analysis with
      existing rule-engine rows produces a non-empty `rule_engine_findings` triage payload
- [ ] Task 3: a `suspected: true` fixture renders the new chip; coach prompt bundle
      includes `suspected` per verdict
- [ ] Task 4: new order-asserting BFF test committed; outcome (pass/documented-fail)
      recorded; **no fix code included**
- [ ] Task 5: genre correction round-trips through phases 2/3/5/6 (not 7), rule-engine
      rows refresh, no duplicate/stale rows left behind
- [ ] Every "discovered, out of scope" gotcha above is called out in the PR description,
      not silently fixed or silently dropped

---

## Anti-Patterns to Avoid
- Don't design or merge a fix for item 2 (coach streaming bug) in this PRP — repro and
  root-cause confirmation only, per explicit instruction.
- Don't fold item 3 (content-type gate) back into this bundle "since it's related" — it's
  split out for concrete, researched reasons (see Scope note); implement it via
  `PRPs/content-type-honesty-gate.md` instead.
- Don't silently fix the two discovered pre-existing bugs (`Song.GenreHint` dead wiring,
  `_hydrate()`'s `source` mislabeling) as drive-by "while I'm in there" changes — flag
  them, don't touch them.
- Don't copy the bare `source == "rule_engine"` filter pattern from the existing
  idempotency-check helpers into new code without the `specialist` condition — those
  helpers are safe only in their narrow original context (nothing else exists yet for a
  fresh analysis), which doesn't hold in general.
- Don't include Phase 7 in the item-1 rerun cascade — its `genre` param is provably inert;
  re-running it wastes time and proves nothing.
- Don't invent new CSS/visual language for the `suspected` treatment — reuse the existing
  `.pill[.tone]`/dashed-border/chip vocabulary already in the codebase.
- Don't make genre correction free-text — constrain it to Phase 2's actual output
  categories so `genre_hint` always resolves cleanly downstream.
- Don't treat a passing item-4 fix as needing a golden-snapshot regen — no such snapshot
  covers this code path; confirm via the cited test files, not an assumed regen step.
