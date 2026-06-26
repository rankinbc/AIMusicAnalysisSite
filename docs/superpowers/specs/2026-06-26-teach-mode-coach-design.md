# Teach Mode (coach) — design

- **Date:** 2026-06-26
- **Branch:** ai-analysis-v2
- **Status:** Design approved; next step `/generate-prp`
- **Author:** Brian Rankin (with Claude)

## Summary

Add a **"Teach me" toggle** to the existing grounded coach. When on, a user
question is answered as a **lesson** — the coach explains the relevant
production craft (drawn from a curated knowledge base built from the
`docs/research/teach/` artifacts) and **anchors the lesson to the user's own
uploaded track** using the measured analysis values the coach already has.

Teach mode is a behavior shift on the existing coach pipeline, not a new
surface or actor. It reuses the coach actor, streaming, evidence resolution,
caps, and degraded short-circuit unchanged.

## Goals

- A user in teach mode can ask a conceptual question ("why is my low end
  muddy?", "what is sidechain ducking?") and get an accurate, plainly-written
  lesson that references *their* track's numbers as the concrete example.
- The craft taught is faithful to the seven research artifacts, expressed in
  the coach's own voice (no source attributions, no formal epistemic-flag
  labels), preserving the genre and standard-vs-taste *substance* as plain
  prose.
- Zero new infrastructure: no embeddings, no vector store, no second actor.
- Lessons stay grounded — any claim about *this track's* values resolves to a
  real measured path, exactly as the Q&A coach already enforces.

## Non-goals (YAGNI — explicitly out of scope)

- **Proactive lesson suggestions** ("want to learn why X?"). Reactive-only.
- **RAG / semantic retrieval / embeddings.** Approach A (curated units) chosen.
- **Source citations / formal `STANDARD/CONVENTION/RULE-OF-THUMB/TASTE`
  labels.** Dropped per the "faithful but plain" decision.
- **A separate teaching route or dramatiq actor.** It's a toggle on the
  existing coach.
- **Authoring all ~40–60 units in this feature.** This feature ships the
  schema + loader + selector + teach prompt + a first vertical slice of units;
  remaining domains are a fast follow.

## Decisions locked during brainstorming

1. **Mode model:** a toggle on the existing coach (one conversation, two
   modes), not a separate surface or always-on capability.
2. **Source fidelity:** *faithful but plain* — teach the craft accurately in
   the coach's voice; drop attributions and formal flag labels; keep the
   substance of standard-vs-taste as plain teaching ("don't chase −14 LUFS —
   that's just a platform target you can ignore").
3. **Knowledge structuring:** **Approach A** — curated teaching-unit files
   keyed by the existing rule-engine category vocabulary, selected by keyword
   + the track's findings, injected into a teach-mode prompt. (RAG and
   distilled-prompt approaches rejected.)

## Background

### The research = the curriculum

`docs/research/teach/reasearch/` holds seven parameter-dense, named-source
craft references, each covering one EDM production domain. They map almost 1:1
onto the project's existing category vocabulary and solver roster:

| Artifact | Domain | Maps to category / solver |
|---|---|---|
| EQ & filtering | corrective + creative EQ, DJ filter | `frequency_balance`, `low_end`, `clarity` / EQ Surgeon |
| Compression, gating, gain-staging | dynamics craft, over-compression | `dynamics` / Dynamics Engineer |
| Limiting & loudness | true-peak, LUFS, streaming vs club | `loudness`, `clipping` / Master-Loudness Engineer |
| Saturation & distortion | harmonics, warmth, bitcrush, exciters | DspOp coverage gap (no sat type) |
| Sidechain & modulation | pumping, tremolo, gates, BPM math | `low_end`/`stereo` masking / Sidechain Specialist |
| Reverb & delay | depth, ambience, send/return | (no solver today — coaching prose) |
| Stereo, M/S & panning | width, mono-compat, correlation | `stereo_field`, `mono_compatibility` / Stereo Engineer |

Every artifact shares one skeleton (TL;DR → Key Findings → Details →
Recommendations → Caveats) and four cross-cutting properties: epistemic flags,
named authorities, genre deltas, and "when this is the wrong tool / thresholds
that change the advice." This is exactly the `why_it_matters` teaching voice
the deterministic solvers lack — i.e. the curriculum behind both the solvers
and the coach.

### Coach reuse (the integration substrate)

The coach is the `coach_reply` dramatiq actor (`coach` queue). It loads the
analysis, builds a **context bundle** (flattened analysis + top verdicts +
optional .als + conversation tail), runs `CoachGrounded.md` as the system
prompt, streams a two-section response (prose + evidence JSON), resolves
evidence chips against the bundle (dropping unresolvable paths), validates via
`CoachReplyPayload`, and rejects numeric claims with no backing path. Teach
mode plugs into this with a mode branch — see Runtime below.

## Architecture

### 1. Knowledge base — teaching units

**Format.** Markdown-with-frontmatter, the same authoring pattern as
`prompts/experts/*.md` and `prompts/identifiers/*.md`:

```markdown
---
slug: low_mid_mud
category: frequency_balance          # rule-engine vocabulary, verbatim
aliases: [mud, muddy, boxy, congested, low-mid buildup]
reference_paths:                     # REAL analysis paths — not the docs' fictional ones
  - analysis.phase1.bands.low_mid
  - analysis.phase1.bands.mid
---
## Explain
Mud is a low-mid traffic jam, ~200–500 Hz, where pads, bass harmonics and
kick body pile up. The fix is small subtractive cuts (2–4 dB, Q ~1) across the
offenders, not one big cut on the bus.

## Anchor to your track
Reference the user's measured low_mid vs mid balance; if low_mid sits hot
relative to mid, that's the buildup, here, in numbers.

## Genre notes
Techno carves 250–500 Hz harder (sparser arrangement); trance keeps a tidy
mid-bass character layer 100–400 Hz.

## When it's the wrong tool
If it only muddies when parts stack, it's arrangement/sidechain, not EQ.
```

- Frontmatter = structured selection metadata (`slug`, `category`, `aliases`,
  `reference_paths`). Body = the plain-voice lesson with light section
  structure (`Explain` / `Anchor to your track` / `Genre notes` / `When it's
  the wrong tool`).
- `reference_paths` use the bundle path syntax the coach evidence resolver
  already understands (`analysis.phaseN.…`; bare `phaseN.…` is auto-prefixed).
  Authoring against real paths sidesteps the `final_json` schema drift trap
  (see memory `final-json-schema-drift`).

**Location.** `components/worker/app/coach_lib/teach/units/*.md`, coach-adjacent
and mirroring the `coach_lib/` structure.

**Loader (`coach_lib/teach/loader.py`).** Parses + validates units at load:
well-formed frontmatter; non-empty body; every `reference_path` is
syntactically valid per the resolver's path grammar. A malformed unit is a
hard error at load (authoring-time failure), not a silent runtime drop.

### 2. Selection (`coach_lib/teach/selector.py` — pure function)

`select_units(question, verdicts, units) -> list[Unit]`:

1. Score each unit by keyword/alias hits against the user's question.
2. Boost units whose `category` matches the track's **top findings** (already
   in the coach bundle) — lessons gravitate to what's actually wrong with this
   track.
3. Return the top ~3.
4. Also expose a compact **catalog** of all unit titles/slugs so the prompt
   can tell the coach what it can and cannot teach (graceful "I don't have a
   lesson on that").
5. Never raises — no match → empty list; the coach then teaches from general
   knowledge with a softer anchor (same fail-soft discipline as
   `resolve_evidence`).

Net: deterministic, grounded pre-filter; the LLM only does final relevance
among candidates.

### 3. Mode flag plumbing (per-message, no wire-format change)

- New column `coach_messages.mode` (`qa` | `teach`, default `qa`).
- Frontend sends `mode` on POST → BFF stamps it on the **user** `CoachMessage`
  row in the same `SaveChanges`.
- The actor reads `user_row.mode` in Phase A (it already loads that row).
- The dramatiq envelope is unchanged: still `coach_reply(conversation_id,
  user_message_id, assistant_message_id)`.
- Per-message (not per-conversation) matches "while in teach mode" = the
  toggle state at send time, and lets a user mix Q&A and lessons in one thread.

### 4. Teach prompt + grounding-contract change

- New `prompts/teach/TeachCoach.md`, sibling to `CoachGrounded.md`, loaded via
  `prompt_loader` when `mode == teach`.
- **Same two-section output contract** (prose + evidence JSON) → the stream
  splitter, `resolve_evidence`, and `CoachReplyPayload` all work unchanged.
- In teach mode, `_build_user_turn` injects the selected units + catalog above
  the grounded track bundle.

**The grounding-contract split (the one real subtlety).** The Q&A coach
refuses numeric claims lacking a resolvable track path
(`answer_makes_numeric_claim_without_evidence`). Teaching requires stating
general craft numbers ("−1 dBTP", "200–500 Hz") that are not track values and
have no path. So teach mode splits the rule:

- **General craft numbers** (from the units) — allowed without a chip; that's
  the lesson.
- **Claims about *this track's* values** — still must cite a resolvable path;
  same evidence chips, same drop-on-unresolved.

The teach prompt enforces this linguistically ("the craft says X" = general,
from the units vs "your track shows Y" = must cite), and the actor scopes the
numeric gate to **track-claim** scope only in teach mode. Evidence chips remain
track-only, so "grounded in the user's uploaded track" holds: every reference
to *their* numbers resolves to a real measured value.

**Reused unchanged:** streaming, degraded/offline short-circuit, idempotency,
error frames, and caps — a teach turn writes the same `coach_message` usage
event and counts against the same tier caps.

### 5. Surfaces

- **BFF** — `PostMessage` request DTO gains optional `mode` (`qa` default);
  stamped on the user row. No change to enqueue or `CoachCapService`. New
  column added canonically: EF `CoachMessage` entity → `aimusic_shared` model
  mirror → EF migration (snake_case `mode`).
- **Frontend** — a "Teach me" toggle in `CoachChat` (feature-folder local
  state, no new global state); composer sends `mode: "teach"` when on; teach
  answers carry a small badge. Evidence chips render as today.
- **Data model** — one column `coach_messages.mode text not null default
  'qa'`. Old rows default to `qa`; fully back-compatible.

## Components (units of design)

| Unit | Responsibility | Depends on |
|---|---|---|
| `coach_lib/teach/units/*.md` | the knowledge (data) | — |
| `coach_lib/teach/loader.py` | load + validate units | resolver path grammar |
| `coach_lib/teach/selector.py` | `select_units(question, verdicts, units)` + catalog | units, bundle verdicts |
| `prompts/teach/TeachCoach.md` | teach-mode system prompt (same output contract) | — |
| `coach_actor.py` (edit) | mode branch: pick prompt, inject units, scope numeric gate | loader, selector, prompt_loader |
| BFF `CoachConversationEndpoints` + DTO + entity + migration | persist `mode` on user row | — |
| `CoachChat` (frontend) | toggle + send mode + badge | — |

## Data flow (teach turn)

1. User toggles "Teach me", sends a question.
2. BFF inserts user row (`mode='teach'`) + pending assistant row; enqueues
   `coach_reply`.
3. Actor Phase A loads rows + analysis; reads `user_row.mode == 'teach'`.
4. Phase B builds the bundle; teach branch loads units, runs `select_units`,
   loads `TeachCoach.md`.
5. Phase C builds the user-turn: selected units + catalog + grounded bundle +
   question.
6. Phase D streams; prose tokens publish live.
7. Phase E parses two sections; loosened numeric gate (track-claim scope only).
8. Phase F resolves evidence chips (track-only) against the bundle.
9. Phase G persists + publishes terminal frame; UI badges the answer.

## Error handling

- No matching units → empty selection; coach teaches general craft, softer
  anchor (fail-soft, never raises).
- Malformed unit file → hard error at load (authoring-time).
- Missing `TeachCoach.md` → same `coach_error` path as a missing
  `CoachGrounded.md` today.
- Degraded analysis → existing offline short-circuit, unchanged.
- Old `coach_messages` rows without `mode` → default `qa`.

## Testing

- `selector` — keyword match, finding-category boost, top-N cap, empty-match
  fail-soft (pure-function unit tests).
- `loader` — rejects malformed frontmatter and syntactically invalid
  `reference_paths`.
- actor branch — teach mode loads `TeachCoach.md`, injects units, loosened
  numeric gate lets general craft numbers through while still dropping
  unresolvable *track* chips; a golden teach-answer test.
- BFF — `mode` persists on the user row; caps still apply.
- frontend — toggle sends the field; teach answers badge.

## Scope: slice-first

This feature ships the **machinery + a first vertical slice of units** (the
domains mapping to the most common findings — EQ/low-end, dynamics, loudness),
proving the end-to-end loop before investing in full curation. Remaining
domains (saturation, sidechain, reverb/delay, stereo) are a fast follow once
the pattern is proven.

## Open follow-ups (not this feature)

- Author the remaining domains' units.
- Consider proactive lesson suggestions keyed off the track's top findings.
- Revisit whether the saturation domain motivates adding a saturation `DspOp`
  type (ties into the solver coverage gap).
