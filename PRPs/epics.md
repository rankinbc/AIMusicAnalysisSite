---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
validation: 'PASS — all 49 FRs covered, no forward dependencies, brownfield starter honored, just-in-time entity creation, all 46 UX-DRs mapped'
inputDocuments:
  - 'PRPs/prd.md'
  - 'PRPs/architecture.md'
  - 'PRPs/ux-design-specification.md'
  - 'PRPs/product-brief-spectr-2026-06-12.md'
workflowType: 'epics-and-stories'
project_name: 'Spectr'
user_name: 'Brian Rankin'
date: '2026-06-12'
---

# Spectr - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Spectr, decomposing the requirements from the PRD, UX Design Specification, and Architecture Decision Document into implementable stories.

**Brownfield context:** base is git branch `restructure` (slices 0–3 complete, build-verified 2026-06-12). FR status tags drive story sizing: **[E]** exists (verify/keep — no story unless verification work), **[P]** partial (story scoped to the missing half), **[N]** new (full story). v1 FastAPI/Celery components are frozen and out of scope.

## Requirements Inventory

### Functional Requirements

**Analysis & Reports**

- FR1 [E]: Users can upload an audio file (MP3/FLAC/WAV, ≤250 MB) for analysis, with live phase-by-phase progress.
- FR2 [E]: Users can optionally attach a reference track, individual stems, and an Ableton .als project file to an analysis.
- FR3 [E]: The system produces a multi-phase analysis covering loudness/true peak/clipping, frequency balance, stereo/mono compatibility, tempo/key, genre detection and scoring, stem clash detection, reference comparison, genre gap analysis, and arrangement structure.
- FR4 [P]: Users can view a single unified report presenting all analysis results, including stem clash table, arrangement advisor, genre radar/gap view, reference comparison, and .als project panel.
- FR5 [E]: Users can listen to the analyzed track from within the product, including on the report.
- FR6 [P]: When an individual analysis phase fails, the report still renders all successful phases, identifies what's missing, and offers a free retry of the analysis.
- FR7 [N]: Visitors can run one instant analysis without creating an account or entering payment details, and claim the result by registering.
- FR8 [E]: Users receive analysis results within minutes and can leave/return without losing progress (job persistence).

**Verdicts & Coaching**

- FR9 [E]: The system generates ranked, severity-tagged verdicts from analysis results via deterministic rules plus AI specialists.
- FR10 [E]: Every AI verdict is validated against the user's measured values before display; unverifiable claims are rejected.
- FR11 [E]: Each verdict explains the issue in producer language, cites the user's actual measured values, and prescribes concrete parameterized fixes.
- FR12 [P]: When a .als project is attached, verdicts attribute issues to specific named project tracks/devices where determinable.
- FR13 [E]: Users can rate any verdict (helpful / wrong / unclear), and ratings feed quality telemetry.
- FR14 [P]: Users can ask the coach follow-up questions about their report; answers are grounded exclusively in that report's measured data and verdicts, and the coach declines rather than inventing when data is absent.
- FR15 [N]: Coach conversations are subject to per-tier message limits, visible to the user before they hit them.
- FR16 [N]: If AI verdict generation is unavailable (provider outage, budget exhaustion), users still receive rule-engine verdicts with a clear notice.

**Song Library & Versioning**

- FR17 [E]: Users can organize analyses into songs with multiple versions, including labeling, notes, soft-delete/restore, and marking a current version.
- FR18 [E]: Users can view score progression across versions of a song over time.
- FR19 [P]: Users can compare two versions of a song side-by-side (scores, key metrics, verdict deltas).
- FR20 [E]: Users can re-analyze any stored version.

**Sharing & Public Access**

- FR21 [P]: Users can generate a public share link for a report; recipients view a read-only report without authentication.
- FR22 [N]: Share pages expose only an owner-safe subset (never .als project internals, never raw stems) and render rich link previews (OG cards) in chat/social apps.
- FR23 [N]: Users can revoke a share link at any time.
- FR24 [N]: Share pages carry a call-to-action into the free analyzer, with conversion attribution.

**Accounts & Identity**

- FR25 [E]: Users can register and authenticate with email/password; sessions persist via refresh tokens.
- FR26 [N]: Users must verify their email; users can reset forgotten passwords.
- FR27 [N]: Users can export their data and delete their account, cascading to all stored audio, projects, reports, and conversations.
- FR28 [N]: Anonymous free-analyzer sessions are rate-limited per device/IP and upgradeable to full accounts without losing the analysis.

**Monetization & Entitlements**

- FR29 [N]: The product offers a Free tier (3 analyses/mo, core report, limited coach follow-ups), a Pro subscription ($12.99/mo or ~$99/yr), and consumable credit packs for full analyses à la carte.
- FR30 [N]: Users can subscribe, change billing period, cancel, and update payment methods self-service; cancellation is as easy as signup.
- FR31 [N]: The system meters per-user consumption (analyses, coach messages, LLM spend) and enforces tier entitlements server-side.
- FR32 [N]: Users can view their current usage, remaining allowances, and an honest cost comparison between their credit spend and Pro pricing.
- FR33 [N]: Failed payments trigger a dunning sequence with grace period; lapsed accounts degrade to Free without losing access to any previously delivered report (results-forever guarantee).
- FR34 [N]: Free-tier and anonymous jobs never starve paying users' jobs (queue prioritization).
- FR35 [N]: All billing state transitions are idempotent and reconcilable against Stripe as source of truth; double-charging is structurally prevented.

**Genre Intelligence**

- FR36 [E]: The system scores tracks against statistical genre profiles with percentile placement (trance exists).
- FR37 [N]: House and techno statistical profiles are available at launch, with published methodology (track counts, features) per profile.
- FR38 [E]: Users can override/confirm detected genre with a genre hint.
- FR39 [P]: Users can browse genre profile reference data (what "good" looks like per genre).

**Growth & Funnel**

- FR40 [N]: A public landing page communicates the product, shows a sample report, and routes to the free analyzer; a pricing page states all tiers and terms transparently.
- FR41 [N]: Trust commitments (no-AI-training pledge, results-forever, privacy defaults) are published as first-class pages and linked from signup and pricing.
- FR42 [N]: Partners can register for affiliate links; signups and conversions attribute to partners (30-day window) and are reportable for payout.
- FR43 [N]: The funnel (landing → upload → report → signup → cap → payment) is instrumented end-to-end, including share-link attribution, in a privacy-respecting way.

**Communications**

- FR44 [N]: The system sends transactional email: verification, password reset, analysis-complete notification (opt-out), payment receipts/dunning.

**Operations & Administration**

- FR45 [N]: The operator can monitor queue depth, job success rate, LLM spend per tier vs budget, verdict quality rates (helpful/wrong, validation rejections), and revenue metrics.
- FR46 [N]: The operator can issue refunds, inspect a user's billing/webhook trail, and see an audit log of privileged actions.
- FR47 [N]: Automated abuse controls (rate limits, per-account caps, disposable-email throttling) contain free-tier abuse; the operator can ban accounts.
- FR48 [E]: Specialist prompts are versioned; the operator can roll back a prompt version without redeploying.
- FR49 [N]: Alerts reach the operator (phone-grade) on pipeline failure spikes, LLM budget breach, billing webhook failures, and quality-rate regressions.

### NonFunctional Requirements

**Performance**

- NFR1: Analysis wall-time (spectral path, 5-min track): <3 min p90, <5 min p99, upload-complete → report viewable.
- NFR2: Landing LCP <2.5 s; report route interactive <2 s post-fetch; SSE progress cadence ≤1 s; coach/verdict streaming first-token <2 s.
- NFR3: 250 MB uploads over consumer connections without timeout; chunked with progress feedback throughout.
- NFR4: Concurrency floor at launch: 10 simultaneous analyses, 5 simultaneous LLM verdict/coach streams, without queue starvation of paid users.

**Security**

- NFR5: All audio/projects/results private by default; object storage encrypted at rest; TLS 1.2+ everywhere; media served via signed expiring URLs only.
- NFR6: Secrets (JWT, Stripe, Anthropic, DB) from environment/secret store — never in code or repo (current hardcoded JWT default is a launch blocker).
- NFR7: Every owned-resource query scoped to owner identity at the query level (IDOR-proof); admin/operator actions require separate elevated auth + audit log.
- NFR8: Rate limiting on auth endpoints (brute-force), upload endpoints (abuse), and anonymous analyzer (per-IP/device).
- NFR9: Error responses never leak stack traces or internals in production.
- NFR10: Payment data via Stripe-hosted surfaces only (SAQ-A scope); webhook signatures verified; replay-safe.
- NFR11: .als ingestion hardened: decompression bombs bounded, parser failures isolated from worker.
- NFR12: LLM I/O: user content never used for model training (provider config + published pledge); prompt-injection resistance on coach (system prompts pinned; user text never executes tools).

**Reliability & Data Integrity**

- NFR13: Job pipeline at-least-once execution with idempotent persistence; max 2 auto-retries; partial-phase failure never kills a job; stuck jobs detectable and re-queueable.
- NFR14: Billing webhook processing idempotent; entitlement state recoverable by replaying Stripe events; nightly reconciliation check.
- NFR15: Object storage + Postgres backups daily, restore-tested before launch; delivered reports survive any subscription state forever.
- NFR16: Availability 99.5% monthly for web/product surface; analysis queue degrades gracefully (queued, not failed) during worker restarts; status page for incidents.
- NFR17: LLM provider outage degrades to rule-engine verdicts + disabled coach with user-visible notice; no silent failures.

**Scalability**

- NFR18: Scales to 100 concurrent analyses by adding workers horizontally; 10k MAU on a single Postgres instance.
- NFR19: LLM concurrency bounded by config, not code; per-tier budget enforcement independent of scale.
- NFR20: Storage growth bounded by retention policy: free-tier raw audio purged after 30 days; paid raw audio kept while active + 90 days post-lapse; reports/verdicts never purged.

**Accessibility**

- NFR21: WCAG 2.1 AA on funnel, auth, report, share, billing surfaces: keyboard navigation, visible focus, contrast-checked dark theme, chart information available as text equivalents.
- NFR22: Listen DSP page best-effort keyboard operability; explicitly exempt from AA where real-time audio interaction makes it impractical.

**Integration**

- NFR23: Stripe: subscriptions, one-time credit purchases, Customer Portal, Tax, webhooks — sandbox-tested dunning + refund + proration flows before launch.
- NFR24: Anthropic API: model pinned per prompt version; fallback model configurable; per-call token + cost capture mandatory; timeout + retry policy explicit.
- NFR25: Email: transactional provider with delivery webhooks (bounce handling); SPF/DKIM/DMARC configured before launch.
- NFR26: Storage: S3-compatible (R2); presigned upload/download; lifecycle rules implement the retention policy.
- NFR27: Privacy-respecting product analytics with custom events for the PRD KPI table; no third-party ad trackers.

**Maintainability & Operability**

- NFR28: CI from clean checkout: BFF build+tests, frontend type-check+lint+build (vite-before-tsc routeTree fix), Python ruff+pytest, golden-fixture verdict regression — all green before deploy; v1 components excluded.
- NFR29: Deploys reproducible from repo (containerized); one-command rollback; prompt versions rollback without redeploy.
- NFR30: Structured logs with job/user correlation IDs; metrics for queue depth, success rate, LLM spend, quality rates; phone-grade alerting on FR49 conditions.
- NFR31: Runbook covering: stuck job, webhook backlog, LLM budget breach, restore-from-backup, abuse response.

### Additional Requirements

**From Architecture — brownfield starter & relocations**

- AR1: Starter is the `restructure` branch itself — no greenfield initialization story. Epic 1 begins with enabling work on the existing codebase, not project setup.
- AR2: Verdict pipeline modules relocate from `components/api/app/verdict_pipeline` into worker ownership (file move + import fixes) — the single planned cross-boundary move, scheduled early, before features build on it.
- AR3: Frozen-v1 boundary: `components/api`, `components/frontend`, `components/frontend-spectr` excluded from CI, deploys, and imports by new code.
- AR4: `components/analysis` stays a pure library — no network, no DB; worker orchestrates.

**From Architecture — D1 LLM gateway**

- AR5: All Anthropic calls live in `components/worker/app/llm/gateway.py` (sole `anthropic` importer, CI-linted). Replace `claude` CLI subprocess with official `anthropic` SDK.
- AR6: `asyncio.Semaphore(LLM_MAX_CONCURRENCY)` (config, default 5) with per-purpose sub-limits (verdicts vs coach).
- AR7: Metering single-sourced: one `llm_calls` row per call (ULID, user_id, tier, purpose, prompt_slug, prompt_version, model, tokens in/out, cost_usd from versioned price table, latency_ms, outcome, correlation_id).
- AR8: Budgets enforced in gateway: per-tier monthly ceilings + global circuit breaker → `LlmBudgetExceeded` → callers degrade per FR16.
- AR9: Coach flow: BFF POST → entitlement check + persist message → enqueue `coach_reply` actor (coach queue) → actor builds grounded context, streams tokens to Redis pub/sub `coach:{conversationId}:{messageId}`, persists final + llm_call → BFF SSE relays. Stop = client closes SSE → cancel flag key checked per chunk. Fallback: poll persisted partial message rows on Redis idle >30 s.
- AR10: Grounding contract: `grounded_complete(prompt_slug, context_bundle, …)`; coach prompts versioned under `llm/prompts/coach/`; refusal template when context lacks data; coach evidence citations resolved against context bundle (unresolvable citations dropped).

**From Architecture — D2 billing & entitlements**

- AR11: Stripe Checkout (hosted) + Customer Portal + Tax + webhooks. Four EF tables: `subscriptions` (webhook-writes only), `credit_ledger` (append-only signed entries, compensating reversals, never UPDATE), `usage_events` (append-only, billing_period keyed), `webhook_events` (Stripe event id PK = strict idempotency).
- AR12: `Entitlements.For(user)` pure function over (subscription, credits, period usage) → cached 60 s, invalidated on webhook/spend; enforced via BFF endpoint filters (`RequireEntitlement`).
- AR13: Worker trusts the job row's stamped tier — BFF stamps at dispatch; worker never reads billing tables; mid-run downgrade cannot kill running work.
- AR14: Integer cents everywhere; Stripe = source of truth for subscription state; local ledger = source of truth for credits; nightly reconciliation job alerts on drift.
- AR15: Results-forever structural: read access to existing reports never entitlement-checked; gates apply to ANALYZE and depth-of-new-reports only.
- AR16: Usage event written at job dispatch; refunded (compensating ledger entry) on validation-fail — never UPDATE balances.

**From Architecture — D3 storage**

- AR17: Cloudflare R2 (S3-compatible); MinIO container for dev + CI.
- AR18: Presigned multipart direct upload: `POST /uploads/init` (entitlement check, returns part URLs, ≥16 MB parts) → browser uploads to R2 → `POST /uploads/complete` → enqueue. BFF never proxies file bodies.
- AR19: Magic-byte + duration validation moves to worker pre-pipeline step; invalid file fails fast with typed error, no entitlement consumed.
- AR20: Key layout: `audio/{userOrDevice}/{jobId}/source.*`, `stems/{jobId}/…`, `als/{jobId}/…`, `reports/{jobId}.json`; reports also in Postgres JSONB (existing).
- AR21: Short-lived presigned GETs for playback/download; share-page audio scoped to share token validity; worker has own R2 credentials.
- AR22: Retention sweep job (`maintenance` queue): anonymous unclaimed 72 h purge; free raw audio 30 d; lapsed-paid 90 d with notice email; reports/verdicts/chats never swept. R2 lifecycle rules as backstop.

**From Architecture — D4 queues**

- AR23: Dramatiq queues: `analysis-paid`, `analysis-free`, `coach`, `maintenance`. Prod: W1 consumes coach + analysis-paid; W2 consumes analysis-free + maintenance. Starvation-proofing structural by process separation. Existing actors unchanged except queue assignment + tier stamp.

**From Architecture — D5 identity/claim**

- AR24: `devices` table (ULID, ip_hash, ua_hash) + signed httpOnly cookie `spectr_device`. Jobs/reports own `device_id` XOR `user_id` (CHECK exactly-one).
- AR25: Claim = transactional re-parent of device's rows (jobs, reports, conversations) to new user on registration; device marked claimed; no R2 key rename needed (keys job-scoped).
- AR26: Rate limits per-device AND per-IP (Redis token bucket) on `/uploads/init` + auth endpoints; anonymous = 1 active analysis, 72 h retention; email verification gates the SECOND analysis, not report viewing.

**From Architecture — D6–D10 integrations & ops**

- AR27: Resend via BFF `IEmailSender` + template registry (verify, reset, analysis-complete opt-out, dunning, retention warning); sends enqueued through `send_email` actor for retry semantics; bounce/complaint webhooks → suppression list table.
- AR28: Share: BFF serves `/r/{token}` prerendered HTML shell (OG/Twitter meta, static branded OG image, inline JSON of share projection) → SPA hydrates. `ShareReportProjection` = server-side allowlist DTO, default-deny. Tokens random 128-bit, one per report with regenerate; revoke = soft-delete. `noindex` per report.
- AR29: Deploy: single VPS Docker Compose (`caddy`, `bff`, `worker-paid`, `worker-free`, `postgres:16`, `redis:7`); funnel pages static via Caddy; EF migrations applied at BFF boot under advisory lock; Alembic frozen.
- AR30: CI (GitHub Actions): BFF `dotnet build && test`; frontend `npm ci && npx vite build && npx tsc -b && lint && vitest` (vite before tsc; also fix package.json build script ordering); Python `ruff + pytest` incl. golden fixtures; on main: build+push GHCR images → SSH deploy → `/healthz` smoke.
- AR31: Backups: nightly `pg_dump` → R2 `backups/` (30 d) + weekly restore-test script; secrets in host `.env` (chmod 600); no secrets in repo/images.
- AR32: Observability: Sentry (3 runtimes, correlation_id tag); Prometheus (prometheus-net BFF, dramatiq middleware + custom counters worker); Grafana dashboards (pipeline health, queue depth, LLM spend vs budget, verdict quality, MRR proxy); Grafana → ntfy.sh phone alerts for FR49; PostHog Cloud EU custom events; healthchecks.io + `/healthz`.
- AR33: .als parsed in subprocess with rss/time limits inside worker; failure = phase skipped.
- AR34: Genre profiles: offline `components/analysis/tools/profile_builder.py` → versioned JSON in `data/reference_library/profiles/` + auto-emitted methodology doc per profile.
- AR35: `feature_flags` table read by BFF + worker (cached 60 s): coach caps, specialist set, genre profile enablement.
- AR36: Affiliates: `?ref=CODE` → 30 d cookie → stamped on registration → `affiliates` + `referrals` tables; payouts manual via BFF CSV export endpoint.
- AR37: Funnel instrumentation: PostHog events (land, upload_start, report_view, signup, cap_hit, checkout_start, paid) with device→user identity stitching on claim.

**From Architecture — patterns & enforcement**

- AR38: API error envelope `{ "error": { "code", "message", "details" } }` with stable machine codes for gate types (frontend keys off codes); production never includes stack traces.
- AR39: CI lints: `anthropic` import only in gateway.py; no raw hex colors in CSS modules (tokens only); no price literals outside config; ESLint ban on fetch to non-BFF origins; `dotnet format` + `ruff format`.
- AR40: Config knobs documented in `.env.example` (LLM_MAX_CONCURRENCY, LLM_MONTHLY_BUDGET_USD, FREE_ANALYSES_PER_MONTH, COACH_FREE_FOLLOWUPS, COACH_PRO_MONTHLY, RETENTION_*, …).
- AR41: Fake gateway mode (`LLM_FAKE=1`) replays golden fixtures for UI work without spend; Stripe CLI webhook forwarding documented for billing dev.
- AR42: Integration smokes in CI against compose: upload→report (stubbed pipeline), checkout webhook replay, coach stream echo with fake gateway.
- AR43: New BFF code in feature folders `Spectr.Bff/Features/{Billing|Entitlements|Coach|Share|Devices|Affiliates|Admin}`; new entities in `Spectr.Data` (Subscription, CreditLedgerEntry, UsageEvent, WebhookEvent, Device, ShareToken, Affiliate, Referral, FeatureFlag, LlmCall read-only, EmailSuppression).
- AR44: SSE formats retained; coach stream events `{type: token|done|error|refusal}`; heartbeat comment every 15 s.

### UX Design Requirements

**Phase A — design-system foundation**

- UX-DR1: Self-host Syne + JetBrains Mono in `public/fonts/` (GDPR-clean, no Google CDN) with @font-face wiring; Syne ss01/ss02 stylistic sets; JetBrains Mono `tnum` for all numerals (fidelity audit blocker #1).
- UX-DR2: Port the 8 global utility classes from mockups (`.card/.card-hd/.card-body`, `.label`, `.pill` + cyan/violet/orange/red/green/yellow variants, `.dot`, `.btn/.btn.primary/.btn.ghost/.btn.sm`) and keyframes (`fadeUp fadeIn fillW fillH pulse pulseGlow`).
- UX-DR3: Token additions: `--space-4-5: 18px`; severity aliases (`warning↔severe`, `info↔minor`, `fixed↔win`); commerce tokens `--tier-free/--tier-pro/--tier-credits`, `--paywall-overlay`.
- UX-DR4: Build `GradePill` (sm/lg, sr-only grade text), `Pill`, `BrandMark` components.
- UX-DR5: Ambient signature (dual radial gradients cyan-top/violet-bottom-right + 48 px grid overlay) applied on ALL surfaces including funnel pages.

**Phase B — app shell & library**

- UX-DR6: TopNav (56 px, blur 14): brand → segmented tabs Report/Listen/Library → search ⌘K → bell → `+ Upload` primary → avatar menu (Profile, Usage, Billing, Partners, Sign out). Public slim chrome variant (brand + Pricing + Sign in + Analyze free) on funnel/share.
- UX-DR7: Library surfaces to mockup fidelity: LibraryCard grid (`minmax(300px,1fr)`) + LibraryRow list + CoverArt (hue-gradient + waveform overlay) + VersionArc sparkline + designed empty states with single CTA.
- UX-DR8: MiniPlayer persistent bottom bar on product routes only (hidden on funnel/share/auth and <768 px); toasts offset above it.
- UX-DR9: Content max-width 1360 px app / 1120 px funnel / 880 px share.

**Phase C — results restructure & coach**

- UX-DR10: VerdictHero (340/1fr layout, grade GradePill-lg ~80 px, verdict text, 4 HeroMetrics) + delta badge ("+6 vs v3") on improved versions with one-time cyan pulse.
- UX-DR11: ResultsTabs — 5 badged tabs, AI Coach default with pulsing cyan dot, tab state in URL (`?tab=coach`) for deep links.
- UX-DR12: FeaturedVerdictCard: 88 px ghost numeral, PersonaChip, ImpactTag, ConfidenceMeter, InlineChart slot (placeholder first), FixRecipe block, `Ask the coach about this` ghost action prefilling chat.
- UX-DR13: CoachChat: TranceBot avatar (72 px, EQ visor idle-pulse, faster while streaming, reduced-motion static), overline `ASK THE COACH · online · trained on your analysis`, 6 suggestion chips derived from this report's verdict categories, input + `Ask →`, token streaming with stop button.
- UX-DR14: Grounding visible: dim mono scope line "Answers grounded in analysis #{shortid} · {n} measurements · {m} verdicts" under input.
- UX-DR15: EvidenceChip global component (verdicts, coach answers, share): tappable measured-value citation, scrolls/highlights source panel, descriptive aria-label.
- UX-DR16: CoachCapChip (header chip, amber at 1 remaining) + CoachGateInline (input replaced at 0 with upgrade copy + "or buy credits"; history stays readable). Caps grammar everywhere: `{used} of {limit} {unit} · resets {date}`.
- UX-DR17: Coach refusal microcopy set pre-written for every gap (stems missing, reference failed, budget exhausted, provider outage) rendered as competence + unlock action; outage state: "Coach is offline — your measured analysis and rule-based findings are unaffected."
- UX-DR18: CoachFilters (category pills + show-fixed toggle) + SpecialistTile roster (collapsible, `minmax(220px,1fr)`).
- UX-DR19: AnalysisSummary tab: PipelineDial + PhaseList + UnlockBlock + sticky side rail (`minmax(0,1fr) 360–380px`).

**Phase D — remaining tabs & song detail**

- UX-DR20: Frequency tab: BigSpectrumBars (CSS columns) + genre-median overlay; stem clash: StemClashList table.
- UX-DR21: Reference tab: GapRow + ScoreRing; Arrangement tab: ArrangementBar + issue list.
- UX-DR22: Song detail: 36 px hero, ProgressTimeline (grade-banded), version table, `+ New version` pre-associated re-upload.
- UX-DR23: Version compare: DeltaCard sticky compare rail (scores, key metrics, verdict deltas).

**Phase E — funnel & commerce surfaces (new)**

- UX-DR24: Landing page: LandingHero with LIVE sample report embed (real VerdictHero rendering demo data, not a screenshot), atmosphere tokens, LCP <2.5 s, primary CTA `Analyze my track free`.
- UX-DR25: PricingTable: two tiers + credits, tax-inclusive note, no asterisks, terms restated at buttons.
- UX-DR26: TrustPledgePage blocks: no-AI-training pledge, results-forever, privacy defaults — linked from signup and pricing.
- UX-DR27: Anonymous analyze flow: full-bleed drop zone (mono hints "WAV · FLAC · MP3 · ≤250 MB", zero form fields) → chunked upload % → pipeline screen (animated phase dots, phase names + ETA, rotating educational one-liners) → anonymous report state (VerdictHero + #1 verdict + streaming readiness visible; deeper tabs blur-locked with claim copy) → inline email+password card (no redirect, report visible behind) → verify banner (verify gates next analysis, not this report). Refresh-safe at every stage.
- UX-DR28: ResumeCard pattern: any interrupted flow (unclaimed report 72 h, half upload, unfinished checkout) surfaces as dismissible resume card on next visit.
- UX-DR29: BlurLock wrapper — ONE component for all gating surfaces (anonymous depth, free-tier stems tab, lapsed-Pro features): blurred real content + one-line unlock copy + single CTA + announced lock reason.
- UX-DR30: UpgradeSheet cap-hit modal (only BETWEEN analyses, never mid-pipeline): header "3 of 3 free analyses used this month" · value recap strip with user's own grade chips · PRO card ($12.99/mo / $99/yr toggle with savings) vs CREDITS card ("no subscription, never expire") · trust line "Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio" · ghost "wait for next month" exit. After Stripe return: upload resumes automatically with the originally chosen file.
- UX-DR31: UsageMeter (nav passive + usage page variants), PlanCard, TierChip components.
- UX-DR32: Usage page: credits balance, CreditLedger mono table, HonestMathBanner ("You've spent $X on credits in 90 days — Pro would've been $Y", dismissible, never modal), buy-credits pack selector (5/10).
- UX-DR33: Billing page: current plan card (next charge, amount, period toggle), Stripe portal link, invoices list, cancel ≤2 clicks (one confirm dialog, single optional reason), canceled state with results-forever copy + resubscribe. DunningBanner amber "Payment failed — retrying Thursday · update card"; post-grace quiet downgrade via BlurLock pattern; existing reports fully readable.
- UX-DR34: ClubCheckCard (mono-compat % / true peak / low-end mono fold) pinned on Streaming/Stereo panels when genre ∈ DJ-genres.
- UX-DR35: ShareReportPage: single column 880 px — brand mark → read-only VerdictHero → top 3 verdicts with evidence chips (no chat) → frequency chart vs genre → ShareCTA "Analyze your own track free →" (sticky on mobile). No owner controls, no .als panel, no stems. 5-second comprehension on a phone; OG unfurl: grade pill + track name + "Spectr mix report."
- UX-DR36: PartnerDashboard one page: link card with copy button, mono stats row (clicks/signups/conversions/owed), monthly payout table; `/partners` public explainer with FTC disclosure terms.
- UX-DR37: Email kit: EmailShell (system fonts, dark header band, mono accents) + verification/reset/analysis-complete/dunning templates.

**Cross-cutting UX patterns**

- UX-DR38: Gate-between-never-during: all monetization gates sit between completed actions; in-flight work always completes and persists.
- UX-DR39: Button hierarchy: ONE `.btn.primary` per view; ghost secondary; violet reserved publish-semantics; destructive = red text ghost + confirm; never primary-red.
- UX-DR40: Feedback: sonner toasts (bottom-right, 5 s, never in-flow validation); inline field errors on blur; banners with remembered dismiss state; skeletons in reading order (hero → tabs → verdicts); determinate mono upload bars; phase dots + per-phase %.
- UX-DR41: Forms: mono overline labels, dim mono hints, custom drop-zones ALWAYS (native file input flagged broken), cyan focus ring `0 0 0 3px var(--cyan-dim)`, auth card 380 px, money forms Stripe-hosted only.
- UX-DR42: Display rules: numbers JetBrains Mono + tnum with dim unit suffix; deltas signed + semantically colored (▲ cyan good, ▼ orange bad); relative time <7 d then absolute mono; severity/grade single token source; AI provenance chips (persona chip vs `RULE` mono chip) always visible.
- UX-DR43: Keyboard: ⌘K search, ⌘U upload, `?` shortcut sheet on product routes.
- UX-DR44: Accessibility build rules: WCAG 2.1 AA on funnel/auth/report/share/billing; `aria-live="polite"` throttled announcements (phase completions, coach streaming); charts `role="img"` + adjacent text equivalent; no `outline: none` without replacement (lint); `prefers-reduced-motion` freezes all signature animations; ≥40 px touch targets on share/funnel; axe-core CI smoke on the 5 AA routes; 360 px-width pass on share + funnel.
- UX-DR45: Responsive: breakpoints sm 640 / md 768 / lg 1024 / xl 1360; report rails stack <1024 (rail folds to accordions); Listen desktop-only with notice card <1024; dialogs full-sheet <768.
- UX-DR46: `/dev/kitchen-sink` route behind feature flag as component inventory + visual regression + a11y audit surface (no Storybook).

### FR Coverage Map

- FR1: Epic 3 — upload path replatformed to presigned R2 multipart (existing chunked UX preserved)
- FR2: Epic 3 — stems/reference/.als attachments through presigned path; Epic 5 — upload dialog UX polish
- FR3: Epic 1 — pipeline verified intact post-relocation (golden fixtures)
- FR4: Epic 5 — unified report parity panels (stem clash, arrangement, genre radar, reference, .als)
- FR5: Epic 5 — report playback verify; Epic 3 — signed media URLs
- FR6: Epic 5 — partial-failure report UI + free retry
- FR7: Epic 6 — anonymous instant analysis + claim
- FR8: Epic 3 — job persistence verified through storage change
- FR9: Epic 1 — verdict generation verified post-relocation
- FR10: Epic 1 — validator verified post-relocation
- FR11: Epic 1 — verdict content quality verified (golden fixtures)
- FR12: Epic 5 — .als panel + track-name chip surfacing (backend exists)
- FR13: Epic 1 — verdict feedback wired into telemetry spine
- FR14: Epic 1 — grounded coach Q&A with refusals
- FR15: Epic 1 — per-analysis follow-up caps; Epic 2 — tier-aware pooled caps
- FR16: Epic 1 — budget/outage degradation to rule-engine verdicts
- FR17: Epic 5 — library/versioning verified + fidelity
- FR18: Epic 5 — score progression verified + ProgressTimeline fidelity
- FR19: Epic 5 — version compare view (DeltaCard)
- FR20: Epic 5 — re-analyze stored version verified
- FR21: Epic 7 — share link generation + read-only view
- FR22: Epic 7 — share projection allowlist + OG cards
- FR23: Epic 7 — share revocation
- FR24: Epic 7 — share CTA + conversion attribution
- FR25: Epic 4 — auth verified (secrets hardening included)
- FR26: Epic 4 — email verification + password reset
- FR27: Epic 4 — GDPR export + cascade delete
- FR28: Epic 4 — device identity, rate limits, claim re-parent (backend); Epic 6 — funnel UX
- FR29: Epic 2 — Free/Pro/credits tiers live
- FR30: Epic 2 — self-service subscribe/change/cancel
- FR31: Epic 2 — metering + server-side entitlement enforcement
- FR32: Epic 2 — usage page + honest math
- FR33: Epic 2 — dunning states, grace, degradation, banner; Epic 4 — dunning email sends
- FR34: Epic 2 — queue split + tier stamping (paid never starved)
- FR35: Epic 2 — idempotent webhooks + reconciliation
- FR36: Epic 8 — trance profile scoring verified
- FR37: Epic 8 — house + techno profiles + methodology
- FR38: Epic 8 — genre hint verified
- FR39: Epic 8 — genre reference browse surface
- FR40: Epic 6 — landing + pricing pages
- FR41: Epic 6 — trust pages
- FR42: Epic 9 — affiliate links, attribution, dashboard, payout export
- FR43: Epic 6 — end-to-end funnel instrumentation
- FR44: Epic 4 — transactional email (all templates)
- FR45: Epic 10 — operator monitoring dashboards
- FR46: Epic 10 — refunds, billing trail, audit log
- FR47: Epic 10 — abuse controls + bans (rate-limit foundation from Epic 4)
- FR48: Epic 1 — prompt versioning + rollback verified post-relocation
- FR49: Epic 10 — phone-grade alerting

## Epic List

### Epic 1: Interrogable Coach & Scalable Verdicts (LLM Replatform)

Producers can ask the coach grounded follow-up questions about their report and get answers citing their own measured data — with honest refusals when data is absent — while the verdict engine moves off the `claude` CLI `Semaphore(1)` onto the Anthropic SDK with metering, budgets, and outage degradation. Includes the verdict-pipeline relocation (api → worker), the design-system foundation (fonts/utilities/primitives) that all subsequent UI consumes, and CI from clean checkout to protect the relocation.
**FRs covered:** FR3, FR9, FR10, FR11, FR13, FR14, FR15 (per-analysis caps), FR16, FR48

### Epic 2: Plans, Credits & Honest Billing

Users can subscribe to Pro, buy credit packs, manage billing self-service, and see transparent usage — with entitlements enforced server-side, paid jobs never starved by free jobs, results-forever structurally guaranteed, and billing state provably idempotent against Stripe.
**FRs covered:** FR15 (tier-pooled caps), FR29, FR30, FR31, FR32, FR33 (states/grace/banner), FR34, FR35

### Epic 3: Reliable Uploads & Results That Last (Cloud Storage)

Users upload 250 MB files reliably via presigned direct-to-R2 multipart, stream playback through signed URLs, and trust that reports survive forever while raw audio follows the published retention policy. Production data layer: R2 + MinIO dev parity + retention sweep.
**FRs covered:** FR1, FR2 (storage path), FR5 (signed media), FR8

### Epic 4: Account Lifecycle, Identity & Email

Users verify email, reset passwords, export their data, and delete their account with full cascade; anonymous visitors get device identities that claim cleanly into accounts; all transactional email (verification, reset, completion, dunning, retention warnings) flows through Resend with bounce handling. Includes secrets hardening (env-only JWT).
**FRs covered:** FR25, FR26, FR27, FR28 (backend), FR33 (dunning emails), FR44

### Epic 5: The Full-Fidelity Report

The report becomes the $12.99-worthy product: verdict hero, five badged tabs, parity panels (stem clash, arrangement, genre radar, reference, .als with track-name chips), partial-failure handling with free retry, version compare, song-detail fidelity, and club-readiness surfacing — executing fidelity-audit Phases B–D.
**FRs covered:** FR2 (upload dialog UX), FR4, FR5, FR6, FR12, FR17, FR18, FR19, FR20

### Epic 6: Free Analyzer Funnel & Public Site

Visitors land, understand the product, run one instant analysis with zero fields, see a real report, and claim it by registering — with landing/pricing/trust pages live and the entire funnel instrumented edge-to-edge.
**FRs covered:** FR7, FR28 (funnel UX), FR40, FR41, FR43

### Epic 7: Share Pages & the Viral Loop

Report owners share a public link that unfurls beautifully in Discord, shows a curated read-only report in 5 seconds on a phone, can be revoked anytime, and converts strangers into the free analyzer with attribution.
**FRs covered:** FR21, FR22, FR23, FR24

### Epic 8: Genre Intelligence — House & Techno

House and techno producers get statistically backed genre scoring with published methodology, and all users can browse what "good" looks like per genre.
**FRs covered:** FR36, FR37, FR38, FR39

### Epic 9: Affiliate Partner Program

Educators register for coded links, see clicks/signups/conversions on a one-page dashboard, and get monthly payout reporting — with FTC-compliant terms.
**FRs covered:** FR42

### Epic 10: Operator Console & Launch Hardening

The operator runs the business from dashboards (queue, success rate, LLM spend vs budget, quality rates, revenue), gets phone-grade alerts, issues refunds with audit trails, contains abuse, and deploys/restores the whole system reproducibly — production topology, backups, observability, and runbook complete.
**FRs covered:** FR45, FR46, FR47, FR49

### Epic Dependency Notes

- Epic 1 runs on current local storage — no dependency on Epic 3.
- Epic 2 builds on Epic 1's `llm_calls` metering; coach caps become tier-aware here.
- Epic 4's retention-warning + dunning emails complete loops opened in Epics 3 and 2 (noted in coverage map).
- Epic 5 (report fidelity) consumes Epic 1's Phase-A design foundation; re-homes the Epic-1 coach UI into the restructured tab layout.
- Epic 6 (funnel) depends on Epic 3 (upload path), Epic 4 (devices/claim/verification), and Epic 5 (VerdictHero component for the landing-page live sample embed).
- Epic 7 reuses Epic 5's report components (read-only VerdictHero) and Epic 6's funnel CTA target + instrumentation.
- Epic 8 is independent (offline profile build + existing engine).
- Epic 9 needs Epic 4 (accounts) and Epic 6 (attribution instrumentation).
- Epic 10 dashboards consume telemetry created in Epics 1–2; deploy topology hardens everything prior.
- UX Phase A (design foundation) is Story 1 territory in Epic 1; Phases B–D land in Epic 5; Phase E components land in their owning epics (UpgradeSheet/BlurLock → Epic 2, funnel set → Epic 6, share → Epic 7, partner → Epic 9).

## Epic 1: Interrogable Coach & Scalable Verdicts (LLM Replatform)

Producers can ask the coach grounded follow-up questions about their report — with honest refusals and visible caps — while the verdict engine moves off the `claude` CLI `Semaphore(1)` onto the Anthropic SDK with single-sourced metering, budgets, and outage degradation. Includes the verdict-pipeline relocation, CI from clean checkout, and the Phase-A design foundation all later UI consumes.

### Story 1.1: Relocate Verdict Pipeline into Worker Ownership

As the operator,
I want the verdict pipeline modules moved from the frozen v1 api component into the worker,
So that all new LLM work builds on actively owned code and the frozen-v1 boundary stays clean.

**Acceptance Criteria:**

1. **Given** the `restructure` branch, **When** the verdict pipeline modules (rule engine, triage, specialists, validator, dedupe, ranker, prompt registry) move from `components/api/app/verdict_pipeline` into a worker-owned package, **Then** all worker actors import from the new location **And** no new-stack code imports from `components/api`.
2. **Given** the golden-fixture suite, **When** it runs against the relocated pipeline, **Then** all fixtures pass unchanged (FR3, FR9–FR11 regression).
3. **Given** prompt versioning (FR48), **When** the operator flips a prompt-version flag row, **Then** the relocated pipeline resolves the new version without redeploy.
4. **Given** verdict feedback (FR13), **When** a user rates a verdict helpful/wrong/unclear, **Then** the rating persists exactly as before relocation.
5. **Given** the frozen-v1 boundary (AR3), **When** the import check runs, **Then** `components/api`, `components/frontend`, and `components/frontend-spectr` are imported by no new-stack code.

### Story 1.2: CI from Clean Checkout

As the operator,
I want every push verified from a clean checkout with enforcement lints,
So that the relocation and all future work cannot silently break builds or boundaries.

**Acceptance Criteria:**

1. **Given** a fresh clone, **When** GitHub Actions runs, **Then** BFF `dotnet build` + `dotnet test` pass, frontend `npm ci && npx vite build && npx tsc -b` + lint + vitest pass, and Python `ruff` + `pytest` (including golden fixtures) pass (NFR28).
2. **Given** the routeTree generation quirk, **When** the frontend job runs, **Then** vite build precedes `tsc -b` **And** the `package.json` build script is fixed to the same ordering.
3. **Given** the frozen-v1 components, **When** CI runs, **Then** they are excluded from all gates.
4. **Given** the enforcement lints (AR39), **When** CI runs, **Then** an `anthropic` import outside `llm/gateway.py` fails the build, a raw hex color in a CSS module fails the build, and a price literal outside config fails the build.

### Story 1.3: Anthropic SDK Gateway with Per-Call Metering

As the operator,
I want every LLM call to flow through one SDK-based gateway with per-call metering,
So that verdicts scale beyond `Semaphore(1)` and unit economics are observable per call.

**Acceptance Criteria:**

1. **Given** `components/worker/app/llm/gateway.py`, **When** any verdict pipeline stage needs the LLM, **Then** it calls the gateway using the official `anthropic` SDK **And** the `claude` CLI subprocess path is deleted.
2. **Given** `LLM_MAX_CONCURRENCY` config (default 5), **When** concurrent calls exceed the limit, **Then** excess calls queue on the semaphore **And** per-purpose sub-limits (verdicts vs coach) apply (AR6).
3. **Given** any completed or failed call, **When** the gateway returns, **Then** exactly one `llm_calls` row exists with ULID, user_id, tier, purpose, prompt_slug, prompt_version, model, input/output tokens, cost_usd (computed from a versioned price table), latency_ms, outcome, and correlation_id (AR7).
4. **Given** `LLM_FAKE=1` (AR41), **When** verdicts run, **Then** golden-fixture responses replay with zero API spend.
5. **Given** model pinning per prompt version (NFR24), **When** a prompt version specifies a model, **Then** the gateway honors it **And** a fallback model is configurable.
6. **Given** a timeout or transient API error, **When** a call fails, **Then** the explicit retry policy applies and an `outcome=error` row is recorded.

### Story 1.4: LLM Budgets, Circuit Breaker & Degraded Verdicts

As a user,
I want rule-engine verdicts with a clear notice when AI generation is unavailable,
So that my analysis is never silently worse.

**Acceptance Criteria:**

1. **Given** per-tier monthly budget ceilings and a global circuit breaker (AR8), **When** spend reaches a ceiling, **Then** the gateway raises `LlmBudgetExceeded` **And** no further Anthropic calls occur for that scope.
2. **Given** a job during budget exhaustion or provider outage, **When** verdict generation runs, **Then** the report persists rule-engine verdicts plus a machine-readable degradation notice (FR16).
3. **Given** a degraded report, **When** it renders, **Then** the user sees a "rule-based findings only" notice **And** the coach entry shows the offline state copy (UX-DR17).
4. **Given** budget reset or provider recovery, **When** new jobs run, **Then** AI verdicts resume with no manual intervention.

### Story 1.5: Grounded Coach Conversations

As a producer,
I want to ask the coach questions about my report and get answers grounded in my measured data,
So that follow-ups resolve confusion instead of inventing facts.

**Acceptance Criteria:**

1. **Given** an analysis report, **When** I POST a question to `/coach/{analysisId}/messages`, **Then** the BFF persists my message and enqueues the `coach_reply` actor on the `coach` queue, **And** the actor builds its context exclusively from that analysis JSON + verdicts + .als summary + conversation tail (AR9, AR10).
2. **Given** a completed reply, **When** the actor finishes, **Then** the full message persists with evidence citations resolved against the context bundle (unresolvable citations dropped) **And** one `llm_calls` row with purpose=coach exists.
3. **Given** a question about data the analysis lacks (e.g. stems not uploaded), **When** the coach replies, **Then** it returns the refusal template naming what is missing and how to unlock it — never invented numbers (FR14).
4. **Given** the conversation endpoint, **When** the client polls, **Then** completed and in-progress replies are retrievable (poll path works before streaming exists).
5. **Given** coach prompts, **When** deployed, **Then** they live under `llm/prompts/coach/` with frontmatter versions like specialist prompts.
6. **Given** prompt-injection attempts in user text (NFR12), **When** the coach replies, **Then** system prompts remain pinned and user text never triggers tool execution.

### Story 1.6: Coach Streaming Relay

As a producer,
I want coach answers to stream in live,
So that the conversation feels immediate.

**Acceptance Criteria:**

1. **Given** `coach_reply` generating, **When** tokens arrive, **Then** the actor publishes chunks to Redis pub/sub `coach:{conversationId}:{messageId}` **And** the BFF SSE endpoint relays them with event types `{token|done|error|refusal}` plus a heartbeat comment every 15 s (AR44).
2. **Given** a connected client, **When** the first token publishes, **Then** it reaches the browser <2 s after dispatch (NFR2).
3. **Given** the client closes the SSE stream (stop), **When** the actor checks the cancel flag per chunk, **Then** generation cancels **And** the partial message persists.
4. **Given** Redis pub/sub idle >30 s mid-stream, **When** the BFF detects it, **Then** it falls back to reading persisted partial message rows and closes with an `error` event — never a silent dead stream (AR9 fallback).

### Story 1.7: Design System Foundation (Fidelity Phase A)

As a producer,
I want the product to look like the designed studio instrument,
So that every surface from here on ships at brand fidelity.

**Acceptance Criteria:**

1. **Given** `public/fonts/`, **When** pages load, **Then** Syne (ss01/ss02 enabled) and JetBrains Mono (`tnum` enabled) are self-hosted with @font-face — no Google CDN (UX-DR1).
2. **Given** the global utility layer, **When** components consume it, **Then** `.card/.card-hd/.card-body`, `.label`, `.pill` + color variants, `.dot`, `.btn/.btn.primary/.btn.ghost/.btn.sm`, and keyframes `fadeUp fadeIn fillW fillH pulse pulseGlow` match the mockup definitions (UX-DR2).
3. **Given** `tokens.css`, **When** extended, **Then** `--space-4-5`, severity aliases, `--tier-free/--tier-pro/--tier-credits`, and `--paywall-overlay` exist **And** the no-raw-hex CI lint passes (UX-DR3).
4. **Given** `GradePill` (sm/lg with sr-only grade text), `Pill`, and `BrandMark`, **When** rendered, **Then** they match the canonical mockups side-by-side (UX-DR4).
5. **Given** the ambient signature, **When** any app page renders, **Then** dual radial gradients + 48 px grid overlay are present (UX-DR5).
6. **Given** `prefers-reduced-motion`, **When** set, **Then** all keyframe animations freeze to their end states.

### Story 1.8: Coach Chat UI with Grounding Affordances

As a producer,
I want a coach chat on my report that shows its grounding and streams answers,
So that asking feels like talking to someone who actually heard my track.

**Acceptance Criteria:**

1. **Given** a report, **When** the coach card renders, **Then** it shows the TranceBot avatar (72 px, EQ visor idle-pulse, faster while streaming, static under reduced-motion), overline `ASK THE COACH · online · trained on your analysis`, six suggestion chips derived from this report's verdict categories, and an input with `Ask →` (UX-DR13).
2. **Given** the grounding scope line, **When** the card renders, **Then** "Answers grounded in analysis #{shortid} · {n} measurements · {m} verdicts" shows beneath the input in dim mono (UX-DR14).
3. **Given** an answer with citations, **When** rendered, **Then** EvidenceChips (e.g. `LUFS −11.2`, `SUB-DEEP 65 Hz`) are tappable, scroll/highlight the source panel, and carry descriptive aria-labels (UX-DR15).
4. **Given** streaming, **When** tokens arrive, **Then** text streams with a visible stop button **And** `aria-live="polite"` announcements are throttled.
5. **Given** a refusal, **When** rendered, **Then** TranceBot styling is unchanged and the copy names the gap plus a one-tap unlock action (e.g. `Add stems`) (UX-DR17).
6. **Given** the provider-outage state, **When** the coach is unavailable, **Then** the card shows "Coach is offline — your measured analysis and rule-based findings are unaffected."

### Story 1.9: Per-Analysis Coach Caps

As a free user,
I want to see how many follow-ups I have left before I hit the limit,
So that caps never surprise me.

**Acceptance Criteria:**

1. **Given** `COACH_FREE_FOLLOWUPS` config (default 3), **When** a free or anonymous conversation exceeds the per-analysis cap, **Then** the server rejects further messages with error code `coach_cap_reached` in the standard envelope (AR38).
2. **Given** the cap chip, **When** the coach card renders, **Then** it uses the caps grammar `{used} of {limit} follow-ups · resets {date}` and turns amber at 1 remaining (UX-DR16).
3. **Given** the cap is reached, **When** rendering, **Then** the input swaps to CoachGateInline ("Pro = pooled monthly coach access" + "or buy credits") **And** the conversation history stays readable.
4. **Given** tier resolution does not exist yet, **When** caps evaluate, **Then** they read from config defaults so this story functions before Epic 2.

## Epic 2: Plans, Credits & Honest Billing

Users subscribe to Pro, buy credit packs, manage billing self-service, and see transparent usage — with entitlements enforced server-side, paid jobs never starved, results-forever structurally guaranteed, and billing state provably idempotent against Stripe.

### Story 2.1: Subscribe to Pro via Stripe Checkout

As a producer,
I want to subscribe to Pro monthly or annual,
So that I get unlimited analyses and full features.

**Acceptance Criteria:**

1. **Given** pricing config (no price literals in code — AR39), **When** I start checkout, **Then** the BFF creates a Stripe Checkout session ($12.99/mo or $99/yr) with Stripe Tax enabled and returns the hosted URL — card data never touches Spectr (NFR10, SAQ-A).
2. **Given** checkout completes, **When** Stripe delivers subscription webhooks, **Then** `webhook_events` records the event id (primary key) and payload hash, **And** duplicate deliveries are skipped via insert-or-skip (AR11).
3. **Given** the webhook processor, **When** subscription events apply, **Then** only it writes the `subscriptions` mirror row (stripe_customer_id, stripe_subscription_id, status, price_id, period_end, cancel_at).
4. **Given** webhook signature verification (NFR10), **When** an unsigned or invalid payload arrives, **Then** it is rejected and logged.
5. **Given** return from checkout, **When** I land on the success page, **Then** my tier shows Pro within 60 s (entitlement cache invalidated on webhook).

### Story 2.2: Manage Subscription Self-Service

As a Pro user,
I want to change billing period, update payment, and cancel as easily as I signed up,
So that I never feel trapped.

**Acceptance Criteria:**

1. **Given** the Billing page, **When** I open it, **Then** I see my plan, next charge date and amount, a monthly/annual toggle, and a Stripe Customer Portal link for payment method + invoices (FR30).
2. **Given** cancellation, **When** I click Cancel and confirm in one dialog (single optional reason field), **Then** `cancel_at_period_end` is set and the canceled state shows the end date, "everything you made stays accessible forever," and a resubscribe button (UX-DR33).
3. **Given** a period change, **When** I switch monthly↔annual, **Then** Stripe proration applies per the sandbox-tested flow (NFR23).
4. **Given** the two-click rule, **When** counting interactions from the Billing page, **Then** cancellation completes in ≤2 clicks.

### Story 2.3: Buy Credits with Append-Only Ledger

As an episodic producer,
I want to buy credit packs that never expire,
So that I can pay per release cycle without a subscription.

**Acceptance Criteria:**

1. **Given** a credit pack, **When** I purchase via Stripe Checkout one-time payment, **Then** a `credit_ledger` row (+5, reason=purchase, payment reference) appends on webhook **And** balance is computed as SUM of entries (AR11).
2. **Given** a credit-funded analysis, **When** the job dispatches, **Then** a −1 spend row appends transactionally with the usage event (AR16).
3. **Given** a job that fails pre-pipeline validation, **When** the failure is typed invalid-file, **Then** a +1 compensating reversal row appends — never an UPDATE to balances.
4. **Given** the usage page, **When** I view credits, **Then** the mono ledger lists signed entries with reasons.
5. **Given** purchased credits, **When** months pass, **Then** they never expire (FR29).

### Story 2.4: Server-Side Entitlements & Metering

As the operator,
I want every gated action checked against one server-side entitlement resolver,
So that tiers are enforced consistently and client tampering is irrelevant.

**Acceptance Criteria:**

1. **Given** `Entitlements.For(user)` (AR12), **When** resolved, **Then** it derives `{analyses_remaining, coach_remaining, features{stems, als, full_verdicts, history_depth}}` purely from subscription status, credit balance, and period usage — cached 60 s, invalidated on webhook/spend.
2. **Given** upload dispatch, **When** a free user has consumed 3 analyses in the current `billing_period`, **Then** the request rejects with error code `entitlement_exhausted` **And** the frontend keys off the code, not the message (AR38).
3. **Given** dispatch, **When** a job is created, **Then** the BFF stamps the tier onto the job row and writes a `usage_events` row (type=analysis, billing_period=YYYY-MM) in the same transaction — the worker never reads billing tables (AR13).
4. **Given** results-forever (AR15), **When** a lapsed user opens any previously delivered report, **Then** no entitlement check runs on the read path (an automated test asserts this).
5. **Given** metering, **When** analyses or coach messages occur, **Then** `usage_events` rows append and are never updated.

### Story 2.5: Paid Jobs Never Starve

As a paying user,
I want my analyses to start promptly regardless of free-tier load,
So that paying is visibly worth it.

**Acceptance Criteria:**

1. **Given** queues `analysis-paid`, `analysis-free`, `coach`, `maintenance` (AR23), **When** jobs dispatch, **Then** paid/credit jobs route to `analysis-paid`, free/anonymous to `analysis-free`, and coach replies to `coach`.
2. **Given** production compose, **When** workers start, **Then** W1 consumes `coach, analysis-paid` and W2 consumes `analysis-free, maintenance`.
3. **Given** W2 saturated with free jobs, **When** a paid job arrives, **Then** its queue wait is unaffected (integration test with stub jobs proves it — FR34).
4. **Given** dev, **When** a single worker consumes all queues, **Then** behavior is functionally unchanged.

### Story 2.6: Tier-Aware Coach Caps

As a Pro user,
I want a pooled monthly coach allowance instead of per-analysis limits,
So that my subscription buys real conversational depth.

**Acceptance Criteria:**

1. **Given** a Pro user, **When** they use the coach, **Then** a pooled monthly cap (`COACH_PRO_MONTHLY` via feature flags) applies across analyses **And** the chip reads `{used} of {limit} this month` (FR15).
2. **Given** the free tier, **When** entitlements resolve, **Then** the Epic-1 per-analysis cap now derives from the entitlement resolver rather than raw config.
3. **Given** the `feature_flags` table (AR35), **When** the operator changes a cap value, **Then** BFF and worker read the new value within 60 s without redeploy.
4. **Given** the two-guard model, **When** caps and budgets both apply, **Then** the BFF gates message COUNT and the gateway gates SPEND independently.

### Story 2.7: Cap-Hit Upgrade Flow (UpgradeSheet + BlurLock)

As a free user at my cap,
I want an honest upgrade moment that shows what I'd get and never loses my work,
So that paying feels like an invitation, not a trick.

**Acceptance Criteria:**

1. **Given** a 4th upload attempt in a month, **When** I click upload, **Then** the UpgradeSheet opens BETWEEN actions (never mid-pipeline): header "3 of 3 free analyses used this month," value-recap strip with my own grade chips, PRO card with period toggle + savings, CREDITS card ("no subscription, never expire"), trust line ("Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio"), and a ghost "wait for next month" exit (UX-DR30).
2. **Given** checkout completes from the sheet, **When** I return, **Then** the file I originally chose resumes uploading automatically — work never lost.
3. **Given** BlurLock (UX-DR29), **When** depth is gated anywhere (free-tier stems tab, lapsed-Pro features), **Then** real blurred content + one-line unlock copy + a single CTA render **And** the lock reason is announced to assistive tech.
4. **Given** the gate-between-never-during pattern (UX-DR38), **When** any entitlement state changes mid-pipeline, **Then** in-flight jobs complete and persist.

### Story 2.8: Usage Page with Honest Math

As a user,
I want to see exactly what I've consumed and what it costs,
So that I can make the subscription decision myself.

**Acceptance Criteria:**

1. **Given** the usage page, **When** opened, **Then** analyses used (`{used} of {limit} · resets {date}`), coach pool status, credit balance, and the CreditLedger mono table render (FR32, UX-DR32).
2. **Given** 90-day credit spend at or above the Pro-equivalent, **When** the page renders, **Then** the HonestMathBanner shows the comparison ("You've spent $X on credits in 90 days — Pro would've been $Y"), dismissible, never a modal.
3. **Given** buy credits, **When** I pick a 5 or 10 pack, **Then** checkout opens and the balance updates inline on return.
4. **Given** the UsageMeter nav variant (UX-DR31), **When** I approach caps, **Then** a passive meter in the account menu reflects it — no surprise modals.

### Story 2.9: Dunning States & Graceful Degradation

As a lapsed subscriber,
I want my access to degrade gracefully without ever losing past reports,
So that a failed card never destroys my trust.

**Acceptance Criteria:**

1. **Given** a failed renewal, **When** Stripe marks the subscription `past_due`, **Then** the webhook updates local state and the amber DunningBanner shows "Payment failed — retrying {day} · update card" (UX-DR33).
2. **Given** Stripe Smart Retries exhaust, **When** status reaches `canceled`/`unpaid`, **Then** the tier degrades to Free, Pro features lock via BlurLock, **And** every past report remains fully readable (FR33 — results-forever as visible behavior).
3. **Given** the grace window, **When** the subscription is `past_due`, **Then** Pro access continues until a terminal state.
4. **Given** recovery, **When** the payment method updates and Stripe resumes the subscription, **Then** Pro restores with no data loss.

### Story 2.10: Billing Integrity & Reconciliation

As the operator,
I want billing state provably consistent with Stripe,
So that double-charging is structurally impossible and drift is caught nightly.

**Acceptance Criteria:**

1. **Given** the nightly reconciliation job (AR14), **When** it compares the subscriptions mirror and credit ledger against Stripe, **Then** any drift emits an alertable metric/event **And** the job is idempotent.
2. **Given** webhook replay, **When** Stripe redelivers an already-processed event id, **Then** processing is a no-op (test replays a recorded fixture stream — FR35).
3. **Given** entitlement state loss, **When** webhook events replay from Stripe, **Then** local state reconstructs equivalently.
4. **Given** money fields, **When** audited, **Then** all amounts are integer cents with ISO currency codes (AR14).

## Epic 3: Reliable Uploads & Results That Last (Cloud Storage)

Users upload 250 MB files reliably via presigned direct-to-R2 multipart, stream playback through signed URLs, and trust that reports survive forever while raw audio follows the published retention policy.

### Story 3.1: Direct-to-R2 Presigned Multipart Upload

As a producer,
I want my 250 MB uploads to go straight to storage with live progress,
So that uploads are fast and never bottleneck on the app server.

**Acceptance Criteria:**

1. **Given** an R2 bucket (MinIO in dev/CI — AR17), **When** I init an upload, **Then** `POST /uploads/init` runs the entitlement check and returns multipart presigned part URLs (parts ≥16 MB) for files ≤250 MB (AR18).
2. **Given** the browser, **When** parts upload directly to R2 with progress events, **Then** the BFF never proxies file bodies **And** `POST /uploads/complete` finalizes the multipart and enqueues the job.
3. **Given** the existing upload UX, **When** uploading, **Then** chunked percentage progress renders as today (FR1 regression).
4. **Given** a stalled part on a poor connection, **When** the client retries that part, **Then** the upload resumes without restarting from zero (NFR3).
5. **Given** dev parity, **When** compose dev runs, **Then** MinIO exercises the identical code paths.

### Story 3.2: Worker-Side Validation & Attachments via R2

As the operator,
I want file validation at the worker trust boundary and all attachments on the same storage path,
So that spoofed files fail fast without consuming user entitlements.

**Acceptance Criteria:**

1. **Given** a completed upload, **When** the worker pre-pipeline step fetches the source from R2, **Then** magic-byte + duration validation runs server-side (AR19); an invalid file fails fast with a typed error **And** no entitlement is consumed (compensating reversal per AR16).
2. **Given** attachments (FR2), **When** stems/reference/.als upload, **Then** they follow the same presigned path into `stems/{jobId}/` and `als/{jobId}/` per the key layout (AR20).
3. **Given** the key layout, **When** objects write, **Then** `audio/{userOrDevice}/{jobId}/source.*` and `reports/{jobId}.json` conventions hold.
4. **Given** worker R2 access, **When** the worker reads/writes objects, **Then** it uses its own credentials, not the BFF's (AR21).

### Story 3.3: Signed Playback & Durable Reports

As a producer,
I want playback to just work while my files stay private,
So that nothing I upload is ever publicly reachable.

**Acceptance Criteria:**

1. **Given** report playback (FR5), **When** the player requests audio, **Then** the BFF issues short-lived presigned GETs — no public objects, no permanent URLs (NFR5).
2. **Given** a completed job, **When** the report persists, **Then** it writes to Postgres JSONB (existing) AND `reports/{jobId}.json` in R2 (AR20).
3. **Given** the Listen page, **When** it loads audio, **Then** the same signed-URL flow applies.
4. **Given** an expired signed URL, **When** playback resumes later, **Then** the client transparently requests a fresh URL.

### Story 3.4: Retention Sweep

As the operator,
I want retention policy enforced by an authoritative nightly job,
So that storage costs stay bounded while reports survive forever.

**Acceptance Criteria:**

1. **Given** the `sweep_retention` actor on the `maintenance` queue (AR22), **When** it runs nightly, **Then** free-tier raw audio older than 30 days purges and lapsed-paid raw audio older than 90 days post-lapse purges, **And** reports/verdicts/chats are NEVER deleted (test asserts NFR20).
2. **Given** an approaching lapsed-paid purge, **When** notice is due, **Then** a retention-warning email enqueues via `IEmailSender` (logs until Epic 4 wires Resend).
3. **Given** anonymous-owned rows, **When** unclaimed for >72 h, **Then** the sweep purges them — the guard no-ops safely before Epic 4 introduces devices.
4. **Given** R2 lifecycle rules on `audio/` prefixes, **When** configured, **Then** they backstop the sweep.
5. **Given** repeated runs, **When** the sweep re-executes, **Then** it is idempotent.

### Story 3.5: Upload & Job Persistence Resilience Verified

As a producer on hotel wifi,
I want interrupted uploads and sessions to survive,
So that flaky connections never cost me an analysis.

**Acceptance Criteria:**

1. **Given** a user leaves mid-analysis, **When** they return, **Then** job progress restores via the existing SSE/poll path (FR8 regression through the storage change).
2. **Given** a worker restart with pending jobs, **When** the worker returns, **Then** queued jobs remain queued (not failed) and resume (NFR16).
3. **Given** a 190 MB FLAC on a flaky connection (Journey 2), **When** parts stall and retry, **Then** the upload completes and the analysis runs.

## Epic 4: Account Lifecycle, Identity & Email

Users verify email, reset passwords, export their data, and delete their account with full cascade; anonymous visitors get device identities that claim cleanly into accounts; all transactional email flows through Resend with bounce handling.

### Story 4.1: Secrets Hardening & Auth Regression

As the operator,
I want all secrets sourced from the environment with no fallback defaults,
So that the known hardcoded-JWT launch blocker is closed.

**Acceptance Criteria:**

1. **Given** production mode, **When** the BFF boots without `JWT_SECRET` set, **Then** it refuses to start — the hardcoded default is removed (NFR6).
2. **Given** `.env.example`, **When** reviewed, **Then** every required secret and config knob from AR40 is documented with placeholder values only.
3. **Given** existing auth (FR25), **When** register/login/refresh-token flows run after the change, **Then** all pass regression.
4. **Given** the repo and built images, **When** scanned in CI, **Then** no real secrets are present.

### Story 4.2: Transactional Email Foundation (Resend)

As the operator,
I want one email pathway with templates, retries, and suppression,
So that every product email is deliverable and brand-consistent.

**Acceptance Criteria:**

1. **Given** `IEmailSender` + a template registry (AR27), **When** any email sends, **Then** it enqueues through the `send_email` actor on the `maintenance` queue for retry semantics.
2. **Given** the EmailShell kit (UX-DR37), **When** templates render, **Then** system fonts + dark header band apply, with verification, reset, analysis-complete, dunning, and retention-warning templates registered.
3. **Given** bounces/complaints, **When** Resend webhooks arrive, **Then** addresses append to the suppression table **And** future sends to suppressed addresses are skipped.
4. **Given** deliverability (NFR25), **When** DNS is configured, **Then** SPF/DKIM/DMARC pass verification (checklist lives in the runbook).

### Story 4.3: Email Verification & Password Reset

As a user,
I want to verify my email and recover a forgotten password,
So that my account is provably mine and never permanently locked.

**Acceptance Criteria:**

1. **Given** registration (FR26), **When** I sign up, **Then** a verification email sends with a single-use expiring token **And** verifying marks my account verified.
2. **Given** a forgotten password, **When** I request a reset, **Then** a reset email sends; the token is single-use and expiring; completing the reset invalidates existing sessions.
3. **Given** the auth forms, **When** rendered, **Then** they use the 380 px card, brand mark, mono labels, and cyan focus ring (UX-DR41).
4. **Given** brute-force protection (NFR8), **When** auth endpoints are hammered, **Then** per-IP token-bucket rate limits apply.

### Story 4.4: Lifecycle Emails (Completion, Dunning, Retention)

As a user,
I want timely, relevant emails about my analyses and billing,
So that I never miss a finished report or a billing problem.

**Acceptance Criteria:**

1. **Given** an analysis completes (FR44), **When** the user has notifications enabled (opt-out flag), **Then** an analysis-complete email sends with a deep link to the report.
2. **Given** a `past_due` transition (Epic 2 states), **When** dunning fires, **Then** the dunning notice email sends through the same pathway (FR33 email half).
3. **Given** an approaching retention purge (Epic 3 sweep), **When** the warning is due, **Then** the retention-warning email sends with the purge date and keep options.
4. **Given** suppression, **When** any lifecycle email targets a suppressed address, **Then** it skips and logs.

### Story 4.5: Anonymous Devices & Claim

As an anonymous visitor,
I want my free analysis tied to my browser and claimable at registration,
So that trying the product costs nothing and signing up loses nothing.

**Acceptance Criteria:**

1. **Given** a first anonymous analysis, **When** it starts, **Then** a `devices` row (ULID, ip_hash, ua_hash) is created and a signed httpOnly `spectr_device` cookie is set (AR24).
2. **Given** anonymous jobs/reports/conversations, **When** persisted, **Then** they own `device_id` XOR `user_id`, enforced by a DB CHECK (AR24).
3. **Given** registration with a device cookie present, **When** the account is created, **Then** that device's jobs, reports, and conversations re-parent to the user in one transaction and the device marks claimed — the analysis is never lost (FR28, AR25).
4. **Given** anonymous rate limits (AR26, NFR8), **When** `/uploads/init` is called, **Then** per-device AND per-IP token buckets apply, one active analysis per device is enforced, and anonymous artifacts follow 72 h retention.
5. **Given** the second-analysis gate (AR26), **When** an unverified registered user starts another analysis, **Then** email verification is required — report viewing is never gated.

### Story 4.6: GDPR Export & Account Deletion

As a user,
I want to export everything I own and delete my account completely,
So that my unreleased music and data remain under my control.

**Acceptance Criteria:**

1. **Given** an export request (FR27), **When** processed, **Then** I receive machine-readable JSON (account, songs, versions, reports, verdicts, conversations) plus a media manifest with signed download links.
2. **Given** account deletion, **When** I confirm, **Then** user rows, audio/stems/.als objects in R2, reports, and chat logs cascade-delete, **And** the Stripe customer is detached per policy.
3. **Given** an active subscription, **When** I attempt deletion, **Then** the flow explains that cancellation happens first and proceeds only after confirmation.
4. **Given** the deletion cascade, **When** it executes, **Then** an audit row records the action (actor = user).

## Epic 5: The Full-Fidelity Report

The report becomes the $12.99-worthy product: verdict hero, five badged tabs, parity panels, partial-failure handling with free retry, version compare, song-detail fidelity, and club-readiness surfacing — fidelity-audit Phases B–D executed.

### Story 5.1: App Shell & Library Fidelity (Phase B)

As a producer,
I want the shell and library to feel like the designed instrument,
So that the product reads premium from the first authenticated screen.

**Acceptance Criteria:**

1. **Given** product routes, **When** TopNav renders, **Then** the 56 px blur bar shows brand → Report/Listen/Library tabs → ⌘K search → bell → `+ Upload` primary → avatar menu (Profile, Usage, Billing, Partners, Sign out) (UX-DR6).
2. **Given** the library, **When** grid/list render, **Then** LibraryCard (`minmax(300px,1fr)`), LibraryRow, CoverArt (hue-gradient + waveform overlay), and VersionArc sparkline match the mockups (UX-DR7).
3. **Given** an empty library, **When** rendered, **Then** the designed empty state previews the filled shape with a single CTA.
4. **Given** the MiniPlayer (UX-DR8), **When** on product routes ≥768 px, **Then** the persistent bottom bar shows; it is hidden on funnel/share/auth routes **And** toasts offset above it.
5. **Given** layout, **When** rendered, **Then** the 1360 px app max-width applies (UX-DR9).

### Story 5.2: Results Restructure — VerdictHero & Tabs (Phase C Core)

As a producer,
I want the report to lead with the grade and what to do,
So that triage beats inventory every time I open it.

**Acceptance Criteria:**

1. **Given** a report, **When** it renders, **Then** VerdictHero (340/1fr layout, GradePill-lg, verdict headline, 4 HeroMetrics) leads the page (UX-DR10).
2. **Given** the tab bar, **When** rendered, **Then** five badged tabs show with AI Coach default (pulsing cyan dot) **And** tab state lives in the URL (`?tab=coach`) for deep links (UX-DR11).
3. **Given** the Epic-1 coach card, **When** the restructure lands, **Then** CoachChat re-homes into the AI Coach tab with zero functional regression.
4. **Given** an improved version, **When** the report renders, **Then** the delta badge ("+6 vs v3") shows with a one-time cyan pulse, static under reduced-motion.
5. **Given** report loading, **When** data fetches, **Then** skeleton cards appear in reading order: hero → tabs → verdicts (UX-DR40).

### Story 5.3: FeaturedVerdictCard & Coach Handoff

As a producer,
I want each verdict to read like a numbered studio finding with a path to act,
So that I always know what's wrong, how sure we are, and what to do next.

**Acceptance Criteria:**

1. **Given** verdicts, **When** rendered, **Then** FeaturedVerdictCard shows the 88 px ghost numeral, PersonaChip, ImpactTag, ConfidenceMeter, InlineChart slot (placeholder variant first), and FixRecipe (UX-DR12).
2. **Given** provenance (UX-DR42), **When** rule-engine findings render, **Then** a `RULE` mono chip distinguishes them from AI persona chips.
3. **Given** `Ask the coach about this`, **When** tapped, **Then** the chat input prefills with the verdict context and the chat scrolls into view.
4. **Given** cited values, **When** a verdict renders, **Then** EvidenceChips tap-to-scroll to the source panel.
5. **Given** verdict feedback (FR13), **When** I rate helpful/wrong/unclear, **Then** the rating persists (regression).

### Story 5.4: Analysis Summary Tab, Filters & Specialist Roster

As a producer,
I want to see what ran, what's locked, and filter findings my way,
So that the full picture is one tab away without drowning the default view.

**Acceptance Criteria:**

1. **Given** the summary tab, **When** rendered, **Then** AnalysisSummary shows PipelineDial + PhaseList + UnlockBlock with the sticky side rail (`minmax(0,1fr) 360–380px`) (UX-DR19).
2. **Given** CoachFilters (UX-DR18), **When** used, **Then** category pills + show-fixed toggle filter the verdict list.
3. **Given** the specialist roster, **When** expanded, **Then** the collapsible SpecialistTile grid (`minmax(220px,1fr)`) lists specialists with status.

### Story 5.5: Frequency, Stem Clash, Reference & Arrangement Panels

As a producer,
I want every analysis phase visualized at parity,
So that the report SHOWS the moat (FR4).

**Acceptance Criteria:**

1. **Given** the frequency tab, **When** rendered, **Then** BigSpectrumBars (CSS columns) render with the genre-median overlay (UX-DR20).
2. **Given** stems were analyzed, **When** the clash panel renders, **Then** StemClashList shows clashing stem pairs with frequency ranges and severity.
3. **Given** a reference track was attached, **When** the reference panel renders, **Then** GapRow + ScoreRing show the deltas (UX-DR21).
4. **Given** arrangement analysis, **When** rendered, **Then** ArrangementBar + the issue list show structure findings.
5. **Given** chart accessibility (UX-DR44), **When** any chart renders, **Then** `role="img"` + label + an adjacent text equivalent exist.

### Story 5.6: .als Project Panel & Track-Name Attribution

As an Ableton producer,
I want verdicts that name my actual project tracks,
So that I know exactly where to click in my DAW.

**Acceptance Criteria:**

1. **Given** an .als-attached analysis, **When** the report renders, **Then** the .als panel shows the project structure summary (FR4).
2. **Given** project-attributed verdicts (FR12), **When** rendered, **Then** track-name chips (e.g. `SUB-DEEP`) highlight cyan inside verdict text and link to the panel.
3. **Given** no .als attached, **When** the panel area renders, **Then** it shows the unlock invitation with benefit chip instead.

### Story 5.7: Partial-Failure Reporting & Free Retry

As a producer whose file hit a snag,
I want everything that worked plus a free retry,
So that one corrupted region never wastes my analysis.

**Acceptance Criteria:**

1. **Given** a phase failure (FR6), **When** the report renders, **Then** all successful phases render, the failed phase is named, and a banner offers "re-export and retry free" in the "we kept everything that worked" tone.
2. **Given** the free retry, **When** clicked, **Then** a new analysis dispatches without consuming entitlement (compensation per AR16) and associates to the same song version.
3. **Given** .als parser isolation (AR33), **When** the subprocess crashes or exceeds limits, **Then** the phase skips, the job survives, and the panel notes the skip.

### Story 5.8: Song Detail & Version Compare

As a producer iterating on a mix,
I want my song's history and a side-by-side version compare,
So that I can see exactly what improved.

**Acceptance Criteria:**

1. **Given** song detail, **When** rendered, **Then** the 36 px hero, grade-banded ProgressTimeline, and version table with labels/notes/current-version controls match the mockups (FR17/FR18, UX-DR22).
2. **Given** `+ New version`, **When** clicked from a report or song page, **Then** the upload pre-associates to that song (FR20).
3. **Given** compare (FR19), **When** two versions are selected, **Then** the DeltaCard sticky rail shows scores, key metrics, and verdict deltas, signed and semantically colored (UX-DR23, UX-DR42).

### Story 5.9: Upload Dialog Polish, Club Check & Playback Verify

As a DJ-producer,
I want stems/reference/.als upload affordances and club-readiness at a glance,
So that pre-gig checks take five seconds.

**Acceptance Criteria:**

1. **Given** the UploadDialog, **When** opened, **Then** a primary custom drop-zone plus three labeled optional zones (Stems multi-select / Reference / .als) each with a benefit chip, song association (existing dropdown or new name), and genre hint select render (FR2 UX, UX-DR41).
2. **Given** a DJ-genre track, **When** Streaming/Stereo panels render, **Then** ClubCheckCard pins mono-compatibility %, true peak, and low-end mono fold (UX-DR34).
3. **Given** report playback (FR5), **When** playing, **Then** in-page playback works including Safari AudioContext unlock-on-gesture.

### Story 5.10: Product A11y, Keyboard & Kitchen Sink

As a keyboard-first producer,
I want the product fully navigable and verifiable,
So that speed and accessibility are the same feature.

**Acceptance Criteria:**

1. **Given** product routes, **When** loaded, **Then** ⌘K search, ⌘U upload, and `?` shortcut sheet register (UX-DR43).
2. **Given** the axe-core CI smoke (UX-DR44), **When** run on the report route, **Then** no WCAG 2.1 AA violations report.
3. **Given** <1024 px, **When** the report renders, **Then** rails stack and fold into accordions **And** Listen shows the desktop-only notice card (UX-DR45).
4. **Given** `/dev/kitchen-sink` behind a feature flag (UX-DR46), **When** opened, **Then** the component inventory renders as the visual-regression and a11y audit surface.
5. **Given** focus styling, **When** tabbing anywhere, **Then** the visible cyan ring shows on all interactives **And** the lint forbids `outline: none` without replacement.

## Epic 6: Free Analyzer Funnel & Public Site

Visitors land, understand the product, run one instant analysis with zero fields, see a real report, and claim it by registering — with landing/pricing/trust pages live and the funnel instrumented edge-to-edge.

### Story 6.1: Landing & Pricing Pages

As a skeptical visitor,
I want to see what the product does on a real report and what it honestly costs,
So that I can decide to try it in one scroll.

**Acceptance Criteria:**

1. **Given** the landing page (FR40), **When** loaded cold, **Then** LCP <2.5 s (prerendered/static), the ambient atmosphere tokens apply, the primary CTA is `Analyze my track free`, **And** a live sample report embed renders a real VerdictHero with demo data — not a screenshot (UX-DR24).
2. **Given** the pricing page, **When** rendered, **Then** PricingTable shows Free/Pro/credits with a tax-inclusive note, no asterisks, and terms restated at the buttons (UX-DR25).
3. **Given** public chrome (UX-DR6), **When** funnel pages render, **Then** the slim variant shows (brand + Pricing + Sign in + `Analyze free`).
4. **Given** SEO (PRD strategy), **When** crawled, **Then** landing/pricing/trust pages are prerendered with meta tags while the SPA stays auth-gated.

### Story 6.2: Trust Pages

As a producer protective of unreleased music,
I want the no-training pledge, results-forever, and privacy defaults stated as first-class pages,
So that I can verify the promises before paying.

**Acceptance Criteria:**

1. **Given** the trust commitments (FR41), **When** published, **Then** the no-AI-training pledge (versioned), results-forever policy, and privacy defaults each render as standalone pages (UX-DR26).
2. **Given** signup and pricing surfaces, **When** rendered, **Then** both link the trust pages.
3. **Given** the pledge content, **When** written, **Then** it documents the Anthropic API no-training configuration matching NFR12.

### Story 6.3: Anonymous Instant Analysis

As a first-time visitor,
I want a real analysis of my track with zero forms,
So that the product proves itself before asking for anything.

**Acceptance Criteria:**

1. **Given** `/analyze` (FR7, UX-DR27), **When** a visitor lands, **Then** a full-bleed custom drop zone renders with mono hints "WAV · FLAC · MP3 · ≤250 MB" and zero form fields.
2. **Given** an upload, **When** the pipeline runs, **Then** the progress screen shows animated phase dots, phase names, ETA, and rotating educational one-liners.
3. **Given** the anonymous report, **When** rendered, **Then** VerdictHero + the #1 verdict + streaming readiness are fully visible **And** deeper tabs are BlurLocked with "Create a free account to keep this report + see all {n} findings."
4. **Given** the claim moment, **When** I register inline (email+password card over the page, report visible behind), **Then** the report re-parents to my account (Epic 4 claim) **And** the verify banner explains verification gates the next analysis, not this one.
5. **Given** a refresh at any stage, **When** the page reloads, **Then** state restores via the device cookie.
6. **Given** abuse (AR26), **When** a device/IP exceeds limits, **Then** rate limiting applies with honest error copy.

### Story 6.4: Resume Cards

As a distracted visitor,
I want interrupted flows to greet me when I return,
So that I never have to start over.

**Acceptance Criteria:**

1. **Given** an unclaimed report within 72 h (UX-DR28), **When** the visitor returns, **Then** a "Your report from {day}" resume card shows.
2. **Given** an interrupted upload or unfinished checkout, **When** returning, **Then** dismissible resume cards offer continuation.
3. **Given** dismissal, **When** a resume card is dismissed, **Then** the dismissal is remembered.

### Story 6.5: Funnel Instrumentation

As the operator,
I want every funnel edge measured privately,
So that conversion leaks are findable from day one.

**Acceptance Criteria:**

1. **Given** PostHog Cloud EU (AR37, NFR27), **When** funnel edges fire, **Then** `land, upload_start, report_view, signup, cap_hit, checkout_start, paid` events record with no third-party ad trackers (FR43).
2. **Given** a claim, **When** a device becomes a user, **Then** identities stitch device→user in analytics.
3. **Given** the PRD KPI table, **When** events flow, **Then** time-to-first-insight, free→paid conversion, and share attribution are derivable.
4. **Given** inbound attribution params (`?ref`, share source), **When** visits arrive, **Then** they are captured for Epic 7/9 consumption.

## Epic 7: Share Pages & the Viral Loop

Report owners share a public link that unfurls beautifully in Discord, shows a curated read-only report in 5 seconds on a phone, can be revoked anytime, and converts strangers into the free analyzer with attribution.

### Story 7.1: Share Link & Read-Only Public Report

As a proud producer,
I want a public link to my report that shows my result without exposing my project,
So that I can post it in Discord safely.

**Acceptance Criteria:**

1. **Given** a report (FR21), **When** I create a share link, **Then** a random 128-bit token generates — one per report, with regenerate support (AR28).
2. **Given** `/r/{token}`, **When** a stranger opens it, **Then** the read-only single-column 880 px page renders: brand mark → VerdictHero → top 3 verdicts with evidence chips (no chat) → frequency chart vs genre (UX-DR35).
3. **Given** the projection (FR22), **When** the share payload serializes, **Then** the `ShareReportProjection` allowlist DTO is the ONLY source — .als internals and raw stems never appear (a default-deny test asserts it).
4. **Given** a recipient view, **When** rendered, **Then** no owner controls appear.

### Story 7.2: OG Share Shell

As a share recipient on Discord,
I want the link to unfurl with the grade and track name,
So that the post sells itself before anyone clicks.

**Acceptance Criteria:**

1. **Given** `/r/{token}` fetched by a crawler or chat app (FR22, AR28), **When** the BFF responds, **Then** it serves a prerendered HTML shell with OG/Twitter meta (grade, verdict text, track name, static branded OG image) and the inline projection JSON, **And** the SPA hydrates the route for human visitors.
2. **Given** per-report privacy, **When** meta renders, **Then** `noindex` applies per report.
3. **Given** the 5-second test, **When** the page loads at 360 px, **Then** grade + verdict text sit above the fold.

### Story 7.3: Share Revocation

As a report owner,
I want to kill a share link anytime,
So that sharing is always reversible.

**Acceptance Criteria:**

1. **Given** my active share (FR23), **When** I revoke it, **Then** the token soft-deletes and `/r/{token}` returns a friendly gone page.
2. **Given** regeneration, **When** I create a new link, **Then** the old token stays dead.
3. **Given** the share controls (UX-DR42), **When** rendered, **Then** a lock/globe glyph + one-line scope text state exactly what a share exposes.

### Story 7.4: Share CTA & Attribution

As the operator,
I want every share view to carry a measured path into the free analyzer,
So that the k-factor loop closes.

**Acceptance Criteria:**

1. **Given** the ShareCTA (FR24, UX-DR35), **When** viewed on mobile, **Then** "Analyze your own track free →" is sticky with a ≥40 px target.
2. **Given** a recipient clicks through, **When** they analyze/sign up, **Then** share→visit→analysis→signup attribution records via Epic 6 instrumentation.
3. **Given** share-page audio (AR21), **When** playback is offered, **Then** presigned GETs are scoped to the share token's validity.

## Epic 8: Genre Intelligence — House & Techno

House and techno producers get statistically backed genre scoring with published methodology, and all users can browse what "good" looks like per genre.

### Story 8.1: Genre Profile Builder Tool

As the operator,
I want a repeatable offline tool that builds genre profiles from curated reference sets,
So that every published profile has real statistical backing.

**Acceptance Criteria:**

1. **Given** `components/analysis/tools/profile_builder.py` (AR34), **When** run offline on a curated reference set, **Then** it emits versioned profile JSON to `data/reference_library/profiles/` plus an auto-generated methodology doc (track counts, feature list).
2. **Given** the existing trance profile, **When** the builder reruns on the trance set, **Then** the output matches the known-good 196-track statistical profile shape (tool validated against the incumbent).
3. **Given** analysis purity (AR4), **When** the tool runs, **Then** it is offline-only — never a runtime service.

### Story 8.2: House Genre Profile

As a house producer,
I want my track scored against a real house profile,
So that the percentile feedback means something in my genre.

**Acceptance Criteria:**

1. **Given** a curated house reference set (FR37), **When** built, **Then** `house_profile.json` ships with its methodology doc and a golden-fixture scoring test.
2. **Given** feature flags (AR35), **When** house is enabled, **Then** genre scoring offers house without redeploy.
3. **Given** a house track, **When** scored, **Then** percentile placement and the radar/gap view render exactly as trance does (FR36 pattern).

### Story 8.3: Techno Genre Profile

As a techno producer,
I want my track scored against a real techno profile,
So that launch covers my genre with published methodology.

**Acceptance Criteria:**

1. **Given** a curated techno reference set (FR37), **When** built, **Then** `techno_profile.json` ships with its methodology doc and a golden-fixture scoring test.
2. **Given** feature flags, **When** techno is enabled, **Then** genre scoring offers techno without redeploy.
3. **Given** a techno track, **When** scored, **Then** percentile placement and the radar/gap view render exactly as trance does.

### Story 8.4: Genre Reference Browsing & Scoring Verification

As a producer,
I want to browse what "good" looks like per genre,
So that targets are transparent, not black-box.

**Acceptance Criteria:**

1. **Given** the genre browse surface (FR39), **When** opened, **Then** per-genre reference data ("what good looks like") renders from profile data with links to the methodology docs.
2. **Given** the genre hint (FR38), **When** a user overrides detection, **Then** scoring uses the hint (regression).
3. **Given** trance scoring (FR36), **When** golden fixtures run, **Then** percentile placement is unchanged.

## Epic 9: Affiliate Partner Program

Educators register for coded links, see clicks/signups/conversions on a one-page dashboard, and get monthly payout reporting — with FTC-compliant terms.

### Story 9.1: Affiliate Registration & Attribution

As an educator,
I want a coded link the moment I apply,
So that my next video can carry it.

**Acceptance Criteria:**

1. **Given** `/partners` (FR42), **When** a partner applies (name, channel URL, payout email), **Then** an affiliate code issues instantly **And** the terms require FTC/ASA disclosure acceptance.
2. **Given** `?ref=CODE` (AR36), **When** a visitor lands, **Then** a 30-day cookie sets; on registration the referral stamps into the `affiliates`/`referrals` tables.
3. **Given** attribution durability, **When** signup happens within 30 days across sessions, **Then** the referral still records.

### Story 9.2: Partner Dashboard & Payout Reporting

As an affiliate partner,
I want my stats and owed commissions on one page,
So that I trust the program enough to keep promoting.

**Acceptance Criteria:**

1. **Given** the dashboard (UX-DR36), **When** a partner views it, **Then** one page renders: link card with copy button, mono stats row (clicks / signups / conversions / owed), monthly payout table.
2. **Given** payout operations, **When** the operator exports, **Then** a CSV endpoint provides per-partner monthly payables (manual payout per PRD).
3. **Given** a referred user pays, **When** commission accrues, **Then** 25% first-year commission reflects in the partner's owed stats.

## Epic 10: Operator Console & Launch Hardening

The operator runs the business from dashboards, gets phone-grade alerts, issues refunds with audit trails, contains abuse, and deploys/restores the whole system reproducibly.

### Story 10.1: Production Deploy Topology

As the operator,
I want one reproducible production deployment,
So that ship and rollback are single commands.

**Acceptance Criteria:**

1. **Given** `infra/compose.prod.yml` (AR29), **When** deployed on the VPS, **Then** caddy (auto-TLS, funnel statics, `/r/*` proxy), bff, worker-paid (W1), worker-free (W2), postgres:16, and redis:7 run.
2. **Given** EF migrations, **When** the BFF boots, **Then** migrations apply under an advisory lock; Alembic stays frozen.
3. **Given** CI on main (AR30), **When** green, **Then** images build and push to GHCR, the SSH deploy step runs `docker compose pull && up -d`, and `/healthz` smoke checks pass.
4. **Given** a bad deploy, **When** rollback runs, **Then** one command restores the previous image set (NFR29).
5. **Given** secrets (AR31), **When** deployed, **Then** the host `.env` is chmod 600 and no secrets exist in repo or images.

### Story 10.2: Backups & Restore Proof

As the operator,
I want nightly backups that provably restore,
So that user data survives me breaking things.

**Acceptance Criteria:**

1. **Given** the nightly job (AR31), **When** it runs, **Then** `pg_dump` lands in R2 `backups/` with 30-day retention.
2. **Given** the weekly restore-test script, **When** it runs, **Then** a restore to a scratch database succeeds and a failure alerts.
3. **Given** the launch gate (NFR15), **When** before launch, **Then** one full restore has been performed and documented in the runbook.

### Story 10.3: Observability Stack

As the operator,
I want pipeline, queue, spend, quality, and revenue visible on dashboards,
So that the morning glance replaces guesswork (Journey 6).

**Acceptance Criteria:**

1. **Given** Sentry (AR32), **When** errors occur in BFF, worker, or frontend, **Then** they report with `correlation_id` tags — one id traceable upload → job → actors → LLM calls → report render (NFR30).
2. **Given** Prometheus, **When** scraping, **Then** BFF `/metrics` (prometheus-net) and worker (dramatiq middleware + custom counters: job durations, queue depth, LLM cost) expose.
3. **Given** Grafana, **When** dashboards load, **Then** pipeline health, queue depths, LLM spend vs budget, verdict quality (validation-reject + helpful/wrong rates), and MRR proxy render (FR45).
4. **Given** PostHog, **When** the funnel runs, **Then** the PRD KPI table metrics are derivable.

### Story 10.4: Phone-Grade Alerting & Status

As the operator,
I want my phone to buzz when the business breaks,
So that incidents never wait for me to look.

**Acceptance Criteria:**

1. **Given** Grafana alert rules (FR49), **When** job failures spike, LLM budget hits ≥80%, billing webhooks fail, wrong-rate exceeds 10%, disk exceeds 80%, or a backup is missed, **Then** ntfy.sh pushes reach the operator's phone.
2. **Given** external uptime probing, **When** `/healthz` fails, **Then** healthchecks.io alerts independently of the VPS.
3. **Given** an incident (NFR16), **When** it occurs, **Then** a status page (static acceptable) is updateable.

### Story 10.5: Admin Endpoints & Audit Log

As the operator,
I want a user's billing trail inspectable and every privileged action logged,
So that a double-charge claim resolves in minutes with evidence.

**Acceptance Criteria:**

1. **Given** elevated admin auth (separate from user auth — NFR7), **When** the operator calls Admin endpoints, **Then** a user's billing/webhook trail is inspectable for refund decisions (FR46).
2. **Given** a refund, **When** issued, **Then** the action records in the audit log (actor, target, reason, timestamp).
3. **Given** privileged actions (bans, feature-flag changes, prompt rollbacks), **When** executed, **Then** audit rows append.

### Story 10.6: Abuse Containment

As the operator,
I want layered automated abuse controls,
So that a scripted free-tier abuser is contained before I wake up (Journey 6).

**Acceptance Criteria:**

1. **Given** per-account caps + disposable-email throttling (FR47), **When** an abuser scripts analyses through disposable emails, **Then** automated controls contain it without operator action.
2. **Given** a ban, **When** the operator bans an account, **Then** access revokes and the action audits.
3. **Given** the anonymous limits from Epic 4, **When** combined with account caps, **Then** layered limits hold under scripted load (test simulates the J6 scenario).

### Story 10.7: Measurement Conformance Harness

As the operator,
I want LUFS/true-peak proven against reference signals,
So that no published number can be wrong (measurement credibility is the product's authority).

**Acceptance Criteria:**

1. **Given** ITU-R BS.1770-4 test vectors, **When** the harness measures LUFS, **Then** results land within the documented ±0.1 LU tolerance.
2. **Given** true peak, **When** 4× oversampled dBTP measures the reference signals, **Then** conformance is documented before any number is marketed as authoritative (PRD domain requirement).
3. **Given** CI, **When** the harness is wired in, **Then** measurement regressions fail the build.

### Story 10.8: Runbook & Launch Checklist

As the operator,
I want every failure mode pre-documented and the launch gates checklisted,
So that 3 a.m. incidents have a script (NFR31).

**Acceptance Criteria:**

1. **Given** `docs/runbook.md`, **When** complete, **Then** it covers: stuck job, webhook backlog, LLM budget breach, restore-from-backup, abuse response, secrets rotation, and prompt rollback.
2. **Given** the launch checklist, **When** executed, **Then** SPF/DKIM/DMARC are verified, the Stripe sandbox matrix (dunning/refund/proration — NFR23) has passed, the restore test is done, and alerting has been test-fired.
3. **Given** production error responses (NFR9), **When** errors occur, **Then** no stack traces or internals leak (test asserts the envelope).

## Epic 11: SPECTR Social — Collaboration, Feedback & Discovery

Surface the already-built Listen-V3 social backend (version sharing, live rooms, threaded timestamped feedback, reviewer rack-suggestions, bookmarks, anon identity) as real, shippable user-facing experiences, then close the two greenfield gaps — in-app notifications and public profiles/follow/discovery — so SPECTR moves from "analyze alone" to "share a version, collect timestamped feedback and rack-fix suggestions (logged-in or anonymous), co-listen live in a room, get notified, and follow other producers." The backend is ~90% done (PRP-0..6 slice); the bulk of this epic is **wiring built hooks to new components**, one **mock→SSE swap**, and one **greenfield social-graph** slice. This is a net-new epic alongside Epics 1–10 (no renumbering). Story lineage: 11.1–11.4 operationalize PRP-3; 11.5 PRP-4; 11.3/11.4 PRP-6; 11.6/11.7 PRP-7 (`PRPs/listen-v3-notifications.md`).

**Sequencing.** Wave A (11.1‖11.3‖11.5, pure wiring/swap) → Wave B (11.4 anon surface) → Wave C/D (11.6→11.7 notifications) → Wave E (11.8→11.9→11.10 social graph) → 11.11 polish. Hard chains: 11.1→11.2→11.4 · 11.6→11.7 · 11.8→11.9→11.10. **First sprint:** 11.1 + 11.3 + 11.5 committed, 11.2 stretch.

### Story 11.1: Threaded Timestamped Comments Panel

As a producer reviewing a track,
I want to read and leave comments pinned to specific moments,
So that feedback points to the exact spot in the mix it's about.

**Acceptance Criteria:**

1. **Given** a version I can view, **When** I open the Comments panel, **Then** threaded comments render ordered with status (open/resolved/pinned/hidden) and timestamp anchors, consuming the existing `useComments` hooks (no new backend).
2. **Given** I click a timestamped comment, **Then** the player seeks to that timestamp.
3. **Given** I am the author or owner, **When** I patch a comment's status (resolve/pin/hide), **Then** the list reflects it after query invalidation.
4. **Given** a server 403/404, **Then** the panel renders a "not permitted" empty state — gating is server-side via `AccessService`; it is never re-implemented client-side.
5. **Given** the panel renders, **Then** a vitest static-render test covers the threaded list + status badges.

### Story 11.2: Reviewer Rack-Suggestions & Accept-to-Preset

As a track owner,
I want to see a reviewer's proposed rack-chain fix and adopt it in one click,
So that good suggestions become a usable preset with credit to the proposer.

**Acceptance Criteria:**

1. **Given** a version with suggestions, **Then** each `ReviewerSuggestion` shows its chain summary, status, and provenance (session/grant origin where present).
2. **Given** I am the owner, **When** I Accept a suggestion, **Then** the backend forks a `RackPreset` and the suggestion flips to accepted (reuse the `AcceptSuggestion` endpoint — never fork client-side).
3. **Given** a suggestion linked to a comment, **Then** it renders inline within that comment thread (11.1).
4. **Given** accept succeeds, **Then** the new preset appears in the rack preset list.
5. **Given** the suggestion card renders, **Then** a static-render test covers its states (open/accepted/rejected).

### Story 11.3: Bookmarks Rail & Owner Heat Signal

As a listener,
I want to bookmark moments with a note and let owners see where attention lands,
So that "love this part" becomes durable, aggregated signal.

**Acceptance Criteria:**

1. **Given** I am listening, **When** I add a bookmark at the playhead with an optional note, **Then** it persists and appears on the timeline (consume `useBookmarks`).
2. **Given** my bookmarks, **Then** I can edit the note, toggle `identity_visible`, and delete (CRUD via `/me/bookmarks`).
3. **Given** I am the version owner, **When** I open the signal view, **Then** I see aggregated bookmark density over the timeline (`/versions/{id}/bookmarks/signal`, owner-only).
4. **Given** a non-owner, **Then** the owner-only signal call is never made.
5. **Given** the rail/overlay renders, **Then** a static-render test covers bookmark markers + signal heat.

### Story 11.4: Anonymous Reviewer Surface on Share Token

As a producer who received a share link,
I want to view and give feedback without an account,
So that getting ears on a track has zero friction.

**Acceptance Criteria:**

1. **Given** a valid share token, **When** an anon visitor opens `/v/{token}`, **Then** they see the owner-safe version (never `.als`/raw stems) plus comments/suggestions/bookmarks in their token-scoped anon variants.
2. **Given** the token's `ShareSetting` grants canComment/canSuggest/canBookmark, **Then** those actions are enabled; otherwise hidden (resolved by `AccessService`).
3. **Given** an anon write, **Then** it carries the durable signed-cookie anon `ActorRef` and is rate-limited; the route uses the opaque ResourceToken, never JWT `?t=`.
4. **Given** a revoked or expired token, **Then** the page renders a revoked state.
5. **Given** the page renders, **Then** a static-render test covers the anon gating matrix.

### Story 11.5: Live Room — Replace Mocks with SSE Orchestration

As a producer,
I want to host a real synchronized listening room,
So that people hear my track together and react live.

**Acceptance Criteria:**

1. **Given** a host starts a room, **When** participants join, **Then** state syncs from the first `sync` snapshot frame and applies subsequent `SessionEvent` deltas (reuse the written-but-unwired `useRoomStream`).
2. **Given** a participant reacts/chats/changes transport-visuals-rack, **Then** the action POSTs via `useRoomActions` and fans out to all clients.
3. **Given** the host grants or revokes control, **Then** capabilities update live (reuse `identity.ts`/`capabilities.ts`).
4. **Given** the host ends the room, **Then** `PublishRecap` triggers and `recap_actor.py` produces the recap.
5. **Given** `useMockRoomOrchestration` is removed from the page, **Then** no mock import remains, the swap sits behind an adapter seam (not a page rewrite), and existing `listen-rack` tests still pass.

### Story 11.6: Notifications Backend — Table, Sink & Endpoints

As a user,
I want the system to record things that happen to my tracks,
So that feedback, suggestions, and adoptions don't get missed.

**Acceptance Criteria:**

1. **Given** the migration, **Then** a `notifications` table exists with a raw-SQL partial-unique on `digest_key` (mirror `CreditLedgerEntry`/`WebhookEvent`), and the Python model is mirrored in `aimusic_shared/models.py`.
2. **Given** the existing call sites (comment_created, suggestion_created, suggestion_accepted, mention), **Then** `NotifyAsync` now writes rows built to the AS-BUILT seam (`ActorRef` recipient, dict payload); anon recipients are a no-op (no orphan rows).
3. **Given** a bookmark create, **Then** a new digest call site collapses into one rolling `(recipient, version, day)` row with incrementing `count`.
4. **Given** a comment body with `@handle`, **Then** `MentionParser` resolves handles to user ids and produces `mention` rows.
5. **Given** `GET /me/notifications` (paged) + unread-count + mark-read + read-all, **Then** all are recipient-scoped (IDOR-safe), with integration coverage for digest-upsert idempotency.

### Story 11.7: Notification Center — Bell & Inbox

As a user,
I want a bell with unread count and an inbox,
So that I can see and act on what happened while I was away.

**Acceptance Criteria:**

1. **Given** unread notifications, **Then** the bell in the app shell shows a live unread count (TanStack Query `refetchInterval` poll; SSE deferred).
2. **Given** I open the bell, **Then** I see a paged list; per-event items render individually, bookmarks render as a digest ("3 people bookmarked Aurora v3 today").
3. **Given** I click a notification, **Then** it deep-links to the version/comment/room and marks read.
4. **Given** mark-all-read, **Then** the unread count resets.
5. **Given** the center renders, **Then** a static-render test covers per-event vs digest rendering and the unread badge.

### Story 11.8: Public Profiles

As a producer,
I want a public page at my handle,
So that others can see who I am and what I've shared.

**Acceptance Criteria:**

1. **Given** a user has a handle, **When** anyone visits `/u/{handle}`, **Then** they see display_name, bio, public_link, hue theming, and that user's public/shared versions.
2. **Given** the visitor is the owner, **Then** an "Edit profile" affordance links to the existing `/profile`.
3. **Given** a handle that doesn't exist, **Then** a 404 page renders.
4. **Given** a private user, **Then** only public-visibility content is exposed (owner-safe subset via `AccessService`).
5. **Given** the public profile endpoint, **Then** it is unauthenticated and rate-limited; a static-render test covers populated + empty profiles.

### Story 11.9: Follow Graph

As a producer,
I want to follow other producers,
So that I keep up with people whose work I rate.

**Acceptance Criteria:**

1. **Given** another user's profile, **When** I click Follow, **Then** a `FollowRelation(follower, followee)` row is created idempotently (unique `(follower_id, followee_id)` index; no duplicates).
2. **Given** I unfollow, **Then** the relation is removed and counts update.
3. **Given** any profile, **Then** follower/following counts render.
4. **Given** my own profile, **Then** the Follow button is hidden (no self-follow).
5. **Given** follow writes, **Then** they are auth-required and rate-limited, and the Python model is mirrored.

### Story 11.10: Activity Feed

As a producer,
I want a feed of recent activity from people I follow,
So that the app gives me a reason to come back.

**Acceptance Criteria:**

1. **Given** I follow users, **When** I open the feed, **Then** I see their recent public version-shares and published room recaps in reverse-chron.
2. **Given** I follow no one, **Then** an empty state suggests profiles to discover.
3. **Given** a feed item, **Then** it deep-links to the version/profile/recap.
4. **Given** the feed query, **Then** it is recipient-scoped, paged, and reuses visibility gating (never leaks private content).
5. **Given** the feed renders, **Then** a static-render test covers populated + empty feed.

### Story 11.11: Discovery Entry-Points

As a user,
I want the social surfaces connected into a loop,
So that comments, rooms, profiles, and follows reinforce each other.

**Acceptance Criteria:**

1. **Given** I type `@` in a comment composer, **Then** a handle autocomplete suggests users (resolving against the index used by `MentionParser`).
2. **Given** a comment or room-participant avatar, **When** clicked, **Then** it links to `/u/{handle}`.
3. **Given** an anon viewer on `/v/{token}` who registers, **Then** a "follow this producer" CTA is offered post-claim.
4. **Given** these entry-points, **Then** static-render tests cover the mention autocomplete and avatar links.
