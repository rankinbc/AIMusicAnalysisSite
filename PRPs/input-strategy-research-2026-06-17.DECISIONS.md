# DECISIONS — input-value-strategy research

Non-trivial assumptions and analytical choices made while producing
`PRPs/input-strategy-research-2026-06-17.md`. This is a strategy/research task — no production code was changed.

> Relocated here from a root `DECISIONS.md` on merge into master — the repo root
> `DECISIONS.md` is the Story 2.5 queue-split log; this research decisions doc
> lives alongside the research PRP it documents.

## Scope & method
- **D1.** Treated the task as a product/strategy question grounded in the actual pipeline + verdict code, market docs, and external evidence — not an implementation plan. Deliverable is a recommendation doc.
- **D2.** Grounded all "what each input unlocks" claims in the real code via two Explore agents (analysis pipeline `phases/`, `als/`, `stems/`; worker `verdict_lib/` + `prompts/experts/`). Where I claim a field exists, it was read from source; where I claim a capability is *missing*, the agent confirmed absence.
- **D3.** Used the two dated strategy docs (`market-…-2026-06-12.md`, `product-brief-…-2026-06-12.md`) as canonical. The brief's 2026-06-16 "Product Direction Update" supersedes earlier text where they conflict (per the brief's own governance note).

## Substantive judgement calls
- **D4. "Diminishing returns" verdict on stems.** I rank the per-stem capabilities by producer value rather than by engineering novelty. Stem *clash attribution* and *per-stem balance/width* are judged high-value; *per-stem reference delta* is judged lower-value-per-burden because it requires BOTH user stems AND matched reference stems (a near-impossible ask) and degrades to "unavailable" otherwise (confirmed in `phase5_reference.py`). This is a judgement, flagged as such.
- **D5. ".als is the highest value-per-burden input."** Asserted because it is one file (≈low burden) yet is the ONLY input that carries track names + devices + MIDI/harmony + arrangement markers — the data required for the product's stated moat (device-specific advice). Burden comparison (1 file vs. 5–30 stem exports) is treated as self-evidently asymmetric and supported by the Ableton stem-export workflow evidence.
- **D6. The "device-specific advice" capability is mostly DORMANT, not shipped.** The agent found the *prompts* (DeviceChainAnalysis.md, FrequencyCollisionDetection.md) and the *Fix schema* (`ableton_hint`) exist, but: (a) Triage does not gate/route on `.als` presence the way it does on stems, and (b) verdict `fix.target.name` carries a stem *role*, never an Ableton track name. I therefore frame device-specific advice as the **opportunity** (plumbing exists, linkage missing), not a current feature. This is the single most important framing decision in the doc.
- **D7. Recommended flow = parse .als FIRST.** Chosen because the .als gives a track/device map onto which audio + stem findings can be projected, enabling "fix THIS track's THIS device." Sequenced ahead of stems deliberately. This is a design recommendation, not a description of current behavior (current `run_pipeline` runs .als at phase 8, late).
- **D8. Tiering = require mix / push .als hard / make stems optional-depth.** Aligns with the brief's friction constraints (no-card first analysis) and the input-depth-as-moat thesis, and with the observation that the core persona (Dario) is an Ableton user who already has the .als.
- **D9. Did NOT cover HOW to auto-classify stems or HOW to extract .als internals** — those are the two sibling research windows (`research/stem-classification`, `feat/als-instant-preview`). I reference their problem space but stay at the value/flow layer, per coordination instructions.
