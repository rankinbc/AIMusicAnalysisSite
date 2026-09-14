---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Improving SPECTR analysis recommendations — deeper song understanding + better user-facing suggestions'
session_goals: 'Map current pipeline + recommendation machinery from code; diverge on improvement ideas across both dimensions; converge on prioritized, PRP-ready improvement areas'
selected_approach: 'AI-Recommended Techniques'
techniques_used: ['Question Storming', 'Role Playing (3 personas)', 'First Principles Thinking', 'Live Artifact Critique (2 real coach outputs)']
ideas_generated: [49]
technique_execution_complete: true
session_active: false
workflow_completed: true
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Brian
**Date:** 2026-07-23

## Session Overview

**Topic:** Improving SPECTR's music-analysis recommendations, across two dimensions:

1. **Understanding** — how deeply the 7/8-phase pipeline understands the song (metrics, models, genre awareness, structure, stems, project data)
2. **Suggestions** — the quality, specificity, and actionability of what gets surfaced to the user (rule-engine Problems, triage plan, specialist verdicts, coach fixes, fix rack)

**Goals:**

- Ground the session in a code-level map of the current analysis + recommendation machinery
- Generate a broad, divergent set of improvement ideas for both dimensions
- Converge on prioritized improvement areas suitable for PRP planning

### Session Setup

Two Explore research agents dispatched at session start: (A) song-understanding map of the `audio_analysis` pipeline + genre config, (B) recommendation-generation map of `verdict_lib`, specialists, coach, fix rack, and results-UI surfaces. Findings seed idea generation.

## Research Inputs

### Agent A — How the pipeline understands a song (landed mid-Phase-1)

Pipeline: phases 1→2→3→4→5→6→7→9 (+8 with .als), schema 2.1.0. Key facts with the biggest understanding-gap implications:

1. **Genre detection is BPM-rule-only** (`phase2_genre.py:42-56`): dnb/trance/house/techno/other from BPM windows + one presence check; hardcoded confidences 0.50–0.75. README's torchopenl3 claim is false — `openl3` loader is dead code (`models.py:35-46`). Verdict layer collapses house/dnb/other→`modern_trance` profile (`rule-bindings.json:10-19`).
2. **Phase 7 arrangement scores every genre against trance conventions** (genre "informational only", `phase7_arrangement.py:27`); **energy_contrast fabricates dB from section-detection *confidence***, not measured RMS (`arrangement_scorer.py:643-655`), and the adapter feeds it a neutral 0.7 (`phase1_adapter.py:108-110`) — 25% of the arrangement score.
3. **Danceability rhythm input is always 0**: `finalize_result` reads `onset_density` from Phase 2, which never emits it — zeroing the 40%-weighted rhythm score (`pipeline.py:162-166`, `danceability.py:57-58`). Phase 1's `transients_per_second` exists but isn't wired in.
4. **No real stem separation on bare mixes** (`USE_DEMUCS=False`, `phase4_stems.py:27`): "clash detection" without uploaded stems = 3 hardcoded whole-mix band-threshold rules.
5. **Phase 6 gap analysis compares only 3 dimensions** (bpm, phase_correlation, width-proxy `1−|corr|`) against the corpus (`phase6_gap.py:103-111`); trance profile = 196 tracks, other genres may fall back to percentile 50.
6. **Phase 5 reference deltas = LUFS/RMS/correlation/7 bands only**; genre presets hardcode −14 LUFS for every genre.
7. **~300 computed datapoints are dropped per run** (`PRPs/surface-latent-analysis-datapoints.md`); ALS parser extracts per-device enabled state + params but discards them (clutter_pct always 0, `health_scorer.py:45-47`); quantization/swing/tempo-automation parsed but unsurfaced.
8. **Phase 9 translation scores are uncalibrated magic-constant heuristics** with bare-except fallbacks to fixed 50/75 (`spatial_analyzer.py:309-342,507-513`).
9. **Key detection = chroma argmax** (Krumhansl-Schmuckler) — no real tonal/harmonic analysis; true-peak over-reads +1.5 dB above ~0.45·fs (documented).
10. **Threshold provenance is weak where it matters**: `suspected:true` on transient-strength (all genres), over-compression, thin-low-end, harsh-upper-mid, over-widened, bpm-genre-match; techno crest = "WEAKEST FIGURE"; spectral tilt has "no authoritative per-genre dataset" (`genre-profiles.json`, `rule-bindings.json`, `genre-ref-values.md`).
11. Stated direction (PRPs): IDENTIFY/SOLVE split (deterministic-first, LLM only for judgment calls), planned metrics `low_mid_ratio`/`spectral_tilt`/per-band correlation, Epic 8 measured genre corpus still future work.

### Agent B — How recommendations are generated + surfaced (landed mid-Phase-1)

Producer chain: pipeline `top_fixes`/`coached_fixes` → rule-engine Problems + deterministic SOLVE (every analysis, Phase C2) → LLM identifiers (paid only, 3 slugs, haiku) → triage routing plan (on-demand) → 26 on-demand LLM specialists → coach chat → fix-rack preset. Key facts:

1. **SOLVE is BUILT and live** (`solve_lib/`, correcting the earlier "fix=None everywhere" framing): deterministic solvers attach parameter-exact `Fix` objects for 8 audio-only categories (`degraded.py:113-139`, `router.py:25-61`). Rules still hard-code `fix=None` at the producer (`rule_engine.py:116`); dynamics / loudness-too-quiet / stems / MIDI moves are deliberately unsolved "leftover advice."
2. **No context slicing**: every LLM specialist + identifier receives the ENTIRE flattened final_json + provenance preamble (`input_grounding.py:158-170`). **Triage never sees rule-engine findings** — worker passes `rule_verdicts=None`, so `rule_engine_findings` is always empty (`triage_actor.py:110`).
3. **Moderate-baseline downgrade caps every LLM verdict** at the moderate band (severe only via category weight ≥1.5, e.g. clipping); deterministic rule findings are exempt (`validator.py:163-202`). LLM findings can never be critical. Validator recomputes `priority_score` for everything.
4. **`coached_fixes` = 8 hardcoded f-string templates** (v1.1, `analysis/coach.py:11-49`), surfaced as `RULE`-chip Moves with hardcoded confidence 0.9 and no params (`move-model.ts:209-240`).
5. **`suspected` flag is never rendered anywhere in the UI** (only a test fixture references it); architecture doc lists "where suspected surfaces" as unresolved.
6. **Feedback loop is dead**: only `applied` has a live mutation; dismiss/feedback endpoints exist with zero frontend consumers (`hooks.ts:640-652`).
7. **Rejected verdicts vanish silently** (logged + Prometheus only); rule rows failing validation are skipped, not surfaced; NaN/Inf metrics pass `_value_close` un-validated.
8. **Triage.md prose report + its own priority formula are vestigial** — contradicts `scoring.py` numbers; only the trailing routing-plan JSON is parsed.
9. **A tier-grouped Problems view exists (`groupProblems`) — unit-tested, never wired into any tab**; only `faultCount` is consumed.
10. **Dedupe keys on `(category, primary_metric)`** — architecture doc flags this as wrong for multi-domain merge (should key on `finding_id`).
11. Prompt-pin system: 60s TTL fail-open; coach/identifier/arbiter prompts excluded from pin support; coach copy triplicated across worker/BFF/frontend.
12. Fail sentinel rows (`headline="Specialist failed"`) are string-sniffed out in 3 separate frontend files.

## Technique 1: Question Storming — Idea Capture

### Element 1: The Producer's Unanswerable Questions (Brian's raw list)

Verbatim seed questions:
1. "Am I making this better or worse by changing this?"
2. "Am I creating a sound that is not going to sound good and end up being loud or annoying after a while?"
3. "Am I making any noob mistakes (compressor before EQ?) that will be hard to figure out?"
4. "What the hell is DC offset — I don't hear the difference it makes. Should I leave it on or off of Saturator?"
5. "I'm making this sound louder using gain on a compressor… should I be using something else like Saturator or EQ?"
6. "Changing this knob makes this synth sound cool but is it going to destroy or drown out another sound?"

Captured ideas:

**[Gap-Q #1]**: Did-My-Change-Help Delta Engine
_Concept_: Analyze the *move*, not the snapshot — diff two versions/saves and answer "better or worse, and why" in terms of what the change did (mud added, punch lost, headroom gained).
_Novelty_: Pipeline is snapshot-only; CompareDialog diffs scores but nothing attributes deltas to the producer's action.

**[Gap-Q #2]**: Fatigue Forecast
_Concept_: Predict long-horizon listenability — "this will get annoying/harsh after 20 listens" — via accumulated sharpness/roughness/repetition metrics over time, not instantaneous harshness.
_Novelty_: No temporal-perceptual model exists anywhere in the pipeline; harsh_upper_mid is static AND suspected=true.

**[Gap-Q #3]**: Noob-Mistake Chain Linter
_Concept_: Lint the .als device chains for process errors — device ordering (comp-before-EQ), redundant/conflicting devices, gain-staging violations, limiter-too-early — like ruff for your signal chain.
_Novelty_: Process critique vs output critique. The parser ALREADY extracts device order + enabled + params and discards them (`als_parser.py:583-656`).

**[Gap-Q #4]**: Contextual Micro-Teacher
_Concept_: Explain concepts against the user's actual project state ("DC offset, on YOUR Saturator on the bass track, does X — here's the measured difference with it on vs off"), with demonstrable before/after rendering or metering.
_Novelty_: Education keyed to project reality with measured proof, not glossary prose. Answers "I don't hear the difference" with evidence.

**[Gap-Q #5]**: Right-Tool-for-Intent Advisor
_Concept_: User states intent ("make it louder/warmer"); SPECTR evaluates whether their chosen device/param is the idiomatic tool for that intent and suggests the better one.
_Novelty_: Current system never knows what the user is TRYING to do — intent is the missing input axis.

**[Gap-Q #6]**: Knob-Consequence Forecast (Masking Radar)
_Concept_: Predict whether a change to element X will mask/collide with element Y — "boosting that synth filter will drown your lead above 2kHz" — before or as the move happens.
_Novelty_: Clash detection today is static + stems-gated; this is predictive, parameter-linked, and could live in the Listen rack loop.

**[Meta #7]**: Moves-Not-State Reframe
_Concept_: Every one of Brian's questions is about a *decision in motion*, not the state of a file. SPECTR analyzes artifacts; the user needs an advisor over their *process* — versions, .als diffs, knob moves, intents.
_Novelty_: Reframes the product posture: the timeline of changes becomes a first-class analysis input.

**[Meta #8]**: Producer-Language Bridge
_Concept_: The user thinks in "cool / annoying / drown out / louder"; the report speaks LUFS/correlation/crest. Bidirectional translation — intent-language in, evidence-backed plain language out — as an explicit design layer.
_Novelty_: Treats vocabulary mismatch as a first-class product gap, not a docs problem.

### Element 1, Round 2 — Session steer from Brian (SCOPE ANCHOR)

Brian's direction: **the primary product loop is upload → analysis coaches you on what you're doing WRONG → you go fix it in the DAW → return for a new analysis.** Version-delta analysis exists but is secondary, not the primary posture. Snapshot analysis of an uploaded song stays the core; the "moves" insight should express as *coaching quality within the snapshot* (infer the mistake from the artifact) and as *continuity across return visits* — not as a real-time/process-monitoring pivot. Also: "which of my 12312 versions is best" is a definite want.

**[Loop #9]**: Coach-the-Cause Diagnosis
_Concept_: Findings framed as the *producer's action*, not the file's symptom — infer the likely mistake from artifact evidence (+ .als): "master-bus pumping pattern → classic over-compression; back off ratio/threshold" instead of "LRA is 3.2".
_Novelty_: Turns each measured symptom into a cause hypothesis about what the user DID — the coaching frame Brian wants, achievable within a single snapshot.

**[Loop #10]**: Homework & Return-Visit Verification
_Concept_: Every finding is an assignment with a resolvable metric. On the NEXT upload of that song, auto-check each open assignment: resolved → celebrate; persistent → re-flag with escalated teaching. Finding-level continuity via stable problem_ids (infra already exists in the IDENTIFY design).
_Novelty_: The fix-and-return loop becomes the verification loop — coaching continuity, distinct from generic version-delta scoring.

**[Loop #11]**: Best-Version Picker
_Concept_: Rank all analyzed versions of a song — overall and per-dimension ("v3 best low end, v7 best width, v9 loudest but most fatiguing") — answering "which of my versions is best" from analyses already stored.
_Novelty_: Zero new analysis needed; it's a synthesis surface over existing per-version rows.

**[Loop #12]**: Persistent-Mistake Profile (Coach Memory)
_Concept_: Across songs and uploads, SPECTR learns the user's habitual errors ("4th track in a row that's over-widened — this is your pattern") and front-loads coaching on THEIR recurring weaknesses.
_Novelty_: User-level cross-song learning; today every analysis has amnesia about who it's coaching.

### Element 2 — Brian's product-vision anchor (THE FUNNEL)

**PARKED (make note, revisit later):** version-to-version analysis as a deep topic — noted, not this session's focus.

**PRIORITY ANCHOR:** The **first upload** must impress — first report = the conversion/retention event.

**The intended funnel:** Analysis determines the MOST CRITICAL issues → report generates fixes → user auditions each fix on the **Listen page** (toggle each suggestion on/off, solo or combined, judge better/worse BY EAR) → keeps what they agree with, discards the rest → *(future module)* **"Game Plan"**: accepted fixes compiled into an easy-to-follow, DAW-oriented direction sheet.

Captured ideas:

**[Funnel #13]**: Critical-Issue Podium
_Concept_: The analysis' first job: confidently rank what matters MOST — a top-3 that considers interactions (fix mud first, it unmasks everything else), not a flat severity list. Requires repairing today's ranking machinery: crude base×weight×scope formula, LLM verdicts capped at moderate, triage blind to rule findings, no cross-issue reasoning.
_Novelty_: Prioritization as a first-class analysis output — a *decision*, not a sort order.

**[Funnel #14]**: Audition-Grade Fixes (design principle)
_Concept_: A suggestion isn't done until it's HEARABLE — every fix should compile to the Listen-rack DSP chain (EQ/comp/sat/width) so the user can toggle it on their actual track. Non-auditionable advice (arrangement, MIDI) gets an explicitly different presentation class.
_Novelty_: "Auditionability" becomes the quality bar separating real fixes from prose advice; forces parameter-exactness through the SOLVE tier.

**[Funnel #15]**: Ear-Vote Feedback Loop
_Concept_: The Listen-page keep/discard decision IS the feedback system — every toggle vote records "user heard this fix and agreed/disagreed." Feeds: per-user taste modeling, advice-quality metrics, and crucially **validation data for every suspected=true threshold** (the missing Epic 8 corpus, crowdsourced from real ears).
_Novelty_: Revives the dead dismiss/feedback loop as a natural interaction nobody has to think of as "giving feedback" — and turns users' ears into the threshold-calibration instrument.

**[Funnel #16]**: Fix-Interaction Awareness
_Concept_: Hearing fixes together vs one at a time implies fixes interact — the engine should know that fixing #1 (mud) may dissolve #3 (masking), that EQ-then-comp ≠ comp-then-EQ, and present combined-chain consequences honestly.
_Novelty_: Suggestion set as a *system* with an ordering, not independent line items.

**[Funnel #17]**: First-Upload Wow Choreography
_Concept_: Design report #1 for the "it actually heard MY track" jolt: call out the user's specific moments by time/name, lead with ONE undeniable insight, and get them hearing a fix within the first minute. Wow = named + measured + immediately hearable.
_Novelty_: Treats the first report as a choreographed conversion moment, not a data dump.

**[Funnel #18]**: The Game Plan (Brian's planned module — noted)
_Concept_: Post-audition compiler: accepted fixes → ordered, DAW-friendly instructions ("in Ableton: on BASS BUS, EQ Eight, cut 3dB @ 300Hz…") — the direction sheet for the return trip to the DAW.
_Novelty_: Closes the funnel; the report's output format becomes "what to do next," not "what was wrong."

## Technique 2: Role Playing — Idea Capture

### Persona 1: The $200/hr legendary mixing engineer, first client call

Brian playing the engineer — first three sentences after one listen:
1. "There's too much going on"
2. "You can barely hear that synth"
3. "You have way too many devices on your tracks"

Observation: the engineer speaks in GESTALT (overall crowding), ELEMENTS (a specific synth), and PROCESS (device habits) — never in bands/LUFS. All three statements are currently unsayable by SPECTR.

**[Persona #19]**: Density / "Too Much Going On" Meter
_Concept_: Per-section crowding analysis — simultaneous-element count, spectral occupancy % over time, onset density, arrangement density curve: "1:30–2:00 is your most crowded stretch — 90%+ of the spectrum occupied continuously." Verdict grammar: too much / about right / too sparse, per section.
_Novelty_: Nothing measures crowdedness today; ironically a `density` specialist prompt exists but has no density METRIC to cite, and onset_density is wired to a field that's always 0.

**[Persona #20]**: Element Audibility Map (Mix Hierarchy)
_Concept_: Per-element audibility scoring — is each element hearable when it plays, masked-% over time, foreground/midground/background hierarchy map: "'PluckLead' is audible only ~40% of the time it plays — pads bury it above 2kHz." With .als, elements get called out BY THE USER'S OWN TRACK NAMES.
_Novelty_: Converts pairwise "clash" into the question producers actually ask ("can I hear my synth?"); mix hierarchy as a first-class analyzed dimension.

**[Persona #21]**: Over-Processing Detector
_Concept_: Chain-depth per track from the .als — "7 devices on a hi-hat," redundant EQ stacks, disabled-device clutter, processing-heavy tracks with poor measured outcomes ("most-processed track is also your muddiest").
_Novelty_: The data is ALREADY PARSED and discarded (`als_parser.py:583-656`); clutter scoring exists but is broken (disabled_count hardcoded 0, `health_scorer.py:45-47`); `device_chain` specialist exists with no metrics to ground it.

### SCOPE ANCHOR #2 (Brian): Audio-file-first

**The primary analysis must be great on a bare WAV/FLAC.** Most new users won't upload an .als — project/stem data is a bonus tier that ENHANCES findings but can never carry the first-upload wow. Consequences for captured ideas: #21 (device linting) and the named-track callouts in #20 are demoted to als-bonus tier; #19/#20 need audio-only implementations.

**[Persona #22]**: Don't-Touch List (facilitator build, pending Brian's reaction)
_Concept_: The analysis explicitly fences off what's WORKING: "your groove/low end is dialed — don't touch it." Protects users from ruining strengths while chasing fixes; arguably the most trust-building sentence in a first report.
_Novelty_: Today's output is 100% deficit-oriented; wins exist as a severity tier but nothing says "leave this alone."

**[Persona #23]**: The Engineer's Algorithm (Dependency-Ordered Triage)
_Concept_: Expert prioritization isn't severity-sorting — it's dependency ordering: (1) BROKEN first (clipping/phase — distortion lies to your ears about everything else), (2) FOUNDATION (gain staging, kick+bass — a muddy bottom makes every upstream judgment a guess), (3) HIERARCHY (pick the star, make it audible), (4) POLISH last (harshness, width, sheen). Cap the podium at 3 — past three, users fix none well. Each fix makes the next one *hearable*.
_Novelty_: Replaces base×weight×scope scoring with an unmasking-dependency graph — the actual human algorithm for "what's most critical."

**[Insight #24]**: The User IS the Client
_Concept_: Brian's honest "I don't know, I'm not a legendary engineer" IS the product thesis — users cannot prioritize because they lack the expert mental model. SPECTR's job is to BE the legendary engineer. Corollary: the report must never assume the user knows *why* — every instruction teaches its own why in one sentence.
_Novelty_: Repositions the report's voice: not a lab result for peers, a mentor's brief for someone who can't yet self-diagnose.

**[Audio-only #25]**: Harvest allin1's Demucs Byproduct
_Concept_: Structure detection ALREADY runs Demucs source separation inside the allin1 Docker container on every bare upload that gets structure. Capture those separated stems as a byproduct → per-element audibility, density, and clash analysis on bare WAV/FLAC uploads with near-zero added compute.
_Novelty_: The expensive separation everyone thinks is disabled is already being paid for — its output is just discarded. (Feasibility check needed: container filesystem access to intermediate stems.)

**[Audio-only #26]**: Bare-Mix Audibility & Density Proxies
_Concept_: Audio-only stand-ins that don't need separation: multiband spectral occupancy over time (density curve), transient audibility vs sustained-energy masking, mid/side occupancy split, per-band dynamics — enough to say "too much going on at 1:30" and "something is buried in your midrange" from the mix alone.
_Novelty_: Makes the engineer's gestalt sentences sayable on the minimum viable upload.

### Persona 2: Brian as the client

Brian's response to the engineer's plan: *"I'd just take his word and try it. I can go try to fix it myself but I don't know which way is the correct way, so I have a large chance of making the track worse or introducing new problems as I try to fix it."*

Insight: **trust is not the bottleneck — execution is.** The failure point is between accepting advice and executing it correctly. Core anxiety: making it worse / breaking something new while fixing. (This retroactively justifies the whole funnel: audition = hear it before committing; guardrails = do it right; return-visit = confirm + catch regressions.)

**[Client #27]**: Execution Guardrails (per-fix "watch-out")
_Concept_: Every fix ships with the correct-way specifics (tool, direction, bounded range with a start-here value, Q/width) PLUS the common way beginners botch THIS fix and the side effect to listen for: "Cut 2–4dB around 250–350Hz. Too wide or too deep and the track goes thin — if it sounds hollow, back off."
_Novelty_: Advice includes its own failure modes; ranges not point values (DSP-rack params don't transfer 1:1 to Ableton devices).

**[Client #28]**: Regression Detection on Return Uploads
_Concept_: Each new upload of a song is checked two ways: (a) did open assignments resolve, (b) did NEW problems appear that the previous version didn't have — with causal guesses ("new master clipping — likely makeup gain added after your EQ fix"). The mix's test suite.
_Novelty_: "Don't break the build" for music; directly answers "large chance of introducing new problems."

**[Client #29]**: Calibrated-Confidence Duty (blind-trust responsibility)
_Concept_: Users won't push back — they'll take SPECTR's word wholesale. So confidence must be honestly calibrated: measured findings speak firmly; suspected-threshold findings must dress differently (hedged voice, "worth checking" framing), never masquerading as certainty. Miscalibrated confident advice at scale actively makes tracks worse.
_Novelty_: The never-surfaced `suspected` flag becomes a VOICE decision, not a hidden boolean.

### Persona 3: The civilian in the car

Brian as the friend who skips the track: *"This has neat ideas but it's so horribly mixed. If only a professional could make it sound like a professionally made song so it's not a pain in the ear."*

Notable: the civilian skipped for SOUND-offense (ear pain), not song-boredom — mix quality is what registers as "amateur" to ears with no vocabulary. And the civilian's wish isn't diagnosis — it's TRANSFORMATION ("make it sound pro").

**[Civilian #30]**: Song/Sound Split Verdict
_Concept_: Two separate top-level judgments: the SONG (ideas, arrangement, groove — "neat ideas!") vs the SOUND (mix execution — "horribly mixed"). "Your songwriting is a B+; your mix is a D and it's holding the song back."
_Novelty_: Protects the creative ego while aiming effort precisely; sells hope (the unlearnable part — ideas — you already have). Today one blended score smears both together.

**[Civilian #31]**: Amateur-Tell Index
_Concept_: Target the specific measurable tells that make civilian ears register "not professional": harsh untamed resonances, no glue/cohesion, static flat loudness, mud, brittle top end, clipped crunch, everything-dry-everything-upfront. Report frames them as "the N things making this read as amateur."
_Novelty_: Distance-from-pro scored on civilian-feelable dimensions with names, not abstract band deltas.

**[Civilian #32]**: Ear-Pain Index (psychoacoustic discomfort)
_Concept_: Measure the literal correlates of "pain in the ear" — psychoacoustic sharpness, roughness, tonality (Zwicker-style) — as a discomfort map over time; feeds the Fatigue Forecast and the harshness story with perceptual (not just spectral) evidence.
_Novelty_: Perceptual psychoacoustics layer; today harshness = a static band threshold marked suspected.

**[Civilian #33]**: The Pro-Preview Wow (hear it fixed FIRST)
_Concept_: Lead report #1 with the transformation, not the diagnosis: within the first minute, A/B the user's track vs their track through the full fix chain — "this is what your song sounds like professionally finished." THEN the diagnosis + coaching as "the path to what you just heard." The civilian's wish, granted as a preview and then taught.
_Novelty_: Inverts report structure from diagnosis→maybe-fix to result→path; the fix-rack + Listen infra makes it buildable; likely THE first-upload conversion moment.

## Technique 3: First Principles — The 7 (+1) Principles of a Great Recommendation

Derived from Brian's own session statements:
1. **Honestly calibrated** — firm when measured, visibly hedged when guessing ("I'd just take his word")
2. **An action spec, not information** — tool + direction + bounded amount ("I don't know which way is correct")
3. **Guard-railed** — how beginners botch this + the too-far signal ("chance of making it worse")
4. **Hearable** — provable to the ear before effort is spent ("better or worse?")
5. **Verifiable** — names the metric that moves; return upload checks it
6. **Prioritized FOR the user** — dependency-ordered, capped (~3) ("I'm not a legendary engineer")
7. **Teaching** — one-sentence why in producer language → **PARKED: Brian has a teach mode planned for later; not this effort's focus**
8. **COHESIVE (Brian's addition)** — the fix set reads as ONE solution, not N independent line-items

Foundation under all: every claim traces to a measurement in the user's track.

### Session steers recorded this round

- **PARKED**: Teach mode (Brian will work on it later — analysis quality is the current focus)
- **CONSTRAINT (additive improvement)**: We IMPROVE the existing analysis + suggestions; remove nothing unless keeping it is more likely to make results worse/less helpful.
- **Brian's failure-pick (where SPECTR fails hardest today)**: "Too many suggestions, not sure which ones to pick. It's not really cohesive. I'd like the AI/analysis to consider fixes as more of a cohesive solution than just fixes to individual flagged problems." → Principles 6 + 8 are THE gaps.

**[FP #34]**: AutoMix Button (feature commitment)
_Concept_: One click → an optimal preset rack generated from the analysis, ready to audition on the Listen page. The transformation artifact: "the pro's whole move" as one rack, alongside per-fix toggles (the plan vs its ingredients).
_Novelty_: The seed exists (fix-rack synthesis + MasteringEngineer arbiter); the upgrade is positioning it as the one-click headline act and the embodiment of the cohesive solution.

**[FP #35]**: The Mix Diagnosis (Unified Theory of This Mix)
_Concept_: Before generating any fixes, form ONE theory: cluster all findings by root cause into a diagnosis narrative — "this mix is dark, crowded, and over-squashed; root chain: mud → loudness compensation → crushed dynamics" — then every fix serves the theory. Medical model: symptoms → differential diagnosis → treatment.
_Novelty_: Extends the existing composite/suppression machinery (which already absorbs child singles via related_verdict_ids) UPWARD to a whole-mix-level diagnosis; the report gets a thesis instead of a list.

**[FP #36]**: Treatment Plan, Not Ticket List
_Concept_: The output artifact = one coordinated plan: ~3 moves, dependency-ordered, each aware of the others' consequences ("after the mud cut you gain ~1dB of headroom — that's why the limiter move comes second"), chosen to resolve the maximum symptom-set with minimum intervention.
_Novelty_: Minimal-intervention cohesion; fixes reference each other; solves "too many suggestions" structurally rather than by truncation.

### Live artifact critique: real coach answer ("What's making my low-end muddy?")

Brian pasted a production coach reply. Scored against the 8 principles:

**What it does WELL (keep — additive constraint):** evidence-grounded (cites 4.2dB band delta, 93% sub-30 ratio, mono 0.44 / corr −0.61); causal storytelling ("low-mids tower over the mids → smears"); genuine dependency reasoning (fix phase before EQ "otherwise you'll be EQing a low end that changes shape"); producer-language translation ("wasting energy where nobody can hear it").

**Failures found:**
1. **Text corruption bug** — opening is interleaved/scrambled ("cking up down there. First, the clasTwo things are stasic mud zone") — looks like SSE chunk reassembly or `<<<EVIDENCE>>>` sentinel-split damage. Trust-killing cosmetic; real QA item.
2. **Action spec dies at the hard part (P2)**: "a cut in the 200–500 Hz region on whatever's crowding there" — no element, no dB, no Q; "fix the phase/widening issue below ~300 Hz" — no tool, no how (the hardest instruction has the least spec).
3. **No guardrails (P3)**: HPF@30 with no watch-out; no too-far signals anywhere.
4. **Not hearable (P4)**: none of the 3 moves offered as Listen toggles; the mono-fold claim is literally demonstrable with a mono button and isn't demonstrated.
5. **Not verifiable (P5)**: no "fixed when X" metric named for the return upload.
6. **Priority inverted (P6)**: teaches moves 1 & 2, then reveals move 0 ("one caution… fix phase FIRST") at the end — reader whiplash; should lead with the dependency root.
7. **Suspicious stat uncalibrated (P1)**: "93% of low-band energy below 30 Hz" is outlier-territory — if it's a metric artifact, the coach is confidently teaching garbage.

**[Artifact #37]**: Coach→Rack Handoff
_Concept_: Any coach answer that names moves ends by materializing them: "I've added 3 toggles to your rack — HPF-30, Mud-Cut, Mono-Below-300. Go hear them on Listen." Chat becomes a funnel router, not a prose cul-de-sac.
_Novelty_: Closes the loop between conversation and audition; today the answer dead-ends.

**[Artifact #38]**: Demonstrable Claims Get Demos
_Concept_: Claims that are provable by ear get a demo affordance: "part of your low end folds away in mono — [🔊 hear it in mono]." Wire the coach's assertions to Listen-page states (mono fold, band solo, before/after).
_Novelty_: Ear-proof beats prose; converts trust-me statements into experienced facts.

**[Artifact #39]**: Sanity Gate on Stat Claims
_Concept_: Outlier-smelling metrics (93% sub-30 energy) pass a plausibility check before the coach may cite them confidently; implausible values get flagged as possible measurement artifacts instead of taught as fact.
_Novelty_: Calibration duty applied to the metrics themselves, not just thresholds.

**[Artifact #40]**: Streaming Integrity Bug (QA item)
_Concept_: Find + fix the garbled interleaved coach-reply opening (SSE chunk ordering / sentinel split). Not a brainstorm idea — a defect observed in production output.
_Novelty_: n/a — bug capture.

**REVEAL: the critiqued coach answer was generated for a BEEP** (a test tone, not a song). The system confidently produced a full mud-diagnosis narrative — low-mid congestion, phase-width warnings, EQ order-of-operations — for a degenerate input. Nothing anywhere said "this isn't a song."

**[Artifact #41]**: "Is This Even a Song?" Gate (degenerate-input honesty)
_Concept_: Content-type classification before any coaching: full mix / loop / single instrument / stem / test tone / silence / speech. Degenerate inputs get honest handling ("this looks like a test tone — upload a full mix for a real report"); partial inputs (8-bar loop) get SCOPED analysis with inapplicable dimensions skipped, stated plainly.
_Novelty_: The ultimate calibration failure demonstrated live: every rule fires against full-track genre thresholds regardless of what the audio IS; the coach narrates fiction with total confidence. Also protects the first-upload wow for users who test with weird files first (which is exactly what new users do).

### Live artifact 2: real-song "3-step fix priority list"

Coach output on a real track: 1) kill master clipping (+0.13 dBTP, 6 clipped samples, "streaming rejection" stakes, ceiling → below −1.0), 2) low-mid mud (200–500 3.2dB over mids, cut "a few dB on your densest elements"), 3) stabilize stereo image (width consistency 25/100, "automate wide/narrow intentionally"), arrangement deferred as next layer.

**Genuinely good:** exactly 3, ranked broken→foundation→polish (the Engineer's Algorithm shape); consequence-grounded rationale per rank; #1 is a complete action spec WITH built-in verification (TP < −1.0); scope discipline (arrangement explicitly deferred).

**Failures:**
- **#3 rests on the pipeline's least trustworthy metric**: width_consistency comes from the uncalibrated magic-constant spatial analyzer (bare-except fallbacks to 50/75) — presented with full confidence, and it beat real arrangement findings to a podium slot. The ranking engine has no concept of metric reliability.
- **Materiality inflation on #1**: 6 clipped samples + 0.13 over is a hair-hot ceiling (10-second fix), dramatized as platform rejection. Right priority, inflated stakes — and the honest justification ("it's 10 seconds, do it now") is unavailable because prioritization has no effort model.
- **The which-element hole, again**: "cut on your densest elements" — third artifact in a row where the action spec dies at element-targeting (the #20 Audibility Map gap, now confirmed as THE recurring last-mile failure).
- **No causal chain**: mud → loudness compensation → clipping is plausibly ONE story; the list never connects its own items (the #35 Mix Diagnosis near-miss).
- No guardrails (ceiling-down = perceived loudness drop will scare a noob), no Listen toggles, no verification for #2/#3.

**[Artifact #42]**: Effort-Weighted Prioritization
_Concept_: The podium factors time-to-execute: impact × confidence ÷ effort. Ten-second fixes (limiter ceiling) get fast-lane placement with honest framing ("not your biggest issue — but it's 10 seconds, do it now"); project-level work is labeled as such.
_Novelty_: Today's score is pure severity math; a real coach sequences by payoff-per-effort too.

**[Artifact #43]**: Metric-Trust Tiering in the Ranking Engine
_Concept_: Every metric carries a reliability grade (measured+calibrated / measured+uncalibrated / proxy / fabricated); podium slots require trustworthy evidence — width_consistency (magic-constant analyzer) can't outrank solid findings until calibrated, or must wear a hedge.
_Novelty_: Extends calibration duty INTO prioritization; today a garbage-grade metric can win slot #3 dressed as 25/100 fact.

**[Artifact #44]**: Causal-Chain Podium
_Concept_: When findings are causally linked, present them AS the chain: "One story: mud is eating your headroom → you compensated with the limiter → the limiter is clipping. Fix the mud and the other two shrink." The list becomes the Mix Diagnosis.
_Novelty_: The concrete, buildable version of #35 — detected causal links reorder and unify the podium.

## Idea Organization and Prioritization

**Session totals:** 44 captured ideas across 4 techniques (Question Storming, Role Playing ×3 personas, First Principles, Live Artifact Critique ×2), grounded in 2 code-research maps.

### Theme A — HEAR THE TRACK BETTER (understanding upgrades, audio-first)
_Measure what humans FEEL — crowding, audibility, discomfort, pro-ness — not just what meters read._
- #19 Density/"Too Much Going On" Meter · #20 Element Audibility Map · #26 Bare-Mix Proxies · #25 Harvest allin1's Demucs byproduct · #32 Ear-Pain Index · #2 Fatigue Forecast · #31 Amateur-Tell Index · #41 "Is This Even a Song?" Gate
- Plus research repairs: onset_density wiring (danceability rhythm always 0), real section energy for arrangement (replace confidence-proxy), Phase-9 calibration, genre detection beyond BPM windows
- **Pattern insight:** the recurring "which element?" hole across every live artifact is Theme A's product — element-level hearing is the missing substrate for everything downstream.

### Theme B — DECIDE WHAT MATTERS (cohesive diagnosis + prioritization brain)
_Brian's #1 failure pick: "too many suggestions, not cohesive." From N flags → ONE diagnosis → ordered treatment plan._
- #35 Mix Diagnosis (unified theory) · #44 Causal-Chain Podium · #36 Treatment Plan Not Ticket List · #13 Critical-Issue Podium · #23 Engineer's Algorithm (dependency order) · #42 Effort-Weighted Prioritization · #43 Metric-Trust Tiering · #16 Fix-Interaction Awareness · #22 Don't-Touch List · #9 Coach-the-Cause
- Plus research repair: triage must see rule-engine findings (currently passed None)
- **Pattern insight:** cohesion isn't presentation polish — it's a diagnosis layer that doesn't exist yet, sitting naturally ABOVE the existing composite/suppression machinery (additive).

### Theme C — MAKE EVERY FIX HEARABLE (the audition funnel)
_Fixes as DSP artifacts; ears as judges; transformation as the wow._
- #34 AutoMix Button (commitment) · #33 Pro-Preview Wow · #14 Audition-Grade Fixes (design bar) · #37 Coach→Rack Handoff · #38 Demonstrable Claims Get Demos · #17 First-Upload Wow Choreography · #15 Ear-Vote Feedback Loop · #6 Knob-Consequence (via rack)
- **Pattern insight:** the Listen rack turns every fix into a provable experience — and every toggle vote is calibration data (the missing Epic-8 corpus, crowdsourced).

### Theme D — EARN TRUST (honest voice, cross-cutting standards)
_Firm when measured, hedged when guessing, guardrails always, producer language._
- #29 Calibrated-Confidence Duty · #27 Execution Guardrails · #39 Sanity Gate on Stats · #8 Producer-Language Bridge · #24 The User IS the Client (voice insight) · #40 Streaming Integrity Bug (QA)
- Plus research repair: surface the `suspected` flag (currently invisible)
- **Pattern insight:** not a feature — a standards layer applied to every finding/fix/coach reply.

### Theme E — THE RETURN LOOP (coaching continuity; phase 2)
_The fix-and-return loop becomes the verification loop._
- #10 Homework & Return-Visit Verification · #28 Regression Detection · #12 Coach Memory · #11 Best-Version Picker
- **Pattern insight:** finding-level continuity (stable problem_ids) ≠ the parked version-delta deep analysis; it's the retention engine.

### Parked (explicit)
Teach mode (#4) · version-to-version deep analysis (#1) · Game Plan module (#18, Brian's own upcoming work) · Right-Tool-for-Intent (#5, needs intent input) 

### Breakthrough concepts
1. **Pro-Preview Wow + AutoMix** (#33/#34) — hear it fixed in the first minute; the conversion moment.
2. **Mix Diagnosis + Causal-Chain Podium** (#35/#44) — the direct answer to "not cohesive."
3. **Ear-Vote Feedback Loop** (#15) — users' ears generate the threshold-calibration corpus as a side effect.
4. **Element Audibility Map** (#20) — fills the recurring which-element hole; enables "you can barely hear that synth."
5. **Metric-Trust Tiering** (#43) — reliability grades as ranking infrastructure.

### Quick-win repair list (small, concrete, high leverage)
1. Streaming-corruption bug in coach replies (#40)
2. "Is this even a song?" input gate (#41)
3. onset_density wiring fix (danceability rhythm component always 0)
4. Triage receives rule-engine findings (one parameter)
5. Surface `suspected` as a hedged voice/UI treatment
6. Sanity gate on outlier stats before coach cites them (#39)

### How the EXISTING analysis fits (Brian's challenge: "it's already pretty decent")

Answer: it is — and the plan stands ON it, not beside it. Four buckets:

**1. SOLID CORE — keep, build on (the "pretty decent" is real):**
Phase 1's measurement suite (BS.1770 LUFS, 4× true peak, EBU R128 windowing, 7 bands, stereo/mono, transients, loudness timeline, key+confidence) · Phase 5 reference deltas · stems analyzer + role detection · the @single/@composite rule engine + suppression architecture · SOLVE's param-exact fixes · validator evidence-grounding · 26-specialist infra · the coach's diagnosis brain (proven in both live artifacts). Every new idea CONSUMES these outputs.

**2. REPAIR — places it currently lies to itself (this IS "improving the existing analysis"):**
Phase 2 genre (BPM-only, hardcoded confidences) · Phase 7 energy-contrast (fabricated from detection confidence) + trance-conventions-for-all · Phase 9 magic constants + bare-except 50/75 fallbacks · onset_density wiring · triage blind to rule findings · coach streaming corruption · (als bonus) clutter always-0.

**3. UNLOCK — treasure already computed, currently thrown away (cheapest wins in the whole plan):**
~300 dropped datapoints (inventoried in PRPs) · allin1's internal Demucs separation (stems paid for, discarded) · .als per-device enabled/params · Phase-1 transients_per_second (danceability) · loudness_timeline + key profile_corrs awaiting consumer rules.

**4. LAYER — genuinely new, sits on top (additive by design):**
Mix Diagnosis + podium (Theme B) · audition funnel/AutoMix/Pro-Preview (Theme C) · voice standards (Theme D) · return loop (Theme E) · new perceptual metrics (density, audibility, ear-pain, amateur-tells, song-gate — Theme A).

Framing: ~80% of session ideas are consumers/enhancers of existing outputs. The measurement core stays canonical; repairs fix where it misleads; unlocks surface what it already knows; layers turn what it knows into cohesive, hearable, trustworthy coaching.

## Action Planning

Priority order carried forward from the strawman (unopposed) + Brian's own feature commitments (AutoMix, cohesive fixes).

### Priority 1: Mix Diagnosis & Cohesive Podium (Theme B) — THE FLAGSHIP
**Why this matters:** Directly answers Brian's own failure diagnosis ("too many suggestions, not cohesive") — confirmed independently by both live coach artifacts (uncoordinated 3-item lists, no causal linking, no metric-trust discrimination).
**Immediate next steps:**
1. Fix the triage-blind-to-rule-findings wiring bug FIRST (`rule_verdicts=None`) — small, unblocks real cohesion since triage currently reasons with half the evidence.
2. Design the Finding→Diagnosis aggregation layer: cluster rule-engine Problems + specialist verdicts into causal groups. Extends (doesn't replace) the existing composite/suppression machinery upward.
3. Build the dependency-ordered podium: broken → foundation → hierarchy → polish, capped at 3, folding in effort-weighting (#42) and metric-trust tiering (#43) so uncalibrated metrics (e.g., Phase-9 width_consistency) can't win a slot dressed as fact.
4. Prototype the "one story" narrative template — the report opens with a single diagnosis paragraph, not a list.
5. **[#48] Specialist consensus signal** — when multiple relevant specialists independently flag the same issue, surface the agreement count as a trust cue ("3 of 4 specialists flagged this") — free from existing multi-specialist data, strengthens the podium's credibility alongside metric-trust tiering.
**Resources:** primarily worker (`verdict_lib/rule_engine.py`, `scoring.py`, `triage_actor.py`, `orchestrator.py`); likely warrants its own PRP given scope.
**Potential obstacles:** causal-link detection between findings is new inference logic, not a lookup — needs design spike before estimation.
**Success indicators:** report leads with one coherent diagnosis; podium ≤3 items; the "which of these do I even do" feeling goes away (validate against Brian's own reaction reading it).

### Priority 2: Audition Funnel — AutoMix + Pro-Preview (Theme C)
**Why this matters:** Brian's explicit feature commitment (AutoMix button) + the first-upload wow moment (civilian persona: "make it sound professional").
**Immediate next steps:**
1. Establish "audition-grade" as a hard bar: every podium fix (from Priority 1) must compile to a Listen-rack DSP chain before it's allowed to ship as a suggestion.
2. Build AutoMix: one click compiles the full treatment plan into a single preset rack (extends existing fix-rack synthesis + MasteringEngineer arbiter).
3. Verify/complete per-fix toggle on/off on the Listen page (solo one fix, combine several, A/B against original).
4. Wire Coach→Rack handoff so chat-suggested fixes also land as toggles, not prose dead-ends.
5. **[#47] Intensity dial per fix** — replace binary on/off with a 0–100% amount slider over each fix's DSP params, so users find their own comfort zone instead of all-or-nothing. Directly answers Brian's stated fear of "making it worse."
**Resources:** frontend (`features/listen-rack/`, `features/results/`) + worker (`generate_fix_rack` actor, `coach_mix`).
**Potential obstacles:** depends on Priority 1 producing a clean treatment plan to compile — sequence after, not parallel.
**Success indicators:** user hears the "professionally finished" version within the first minute of a first-upload report.

### Priority 3 (feeds 1 & 2): Theme A unlocks, cheapest first
- Demucs-harvest feasibility spike (allin1 container byproduct) — check if intermediate stems are reachable before committing.
- Element Audibility Map — resolves the "which element?" hole that broke the action-spec in EVERY live artifact reviewed this session; both Priority 1 (specific diagnosis) and Priority 2 (specific fixes) need it.
- Density/"too much going on" meter.

### Immediate quick wins (parallel track, low effort, do anytime)
1. **[#46] One-question genre confirm at upload** — "Sounds like trance — right?" Cheap UX, but high-leverage: genre conditions Phase 3 scoring, Phase 5 presets, Phase 6 profile selection, and the verdict-layer genre_map, all currently resting on a BPM-only guess with hardcoded confidence.
2. Streaming-corruption bug in coach replies (#40)
3. "Is this even a song?" input gate (#41) — the beep incident
4. onset_density wiring fix (danceability rhythm always 0)
5. Triage receives rule-engine findings (same fix as Priority 1 step 1)
6. Surface `suspected` as hedged voice/UI treatment (#29)
7. Sanity gate on outlier stats before coach cites them (#39)

### Explicitly deferred (not this cycle)
Theme E (return loop: homework verification, regression detection, coach memory, best-version picker) — real and wanted, sequenced after the first-upload experience (Priorities 1–2) ships. Teach mode, version-delta deep analysis, and the Game Plan module remain Brian's own parked/future work.

## Session Summary and Insights

**Key Achievements:**

- **49 ideas generated** (44 across 4 techniques + 5 facilitator suggestions), **48 carried forward** into the plan (1 — predicted score delta — explicitly rejected on product-philosophy grounds).
- **Two code-research agents** grounded the entire session in fact before ideation started — every idea traces to a real file:line, not a guess about how the pipeline works.
- **Two live artifacts** (a beep mistaken for a song, and a real 3-step coach priority list) turned abstract principles into concrete, evidenced failures — this is what took the session from "nice ideas" to a defensible roadmap.
- **A working definition of "great recommendation"** derived entirely from Brian's own words (7 principles: calibrated, action-spec, guard-railed, hearable, verifiable, prioritized, teaching — plus Brian's own 8th, cohesive) — this rubric scored every artifact reviewed and will keep scoring future output.
- **A prioritized, sequenced action plan**: Mix Diagnosis & Cohesive Podium (flagship) → Audition Funnel/AutoMix (rides on it) → Element Audibility Map + Demucs-harvest (fuel for both) → trust/voice standards applied throughout → return loop deferred to next cycle.

**Creative Breakthroughs:**

- **The "moves not state" insight, correctly redirected.** Early questions were all about real-time process ("am I making this worse right now?"). Brian's steer clarified the actual product is snapshot-based coaching — but the insight didn't die, it transformed into "coach the cause" (infer the mistake from the evidence in one snapshot) and "homework verification" (continuity across return visits) — process-awareness achieved without a real-time pivot.
- **The recurring "which element?" hole.** Independently, in the engineer persona, the real coach mud-answer, AND the real coach priority list, the action spec broke at the exact same point: naming the specific offending element. Three unrelated artifacts, one root cause — a strong signal the Element Audibility Map is genuinely load-bearing, not just a nice-to-have.
- **The beep incident.** Live-testing a degenerate input produced a fully confident, fully wrong diagnosis — the sharpest possible demonstration of why calibrated confidence has to be a system property, not a writing-style suggestion.
- **SOLVE-is-already-built correction.** The session's working assumption ("fix=None everywhere") was wrong — deterministic SOLVE exists and is live for 8 categories. Corrected mid-session by the research map; changed the framing from "build fixes" to "extend fix coverage + make existing fixes cohesive and hearable."
- **The score correction.** Brian's closing note — "I don't use the score, the output is analysis/suggestions/coaching" — reframed what "success" means for everything built from this session. Recorded as a standing product-philosophy constraint, not just a one-off preference.

**Session Reflections:**

Role Playing across three unscripted personas (engineer, client, civilian) surfaced three non-overlapping failure modes from a single mental exercise — cheaper than three separate research passes. Live Artifact Critique (feeding real production output into the First Principles rubric) was the single highest-value technique in the session: it turned "the coach should be more cohesive" from an opinion into a demonstrated, file-and-line-adjacent pattern, three times over. The session stayed grounded throughout because research came first and every idea had to survive contact with either the code map or a real artifact.

**Your Next Steps:**

1. **This roadmap is PRP-ready** — Priority 1 (Mix Diagnosis & Cohesive Podium) is scoped enough to become the next PRP; consider `/generate-prp` against the Action Planning section above.
2. **Quick wins can start immediately** in parallel — none of the 7 listed depend on the larger design work.
3. **Feasibility-check the Demucs-harvest idea (#25)** early — it's cheap to verify and, if it works, meaningfully cheapens the Element Audibility Map build.
4. **Revisit Theme E and the parked items** (version-delta, teach mode, Game Plan) once the first-upload experience ships — they were deferred by sequencing, not by value.

**What Made This Session Valuable:**

- Research-grounded divergence — no idea floated free of the actual codebase
- Brian's own words became the evaluation rubric, not an imported framework
- Two real artifacts pressure-tested every abstract principle before it reached the roadmap
- A clear, sequenced, additive-only action plan — not just a pile of ideas

Thank you, Brian — this was a genuinely productive session. The document is complete and ready to inform the next PRP. 🚀

### Facilitator suggestions (offered before close, pending Brian's reaction)

**[Facilitator #45]**: Layered Reveal (unify B + C)
_Concept_: The Pro-Preview isn't a single before/after jump — it plays the diagnosis IN LAYERS: original → +fix 1 → +fix 1&2 → full plan, so the causal story (Theme B) is literally heard unfolding, not just read.
_Novelty_: Fuses the two flagship priorities into one experience instead of two adjacent features — audition proves the cohesion claim.

**[Facilitator #46]**: One-Question Genre Confirm
_Concept_: At upload, surface the detected genre as a quick confirm/correct chip ("Sounds like trance — right?") before analysis finalizes. Fixes the single most-flagged reliability gap (BPM-only genre detection) with near-zero engineering, no ML project required.
_Novelty_: Disproportionate leverage — a UX question sidesteps an entire detection-accuracy problem.

**[Facilitator #47]**: Intensity Dial, Not Just On/Off
_Concept_: Each Listen-page fix toggle gains an amount slider (0–100% of the fix's DSP params), not just on/off — lets users find their own comfort zone between "untouched" and "full suggested fix."
_Novelty_: Directly answers Brian's stated fear ("large chance of making it worse") by removing the all-or-nothing risk; natural extension of params the SOLVE tier already computes.

**[Facilitator #48]**: Specialist Consensus Signal
_Concept_: When multiple relevant specialists independently flag the same issue, surface it as agreement — "3 of 4 specialists who reviewed your low end flagged this" — an implicit trust signal from the existing 26-specialist roster, no new infrastructure.
_Novelty_: Wisdom-of-crowds trust signal on the LLM side, complementing Metric-Trust Tiering (#43) on the measurement side.

**[Facilitator #49]**: Predicted Score Delta on the Plan — **REJECTED by Brian**
_Concept_: AutoMix's treatment plan carries a predicted outcome — "Try this plan: B− → A− (predicted)" — reusing the existing scoring formula as a payoff number, not just a diagnosis.
_Reason for rejection_: "I don't care about a 'score' formula. The output of this is the analysis and suggestions and coaching. I don't use the score."

**PRODUCT PHILOSOPHY NOTE (important, carries forward):** the value of SPECTR, in Brian's own words, is the analysis + suggestions + coaching — NOT the letter-grade/score. The pipeline still computes `overall_score`/`grade` internally (Phase 3 total_score) and that stays as-is (additive constraint — not removed), but it should never be treated as the payoff or motivational hook in anything new we build. The Mix Diagnosis narrative (Priority 1) and the coaching voice ARE the product; score is incidental plumbing, not the star.

**Decision: #46, #47, #48 ACCEPTED — folded into the priority plan below.**
