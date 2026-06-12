---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
inputDocuments:
  - 'PRPs/product-brief-spectr-2026-06-12.md'
  - 'PRPs/research/market-spectr-ai-music-analyzer-2026-06-12.md'
  - '_bmad/knowledge/index.md'
  - '_bmad/knowledge/project-overview.md'
  - 'session: restructure-branch audit 2026-06-12 (BFF endpoints, frontend-spectr-v2 state, verdict pipeline, Dramatiq actors, build verification)'
workflowType: 'prd'
classification:
  projectType: 'web_app (B2C/prosumer SaaS — SPA + BFF API + async analysis worker)'
  domain: 'music technology / creator tools (consumer AI SaaS; scientific-ML flavor: DSP analysis, LLM verdicts)'
  complexity: 'medium (no regulatory burden; payments via Stripe standard; accuracy/trust of DSP+LLM output is the domain-specific concern)'
  projectContext: 'brownfield (base = git branch restructure; slices 0-3 built and verified)'
---

# Product Requirements Document - Spectr

**Author:** Brian Rankin
**Date:** 2026-06-12

## Executive Summary

Spectr is an AI mixing coach for electronic music producers. A producer uploads a bounce — optionally with stems, a reference track, and the Ableton .als project file — and receives one explained, genre-native report: measured DSP facts (LUFS/true peak, frequency balance, stereo health, stem clashes, arrangement structure), validated AI verdicts ranked by priority, and a coach that names the offending project track, explains why it matters, prescribes exact DSP moves, and answers follow-up questions grounded in the producer's own data. A song library tracks score progression across mix versions, turning one-shot feedback into an iteration loop.

The target buyer is the "ambitious bedroom producer" (~5–10M globally; trance/house/techno/DnB beachhead): releases via DistroKid, cannot afford $300–700/track professional feedback per release, gets noise from Discord feedback threads, and cannot interpret the numbers free analyzers already give them. Monetization: Free (3 analyses/mo) → Pro $12.99/mo (~$99/yr) → credit packs for episodic users; conspicuously honest commercial terms (transparent billing, delivered reports never held hostage, no-AI-training pledge) as a wedge in a category whose incumbents are distrusted on billing (78% of eMastered complaints are billing).

This PRD covers the revamp of an existing working codebase (git branch `restructure`: .NET 10 BFF + EF Core, Dramatiq Python analysis worker, React 19 SPA, validated verdict pipeline — slices 0–3 complete, builds verified 2026-06-12) into that paid SaaS: completing the product surface (report parity panels, share page, version compare, playback, genre profiles, capped report-anchored coach chat) and adding the entire commerce/trust layer (Stripe, metering, Anthropic SDK replatform, funnel pages, email, storage/hardening/CI, affiliate basics).

### What Makes This Special

The defensible asset is the data layer under the coach, not the chat. Generic AI feedback is a free commodity (Gemini/ChatGPT, BandLab, RoEx Mix Check at $0); a coach that cites YOUR measured 60–90 Hz energy, names YOUR 'SUB-DEEP' track as the masking source, scores you against a statistical genre profile, and shows your score climbing across four mix versions requires audio DSP + stem analysis + .als introspection + genre statistics + version history in one system. Competitive search (June 2026) confirms no competitor combines them: Slapback has .als feedback but no DSP scoring depth; TrackScore has 9 EDM genre profiles but is audio-only; RoEx has an API but coaches nothing. Each holds one piece; the stack is unoccupied. Secondary differentiators: validator-checked verdicts (structural answer to "AI slop"), and trust-as-product commercial terms incumbents cannot copy without revenue pain. Window: 6–12 months.

## Project Classification

**Project Type:** Web app — B2C/prosumer SaaS (React SPA + .NET BFF + async Python analysis worker)
**Domain:** Music technology / creator tools; scientific-ML flavor (DSP analysis, LLM verdict generation)
**Complexity:** Medium — no regulatory burden; payments standard via Stripe; domain-specific risk concentrates in DSP/LLM output accuracy and trust
**Project Context:** Brownfield — base is git branch `restructure` (v2 stack, slices 0–3 complete and build-verified); v1 FastAPI/Celery surface frozen, not migrated

## Success Criteria

### User Success

- A first-time visitor gets an explained, genuinely useful analysis of their own track in **<3 minutes p90** from upload, without entering a card.
- The "exactly what I needed" moment is reproducible: top verdict cites the user's measured values, and — when .als is attached — names the offending project track with a concrete DSP fix.
- The iteration loop works: users act on a verdict, re-upload, and see version-over-version score movement. **Same-track re-analysis is the canonical user-success behavior.**
- Coach follow-ups resolve confusion instead of creating it: answers stay grounded in the user's analysis JSON; "I don't have that measurement" beats invention.
- Users never lose their work: delivered reports remain accessible after subscription lapse, permanently.

### Business Success

- **3 months post-launch:** $1K MRR (~80 Pro-equivalents); 500 free MAU; ≥5 affiliate videos live; free→paid ≥2%.
- **12 months:** $10K MRR; month-3 cohort retention flattening ≥40%; ≥30% of paid attributable to affiliates; 5+ genre profiles live.
- Position owned before window closes: "AI mixing coach for electronic producers" — distinct from Slapback (feedback without DSP depth) and TrackScore (score without project root-cause).

### Technical Success

- **Concurrency:** 2+ paying users can run analyses + verdict generation + coach chat simultaneously without queue starvation (retires claude-CLI `Semaphore(1)`).
- **Unit economics observable:** every LLM call metered (tokens, $, user, tier, purpose); LLM cost per analysis <25% ARPU at launch, trending <15%.
- **Verdict quality guarded:** validator rejection + user "wrong" feedback rates tracked; helpful-rate >70%, wrong-rate <10% sustained.
- **Billing integrity:** zero tolerance — no double charges, no post-cancel charges, no orphaned subscriptions; Stripe webhook reconciliation provably idempotent.
- **Pipeline reliability:** analysis job success ≥99% (excluding invalid files); failed jobs auto-retry (Dramatiq max_retries) then surface actionable errors; p90 analysis wall-time <3 min without Demucs.

### Measurable Outcomes

| Outcome | Target | Instrument |
|---|---|---|
| Time-to-first-insight | <3 min p90 | job timestamps (created→report viewable) |
| Free→paid conversion | 2–5% | Stripe + signup cohorts |
| Same-track re-analysis | ≥30% of paying users/mo | song_versions per user |
| Paid churn | <6%/mo (target <4%) | Stripe |
| Verdict helpful-rate | >70% helpful, <10% wrong | verdict feedback (schema exists) |
| Coach follow-up rate | tracked; engagement signal | coach message events |
| .als attach rate | tracked; differentiator adoption | upload metadata |
| LLM cost / analysis | <25% ARPU → <15% | per-call metering |
| Share-link k-factor | ≥0.15 | share views → signups |
| Failed-payment recovery | >50% | dunning events |

## Product Scope

### MVP - Minimum Viable Product

(Carries forward Product Brief MVP buckets; brief is authoritative for rationale.)

- **Bucket A — exists on `restructure`, verify + keep:** 8-phase analysis pipeline; verdict pipeline (rule engine → triage → 27 specialists → validator → dedupe/rank); song library + versioning; auth; upload ≤250 MB; SSE progress; results page core; Listen DSP page; trance genre profile.
- **Bucket B — product completion:** report parity panels (stem clash table, arrangement advisor, genre radar/gap, reference comparison, .als analysis); share page (public report = acquisition surface); version-compare view; audio playback in report; house + techno genre profiles; **"Ask the Coach"** report-anchored chat with per-tier message caps.
- **Bucket C — commerce + trust layer (all-new):** Stripe billing (Free 3/mo, Pro $12.99/mo + $99/yr, credit packs); per-tier usage metering (analyses, LLM spend, coach messages); Anthropic SDK replatform (concurrency + cost tracking); landing + pricing + free instant analyzer funnel; email (verification, reset, completion, dunning); production hardening (S3/R2 + retention, secrets, rate limiting, error sanitization, worker retries, CI/CD, monitoring); trust pages (no-training pledge, results-forever, privacy defaults); affiliate basics (coded links, attribution, payout report).

### Growth Features (Post-MVP)

.flp (FL Studio) project analysis; DnB/progressive/melodic-techno profiles; A/B compare against arbitrary tracks; PDF export; coach memory across sessions; schools/label seats; API tier (Tonn-style); album/EP consistency reports; pause-subscription flows; deeper Listen-DSP ↔ report integration (audition the prescribed EQ move).

### Vision (Future)

The pre-release ritual and progress record for every serious electronic producer: catalog QC, label-submission readiness packs, A&R share workflows, feedback API embedded in distribution platforms, and a genre-benchmark data moat that compounds with every analysis.

## User Journeys

### Journey 1 — Dario, free → Pro (happy path)

Dario, 27, IT day job, five years of melodic trance in Ableton, releases via DistroKid. His label submissions keep bouncing: "low end needs work." Discord feedback says "sounds good bro." A YouTube tutorial he follows ends with "I ran my mix through this AI coach" — affiliate link.

He lands on the free analyzer. No card, no account for first result: drags `anthem_v3.wav` in, watches phase progress live, and in under 3 minutes sees a B- (78), LUFS panel with platform pass/fails, frequency chart vs trance median — and one top verdict: "Low-end congestion 60–90 Hz, 4.2 dB over genre median; kick clarity suffers. Likely bass/kick masking." It cites HIS numbers. He signs up (email verification) to see the other six verdicts and save the report.

Next evening he re-exports with the .als attached. Now the verdict names the track: "'SUB-DEEP' overlaps kick fundamental 55–80 Hz; sidechain at ~4:1 or cut 2 dB at 65 Hz, Q 1.4." He asks the coach: "won't cutting 65 Hz thin out the drop?" Coach answers from his arrangement data: drop sections have 3 dB more sub energy than breakdowns; a 2 dB cut keeps him above genre median. He makes the move, re-bounces, uploads version 4. Score: 84. Version timeline shows the climb. Third analysis that month — cap hit. Upgrade screen: $12.99/mo or $99/yr, plain terms, "reports stay yours forever." He pays without contacting anyone. Two weeks later his library shows 3 songs, 11 versions; the label replies "low end sits much better — send two more."

**Reveals:** free-analyzer funnel (no-card first analysis), signup gate at depth, .als attach flow, verdict → coach-chat context handoff, version timeline, usage caps + upgrade flow, Stripe checkout, results-forever policy.

### Journey 2 — Dario, things go wrong (edge/recovery)

Dario uploads a 190 MB FLAC on hotel wifi; upload stalls at 60%, resumes, completes. The pipeline's phase 4 (stem clash) fails on a corrupted region — report still renders with seven of eight phases and a banner: "Stem clash unavailable for this file — re-export and retry free." One verdict claims his mids are harsh; he disagrees, taps "wrong," explains in one line. The wrong-rate feeds the quality dashboard; verdict's specialist prompt version is flagged for review. Later the coach declines gracefully: "I don't have tonal data for your reference track — it failed to analyze" instead of inventing numbers. A failed Stripe renewal (expired card) triggers dunning emails; his access degrades to free tier, but every past report stays readable. He fixes the card; Pro resumes; nothing was lost.

**Reveals:** chunked/resumable-tolerant upload, partial-failure-tolerant reporting (per-phase), free retry on phase failure, verdict feedback loop wired to quality telemetry, grounded-refusal coach behavior, dunning + graceful degradation (never lock past reports), idempotent billing state transitions.

### Journey 3 — Maya, episodic credits (DJ-producer)

Maya finishes a tech-house tool the week before a gig. She doesn't want a subscription — she releases in bursts. Free analysis flags mono compatibility 71%: her widened bass loses 4 dB summed to mono — exactly what killed her last track on the club's mono sub. She buys a 5-credit pack ($24.95), runs the full check with stems, fixes width below 120 Hz, re-checks (second credit), exports. At the gig the track translates. Credits don't expire monthly; no dark-pattern auto-subscription. Two release cycles later, her cadence rises and the upgrade math is shown plainly in her usage page: "you spent $39.90 on credits in 90 days; Pro would have been $38.97."

**Reveals:** credit purchase + ledger, credits-vs-subscription transparency, club-readiness checks surfaced (mono/TP/energy), stem upload flow, usage page with honest upgrade math.

### Journey 4 — share-link recipient → signup (acquisition loop)

Dario posts his report link in a producer Discord: "finally understand my low end." A stranger opens `/r/{token}`: public read-only report — score hero, frequency chart vs genre, top verdicts (coach chat and project internals hidden), "Analyze your own track free" CTA. No auth wall to view. She runs the free analyzer on her own track; the k-factor loop closes.

**Reveals:** public share page must be self-explanatory and fast (SEO/OG cards), privacy boundaries (owner controls what a share exposes; .als internals never public), CTA conversion instrumentation (share→visit→analysis→signup).

### Journey 5 — Marco, educator/affiliate (channel partner)

Marco runs a 120K-sub production channel. Affiliate signup gives him a coded link and a dashboard: clicks, signups, conversions, 25% first-year commission. He films "AI coach reviews my subscribers' trance mixes": screenshot-friendly report, presenter-readable charts. His audience converts; attribution survives the 30-day cookie; payouts reported monthly. He keeps making videos because the report demos well and the free tier doesn't embarrass his viewers.

**Reveals:** affiliate registration/links/attribution/dashboard/payout report; report visual quality as a marketing requirement; demo-able free tier.

### Journey 6 — Brian, operator/admin

Solo operator. Morning glance at ops dashboard: queue depth, analysis success rate, LLM spend per tier vs budget, verdict wrong-rate trend, MRR/churn. A user emails about a double-charge claim — Stripe reconciliation view shows the single charge and its webhook trail; refund issued in two clicks; audit-logged. A free-tier abuser scripts 50 analyses through disposable emails — rate limiting + per-account caps already contained it; he bans the accounts. A specialist prompt update bumped wrong-rate from 6%→14%; he rolls back the prompt version (prompt versioning already in pipeline) without redeploying.

**Reveals:** ops/admin dashboard (queue, success rate, LLM spend, quality, revenue), refund + audit tooling, abuse controls (rate limits, caps, disposable-email throttling), prompt version rollback, alerting.

### Journey Requirements Summary

| Capability area | Revealed by | MVP? |
|---|---|---|
| Free instant analyzer (no card; result <3 min) | J1, J4 | Yes |
| Signup gate at depth; email verification | J1 | Yes |
| .als attach + project-named verdicts | J1 | Yes |
| Report-anchored coach chat (grounded; refuses when data absent; capped) | J1, J2 | Yes |
| Version timeline + same-track re-analysis | J1 | Yes |
| Stripe: subscription + credit packs + dunning + reconciliation; results-forever on lapse | J1, J2, J3 | Yes |
| Partial-failure reporting + free retry | J2 | Yes |
| Verdict feedback → quality telemetry; prompt version rollback | J2, J6 | Yes |
| Stems flow + club-readiness surfacing | J3 | Yes |
| Usage page with honest credits-vs-Pro math | J3 | Yes |
| Public share page (fast, OG cards, privacy-bounded) + funnel instrumentation | J4 | Yes |
| Affiliate links/attribution/dashboard/payouts | J5 | Yes (basic) |
| Ops dashboard + refunds + abuse controls + alerts | J6 | Yes (minimal) |
| API consumers | none in MVP | No (post-MVP tier) |

## Domain-Specific Requirements

### Compliance & Regulatory

- **GDPR-first posture** — 54% of engaged-producer market is EU/UK: data export, account deletion (cascade: audio, stems, .als, reports, chat logs), lawful-basis clarity, cookie-consent minimalism. No US-only shortcuts.
- **EU consumer law for digital subscriptions:** 14-day withdrawal handling, pre-contract pricing transparency, cancellation as easy as signup (also brand strategy).
- **Tax:** EU VAT/OSS + US sales tax on digital services via Stripe Tax from day one; pricing displayed tax-inclusive where law requires.
- **PCI:** scope minimized to SAQ-A — Stripe Checkout/Elements only; card data never touches Spectr servers.
- **FTC/ASA affiliate disclosure:** affiliate terms must require disclosure; tracking links honor consent rules.

### Technical Constraints

- **Intellectual property is the data:** unreleased music is the user's most sensitive asset. Encryption at rest (S3 SSE) + TLS everywhere; signed, expiring media URLs; private-by-default; share links expose a curated read-only subset (never .als internals, never raw stems).
- **No-AI-training pledge as binding policy:** user content never used to train models; Anthropic API calls configured accordingly (no training on API data); pledge published and versioned.
- **Measurement credibility:** loudness/true-peak must match the meters producers trust — ITU-R BS.1770-4 / EBU R128 conformance for LUFS, 4× oversampled dBTP; published tolerance (±0.1 LU) against reference test signals. A wrong LUFS number destroys the product's authority.
- **LLM grounding constraints:** verdicts and coach answers must cite only measured values present in analysis JSON (validator-enforced); coach refuses rather than invents; every prompt versioned; provider outage degrades to rule-engine-only verdicts with user-visible notice.
- **.als parsing safety:** gzip-bomb limits, schema-version tolerance (Live 10–12), parser sandboxed from worker crash (failure = phase skipped, not job dead).
- **Large-file handling:** 250 MB uploads on consumer connections — chunked upload, resume tolerance, magic-byte validation (existing), transcode normalization to 44.1 kHz WAV before analysis (existing).

### Integration Requirements

- Stripe (subscriptions, credits via invoice items or payment intents, Customer Portal, webhooks, Tax).
- Anthropic API (verdicts + coach; per-call token/cost capture; model pinning + fallback model config).
- Transactional email provider (Resend/Postmark/SES — verification, reset, completion, dunning).
- S3-compatible object storage (AWS S3 or Cloudflare R2) for uploads/stems/results; lifecycle rules per retention policy.
- OG/social card rendering for share pages (static generation acceptable).
- Analytics: privacy-respecting product analytics (PostHog self-host or Plausible + custom events) — funnel + KPI instrumentation without creepy tracking (brand-consistent).

### Risk Mitigations

- **Quality drift (LLM):** prompt version pinning, golden-fixture regression suite (exists), wrong-rate alerting, one-click prompt rollback.
- **Cost blowout (LLM):** hard per-tier budgets, per-user caps, coach message caps, circuit breaker that degrades to rule-engine verdicts.
- **Copyright disputes:** users attest ownership at upload; DMCA contact + takedown process documented (low risk — private analysis, not distribution — but policy must exist).
- **Genre-profile credibility:** publish methodology (track counts, feature list) per profile; never claim a profile that's just presets (house/techno must ship with real statistical backing like trance's 196-track profile).
- **Single-operator bus factor:** ops runbook, alerting to phone, every privileged action audit-logged, infra reproducible from repo (IaC-lite acceptable).

## Innovation & Novel Patterns

### Detected Innovation Areas

1. **Validated-verdict architecture (novel pattern):** LLM output is not trusted — a deterministic validator resolves every metric path against the analysis JSON, checks evidence values within 10% tolerance, range-checks prescribed DSP parameters, and recomputes priority. LLM claims that fail validation are rejected before users see them. This is a structural answer to AI-feedback slop that no competitor advertises.
2. **Cross-artifact root-cause linkage (first combination):** rendered-audio DSP + per-stem analysis + .als project introspection feed one verdict: symptom (frequency clash) → cause (named project track/device) → prescription (parameterized DSP move). Slapback (project, no DSP depth), TrackScore (DSP score, no project), RoEx (processing, no coaching) each hold a fragment.
3. **Grounded interrogable report:** coach chat whose context is the user's measured data and whose refusal behavior is a feature ("I don't have that measurement"). Chat-as-UI is commodity; grounding contract is the innovation.
4. **Version-history-as-product:** score trajectories per song as the retention spine — analytics pattern common in fitness/learning apps, unoccupied in mix feedback.

### Market Context & Competitive Landscape

Covered exhaustively in `PRPs/research/market-spectr-ai-music-analyzer-2026-06-12.md` (June 2026): combination confirmed unoccupied; nearest threats Slapback ($9.95/mo) and TrackScore.ai; free floor (BandLab, Mix Check Studio, Phantom OSS) commoditizes shallow feedback.

### Validation Approach

- Golden-fixture regression suite for pipeline + verdicts (exists; extend per new genre profile).
- Closed beta (20–50 trance/house producers): verdict helpful-rate >70% gate before paid launch.
- A/B the coach's grounded-refusal vs silence on user trust (qualitative beta interviews acceptable at this scale).
- LUFS/dBTP conformance harness against reference signals (BS.1770 test vectors) before marketing any number as authoritative.

### Risk Mitigation

- If validation kills too many LLM verdicts (over-strict): tolerance tuning per metric class; rule-engine verdicts always available as floor.
- If grounded chat disappoints (context too thin): expand context windows with per-section analysis slices before loosening grounding.
- If .als linkage proves brittle across Live versions: degrade to stem-level attribution (still ahead of audio-only rivals).

## Web App (SaaS) Specific Requirements

### Project-Type Overview

Subscription B2C web app: public marketing/funnel surface + authenticated SPA product + public read-only share surface. Existing SPA (React 19, TanStack Router/Query, CSS Modules, code-split routes — build verified) is the product shell; funnel pages are new.

### Browser & Platform Matrix

- Evergreen desktop browsers, last 2 majors: Chrome/Edge, Firefox, Safari. Desktop-first (producers work on desktops next to their DAW).
- **Web Audio API is load-bearing** (Listen DSP page, report playback): Safari quirks (AudioContext unlock-on-gesture, decode differences) must be handled; Listen degrades gracefully where nodes unsupported.
- Responsive: report + share + funnel usable on mobile (producers open share links from Discord mobile); Listen DSP page may remain desktop-only with a polite notice.
- No native apps, no PWA-offline in MVP.

### Performance Targets

- Free-analyzer funnel: landing LCP <2.5 s; upload start <2 clicks from landing.
- Report route: interactive <2 s broadband after data fetch; charts render without jank (no Recharts animations — already the convention).
- Analysis wall-time: <3 min p90 (spectral path, no Demucs) — the funnel promise.
- SSE: progress events ≤1 s cadence; coach/verdict streaming starts <2 s after dispatch.
- Bundle: per-route code-split (exists); audio decode work off main thread where feasible.

### SEO Strategy

- SPA is auth-gated — SEO concentrates on: **landing/pricing/trust pages** (prerendered static — SSG or plain HTML served by BFF/CDN) and **share pages** (`/r/{token}`: server-rendered OG/Twitter cards + readable summary so Discord/Twitter unfurls sell the product; `noindex` per-report, index the template marketing copy only).
- Programmatic SEO later (genre guide pages off profile methodology); not MVP-gating.

### Accessibility Level

- WCAG 2.1 AA on funnel, auth, report, share (keyboard nav, contrast on the dark studio theme, chart data available as text/table equivalents — verdict text already carries the meaning).
- Listen DSP page: best-effort (niche interactive audio tooling), keyboard-operable controls where practical.

### Subscription & Tier Mechanics (web-app surface)

- Tier gates enforced server-side (BFF), reflected client-side: free = 3 analyses/mo + core report + 3 coach follow-ups/analysis; Pro = unlimited analyses (fair-use), full verdicts, stems + .als, version history depth, pooled coach cap; credits = à-la-carte full analyses.
- Upgrade/downgrade/cancel via Stripe Customer Portal; in-app usage page shows consumption + honest credits-vs-Pro math.
- Anonymous → registered upgrade path: free instant analysis runs without account (device-scoped token, aggressive rate limits); result persists once email-verified.

### Technical Architecture Considerations (brownfield constraints)

- BFF (.NET 10 minimal API + EF Core/Postgres) is the single client-facing API; Python worker reached via Dramatiq/Redis only. Keep this seam — billing/metering/entitlements live in BFF; analysis + LLM execution live in worker; entitlement checks must not require worker round-trips.
- SSE today = DB polling; acceptable at MVP scale, Redis pub/sub upgrade is post-MVP unless beta shows lag.
- LLM access moves from `claude` CLI subprocess (Semaphore(1), worker-local) to Anthropic SDK client with bounded concurrency, retries, token/cost capture per call; callable from worker actors (verdicts) and BFF (coach chat streaming) via one shared metering pathway (worker-owned LLM gateway or shared library — architecture doc decides; metering single-sourced either way).
- Frontend build quirk to fix: `tsc -b` ordering vs generated `routeTree.gen.ts` (fresh-checkout build fails until vite runs; 1-line script fix) — CI must build from clean checkout.

### Implementation Considerations

- Free analyzer is the highest-traffic surface: rate limiting, abuse caps, and queue fairness (free jobs never starve paid jobs — priority queues) designed in from the start.
- Email deliverability (SPF/DKIM/DMARC) before launch; transactional only, no marketing spam (brand).
- Feature flags for: coach chat caps, verdict specialist set, genre profiles — enables prompt/profile rollout without redeploys (prompt versioning already exists in pipeline).

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Revenue MVP on a working engine. The concept is already validated technically (37 real analyses ran end-to-end on v1; v2 engine built); the unvalidated assumptions are commercial: will the funnel convert, will verdicts feel worth $12.99, will the iteration loop retain. MVP therefore optimizes for: real Stripe revenue, real funnel telemetry, real verdict-quality signal — not for more analysis features.
**Resource Requirements:** Solo developer (Brian) + Claude-assisted workflow; budgeted external services (Stripe, Anthropic API, S3/R2, email, hosting). No hires assumed. Beta cohort 20–50 producers recruited from genre communities.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:** J1 (free→Pro happy path), J2 (failure/recovery), J3 (credits), J4 (share loop), J5 (affiliate, basic), J6 (operator, minimal).

**Must-Have Capabilities:** the Bucket A/B/C set defined in Product Scope above. Deal-breaker test applied: every Bucket C item is launch-gating (no billing = no revenue; no SDK replatform = no concurrency; no funnel = no users; no email = no auth recovery; no hardening = no trust). Bucket B items are differentiation-gating (the report must SHOW the moat: stem clash, .als panel, genre radar, coach chat). Manual-initially allowances: affiliate payouts (manual monthly), refunds (manual via Stripe dashboard), abuse review (manual after automated caps), ops dashboard (Grafana/Stripe/PostHog composite acceptable over custom UI).

### Post-MVP Features

**Phase 2 (Growth):** .flp support; DnB + progressive + melodic-techno profiles; A/B compare; PDF export; coach memory; pause-subscription; Redis pub/sub SSE; deeper Listen↔report integration; programmatic SEO genre guides.
**Phase 3 (Expansion):** public API tier (Tonn-style); schools/label seats + cohort views; distro-platform partnerships; album/EP consistency packs; community/benchmark features on accumulated data.

### Risk Mitigation Strategy

**Technical Risks:** Highest = LLM unit economics + grounding quality at concurrency. Mitigate: SDK replatform with metering FIRST (it gates coach chat, verdict scaling, and cost telemetry); golden-fixture regression on every prompt change; circuit-breaker degradation to rule-engine verdicts. Second = .als parser brittleness across Live versions → sandboxed phase, skip-not-fail, stem-level fallback.
**Market Risks:** Window compression by Slapback/TrackScore → ship beachhead fast, lead marketing with the combo they can't match (root-cause linkage); conversion below 2% → funnel telemetry from day one isolates the leak (landing→upload→report→signup→cap→pay); pricing rejection → credits absorb subscription-averse users without repricing.
**Resource Risks:** Solo-dev bandwidth → strict Bucket discipline (no Phase-2 work before first revenue); manual-ops allowances above; if timeline slips, cut order is: affiliate dashboard (links+spreadsheet suffice) → version-compare view (timeline already shows trend) → house/techno profiles ship as fast-follow (trance-only launch acceptable for closed beta, NOT for public launch).

## Functional Requirements

Status tags (brownfield): **[E]** exists on `restructure` (verify/keep) · **[P]** partial (backend exists, surface missing or vice versa) · **[N]** new.

### Analysis & Reports

- FR1 [E]: Users can upload an audio file (MP3/FLAC/WAV, ≤250 MB) for analysis, with live phase-by-phase progress.
- FR2 [E]: Users can optionally attach a reference track, individual stems, and an Ableton .als project file to an analysis.
- FR3 [E]: The system produces a multi-phase analysis covering loudness/true peak/clipping, frequency balance, stereo/mono compatibility, tempo/key, genre detection and scoring, stem clash detection, reference comparison, genre gap analysis, and arrangement structure.
- FR4 [P]: Users can view a single unified report presenting all analysis results, including stem clash table, arrangement advisor, genre radar/gap view, reference comparison, and .als project panel.
- FR5 [E]: Users can listen to the analyzed track from within the product, including on the report.
- FR6 [P]: When an individual analysis phase fails, the report still renders all successful phases, identifies what's missing, and offers a free retry of the analysis.
- FR7 [N]: Visitors can run one instant analysis without creating an account or entering payment details, and claim the result by registering.
- FR8 [E]: Users receive analysis results within minutes and can leave/return without losing progress (job persistence).

### Verdicts & Coaching

- FR9 [E]: The system generates ranked, severity-tagged verdicts from analysis results via deterministic rules plus AI specialists.
- FR10 [E]: Every AI verdict is validated against the user's measured values before display; unverifiable claims are rejected.
- FR11 [E]: Each verdict explains the issue in producer language, cites the user's actual measured values, and prescribes concrete parameterized fixes.
- FR12 [P]: When a .als project is attached, verdicts attribute issues to specific named project tracks/devices where determinable.
- FR13 [E]: Users can rate any verdict (helpful / wrong / unclear), and ratings feed quality telemetry.
- FR14 [P]: Users can ask the coach follow-up questions about their report; answers are grounded exclusively in that report's measured data and verdicts, and the coach declines rather than inventing when data is absent.
- FR15 [N]: Coach conversations are subject to per-tier message limits, visible to the user before they hit them.
- FR16 [N]: If AI verdict generation is unavailable (provider outage, budget exhaustion), users still receive rule-engine verdicts with a clear notice.

### Song Library & Versioning

- FR17 [E]: Users can organize analyses into songs with multiple versions, including labeling, notes, soft-delete/restore, and marking a current version.
- FR18 [E]: Users can view score progression across versions of a song over time.
- FR19 [P]: Users can compare two versions of a song side-by-side (scores, key metrics, verdict deltas).
- FR20 [E]: Users can re-analyze any stored version.

### Sharing & Public Access

- FR21 [P]: Users can generate a public share link for a report; recipients view a read-only report without authentication.
- FR22 [N]: Share pages expose only an owner-safe subset (never .als project internals, never raw stems) and render rich link previews (OG cards) in chat/social apps.
- FR23 [N]: Users can revoke a share link at any time.
- FR24 [N]: Share pages carry a call-to-action into the free analyzer, with conversion attribution.

### Accounts & Identity

- FR25 [E]: Users can register and authenticate with email/password; sessions persist via refresh tokens.
- FR26 [N]: Users must verify their email; users can reset forgotten passwords.
- FR27 [N]: Users can export their data and delete their account, cascading to all stored audio, projects, reports, and conversations.
- FR28 [N]: Anonymous free-analyzer sessions are rate-limited per device/IP and upgradeable to full accounts without losing the analysis.

### Monetization & Entitlements

- FR29 [N]: The product offers a Free tier (3 analyses/mo, core report, limited coach follow-ups), a Pro subscription ($12.99/mo or ~$99/yr), and consumable credit packs for full analyses à la carte.
- FR30 [N]: Users can subscribe, change billing period, cancel, and update payment methods self-service; cancellation is as easy as signup.
- FR31 [N]: The system meters per-user consumption (analyses, coach messages, LLM spend) and enforces tier entitlements server-side.
- FR32 [N]: Users can view their current usage, remaining allowances, and an honest cost comparison between their credit spend and Pro pricing.
- FR33 [N]: Failed payments trigger a dunning sequence with grace period; lapsed accounts degrade to Free without losing access to any previously delivered report (results-forever guarantee).
- FR34 [N]: Free-tier and anonymous jobs never starve paying users' jobs (queue prioritization).
- FR35 [N]: All billing state transitions are idempotent and reconcilable against Stripe as source of truth; double-charging is structurally prevented.

### Genre Intelligence

- FR36 [E]: The system scores tracks against statistical genre profiles with percentile placement (trance exists).
- FR37 [N]: House and techno statistical profiles are available at launch, with published methodology (track counts, features) per profile.
- FR38 [E]: Users can override/confirm detected genre with a genre hint.
- FR39 [P]: Users can browse genre profile reference data (what "good" looks like per genre).

### Growth & Funnel

- FR40 [N]: A public landing page communicates the product, shows a sample report, and routes to the free analyzer; a pricing page states all tiers and terms transparently.
- FR41 [N]: Trust commitments (no-AI-training pledge, results-forever, privacy defaults) are published as first-class pages and linked from signup and pricing.
- FR42 [N]: Partners can register for affiliate links; signups and conversions attribute to partners (30-day window) and are reportable for payout.
- FR43 [N]: The funnel (landing → upload → report → signup → cap → payment) is instrumented end-to-end, including share-link attribution, in a privacy-respecting way.

### Communications

- FR44 [N]: The system sends transactional email: verification, password reset, analysis-complete notification (opt-out), payment receipts/dunning.

### Operations & Administration

- FR45 [N]: The operator can monitor queue depth, job success rate, LLM spend per tier vs budget, verdict quality rates (helpful/wrong, validation rejections), and revenue metrics.
- FR46 [N]: The operator can issue refunds, inspect a user's billing/webhook trail, and see an audit log of privileged actions.
- FR47 [N]: Automated abuse controls (rate limits, per-account caps, disposable-email throttling) contain free-tier abuse; the operator can ban accounts.
- FR48 [E]: Specialist prompts are versioned; the operator can roll back a prompt version without redeploying.
- FR49 [N]: Alerts reach the operator (phone-grade) on pipeline failure spikes, LLM budget breach, billing webhook failures, and quality-rate regressions.

## Non-Functional Requirements

### Performance

- Analysis wall-time (spectral path, 5-min track): **<3 min p90, <5 min p99** upload-complete → report viewable.
- Landing LCP <2.5 s; report route interactive <2 s post-fetch; SSE progress cadence ≤1 s; coach/verdict streaming first-token <2 s.
- Upload: 250 MB over consumer connections without timeout; progress feedback throughout; chunked.
- Concurrency floor at launch: 10 simultaneous analyses, 5 simultaneous LLM verdict/coach streams, without queue starvation of paid users.

### Security

- All audio/projects/results private by default; object storage encrypted at rest; TLS 1.2+ everywhere; media served via signed expiring URLs only.
- Secrets (JWT, Stripe, Anthropic, DB) from environment/secret store — never in code or repo (current hardcoded JWT default is a launch blocker).
- AuthN/Z: every owned-resource query scoped to owner identity at the query level (IDOR-proof — existing pattern, keep); admin/operator actions require separate elevated auth + audit log.
- Rate limiting on auth endpoints (brute-force), upload endpoints (abuse), and anonymous analyzer (per-IP/device).
- Error responses never leak stack traces or internals in production.
- Payment data: Stripe-hosted surfaces only (SAQ-A scope); webhook signatures verified; replay-safe.
- .als ingestion hardened: decompression bombs bounded, parser failures isolated.
- LLM I/O: user content never used for model training (provider config + contractual pledge); prompt-injection resistance on coach (system prompts pinned; user text never executes tools).

### Reliability & Data Integrity

- Job pipeline: at-least-once execution with idempotent persistence; max 2 auto-retries; partial-phase failure never kills a job; stuck jobs detectable and re-queueable.
- Billing: webhook processing idempotent; entitlement state recoverable by replaying Stripe events; nightly reconciliation check.
- Durability: object storage + Postgres backups daily, restore-tested once before launch; delivered reports survive any subscription state forever.
- Availability target: 99.5% monthly for the web/product surface (solo-operated SaaS realism); analysis queue may degrade gracefully (queued, not failed) during worker restarts; status page (even static) for incidents.
- LLM provider outage: degrade to rule-engine verdicts + disabled coach with user-visible notice; no silent failures.

### Scalability

- Architecture must scale to 100 concurrent analyses by adding workers horizontally (Dramatiq already supports; no design change required) and to 10k MAU on a single Postgres instance.
- LLM concurrency bounded by config, not code (replaces Semaphore(1)); per-tier budget enforcement independent of scale.
- Storage growth bounded by retention policy: free-tier raw audio purged after 30 days (reports kept forever — reports are small JSON); paid raw audio kept while active + 90 days post-lapse, then purged with notice. Reports/verdicts: never purged.

### Accessibility

- WCAG 2.1 AA on funnel, auth, report, share, billing surfaces: keyboard navigation, visible focus, contrast-checked dark theme, chart information available as text equivalents (verdict text + data tables).
- Listen DSP page: best-effort keyboard operability; explicitly exempt from AA where real-time audio interaction makes it impractical.

### Integration

- Stripe: subscriptions, one-time credit purchases, Customer Portal, Tax, webhooks — sandbox-tested dunning + refund + proration flows before launch.
- Anthropic API: model pinned per prompt version; fallback model configurable; per-call token + cost capture mandatory; timeout + retry policy explicit.
- Email: transactional provider with delivery webhooks (bounce handling); SPF/DKIM/DMARC configured before launch.
- Storage: S3-compatible (S3 or R2); presigned upload/download; lifecycle rules implement the retention policy.
- Analytics: self-hostable/privacy-respecting product analytics with custom events for the KPI table; no third-party ad trackers (brand: trust).

### Maintainability & Operability (solo-operator constraints)

- CI from clean checkout: BFF build+tests, frontend type-check+lint+build (fix routeTree generation ordering), Python ruff+pytest, golden-fixture verdict regression — all green before deploy.
- Deploys reproducible from repo (containerized; compose or equivalent); one-command rollback; prompt versions rollback without redeploy (exists).
- Observability: structured logs with job/user correlation IDs; metrics for queue depth, success rate, LLM spend, quality rates; phone-grade alerting on the FR49 conditions.
- Runbook covering: stuck job, webhook backlog, LLM budget breach, restore-from-backup, abuse response.
