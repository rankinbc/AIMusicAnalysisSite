<!--
  INITIAL.md — feature intake for /generate-prp.

  Feature: First-upload trust & accuracy quick-wins bundle
  Authored: 2026-07-23 from docs/archive/brainstorming/brainstorming-session-2026-07-23-1357.md
  (Quick-win repair list + facilitator idea #46), grounded in two Explore-agent code maps
  from the same session.
-->

## FEATURE

Six small, independently-shippable fixes that repair places where the analysis/coaching
pipeline currently misleads the user or leaves known-good data unused. All are additive
per CLAUDE.md's project rules — nothing here removes existing behavior, only repairs or
extends it. None depend on each other, but #5 (triage sees rule findings) is also step 1
of the larger "Mix Diagnosis & Cohesive Podium" flagship work tracked separately — doing
it now is not wasted effort either way.

1. **Genre confirm chip.** Phase 2 genre detection (`components/analysis/src/audio_analysis/phases/phase2_genre.py:42-56`)
   is BPM-window rules only (dnb/trance/house/techno/other) with hardcoded confidences
   (0.50-0.75) — no ML despite the package README's claim. Genre conditions Phase 3
   scoring, Phase 5 reference presets, Phase 6 profile selection, and the verdict-layer
   `genre_map` (`components/worker/app/verdict_lib/config/rule-bindings.json:10-19`,
   which collapses house/dnb/other all onto the `modern_trance` profile). The phase
   ALREADY supports a trusted override: `genre_hint` short-circuits detection to
   confidence 1.0 (`phase2_genre.py:32-34`) — this feature is primarily a UI + wiring
   problem, not a detection-accuracy problem.
   - Deliverable: after Phase 1+2 complete (genre can't be known before BPM is
     detected, so this is NOT literally pre-upload), surface the detected genre +
     confidence with a confirm/correct affordance. On correction, feed it back as
     `genre_hint` and re-run genre-dependent downstream phases.
   - **Open question for /generate-prp research**: the BFF already exposes per-phase
     re-run (`POST /api/reports/{jobId}/phases/{phase}/rerun`, accepts phases 2-8, see
     CLAUDE.md bff Gotchas) via the `rerun_phase` worker actor →
     `audio_analysis.rerun_single_phase`. Confirm whether re-running phase 2 alone is
     sufficient or whether phases 3/5/6/7 (all genre-conditioned) need to cascade —
     read `rerun_single_phase` in `components/analysis/src/audio_analysis/pipeline.py`
     to determine current cascade behavior before designing the UI trigger.

2. **Coach reply chunk-reordering bug.** Brian observed a real coach chat response
   where two prose fragments appeared reordered/interleaved (pasted example:
   "cking up down there. First, the clasTwo things are stasic mud zone" — decodes to
   two chunks, "Two things are sta[cking...]" and "[...]cking up down there. First, the
   clas[sic mud zone]", swapped in the rendered output). **Investigated during the
   brainstorming session**: `components/worker/app/coach_lib/stream_parser.py`
   (`StreamSplitter`) is the sentinel-aware `<<<EVIDENCE>>>` splitter and is provably
   clean by inspection — it publishes strictly append-only, in call order
   (`self._published.append(...)`, joined at `finish()`), and has its own exhaustive
   test suite (`components/worker/tests/test_coach_stream_parser.py`). The reordering
   is a CHUNK-level swap, not a sentinel-boundary corruption, which rules out this
   module as the root cause.
   - This is a bug, not a spec — needs a `systematic-debugging`-style live-repro pass
     BEFORE a fix is designed, not a guessed patch. Suspect areas to start from: the
     BFF's SSE relay for coach chat (chunk ordering/buffering across the relay hop) and
     the frontend's SSE token-accumulation in `CoachChat.tsx` (races in how deltas are
     appended to render state). Do not scope a fix in the PRP itself — scope a
     reproduction + root-cause step, then the fix once the actual site is confirmed.

3. **"Is this even a song?" input gate.** Live-tested during the brainstorming session:
   a test-tone beep was uploaded and the full pipeline — every rule threshold, every
   specialist, the coach — produced a fully confident, fully fabricated diagnosis (mud
   buildup, phase-width warnings, EQ order-of-operations) for audio that was not a song.
   Nothing in the 9-phase pipeline currently classifies input content type before
   applying full-track genre-relative thresholds.
   - Deliverable: a lightweight content-type classification (full mix / loop / single
     instrument / stem / test tone / silence / speech) that runs early (ideally as
     part of or immediately after Phase 1, before genre-relative scoring commits to a
     verdict). Degenerate inputs (tone/silence) get honest handling in the report
     ("this looks like a test tone — upload a full mix for a real analysis") instead of
     a fabricated diagnosis. Partial inputs (e.g. an 8-bar loop) get explicitly scoped
     analysis with inapplicable dimensions skipped, stated plainly — not silently
     scored as if they were a full track.
   - **Scope flag**: this item is larger than the other five (new classification logic
     + gating behavior touching multiple phases/the rule engine/the coach). If
     /generate-prp's research finds the surface area doesn't fit cleanly alongside the
     other five smaller items in one PR-sized change, it should be split into its own
     PRP rather than forced into this bundle — note that explicitly in the generated
     PRP rather than silently cutting scope.

4. **`onset_density` wiring fix.** `finalize_result` reads `onset_density`/`onset_count`
   from Phase 2's output to compute the danceability rhythm component
   (`components/analysis/src/audio_analysis/pipeline.py:162-166`), but Phase 2
   (`phase2_genre.py`) never emits those fields — so for every real track,
   `onset_density = 0/dur = 0.0`, zeroing the 40%-weighted rhythm score in
   `scorers/danceability.py:57-58`. Phase 1 already computes real transient data
   (`transients.transients_per_second`,
   `components/analysis/src/audio_analysis/phases/phase1_universal.py:434`) that is
   simply never wired to the consumer.
   - Deliverable: wire `finalize_result` (or Phase 2) to source onset/transient density
     from Phase 1's existing `transients` output instead of the dead Phase-2 field.
     Verify the danceability score changes sensibly on a golden-snapshot track
     (pipeline output is guarded byte-identical by golden snapshots per CLAUDE.md bff
     Gotchas — check whether `components/analysis/tests/` has an equivalent snapshot
     guard that needs updating).

5. **Triage receives rule-engine findings.** The triage LLM call is built with
   `rule_verdicts=None` passed from the worker
   (`components/worker/app/verdict_lib/triage_actor.py:110`), so
   `input_grounding.build_triage_user_message`'s `rule_engine_findings` list is always
   empty (`components/worker/app/verdict_lib/input_grounding.py:173-203`) — triage
   currently reasons about specialist routing while blind to everything the
   deterministic rule engine (which runs on every completed analysis, Phase C2,
   `tasks_dramatiq.py:428-436`) already found.
   - Deliverable: fetch the analysis's existing `source="rule_engine"` verdict rows and
     pass them into the triage call so routing decisions account for what's already
     been deterministically identified, instead of duplicating or ignoring it.
   - This is also literally step 1 of the separately-tracked "Mix Diagnosis & Cohesive
     Podium" flagship work — safe to land independently now.

6. **Surface the `suspected` flag.** Many Tier-A/B rule thresholds ship
   `suspected=True` because they're placeholder values pending a measured corpus (e.g.
   `sub_rumble`, `missing_sidechain`, `over_compression`, `thin_low_end`,
   `harsh_upper_mid`, `over_widened` — see
   `components/worker/app/verdict_lib/rule_engine.py` and
   `components/worker/app/verdict_lib/config/rule-bindings.json:69,107,121,137,159`).
   `VerdictDto.suspected` exists end-to-end in the data model but is currently rendered
   nowhere in the frontend — only a test fixture references it
   (`FindingsTab.trackchip.test.tsx:36`). Every finding, measured or guessed, currently
   wears the same confident voice.
   - Deliverable: a distinct visual/voice treatment for `suspected=true` findings
     (e.g. a hedged badge, "worth checking" framing, or dashed-border treatment — exact
     visual direction is a small design decision, not specified here) wired into
     whatever currently renders findings
     (`components/frontend-spectr-v2/src/features/results/.../FindingsTab.tsx` and
     `MoveCard.tsx` per the session's code map). Applies to the coach's use of these
     findings too if the coach prompt path can distinguish suspected from measured
     evidence when constructing its answer.

## COMPONENTS

### COMPONENT: worker

**Pattern**: worker conventions in CLAUDE.md (sync dramatiq actors, `aimusic_shared`
models, ruff/mypy gates)

**Purpose**: items 1 (genre re-run wiring), 2 (bug repro — likely BFF/frontend but worker
streaming code is the first place to rule out), 3 (content-type gate — new phase-adjacent
classification), 4 (onset_density wiring), 5 (triage rule-findings wiring), 6 (coach voice
treatment if the coach path is in scope)

**Notes**:
- Item 3's content-type gate should run cheaply and early — do not add expensive
  classification (e.g. a model inference pass) if a lightweight heuristic (energy
  profile, spectral flatness/entropy, duration-vs-silence ratio) can distinguish
  degenerate inputs from real mixes. Research existing Phase 1 outputs first — some of
  this may already be computable from data Phase 1 produces.
- Item 4's fix must not break the golden-snapshot guard mentioned in CLAUDE.md
  (`run_pipeline` output is guarded byte-identical by golden snapshots) — check
  `components/analysis/tests/` for the relevant fixtures and update them deliberately,
  not accidentally.

### COMPONENT: bff

**Pattern**: bff conventions in CLAUDE.md (minimal-API groups, ErrorEnvelope)

**Purpose**: item 1 (surfacing genre confirm UI needs a place to receive the correction
and trigger the existing rerun-phase endpoint); item 2 (rule out the SSE relay hop as the
chunk-reordering site)

**Notes**:
- No new persistence expected for item 1 beyond what `rerun_phase`/`AnalysisJob` already
  supports — verify before adding schema.
- For item 2, check whether the BFF's coach-chat SSE relay does any buffering/reordering
  (e.g. concurrent writes to the same connection, out-of-order awaits) before assuming
  the bug is frontend-only.

### COMPONENT: frontend-spectr-v2

**Pattern**: v2 stack rules in CLAUDE.md (TS strict, CSS Modules, fetcher.ts, no inline
styles unless dynamic)

**Purpose**: item 1 (genre confirm chip UI), item 2 (rule out/fix token-accumulation
ordering in `CoachChat.tsx` if the repro lands here), item 3 (honest degenerate-input
messaging on the report), item 6 (suspected-flag visual treatment)

**Notes**:
- Item 6's visual treatment should stay consistent with existing severity-badge / source
  chip patterns already in `FindingsTab.tsx` (`AI` vs `Measured` chips per the session's
  code map) rather than inventing a fourth unrelated visual language.

## SHARED DOCUMENTATION

- `docs/archive/brainstorming/brainstorming-session-2026-07-23-1357.md` — full session:
  both Explore-agent research maps (file:line level detail on the entire analysis
  pipeline and recommendation-generation path), the live artifact critiques that
  surfaced items 2 and 3 directly, and the full prioritized roadmap this bundle is
  extracted from.
- `CLAUDE.md` — worker/bff/frontend gotchas referenced throughout above; validation
  gates section.

## OTHER CONSIDERATIONS

- **Additive constraint (project-wide rule, not just this feature)**: improve, don't
  remove, unless removing is clearly more correct — see project memory
  `feedback_spectr-coaching-product-philosophy.md` for the full standing constraints
  (additive-only, audio-file-first, score is not the product, first-upload is the
  conversion moment) that should inform any judgment calls made while implementing this.
- **Item 3 may need to be split out** — see the scope flag under item 3 above. Size it
  honestly during research rather than cramming it into a bundle PR.
- **Item 2 needs a repro before a fix** — do not let /generate-prp write a "fix" section
  for item 2 without first confirming the actual root-cause site. If root-causing during
  PRP research isn't feasible without a live stack (per `docs/STARTUP.md`), the PRP
  should scope item 2 as "add instrumentation / reproduce with a controlled test" as its
  own validation-gated step before the fix step.
- **Validation gates**: standard set per CLAUDE.md — worker `pytest -q
  components/worker/tests/` + `ruff check` + `mypy`; bff `dotnet build && dotnet test` if
  touched; frontend `tsc --noEmit` / `lint --max-warnings 0` / `build` / `npx vitest run`
  if touched. Add tests per item: danceability score change (4), triage prompt payload
  now includes rule findings (5), suspected-flag rendering (6), degenerate-input honest
  handling (3).
