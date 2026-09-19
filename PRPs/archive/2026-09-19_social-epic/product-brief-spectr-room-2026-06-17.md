---
date: 2026-06-17
author: Brian Rankin
status: draft
supersedes: product-brief-spectr-2026-06-12.md
---

# Product Brief: Spectr — Live Listening Room

## Executive Summary

Spectr is a **live listening room for bedroom producers** — a virtual venue where you upload a track, watch real producers react in real time, and leave with a timestamped heatmap of every moment that hit and every moment that didn't. Between sessions, an AI analysis pipeline (better than the tools producers are actually using) serves as the acquisition hook and earns producers the credits they spend on queue slots and deeper analysis.

The pivot reframes a working v2 codebase — .NET BFF + Dramatiq Python analysis worker + React 19 SPA with a fully-built Listen page visualizer — from "AI mixing coach competing with RoEx" to "the only platform that gives bedroom producers a live human audience AND version-tracked feedback history." No one else has that combination.

**Competitive window:** trackscore.ai has users and is objectively worse on analysis. No social listening room for bedroom producers exists. Neither problem is hard to fix individually; the combination is the moat.

---

## The Pivot Rationale

The original brief (June 12) positioned Spectr as an AI coaching tool competing on analysis depth. That ceiling is low: RoEx is better-funded, ships faster, and already at scale. Competing on analysis quality alone means either losing or fighting forever for a niche.

The unoccupied position: **the room**.

Bedroom producers don't just need to know what's wrong with their mix. They need to know if it *lands* when real people hear it. Discord threads give them "sounds good bro" or silence. Paid services cost $90 and take 9 days. The AI tools tell them numbers without telling them how the drop felt to someone who didn't make the track.

What they actually want is what happens at a rave: 200 people, the DJ drops something new, and the room tells you everything in 8 seconds. Spectr makes that accessible to a producer working alone at 2am.

The analysis pipeline doesn't go away — it becomes the acquisition hook and the technical feedback layer. But the product is the room.

---

## Core Concept

**A virtual venue for bedroom producers.**

- Upload a track (or queue one already analyzed)
- Enter the live room — everyone present hears the same track at the same time
- React in real time: emoji, chat, timestamp markers on the waveform
- When 3+ people spam 🔥 within 2 seconds, the entire visualizer erupts — synchronized chaos everyone in the room sees at once
- The producer watches from "the booth" — live, present, seeing every reaction land
- When the track ends: waveform heatmap showing reaction density at every timestamp, chat comments, AI analysis alongside the human data
- That report attaches to the version record — v2 can be compared against v1

No signup required. Enter with any name. Producers who want their track in the live queue must be present.

---

## Product Mechanics

### The Live Room

- **Synchronized playback** — WebSocket-coordinated, everyone hears the same timestamp
- **Chat** — text panel, low friction
- **Emoji reactions** — single-click, appear as floating markers on the waveform in real time
- **Chaos events** — 3+ same emoji within 2 seconds = full-screen visual firework event on the visualizer (uses existing beam fan + spectrogram infrastructure)
- **The booth** — producer has a special presence indicator; can send short text to the room ("this is the part I've been struggling with")
- **Mood tag** — producer sets before track plays: 🌙 Late night / 🔥 Banger / 💔 Emotional / 🎲 Experimental
- **Presence list** — visible list of who's in the room including AI bots

### Active vs Passive Queue

- **Active queue** — tracks from producers currently in the room. Live experience: they watch reactions in real time.
- **Passive queue** — tracks uploaded by offline producers. Plays during lulls. Producer gets heatmap + comments when they check back.
- **Scheduled sessions** — announced live sessions (e.g. Tue/Thu 8pm, Sat afternoon) concentrate users and create event energy. Not always-on.

### Credit Economy

| Action | Credits |
|--------|---------|
| Listen to a full track + send 1 reaction | +1 earned |
| Write a text comment during playback | +0.5 bonus |
| Full 7-phase AI analysis | −3 |
| Active queue slot (live session) | −1 |
| Specialist verdict (single) | −1 |
| Buy a credit bundle | $3–5 / 10 credits |

**First analysis is free** — gets users in the door before they've earned anything.

**Earn or buy** — paying feels fair because earning is always available. Producers who pay subsidize the platform; producers who participate build the community.

### AI Bots as Room Characters

The existing specialist pipeline repurposed as transparent room presences:

- Always in the room — clearly labeled as bots, never hidden
- React based on live analysis: FreqBot changes status to 👎 when frequency clash detected, 👍 when it clears
- Status changes announced to the room ("FreqBot just flagged 200–400 Hz")
- Give the room energy when human count is low
- Their verdicts appear in the producer's report alongside human reactions
- Characters, not meters: FreqBot is skeptical, VibeBot is always hype, CompBot is a snob

### Version Control with Room Feedback

Every version accumulates both AI and human feedback:

- **AI layer**: 7-phase analysis, specialist verdicts, bot reactions
- **Human layer**: timestamped emoji reactions, chat comments, chaos event log, rack adjustment suggestions
- **Comparison view**: upload v2 after fixing the drop — see reaction heatmap side by side with v1. "Chaos events: v1 = 0, v2 = 3. Reactions at drop: v1 = 2, v2 = 11."

This is the long-term retention hook. Producers come back to see if they moved the needle.

### Rack Control Handoff (post-launch)

A viewer requests temporary EQ/compression controls from the producer. If granted, they adjust the DSP chain live — whole room hears the before/after. Deferred to after thin slice validates.

---

## Competitive Positioning

| | Spectr | RoEx | trackscore.ai | Discord feedback |
|---|---|---|---|---|
| AI analysis | deep | deeper | shallow | — |
| Live room | yes | no | no | voice only |
| Synchronized playback | yes | no | no | no |
| Timestamped human reactions | yes | no | no | no |
| Version history + room feedback | yes | no | no | no |
| Credit economy | yes | no | no | no |
| No signup | yes | no | no | yes |
| Pricing | credits + bundles | sub ~$20/mo | sub | free |

**The bar to beat:** trackscore.ai has users with objectively worse analysis. Spectr with better analysis AND a social layer has a path.

**The moat:** The combination. RoEx could build a room but it's not their product. SoundCloud could build analysis but hasn't in a decade. Nobody combines both and adds a credit economy that makes the room self-sustaining.

---

## Target Users

**Primary: "Dario" — the Ambitious Bedroom Producer**

27, produces melodic trance in Ableton, releases 5–8 tracks/yr, can't afford $90/track professional feedback. Tried Discord ("sounds good bro"), tried AI tools (numbers without meaning).

What Dario wants from the room:
- To feel like a DJ for 5 minutes — watch a room react to his track live
- To know which exact timestamp the drop hit or missed
- To have other producers (who know what a good drop sounds like) as his audience
- To compare v2 against v1 and see if his fix actually worked

**Secondary: "The Regular"**

Already uploaded last week. Waiting for credits for another analysis slot. In the room listening because (a) credit incentive, (b) genuinely interesting to hear what other bedroom producers are making, (c) the chaos events are fun when the room gets going.

---

## What's Already Built

| Component | Status |
|-----------|--------|
| Audio analysis pipeline (7 phases + specialists) | complete |
| Listen page visualizer (waveform, spectrogram, EQ overlay, beam fan) | complete |
| Audio streaming (range-enabled) | complete |
| Upload flow | complete |
| Song / version / analysis data model | complete |
| SSE for real-time job progress | complete |
| AI specialist pipeline (27 specialists + triage + validator) | complete |

| Component | Status |
|-----------|--------|
| WebSocket live room (sync playback + presence) | new work |
| Chat panel | new work |
| Emoji reaction + chaos fireworks | new work |
| Queue management (active / passive) | new work |
| Credit tracking + earn/spend logic | new work |
| Credit purchase (Stripe bundles) | new work |
| AI bots wired as room characters | new work |
| Version feedback history (room session attached to version) | new work |

---

## Build Plan

### Thin Slice — test core assumption first

**Riskiest assumption:** Producers find the live reaction experience fun enough to return.

**Scope:**
1. WebSocket live room — synchronized playback, presence list, chat
2. Emoji reaction → chaos fireworks on visualizer
3. Queue display — active (live) and passive (archive)
4. Wire existing analysis as credit sink: 1 full analysis = 3 credits
5. Basic credit tracking: +1 per full track listened with at least 1 reaction sent

**Success bar:** 5+ producers stay for a full track and react. One messages the producer after.

**Estimated:** 2–3 weeks of focused work on top of existing infrastructure.

### Full Build (after thin slice validates)

6. Credit purchase — Stripe bundles
7. AI bots as room characters
8. Version feedback history
9. Rack control handoff
10. Scheduled session announcements

---

## Open Questions

1. **Cold start:** Seed first users via Reddit (r/WeAreTheMusicMakers, r/bedroomproducers) or run a manual Discord session first?
2. **Anti-gaming credits:** Minimum reaction required (already in spec) is probably enough for v1. Revisit if gaming is observed.
3. **Quality floor:** What prevents an unlistenable track from killing the room energy? Options: downvote-to-skip, or minimum play threshold.
4. **Passive queue notifications:** How does an offline producer get notified their track played and reactions are ready?
5. **Bot personality:** Fixed scripts keyed to analysis thresholds for MVP vs LLM-generated status messages.
