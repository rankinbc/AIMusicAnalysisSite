---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - 'PRPs/research/market-spectr-ai-music-analyzer-2026-06-12.md'
  - '_bmad/knowledge/index.md'
  - '_bmad/knowledge/project-overview.md'
  - 'session: v2 restructure-branch audit (BFF/frontend-spectr-v2/verdict-pipeline findings, 2026-06-12)'
date: 2026-06-12
author: Brian Rankin
---

# Product Brief: Spectr

<!-- Content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

**Spectr is an AI mixing coach for electronic music producers** — upload a track (optionally with stems, a reference track, and the Ableton project file) and get an explained, genre-native diagnosis: what's wrong, why it matters, which track in your project causes it, and exactly how to fix it. Where incumbent AI services process audio as a black box, Spectr teaches; where free analyzers spit numbers, Spectr interprets them against the producer's own genre and project.

The product revamps an existing, working v2 codebase (.NET BFF + Dramatiq Python analysis worker + React 19 SPA) that already implements the category's unoccupied feature combination: 8-phase DSP analysis, a validated AI verdict pipeline (rule engine → triage → 27 specialists → validator → dedupe/rank), per-stem clash detection, Ableton .als project introspection, genre-weighted scoring, song library with version tracking, and in-browser Listen DSP tools. The revamp converts this engine into a trustworthy paid SaaS: Free tier funnel → Pro $12.99/mo (~$99/yr) → episodic credit packs, with conspicuously honest commercial terms (transparent billing, delivered reports never held hostage, "never trained on your audio" pledge) as a structural differentiator in a category whose incumbents are distrusted on billing.

Target: the ~5–10M "ambitious bedroom producers" (trance/house/techno/DnB first) who release via DistroKid/SoundCloud/Beatport, cannot afford $300–700/track professional mixing on every release, and currently get feedback from spam-ridden Discord threads or not at all. Competitive window: 6–12 months before Slapback (.als feedback, $9.95/mo) and TrackScore.ai (9 EDM genre profiles) converge on the combined position.

---

## Core Vision

### Problem Statement

Ambitious bedroom producers cannot get fast, honest, actionable feedback on their mixes. Professional mixing/mastering feedback costs $75–700 per track with 1–14 day turnaround; free community feedback is reciprocity-gated, slow, sycophantic, or spam ("5 people asking for feedback, 1 person giving it"); and existing AI services process the audio without explaining anything — "the algorithm can't tell you to go back and fix your mix." The producer is left alone with the two questions that block their growth: "why does my mix sound worse than releases I admire?" and "what specifically do I fix first?"

### Problem Impact

- The #1 and #2 producer struggles are beginner overwhelm and mixing/mastering (EDMProd survey, n=1,097); misdiagnosis is rampant — perceived "mix" problems are often arrangement problems.
- Tracks stall at 80–90% done (the "loop trap"); fear of honest feedback keeps finished tracks unreleased.
- The education gap compounds it: the -14 LUFS myth, true-peak confusion, and distrusted low-end metering mean producers can't act on the numbers tools already give them.
- Economically: a producer releasing 6 tracks/yr faces $450–4,200/yr in professional feedback costs to close the gap — or stays stuck.

### Why Existing Solutions Fall Short

- **AI mastering processors (LANDR, eMastered, Mixea, BandLab):** black boxes that loudness-process toward a genre average; zero diagnostics; documented complaints of generic results, destroyed dynamics, genre blindness (3-bucket presets), and billing traps (78% of eMastered complaints are billing).
- **Free analyzers (RoEx Mix Check Studio — 1.7M+ analyses):** prove demand for diagnostics, but are genre-shallow, project-blind, and single-shot (no history, no coaching depth).
- **Desktop metering plugins (Tonal Balance Control, EXPOSE, Metric AB):** assume the user already knows what to listen for; distrusted precisely in the low end where help is most needed; no verdicts, no fixes, no education.
- **Direct new rivals each hold one piece:** Slapback reads .als but lacks DSP scoring depth, genre profiles, stem clash, and version timelines. TrackScore scores 9 EDM genres but is audio-only — it cannot point at the offending track in the project. Nobody combines them.
- **Human feedback (Discord, paid services):** slow, inconsistent, reciprocity-gated, or expensive; emotionally costly for producers afraid to share work.

### Proposed Solution

A hosted analysis platform where a producer uploads a bounce (plus optional stems, reference track, and .als project) and receives one shareable report that:

1. **Measures** — 8-phase DSP analysis: LUFS/true peak/clipping, 7-band frequency balance, stereo/mono compatibility, BPM/key, genre detection and scoring, stem clash matrix, reference deltas, percentile gap vs genre profile, arrangement structure.
2. **Diagnoses** — verdict pipeline turns measurements into ranked, validated verdicts: rule engine for deterministic issues, LLM specialists for nuanced ones, a validator that rejects hallucinated evidence, dedupe and priority ranking.
3. **Coaches** — every verdict explains the why in producer language, references the producer's actual measured values and (when .als provided) the specific project track/device, and prescribes concrete DSP moves (EQ frequencies, compressor settings).
4. **Tracks growth** — song library groups versions; score timelines show whether mix iterations actually improved; the report becomes a feedback loop, not a one-shot verdict.
5. **Stays honest** — transparent pricing, results accessible forever even after cancellation, explicit no-AI-training pledge, private by default with opt-in share links.

### Key Differentiators

1. **The stack, not a feature:** .als project introspection + per-stem clash table + genre-weighted scoring + validated coach verdicts + version history in one hosted report — confirmed unoccupied by dedicated competitive search (June 2026).
2. **Explains, never just processes:** positioned on the assistive side of the AI acceptance line (~50% producer approval) vs generative (>90% rejection); coach framing, never "replaces your engineer."
3. **Genre-native for electronic music:** statistical genre profiles (trance shipped: 196 tracks, 25 features, percentile ranking) vs incumbents' 3-bucket genre blindness; arrangement scoring built on EDM conventions (8-bar rule, drop/breakdown energy contrast).
4. **Root-cause linkage no one else can do:** "your 60–90 Hz is 4 dB over genre median — and it's the Sub Bass track in your project clashing with the kick; sidechain or carve 65 Hz" requires audio + stems + project file together.
5. **Trust as product:** the category's billing reputation is wounded; conspicuously honest commercial terms are a differentiator incumbents cannot copy without revenue pain.
6. **Validated verdicts:** the pipeline's validator checks every LLM claim against measured values (metric-path resolution, 10% evidence tolerance, DSP parameter ranges) — answers the "AI feedback is hallucinated slop" objection structurally.
7. **An interrogable coach, not a static report:** "Ask the Coach" chat is anchored to the report — every answer grounded in the producer's own analysis JSON, verdicts, and project structure. Generic AI chat about mixing is a commodity (free Gemini/ChatGPT feedback exists); chat that knows YOUR measured values and YOUR track names is only possible on top of this data layer. The coach metaphor becomes literal: you can talk back.

---

## Target Users

### Primary Users

**P1 — "Dario", the Ambitious Bedroom Producer (core ICP; market segment S2, ~5–10M globally)**
27, Berlin suburb, day job in IT. Produces melodic trance in Ableton 3–4 evenings/week for five years; releases 5–8 tracks/yr via DistroKid; dreams of a signing on a respected trance label. Learns from YouTube (In The Mix, production streams). His mixes "almost" work: low end muddier than the Anjunabeats references, masters come back from free AI tools sounding flat and loud. Workarounds today: posts WIPs in two Discords (gets "sounds good bro" or silence), once paid $90 for feedback that took 9 days and said "fix the low mids" without saying where or how. He will not pay $350/track to mix-engineer every release; he wants to LEARN to close the gap himself.
- **Problem experience:** stuck iterating blind; same low-end and arrangement mistakes every track; can't interpret LUFS/true-peak numbers confidently.
- **Success vision:** uploads bounce + .als after each session; in 2 minutes knows the 3 things to fix, in his language, pointing at his actual tracks; version chart shows score climbing across mix 1→4; track gets signed, he credits the iteration loop.
- **"Exactly what I needed" moment:** "Your sub bass (track 'SUB-DEEP') masks the kick 55–80 Hz — sidechain it or cut 2 dB at 65 Hz; this is why your drop feels weaker than your reference" — a verdict naming HIS track with HIS numbers.

**P2 — "Maya", the DJ-Producer Scene Operator (market segment S3, ~1–3M)**
33, Manchester, plays tech-house club sets monthly. Produces tools-for-sets, not streaming hits: tracks must slam on club systems and mix cleanly into Beatport top-100 material. Cares about: mono-compatible low end, true peak headroom, DJ-friendly intro/outro arrangement, energy curve through the drop. Buys-per-need (credits > subscription), benchmarks everything against current Beatport genre charts.
- **Problem experience:** track sounds huge at home, falls apart on the club's mono sub; arrangement awkward to beatmatch.
- **Success vision:** pre-release club-readiness check: mono compatibility, low-end translation, energy contrast, 8-bar DJ structure — pass/fail with fixes.
- **"Exactly what I needed" moment:** "Mono compatibility 71% — your widened bass loses 4 dB summed to mono; narrow below 120 Hz" before a gig, not after.

### Secondary Users

- **S1 Casual hobbyists (~60–90M):** free-tier funnel volume and share-link virality; near-zero paid conversion by design — do not build for them, accept them.
- **S4 Semi-pro engineers/educators:** skeptical of coaching framing but value batch QC; future API/Studio tier; also act as credibility validators in communities.
- **YouTube producer-educators (channel partners):** not end users primarily — they demo reports on subscriber tracks; affiliate economics (15–30%) make them the de facto sales force; need a demo-able, screenshot-friendly report.
- **Production schools/courses (validated by Slapback's schools program):** instructors reviewing student mixes at scale; cohort licensing later.
- **Recipients of share links (A&Rs, collab partners, mentors):** read-only consumers of the public report page; every share is an acquisition impression.

### User Journey

**Dario (P1) — subscription path:**
1. **Discovery:** YouTube educator video "I let an AI coach review my trance mix" (affiliate link) or a share-link report a Discord friend posted.
2. **Onboarding:** free instant analysis — uploads a bounce, sees core report (score, LUFS panel, frequency chart, top fix) in ~2 min without a card; depth (verdicts, stems, .als, history) visibly gated.
3. **First "aha":** the top fix references his actual measured values and explains WHY in producer language — unlike every black-box master he's tried.
4. **Conversion:** finishing a track for label submission, hits the 3-analyses/mo free cap mid-iteration; upgrades to Pro $12.99 (or $99/yr) to unlock unlimited + .als + verdicts.
5. **Core usage:** 2–4 analyses/week during active projects; uploads .als with each bounce; works the fix queue; asks the coach follow-ups on verdicts he doesn't fully understand ("why does this matter on club systems?"); version timeline becomes his progress dashboard.
6. **Long-term:** library = his catalog QC system; sharing reports with collab partners; renews annually because history + genre percentile is where his growth lives.

**Maya (P2) — episodic credits path:**
1. Discovery via Beatport-adjacent communities/genre Discord. 2. Free check on a finished club tool. 3. Buys 5-credit pack ($4.99–5.99/credit economics) before each release batch. 4. Success moment: first track that translates on the club sub. 5. Converts to Pro only if release cadence rises — credits keep her monetized without subscription resentment.

**Failure modes to design against:** Dario churns if verdicts repeat generically across tracks (depth = retention); Maya never subscribes if credits feel punitive (credits are a feature, not a dark pattern); educators won't promote if the free tier embarrasses their audience (free report must be genuinely good).

---

## Success Metrics

**User success = the iteration loop works.** A user succeeds when (a) first analysis delivers an actionable top-fix within 3 minutes of upload, (b) they apply fixes and re-upload — version 2+ of the same song analyzed, and (c) their version-over-version scores trend up. The single behavior that proves value: **re-analysis of the same track after acting on a verdict.** Verdict-level feedback (helpful/wrong — already in schema) is the quality thermometer.

### Business Objectives

- **3 months post-launch:** willingness-to-pay validated — $1K MRR (~80 Pro subs or equivalent credits); 500 free MAU; ≥5 affiliate videos live; free→paid conversion ≥2%.
- **12 months:** niche validated — $10K MRR; 5+ genre profiles shipped (match TrackScore's coverage where it matters); month-3 cohort retention curve flattening ≥40% (version-history moat thesis proven); LLM cost per analysis <15% of ARPU.
- **Strategic:** own "AI mixing coach for electronic producers" position before Slapback/TrackScore converge (6–12 month window); be acquisition-attractive (clean stack, niche dominance) while community-rooted (library, profiles, shares).

### Key Performance Indicators

| KPI | Target | Why it matters |
|---|---|---|
| Time-to-first-insight (upload → report visible) | <3 min p90 | Onboarding aha; free funnel converts on this |
| Free→paid conversion | 2–5% | Industry-realistic band; below 2% = funnel or value problem |
| Analyses per active user per month | ≥2 | Distinguishes WIP-coaching usage from one-shot master checks |
| Same-track re-analysis rate | ≥30% of paying users monthly | The iteration loop — core retention signal |
| Monthly churn (paid) | <6% (prosumer norm), <4% good | Episodic-usage risk control; pause plan counts as save |
| Verdict helpful-rate | >70% helpful, <10% wrong | Coaching quality; wrong-rate spikes gate LLM changes |
| Share-link views → signups | track k-factor; ≥0.15 early | Organic loop already built (share_token) |
| Affiliate-attributed signups | ≥30% of paid in yr 1 | Channel thesis validation |
| LLM cost per analysis | <15% of ARPU | Unit economics guardrail; enforced by per-tier metering |
| Involuntary churn recovered | >50% of failed payments | ~Half of SaaS churn is card failures — cheapest retention |

Leading indicators: free-analyzer weekly volume (top-of-funnel health), .als-attach rate (differentiator adoption), coach follow-up rate per analysis (interrogable-report engagement), genre distribution of signups (beachhead focus check).

---

## MVP Scope

Base: `restructure` branch (v2 stack — .NET BFF + Dramatiq worker + frontend-spectr-v2; slices 0–3 complete and verified building June 2026). MVP = finish the product surface + add the entire monetization/trust layer. Engine work is mostly done; commerce work is mostly not started.

### Core Features

**A. Already built — verify, polish, keep (engine):**
1. 8-phase DSP analysis pipeline (LUFS/TP/clipping, frequency, stereo/mono, BPM/key, genre scoring, stem clash, reference deltas, gap analysis, arrangement, .als)
2. Verdict pipeline (rule engine → triage → specialists → validator → dedupe/rank) with golden-fixture tests
3. Song library + version tracking (songs/song_versions schema, set-current, notes, re-analyze)
4. Auth (JWT + refresh cookie), upload ≤250 MB, SSE progress
5. Results page core (grade hero, metadata, streaming readiness, frequency chart, coach) + Listen DSP page
6. Trance statistical genre profile (196 tracks, 25 features, percentile)

**B. Build for MVP — product completion:**
7. Report parity with v1 surface: per-stem clash table, arrangement advisor panel, genre radar/gap UI, reference comparison UI, .als analysis panel (backends exist; v2 UI panels missing)
8. Share page (currently 20% stub) — public report = acquisition surface; screenshot/educator-friendly
9. Version comparison view (delta between two versions — placeholder today)
10. Audio playback on report (player exists in Listen; embed in report)
11. House + techno genre profiles (beachhead credibility; trance alone is too narrow)
12. **"Ask the Coach"** — report-anchored chat (BFF coach endpoints + frontend wiring already half-built): context = analysis JSON + verdicts + .als summary; answers grounded in the user's measured values; per-tier message caps (free: 3 follow-ups per analysis; Pro: pooled monthly cap) enforced by the same metering as analyses — keeps the <15%-ARPU LLM guardrail intact

**C. Build for MVP — monetization + trust layer (all-new):**
13. Stripe billing: Free (3 analyses/mo) / Pro $12.99/mo + $99/yr / credit packs; transparent terms; cancel = cancel
14. Usage metering per tier (analyses, LLM verdict spend, coach messages) — gates + unit-economics telemetry
15. LLM replatform: claude CLI subprocess → Anthropic SDK with concurrency, per-call cost tracking, per-tier budgets (current Semaphore(1) cannot serve concurrent paying users; also prerequisite for responsive coach chat)
16. Landing page + pricing page + free instant analyzer (no-card first analysis) — the funnel
17. Email: verification, password reset, analysis-complete notification, failed-payment dunning
18. Production hardening: S3/R2 storage + retention policy, JWT secret from env, rate limiting, error sanitization, worker retries, CI/CD, monitoring
19. Trust policies shipped as features: no-AI-training pledge page, results-forever guarantee, privacy-by-default sharing
20. Affiliate program (basic: coded links + attribution + payout report) — channel from day one

### Out of Scope for MVP

- .flp (FL Studio) project support — fast-follow differentiator, not launch-gating
- API/B2B tier (Tonn-style), white-label, schools licensing
- Freeform/general-production chat companion — MVP chat is report/verdict-anchored only (uncapped open-ended chat breaks unit economics and invites ungrounded-slop brand risk)
- Bookmarks/profiles/community surfaces beyond what's already wired
- PDF export (share links cover MVP sharing; revisit on demand)
- Mobile apps (responsive web only)
- Demucs full stem separation by default (10–20 min CPU); spectral fallback + user-supplied stems remain
- Additional genre profiles beyond trance/house/techno (DnB next, post-launch)
- Album/EP multi-track consistency reports
- Migration of v1 FastAPI surface — frozen, not deleted; BFF is canonical

### MVP Success Criteria

- A stranger can: land → free-analyze a track without a card → see a genuinely useful explained report → hit the cap → pay $12.99 without talking to anyone → analyze with .als + stems → share a report link.
- Beta gate (pre-paid-launch): 20–50 producers from trance/house communities; ≥70% verdict helpful-rate; time-to-first-insight <3 min p90; zero billing-integrity bugs.
- Scale gate: 2 concurrent paying users running verdicts simultaneously without queue starvation (kills Semaphore(1)).
- Business gate: first 30 days post-launch — ≥1% free→paid conversion and LLM cost per analysis <25% ARPU (improving toward 15%).

### Future Vision

Year 1: genre-profile expansion (DnB, progressive, melodic techno — match/exceed TrackScore's 9), .flp support (unoccupied), coach chat on verdict context, A/B compare, schools/labels seats. Year 2–3: the producer's growth platform — every serious electronic producer's pre-release ritual and progress record: catalog QC, label-submission readiness packs, A&R share workflows, API embedded in distro platforms (the DistroKid-buys-feedback scenario — be the acquisition, not the roadkill), community of shared reports forming a genre-benchmark data moat that compounds with every analysis.
