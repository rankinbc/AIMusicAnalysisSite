---
stepsCompleted: [1]
session_topic: 'Results-page flow + the broader SPECTR product surfaces (Report, Catalog, Social) for a bedroom producer'
session_goals: 'Design the best flow from analyze -> AI findings -> Listen sandbox -> back to Ableton -> re-analyze; decide IA / what is surfaced vs tabbed; make it feel like a serious paid tool; add catalog/version-control + reference library; future-proof for social/live.'
selected_approach: 'Progressive Flow (broad -> narrow)'
techniques_used: []
ideas_generated: []
facilitator: Claude
user: Brian
date: 2026-06-16
---

# Brainstorming Session — SPECTR product flow & results-page IA

**Date:** 2026-06-16
**Facilitator:** Claude · **Participant:** Brian

## Session Overview

**Topic:** How to arrange the analysis-results experience (and the surrounding product) so a bedroom-level producer goes: analyze song -> get an actionable list of AI "findings" -> audition the fixes on the Listen page -> take notes / decide what to address -> go back to Ableton knowing exactly what to do -> re-analyze the next version and see improvement.

**Goals:**
1. Report IA — AI findings as the hero; raw stats (LUFS, TP, EQ bands, clashes) as *evidence* attached to findings, not a stat dump. Decide what's surfaced vs. buried in tabs and the logic of the tab split.
2. Findings as a triage system — address / dismiss / "trying it" + notes, feeding the DAW handoff.
3. Catalog as version control — songs, versions, reference library (already built), and **version deltas as the motivational payoff**.
4. Feel like a serious instrument worth a subscription.

## Guiding tension / north star

> **Density for credibility, hierarchy for action.** The dashboard should *look* rich and pro (earns trust, justifies paying), but the visual hierarchy funnels the eye to findings -> "go do this." Nothing is cut; it's *ranked*. A stat (e.g. a frequency-clash chart) becomes the *receipt/evidence* for a finding rather than a standalone number.

## The unifying model: a track has a lifecycle; credits are the bloodstream

| | Surface | Mode | Credit flow |
|---|---|---|---|
| A | **Report** | private craft | spend to analyze |
| B | **Catalog** | private library + progress (deltas) | storage of A over time |
| C | **Social** (future) | publish -> async feedback -> live room | earn by reviewing others; spend to publish / DJ / react |

**Flywheel:** analyzing costs credits -> earn credits by giving feedback on others' tracks -> feedback needs a publish/listen surface -> live "concert room" becomes natural -> engagement -> more analyzing. Credits tie craft + community + revenue together.

### Social surface — captured ideas (FUTURE; build A + B first)
- **Idea 1 — Publish for feedback:** producer hits "publish," track becomes available for others to listen and leave timestamped notes / suggestions. Incentivize reviewers with credits.
- **Idea 2 — Live concert / DJ room:** someone spends credits to be the DJ in a room at the top of the page; viewers join Twitch-style to listen. DJ runs visualizations (bars, laser, strobe, fireworks). Chat + audience engagement; viewers pay credits for effects, or to put their avatar/mood on stage. Picture the post-buildup drop with lots of interaction. DJ could open the rack and let viewers move the EQ to where they think it sounds best = crowdsourced feedback.
  - **Build brief for the DJ-tab visuals:** [`dj-tab-audio-reactive-build-prompt.md`](../dj-tab-audio-reactive-build-prompt.md) — copy-paste prompt for the audio-reactive feature set (beat detection, reactive laser-show engine, auto color, energy macro, radial pulse, spectrogram, drop detection, snapshot presets) with the ≤3 Hz photosensitivity safety cap.

### Cheap future-proofing decisions for the near-term build
1. Notes/findings carry an `author` + `visibility` from day one (private | shared | public) — same primitive for you, a friend, or a paid reviewer.
2. "Publish" = a visibility flip on a catalog version, not a new system.
3. The **Listen page is the convergence point** — private sandbox and the future stage are the same surface with different right-rail tabs (Meters/Notes/Issues/Chat/Comments/DJ/Viewers) toggled on.

## Reference screenshots provided
- Current Report "Mix" tab (frequency balance bars, clashes, other scoring) — too stat-forward, not action-forward.
- Listen page DAW-style mock with right rail: Meters, Notes, Issues, Chat, Comments, DJ, Viewers; EQ 8-band overlay, transport, insert rack (Comp/Saturate/M-S/Limiter/Pitch/Scope), metering panel, viewers list with avatars/moods + "Show me on stage."

## Ideas Generated

### Round 1 — The "Couch Screen" + the core primitive

**BREAKTHROUGH — the deliverable is a prescription, not a problem list.** Distinguish two objects we'd been blurring:

- **Finding (diagnosis):** what's wrong + evidence + severity + confidence. Made by the analysis pipeline.
- **Move (prescription):** what to DO in Ableton — device, parameter, target value, ideally a target-curve visual. Made by an **AI agent** that translates Finding -> Move(s). *This agent is the heart of the product.*
- **Game Plan:** the ordered set of Moves the producer commits to (curated). Exportable as MD/HTML with EQ visuals; also a live in-app checklist.

**Loop payoff (auto-verify):** because a Move is structured (device + param + target), the next version's analysis can auto-check it: "You did 4/6 moves -> low-end clash resolved (+5); 2 still open; 1 new finding." Closes the "did I improve?" loop without self-reporting.

**Variable-depth analysis (user input):** every version analyzed from the soundfile (required); optional reference / .als / stems unlock deeper analysis. IA should progressively disclose depth and nudge "add stems for stem-level moves" (ties to credit flywheel).

**Ranking (open):** findings already carry a confidence level. Need a ranking that avoids overwhelm. Proposed dimensions: impact (score/audibility) x confidence x effort; lead beginners with "quick wins." Top 3 surfaced, rest one tap away. TBD whether AI picks, severity picks, or user filters by effort.

**Artifact for the DAW handoff (open):** candidates — kept/marked findings, timestamped Listen-page notes, a generated MD "game plan," or an HTML file with target-EQ visuals. Goal: specifics on WHAT TO DO, not a list of problems.

**Open questions to resolve next:**
1. Ranking dimension for Moves (impact x confidence x effort? quick-wins-first?).
2. What makes a Move "specific enough" to act on — and how much does the agent commit to exact numbers vs. directional guidance?
3. Game Plan artifact format: interactive in-app checklist, exported MD, or HTML-with-visuals — or all three from one structured source?

### Round 2 — Grounding in real pipeline capability + IA reframe

**Most of the prescriptive engine already exists (codebase reality):**
- `rule_engine.py` — deterministic findings. The "common ordering mistakes" patterns (reverb mid-chain, stereo <120 Hz, widener-before-mono, sidechain-after-wet-FX, comp-before-cleanup, de-ess-before-comp, transient-shaper-after-heavy-comp) belong here — scriptable, high-confidence, especially from the `.als`.
- `triage.py` -> `SpecialistRoutingPlan` — ALREADY the "programmatically pick specialists." Takes analysis + rule findings, returns which specialists are relevant + why. UI currently ignores it (shows all 26, user picks manually).
- 26 specialists (categories: Spectrum, Loudness, Dynamics, Stereo, Arrangement, Stems, Meta…) -> verdicts. `validator.py` = authoritative scoring. "Ask the Coach" = grounded chat over the analysis.
- **MISSING PIECE = the `Finding -> Move` synthesizer + a Game Plan object.** Everything upstream exists.

**KEY INSIGHT — Move specificity = f(input depth):**
| Input | Analysis sees | Move specificity |
|---|---|---|
| Mix only | spectral/loudness/stereo (ph 1–3,6) | Directional ("carve the 60–120 Hz buildup") |
| + Reference | delta vs genre target (ph 5) | Targeted ("+3 dB presence vs ref — pull 3–5 kHz") |
| + Stems | per-stem + clash matrix (ph 4/5) | Stem-specific ("kick vs bass 60–120 Hz — sidechain") |
| + .als | device chain & ordering (ph 8) | Device-specific & confident ("Reverb mid-chain on Lead -> move to a return") |

Resolves the trust problem: the tool is as prescriptive as the data allows and tells you how to unlock more precision (add stems/.als) — honest + drives the credit/depth flywheel. Listen page = test-bench for directional Moves.

**IA REFRAME — organize tabs by the user's JOB, not by data source.** Current tabs (Mix/Reference/Arrangement/Raw/Files) are a database browser. Proposed:
- **Plan** (hero/default): Verdict + Delta-vs-last + ranked Game Plan (Moves, quick-wins-first). Each Move expands -> Finding + the one relevant chart as evidence + "Audition in Listen" + triage (address/trying/dismiss).
- **Specialists**: triage's *recommended* set (not 26) with reasons -> run (credits) -> verdicts feed new Moves. Coach chat here, grounded.
- **Analysis**: the dense measured dashboard (EQ bands, clashes, meters) — pro-looking but secondary = credibility layer.
- **Files / Versions**: inputs, .als, exports, version history.
Dense charts aren't cut — demoted to *evidence* under a Move or to the Analysis tab.

**Open for Round 3:**
1. Does triage AUTO-run a recommended specialist set on analysis (costs credits up front), or just *recommend* and the user clicks to spend? (cost vs. convenience)
2. Where does the Coach chat live — inside Plan, or its own thing?
3. Is "Plan" + "Specialists" actually one tab (recommendations flow straight into Moves), or two?

**DECISION — Game Plan artifact:** rendered in-app as polished web components (the Plan view), with **Markdown export as the non-negotiable v1 take-away** for the DAW. HTML-with-EQ-visuals = later nice-to-have.

### Round 4 — Soul, smaller payload, and the social pivot (mind changed)

**Design soul (redirect):** the "engineer's worksheet" mockup was rejected as soulless/dead. The product's soul is the **living, audio-reactive Listen/DJ page** (dancing spectrum, lasers, stem deck, fireworks) — not a static report. The results experience must feel like the same *alive instrument reacting to the music*, not a printout. Keep the one liked element: the **organic prescription line**. Direction: audio-reactive motion, the track as a living presence, findings tied to moments in the waveform (cf. the "Add mark" feature), organic linework over Bauhaus austerity.

**Analysis = pattern detector, not measurement dump (smaller payload):** stop computing marginal static data points. Shrink the LLM payload to **high-signal pattern/indicator detections** — a curated library of *known mix mistakes / key indicators / patterns that cause a specific problem* (e.g. the "common ordering mistakes" set; spectral/dynamics/stereo red flags). Output = "pattern X detected (confidence) → causes Y → fix Z," not 40 numbers. Benefits: cheaper + sharper AI reasoning; the UI naturally shows *very little* (only fired patterns); and **the curated pattern library is a compounding, defensible IP asset** (harder to copy than an FFT). Caveat: false positives kill trust — each pattern needs validation.

**SOCIAL — embraced as potentially the core, not a deferral (Claude was too conservative, conceded):** the only durable moats named earlier (network effects, switching cost, belonging) live in the **social layer, not the analyzer** (which is commoditizing — TrackScore is "trash" but alive). So community may *be* the moat; the analyzer is the hook. Vision:
- **Incentivized interaction + collaboration** (credits for giving feedback; reciprocity engine).
- **Taste-matching / "find someone who makes music like me"** — antidote to mainstream sameness; loneliness of the bedroom producer. The analysis data already computed (genre, spectral fingerprint, BPM, vibe) becomes the **matchmaking substrate**.
- **Live "Twitch for bedroom producers" room** (Image #7 DJ page): artist gets heard + real (even harsh) feedback, controls the light show/visualization at parts they like, viewers react/chat/give feedback, audience = peer producers. Makes listening to amateur music *fun and interactive*.
- **Hard truths (owed honestly):** (1) cold-start is brutal — empty rooms are depressing; needs density of simultaneously-online producers; hardest thing in the whole plan for a solo dev with no audience. (2) "even mean feedback" can chase off the insecure beginners you serve — norms/moderation are core product design. (3) credits-for-feedback invites low-effort farming — quality > quantity must be designed in.

**THE STRATEGIC FORK (now the most important decision):** Is SPECTR…
- **(A) an AI analysis TOOL** with community features bolted on, or
- **(B) a COMMUNITY/network for bedroom producers** (get heard, find collaborators/taste-matches) with AI analysis as the hook?
Different companies, different build orders, different moats. The energy is swinging to (B). (B) is *more defensible and differentiated* (answers the "you're a late me-too analyzer" problem) but *more dependent on the single hardest thing* — getting people to show up together.

### Round 3 (Party Mode) — Strategic pivot: the moat is Analysis -> AI

**Brian's strategic call:** can't out-analyze the established meter/analyzer tools. **The only real moat is AI prescription.** Therefore:
- **Version delta is DEPRIORITIZED** (not implemented; not the hero; keep as a cheap retention nicety later, not a pillar). Overrides earlier "delta = dopamine" framing.
- **The product = Analysis -> AI.** But this *raises* the bar on analysis: it must be the best possible **feedstock for the AI** — extract the right signal, structure it LLM-legibly, route the right slices to the right specialists (triage), and the rule_engine must catch deterministic stuff — WITHOUT overloading the producer.

**Reframe of the "density vs hierarchy" tension:** the dense analysis is primarily **AI feedstock**, secondarily **credibility proof**, and only rarely the user's action surface. User sees the AI's distilled Plan; richness lives upstream + is queryable via the Coach.

**DECISIONS locked this round (party consensus):**
- **Plan and Specialists are ONE surface.** Plan is the hero; running a specialist is a *verb inside the Plan* ("get a deeper read · N credits"), results drop in as new Moves. The 26-roster goes in an "advanced" drawer for power users.
- **No auto-spend of credits.** Triage *recommends* a specialist set with reasons; every spend is a deliberate, priced click. The **free tier must deliver a useful Plan from rule_engine + measured findings alone** (specialists = upgrade, not paywall-to-basics).
- **One `Move` struct, three renderers** (web component / Markdown export / next-version auto-verify) — confidence-gated: precise numbers only when the data backs them, else directional prose.

**New focus for next rounds:** what concretely makes the analysis a better AI feedstock (signal coverage, grounding, per-section/time-aware data, .als device-graph extraction), and where to spend the next unit of effort.
