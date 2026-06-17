# The new SPECTR — vision synthesis (2026-06-16)

> One page. Came out of a session that started as "how do I arrange the results page" and ended as a product repositioning. Supersedes the *direction* (not the market/user research) of `product-brief-spectr-2026-06-12.md`. Detail lives in: `spectr-flywheel.md`, `async-social-core-design.md`, `results-ui-plan.md`, `brainstorming/brainstorming-session-2026-06-16.md`.

## The thesis (what changed)

**Old:** an AI mix analyzer for electronic producers — a better report.
**New:** a **community of bedroom producers** where the AI analyzer is the *hook* and the *crowd* is the moat.

The analyzer alone is a commoditizing, crowded, copyable niche (TrackScore/Slapback/RoEx already ship it; one is live and, in the user's words, "trash" — and still alive on distribution). The defensible thing — network effects, switching cost, belonging, ground-truth feedback — lives in the **social layer**, not the DSP.

## The machine (the flywheel)

`Library → Analyze → Listen (audition) → Publish → Crowd reacts (timestamped) → reactions become findings + motivation → fix → re-analyze → re-publish`, with **taste-match** ("find someone who sounds like you") pairing producers off the analysis fingerprint. Spun up **craft-loop-first** so it's valuable at 1 user and survives cold start; the **live "Twitch-for-producers" room** is a later spike, not the lead.

## What's different from the 2026-06-12 brief

- **Positioning:** tool-with-community → **community-with-tool-as-hook**.
- **Analysis:** measurement dump → **pattern detector** (known mistakes/indicators, smaller LLM payload, cheaper + sharper; the curated pattern library is compounding IP).
- **Results UI:** stat dashboard (rejected as soulless/TrackScore-like) → **alive, irreverent "Plan"** — findings-as-prescription hero, numbers tucked into an Analysis tab. Soul = the living DJ/Listen page, not a worksheet.
- **Social:** deferred → **core**. Async publish + react-on-the-timeline is the bootstrappable heart; reactions become ground-truth findings.
- **Economy:** **two currencies — buy tools (credits), earn ears (standing)**; reciprocity surfacing as the cold-start spine; reputation-gated earning; public reaction heat.
- **Brand soul:** earnest engineering tool → **playful, honest, anonymous-friendly, for people making weird/unique music** (not money-chasing generic trash).
- **Deprioritized:** version-delta UI; the 26-tile specialist grid (→ triage recommends into the Plan); chasing feature-parity/depth as the wedge.

## The honest top-3 risks

1. **Cold start / distribution — the boss fight.** The flywheel spins beautifully once moving and does *nothing* to move it from rest. Getting the first ~50 producers in, as a solo dev with no audience, is harder than any code here.
2. **Tool quality is the cold-start fuel.** The craft loop is the only thing valuable at 1 user, so it's how people show up *before* the crowd. If the AI's Moves are generic/wrong, the machine has no fuel. **Still unvalidated** (you found the market leader "trash" — necessary but not sufficient that you can beat it).
3. **You're now building a social product, not a tool.** Moderation/norms, anonymity balance, two-sided incentive gaming, ops — all harder and fuzzier than DSP. Plus real scope risk: community + good analyzer + economy is a lot for one person.

## What to do first (in order)

1. **Validate the hook is actually good** — the cheap head-to-head: your plain-*audio* Moves vs TrackScore on 5 real tracks, judged by 10 real producers. Before building more. (This was the unfinished test.)
2. **Build the craft loop + the async publish→react MVP** — reusing what exists (bookmarks, share tokens, Listen waveform, library, credits). **Not** the live room.
3. **Pattern-first analysis** — start the curated mistake/indicator library; it's the quality bet *and* the IP.
4. **Pick ONE genre community and be present** — manufacture the first 20–50 producers by hand. Distribution is the actual product risk.

## Status of the old planning docs (revision needed, NOT archived)

`prd.md`, `epics.md`, `architecture.md`, `ux-design-specification.md`, `implementation-readiness-report-2026-06-12.md` predate this repositioning. They describe the analyzer-first scope and need **revision** (esp. results-page UX, social-as-core, the economy). Left in place — flagged, not deleted. Archived this session: the two superseded `2026-05-17_v2-slice-2-*` results/verdicts design slices.
