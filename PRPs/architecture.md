---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - 'PRPs/prd.md'
  - 'PRPs/ux-design-specification.md'
  - 'PRPs/product-brief-spectr-2026-06-12.md'
  - 'PRPs/research/market-spectr-ai-music-analyzer-2026-06-12.md'
  - '_bmad/knowledge/index.md'
  - 'session: restructure-branch audit 2026-06-12 (BFF/worker/verdict-pipeline/frontend state, build verification)'
workflowType: 'architecture'
project_name: 'Spectr'
user_name: 'Brian Rankin'
date: '2026-06-12'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:** 49 FRs across 10 capability areas, brownfield-tagged: 17 [E]xist on `restructure`, 8 [P]artial, 24 [N]ew. The [N] set concentrates in four architectural zones: (1) commerce/entitlements (FR29–35), (2) anonymous funnel + claim (FR7/FR28), (3) communications + growth instrumentation (FR40–44), (4) operations (FR45–49). The [P] set is mostly UI surface over existing backends (report panels, share, version compare) plus coach chat (FR14–15) which is plumbing-incomplete. Architectural implication: the analysis/verdict engine needs almost no new architecture — the work is wrapping it in a revenue system without destabilizing it.

**Non-Functional Requirements (architecture-driving):**
- Concurrency: 10 simultaneous analyses + 5 LLM streams, free never starves paid (FR34) → queue topology decision.
- LLM unit economics observable per call (<25%→15% ARPU) → single-sourced metering is non-negotiable; current `claude` CLI + `Semaphore(1)` must die.
- Billing integrity: idempotent webhooks, replay-recoverable entitlements, zero double-charge → event-sourced-lite billing tables.
- Results-forever + retention tiers (free raw audio 30d, reports forever) → object-storage lifecycle + report/audio separation.
- GDPR export/delete cascade → ownership graph must be walkable from user id.
- 99.5% availability, solo operator → boring deployable topology, phone-grade alerting, runbook-first ops.
- Measurement credibility (BS.1770 conformance harness) → analysis engine untouched except verified.

**Scale & Complexity:**
- Primary domain: full-stack SaaS web app (SPA + BFF + async compute) with LLM cost-control subsystem.
- Complexity: medium — no multi-tenancy beyond user-scoping, no regulated data, but three runtimes (.NET, Python, TS) and money correctness.
- Estimated architectural components: ~12 (BFF, worker×2 pools, LLM gateway module, billing/entitlements, storage, email, share renderer, funnel pages, observability stack, CI/CD, backup).

### Technical Constraints & Dependencies

- Brownfield base `restructure` is canonical: .NET 10 BFF (minimal API + EF Core/Npgsql, EF migrations own the schema), Python 3.11 Dramatiq worker (Redis broker), verdict pipeline (rule engine → triage → 27 specialists → validator → dedupe → ranker; prompt versioning; golden fixtures), React 19 + TanStack frontend. **Keep the BFF↔worker seam: BFF never imports analysis code; worker never serves HTTP.**
- v1 FastAPI + Celery + two legacy frontends: FROZEN. No migration, no deletion in MVP; excluded from CI gates.
- LLM provider: Anthropic API (no-training posture, model pinning per prompt version, fallback model).
- External services budget-bound: Stripe, object storage, transactional email, error tracking, product analytics — all must have solo-dev-sane free/cheap tiers.
- Windows dev machine, Linux prod target → containerized parity (compose both sides).
- Known build quirk: frontend `tsc -b` requires generated `routeTree.gen.ts` → CI ordering fix mandatory.

### Cross-Cutting Concerns Identified

1. **Entitlement enforcement** — every analysis dispatch, coach message, and depth-gated read passes one server-side check (BFF), backed by metering events.
2. **LLM cost + quality telemetry** — every Anthropic call (verdict, triage, coach) records tokens/cost/purpose/user/tier + outcome; quality rates (validator rejections, user feedback) join the same spine.
3. **Identity duality** — anonymous device identity and account identity share the ownership model (claimable).
4. **Privacy/ownership graph** — user → songs → versions → jobs → artifacts (audio/stems/als/reports/chats) must support export, cascade delete, retention sweeps, and share-scoped projection.
5. **Idempotency** — webhooks, job retries, claim flow, credit spends: all replay-safe.
6. **Observability correlation** — one correlation id from upload → job → actors → LLM calls → report render.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack SaaS: React SPA + .NET BFF + Python async compute.

### Starter Options Considered

Greenfield starters (T3, dotnet templates, SaaS boilerplates) — all rejected without deep evaluation: this is brownfield with ~25k LOC of working, tested, audited code embodying the product's differentiators.

### Selected Starter: the `restructure` branch itself

The existing codebase is the starter. Build-verified 2026-06-12 (BFF: 0 warnings; frontend: vite + tsc clean). Slices 0–3 provide auth, library/versioning, upload, pipeline, verdicts, results UI, Listen DSP. All new architecture extends this base; nothing is rewritten for taste. Consequence: technology choices below are constrained-by-default to the incumbent stack (.NET 10, EF Core, Dramatiq, Redis, Postgres 16, React 19/TanStack) unless a requirement is impossible within it — none is.

## Core Architectural Decisions

### Decision Priority Analysis

Ordered by blast radius: (1) LLM gateway placement — gates coach chat, verdict scaling, all cost telemetry; (2) billing/entitlements model — gates revenue and every gated FR; (3) storage — gates production deploy + retention; (4) queue topology — gates fairness NFR; (5) identity/claim; remainder are bounded integrations.

### D1 — LLM Gateway: worker-owned, BFF is LLM-free

**Decision:** All Anthropic calls live in Python, in one module: `components/worker/app/llm/gateway.py` (evolves the existing `llm/client.py`). Replace `claude` CLI subprocess with the official `anthropic` SDK. The .NET BFF never holds an Anthropic key.

- **Concurrency:** `asyncio.Semaphore(LLM_MAX_CONCURRENCY)` (config, default 5) replaces the hard-coded `Semaphore(1)`; per-purpose sub-limits (verdicts vs coach) via weighted acquisition.
- **Metering (single-sourced):** gateway writes one row per call to Postgres `llm_calls` (id ULID, user_id, tier, purpose[triage|specialist|coach], prompt_slug, prompt_version, model, input_tokens, output_tokens, cost_usd computed from a versioned price table, latency_ms, outcome[ok|validation_rejected|error|refused], correlation_id). Budgets enforced here: per-tier monthly ceilings + global circuit breaker → on breach, raise `LlmBudgetExceeded` → callers degrade (rule-engine-only verdicts, coach gate message) per FR16.
- **Coach chat flow (streaming through the seam):** BFF `POST /coach/{analysisId}/messages` → entitlement check + persist user message → enqueue `coach_reply` actor (high-priority queue) → actor builds grounded context (analysis JSON + verdicts + .als summary + conversation tail), streams Anthropic tokens, publishes chunks to Redis pub/sub channel `coach:{conversationId}:{messageId}`, persists final message + llm_call row → BFF SSE endpoint relays the Redis channel to the browser. Enqueue+relay overhead ≪ the <2s first-token NFR. Stop = client closes SSE; BFF publishes cancel flag key; actor checks per chunk.
- **Why not BFF-side .NET SDK for coach:** would split metering/budget/prompt-versioning across two runtimes — the exact failure mode the NFRs forbid. Why not a standalone gateway service: third deployable for a solo operator with no independent scaling need.
- **Grounding contract:** gateway exposes `grounded_complete(prompt_slug, context_bundle, …)`; coach prompts pinned + versioned like specialists; refusal template when context lacks requested data (FR14). Existing validator continues to gate verdict outputs; coach outputs carry evidence-chip citations resolved against the context bundle (cheap regex/JSON-pointer check; unresolvable citations dropped).

### D2 — Billing & Entitlements: Stripe-mirrored state + append-only ledgers in BFF

**Decision:** Stripe Checkout (hosted) + Customer Portal + webhooks. BFF owns four EF tables:
- `subscriptions` — local mirror keyed by user: stripe_customer_id, stripe_subscription_id, status, price_id, period_end, cancel_at. Updated ONLY by webhook processor.
- `credit_ledger` — append-only signed entries (purchase +5, spend −1, refund +1) with reason + reference (job id / payment intent); balance = SUM, materialized per-user cached.
- `usage_events` — append-only: type[analysis|coach_message], user_or_device id, billing_period (YYYY-MM), job/message ref. Free-tier caps + Pro coach pool computed per period from here.
- `webhook_events` — Stripe event id PK, payload hash, processed_at → strict idempotency; processor is a transactional consumer (insert-or-skip then apply).
**Entitlement resolution:** pure function `Entitlements.For(user)` over (subscription status, credit balance, period usage) → {analyses_remaining, coach_remaining, features{stems, als, full_verdicts, history_depth}}; cached 60s, invalidated on webhook/spend. Enforced in BFF endpoint filters — worker trusts the job row's stamped tier (BFF stamps at dispatch; jobs never re-check mid-run, so a mid-analysis downgrade cannot kill running work).
**Money rules:** integer cents everywhere; Stripe is source of truth for subscription state, local ledger is source of truth for credits; nightly reconciliation job compares mirrors and alerts on drift (FR35). Dunning: rely on Stripe Smart Retries + webhook-driven `past_due` state → in-app banner + email; downgrade applies only at `canceled`/`unpaid` terminal states. Tax via Stripe Tax. Results-forever: entitlement gates ANALYZE and DEPTH-of-new-reports only — read access to existing reports is never entitlement-checked (FR33 structurally guaranteed).

### D3 — Object Storage: S3-compatible (Cloudflare R2), presigned direct upload

**Decision:** R2 (zero egress fees — audio downloads/playback would bleed on S3; S3-compatible API keeps options open). Local dev + CI: MinIO container.
- **Upload path:** client → BFF `POST /uploads/init` (entitlement check, returns multipart presigned part URLs) → browser uploads parts directly to R2 → `POST /uploads/complete` → BFF enqueues job. BFF never proxies 250 MB bodies. Magic-byte + duration validation moves into the worker's pre-pipeline step (server-side trust boundary); invalid file → job fails fast with typed error, no entitlement consumed.
- **Layout:** `audio/{userOrDevice}/{jobId}/source.*`, `stems/{jobId}/…`, `als/{jobId}/…`, `reports/{jobId}.json` (small, forever), `og/{token}.png` (post-MVP). Reports also persisted in Postgres JSONB (existing) — R2 copy is belt-and-braces export fodder.
- **Access:** BFF issues short-lived presigned GETs for playback/download; share-page audio = presigned GET scoped to share token validity; worker uses its own R2 credentials.
- **Retention (FR/NFR):** nightly sweep job (Dramatiq `maintenance` queue) implements: anonymous unclaimed 72h purge; free raw audio 30d; lapsed-paid raw audio 90d post-lapse with notice email; reports/verdicts/chats never swept. R2 lifecycle rules as backstop on `audio/` prefixes; authoritative sweep is the job (needs DB joins for tier).

### D4 — Queue Topology: priority by queue + dedicated worker pools

**Decision:** Dramatiq queues: `analysis-paid`, `analysis-free`, `coach` (also paid-priority), `maintenance`. Two worker processes in prod: **W1** consumes `coach, analysis-paid` (in that order), **W2** consumes `analysis-free, maintenance`. Starvation-proofing is structural (separate processes), not scheduler-dependent — free jobs can saturate W2 forever without touching paid latency (FR34). Scale path: add W1 replicas. Existing actors unchanged except queue assignment + tier stamp; `max_retries=2`, idempotent persistence already in place (3-phase transaction pattern survives).

### D5 — Anonymous Identity & Claim

**Decision:** `devices` table (ULID id, created_at, ip_hash, ua_hash) + signed httpOnly cookie `spectr_device`. Anonymous jobs/reports own `device_id` instead of `user_id` (nullable pair + CHECK exactly-one). Claim flow (FR7/FR28): on registration with device cookie present → transactional re-parent of that device's rows to the new user (jobs, reports, conversations) → device marked claimed. Rate limits: per-device AND per-IP (Redis token bucket) on `/uploads/init` + auth endpoints; anonymous = 1 active analysis, 72h retention. Email verification gates the SECOND analysis, not report viewing (UX flow 1).

### D6 — Transactional Email: Resend

**Decision:** Resend (solo-dev DX, React-less plain HTML templates per UX email kit, EU-friendly). BFF-side `IEmailSender` with template registry: verify, reset, analysis-complete (opt-out flag on user), dunning notice, retention warning. Bounce/complaint webhooks → suppress list table. SPF/DKIM/DMARC checklist in runbook. Email sends enqueued (BFF → `maintenance` queue actor) so SMTP latency never blocks requests… correction: Resend is HTTP API — still enqueue for retry semantics.

### D7 — Share Page & OG Rendering

**Decision:** BFF serves `/r/{token}` as prerendered HTML shell: minimal Razor-less template (string-templated) containing OG/Twitter meta (grade, verdict text, track name, static branded OG image), inline JSON payload of the share-scoped report projection, then loads the SPA bundle which hydrates the share route. Share projection is a server-side allowlist DTO (never .als internals, never stems, configurable owner toggles post-MVP). `noindex` per report. Dynamic per-report OG images deferred (worker-rendered PNG post-MVP); static branded card + dynamic text ships MVP. Revocation = token row soft-delete (FR23); tokens random 128-bit, single per report with regenerate.

### D8 — Deployment Topology & CI/CD: one VPS, Compose, GitHub Actions

**Decision:** Single Linux VPS (Hetzner CX42-class) running Docker Compose: `caddy` (auto-TLS, serves prerendered funnel statics + share shell proxy), `bff`, `worker-paid` (W1), `worker-free` (W2), `postgres:16`, `redis:7`. R2/Resend/Stripe/Anthropic external. Funnel pages = static HTML built with the SPA (separate vite entry or plain files) served by Caddy with cache headers.
- **CI (GitHub Actions):** matrix — BFF `dotnet build && dotnet test`; frontend `npm ci && npx vite build && npx tsc -b && lint && vitest` (vite-before-tsc fixes routeTree quirk; also fix `build` script ordering in package.json); Python `ruff + pytest` (worker, analysis, shared incl. golden fixtures); v1 components excluded. On main: build+push images (GHCR) → SSH deploy step `docker compose pull && up -d` → smoke check `/healthz` endpoints.
- **Migrations:** EF migrations applied by BFF container entrypoint with advisory lock; Alembic frozen.
- **Backups:** nightly `pg_dump` → R2 `backups/` (30d retention) + weekly restore-test script; runbook documents restore.
- **Secrets:** `.env` on host (chmod 600) injected via compose; no secrets in repo/images; JWT/Stripe/Anthropic/R2 keys rotated documented in runbook. Rejected: k8s (ops weight), PaaS-per-service (cost + Dramatiq/Redis affinity), serverless (long-running CPU analysis hostile).

### D9 — Observability & Alerting

**Decision:** Sentry (free tier) for exceptions in BFF, worker, frontend (correlation_id tag). Metrics: Prometheus scrape — BFF (`/metrics` via prometheus-net), workers (dramatiq prometheus middleware + custom counters: job durations, queue depth via Redis llen probe, llm cost counter from gateway). Single Grafana + Prometheus pair as compose services (self-host, free) with dashboards: pipeline health, queue depths, LLM spend vs budget, verdict quality (validation_rejected rate, feedback helpful/wrong from existing tables), MRR/churn proxy (Stripe webhook counts). Alerts: Grafana → ntfy.sh push to phone for FR49 conditions (job failure spike, budget breach ≥80%, webhook failures, wrong-rate >10%, disk >80%, backup missed). Product analytics: PostHog Cloud EU free tier, custom events per PRD KPI table, no ad trackers. Uptime: healthchecks.io ping from cron + external probe on `/healthz`.

### D10 — Supporting decisions (bounded)

- **.als parser isolation:** parse in a `concurrent.futures` subprocess with rss/time limits inside the worker; failure → phase skipped (existing partial-failure pattern), never job death.
- **Genre profiles (house/techno):** offline build script in `components/analysis/tools/profile_builder.py` from curated reference sets → versioned JSON in `data/reference_library/profiles/`; methodology doc auto-emitted per profile (FR37). Not a runtime service.
- **Feature flags:** single `feature_flags` table read by BFF + worker (cached 60s) — coach caps, specialist set, genre profile enablement. No external flag service.
- **Affiliate attribution:** `?ref=CODE` → 30d cookie → stamped on registration → `affiliates` + `referrals` tables; payouts manual from a BFF CSV export endpoint (MVP per PRD).
- **Funnel instrumentation:** PostHog events at each funnel edge (land, upload_start, report_view, signup, cap_hit, checkout_start, paid) with device→user identity stitching on claim.

### Decision Impact Analysis

D1 unblocks FR14–16, FR31 (LLM share of metering), FR49 budget alerts; D2 unblocks FR29–35; D3 unblocks NFR storage/retention + 250MB uploads; D4 satisfies FR34 structurally; D5 unblocks FR7/FR28; D6 FR26/FR44; D7 FR21–24; D8 NFR maintainability + CI; D9 FR45/FR49 + KPI table. Riskiest: D1 streaming relay (new plumbing) — mitigated by it being ~200 lines (publish/subscribe/relay) with a worked fallback (poll persisted partial message rows) if pub/sub misbehaves.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

Naming, structure, format, communication, process — each below states the rule + the incumbent convention it extends. Where the codebase already has a pattern, the pattern wins over taste.

### Naming Patterns

- **IDs:** ULIDs for new domain entities (matches verdict ids); Stripe ids stored verbatim with `stripe_` prefix columns.
- **DB:** EF Core entities PascalCase → snake_case tables/columns via existing Npgsql naming convention; append-only tables suffixed `_ledger`/`_events`; mirrors named after source (`subscriptions`).
- **Endpoints:** existing minimal-API style — nouns, kebab-less lowercase segments (`/uploads/init`, `/coach/{analysisId}/messages`, `/billing/portal`, `/r/{token}`); no `/api/v1` versioning in MVP (single client).
- **Dramatiq actors:** verb_noun snake_case (`coach_reply`, `sweep_retention`) matching `run_specialist` lineage; queue names kebab (`analysis-paid`).
- **Events (PostHog + usage_events):** snake_case past-participle-free verbs (`upload_start`, `report_view`, `cap_hit`, `coach_message`).
- **Frontend:** TanStack file-route conventions as-is; CSS Modules `ComponentName.module.css`; Phase-A global utilities exactly as mockup names them (`.card`, `.pill`).
- **LLM prompts:** PascalCase markdown files with frontmatter `version:` (existing); coach prompts under `prompts/coach/`.

### Structure Patterns

- **BFF:** feature folders under `Spectr.Bff/Features/{Billing|Entitlements|Coach|Share|Devices|Affiliates|Admin}` each owning endpoints + DTOs + services; `Spectr.Data` owns entities + EF migrations only; no feature logic in Data.
- **Worker:** `app/actors/` one file per actor; `app/llm/gateway.py` sole Anthropic touchpoint (import-linted: `anthropic` importable only there); `app/maintenance/` sweep jobs.
- **Shared Python:** `aimusic_shared` remains the ORM/verdict-schema source for worker-side persistence; new billing tables are EF-only (worker reads tier from job row, never joins billing tables).
- **Frontend:** existing `features/` + `routes/` layout; new `features/billing`, `features/funnel` (static-built), `features/share`; Phase-E components colocated with their feature.
- **Repo additions:** `infra/` (compose.prod.yml, Caddyfile, deploy.sh), `.github/workflows/ci.yml`, `docs/runbook.md`.

### Format Patterns

- **API error envelope (extend existing):** `{ "error": { "code": "entitlement_exhausted", "message": human, "details": {...} } }` — stable machine codes for gate types (frontend BlurLock/UpgradeSheet key off codes, not strings); production never includes stack traces (NFR).
- **Money:** integer cents + ISO currency; UI formats.
- **Timestamps:** UTC ISO-8601 everywhere; DB `timestamptz`.
- **SSE:** existing event format retained; coach stream events `{type: token|done|error|refusal, …}`; heartbeat comment every 15s.
- **Share projection DTO:** explicit allowlist mapper (`ShareReportProjection`) — adding a field requires touching one file; default-deny.
- **Config:** BFF `IOptions` from env; worker pydantic-settings; every new knob documented in `.env.example` (LLM_MAX_CONCURRENCY, LLM_MONTHLY_BUDGET_USD, FREE_ANALYSES_PER_MONTH, COACH_FREE_FOLLOWUPS, COACH_PRO_MONTHLY, RETENTION_* …).

### Communication Patterns

- Browser↔BFF: REST + SSE only (existing). Browser never talks to worker, Redis, or R2 APIs (presigned URLs excepted).
- BFF↔worker: Dramatiq message enqueue (BFF uses existing .NET Redis enqueue path from the audit) + Postgres rows as shared state + Redis pub/sub for coach streams. No HTTP between BFF and worker.
- Worker→BFF: never calls BFF; communicates via DB writes + pub/sub.
- Webhooks: Stripe → BFF single endpoint → `webhook_events` insert → in-process dispatch; Resend bounces likewise.
- Third parties called server-side only (Stripe/Anthropic/Resend/R2-signing); browser sees Stripe Checkout redirect + presigned R2 URLs only.

### Process Patterns

- **Migrations:** EF Core only, applied at BFF boot under advisory lock; destructive migrations require a runbook entry + backup confirmation step in CI deploy gate.
- **Prompt changes:** bump frontmatter version → golden-fixture suite must pass → deploy; rollback = flip `prompt_versions` flag row (existing mechanism) — never redeploy for prompt rollback.
- **Entitlement changes:** caps/prices only via feature_flags/config + Stripe dashboard price objects; code never hardcodes tier numbers (lint: no `12.99` literals outside config).
- **Testing gates (CI):** BFF unit (entitlement resolver, webhook idempotency, share projection), worker unit + golden fixtures, frontend type/lint/build + vitest, plus 3 integration smokes against compose (upload→report stub, checkout webhook replay, coach stream echo with fake gateway).
- **Error budget practice:** wrong-rate >10% or validation-reject spike auto-alerts → prompt rollback is the documented first response.

### Enforcement Guidelines

CI lints encode the load-bearing rules: `anthropic` import allowed only in `llm/gateway.py`; no raw hex colors in CSS modules (tokens only); no `Money`/price literals outside config; ESLint ban on `fetch` to non-BFF origins; `dotnet format` + `ruff format` enforced. Code review (self, PR-to-main) checklist mirrors this section.

### Pattern Examples

- Entitlement gate (BFF endpoint filter): `group.MapPost("/uploads/init", …).RequireEntitlement(Entitlement.Analysis)` → filter resolves, decrements nothing (usage event written at job dispatch, refunded on validation-fail).
- Credit spend (transactional): insert `usage_events` + `credit_ledger(-1, reason: job_id)` in the dispatch transaction; job validation-failure compensates with `+1 reversal` row — never UPDATE balances.
- Coach relay (BFF): subscribe `coach:{cid}:{mid}` → forward as SSE → on Redis idle >30s, fall back to reading persisted partial message → close with `error` event.

## Project Structure & Boundaries

### Complete Project Directory Structure

Additions/changes to `restructure` (existing layout retained; v1 components frozen in place):

```
components/
├── bff/
│   ├── src/Spectr.Bff/
│   │   ├── Features/
│   │   │   ├── Billing/        (checkout session, portal link, webhook endpoint, reconciliation job trigger)
│   │   │   ├── Entitlements/   (resolver, endpoint filters, usage service)
│   │   │   ├── Coach/          (message POST, SSE relay, conversation CRUD)
│   │   │   ├── Devices/        (anon device issue, claim-on-register hook)
│   │   │   ├── Share/          (token mgmt, share shell HTML, projection DTO)
│   │   │   ├── Affiliates/     (register, stats, CSV export)
│   │   │   └── Admin/          (ops endpoints behind elevated auth: refund trail, bans, flags)
│   │   └── Metrics/            (prometheus-net wiring)
│   ├── src/Spectr.Data/        (+ entities: Subscription, CreditLedgerEntry, UsageEvent, WebhookEvent,
│   │                              Device, ShareToken, Affiliate, Referral, FeatureFlag, LlmCall*, EmailSuppression
│   │                              *LlmCall written by worker via SQL, mapped read-only in EF)
│   └── tests/                  (+ entitlement, webhook idempotency, share projection, claim flow)
├── worker/
│   └── app/
│       ├── actors/             (analyze_audio_job, run_triage, run_specialist, run_reference_analyzer,
│       │                        coach_reply, sweep_retention, send_email, reconcile_billing_probe)
│       ├── llm/gateway.py      (anthropic SDK, semaphore, metering, budgets, grounding helpers)
│       ├── llm/prompts/coach/  (versioned coach prompts)
│       └── validation/         (pre-pipeline magic-byte/duration checks)
├── analysis/
│   └── tools/profile_builder.py  (+ data/reference_library/profiles/{house,techno}_profile.json + methodology md)
├── frontend-spectr-v2/
│   └── src/features/{billing,share,funnel}/ + Phase A–E components per UX spec
infra/
├── compose.prod.yml  ├── Caddyfile  ├── deploy.sh  └── backup.sh
.github/workflows/ci.yml
docs/runbook.md
```

### Architectural Boundaries

1. **BFF↔Worker seam (hard):** DB rows + Dramatiq messages + Redis pub/sub only. BFF stamps tier/entitlement onto jobs; worker never reads billing tables.
2. **LLM boundary (hard):** `llm/gateway.py` is the only Anthropic importer; budgets/metering inseparable from calls.
3. **Money boundary (hard):** Stripe state mutations only via webhook processor; app code reads mirrors/ledgers.
4. **Share boundary (hard):** public surface reads only `ShareReportProjection`; no entity ever serialized raw to `/r/*`.
5. **Frozen-v1 boundary:** `components/api`, `components/frontend`, `components/frontend-spectr` excluded from CI, deploys, and imports by new code (worker's verdict pipeline modules that currently live under `components/api/app/verdict_pipeline` get MOVED into worker ownership — the audit showed worker actors already canonical; the move is file relocation + import fix, scheduled early).
6. **Analysis purity:** `components/analysis` stays a pure library — no network, no DB; worker orchestrates.

### Requirements to Structure Mapping

| FR cluster | Owner |
|---|---|
| FR1–8 analysis/report | existing worker+analysis+frontend results (+ Features/… untouched) |
| FR9–16 verdicts/coach | worker actors + llm/gateway + Features/Coach + frontend CoachChat |
| FR17–20 library/versions | existing + frontend version-compare |
| FR21–24 share | Features/Share + frontend share + Caddy route |
| FR25–28 identity/claim | existing auth + Features/Devices |
| FR29–35 monetization | Features/Billing + Entitlements + Data tables + UpgradeSheet/usage UI |
| FR36–39 genre | analysis tools + profiles + existing phase 6 |
| FR40–43 funnel/affiliate | funnel statics + Features/Affiliates + PostHog wiring |
| FR44 email | send_email actor + Resend + templates |
| FR45–49 ops | Metrics + Grafana/Sentry + Features/Admin + runbook |

### Integration Points

Stripe (Checkout/Portal/Tax/webhooks) ↔ Features/Billing; Anthropic ↔ llm/gateway only; R2 ↔ BFF presigner + worker client + backup.sh; Resend ↔ send_email actor + bounce webhook; PostHog ↔ frontend SDK + BFF server events (claim stitch); Sentry ↔ all three runtimes; ntfy ↔ Grafana alerting.

### File Organization Patterns

Feature-folder colocations everywhere (endpoints+DTOs+service per feature in BFF; component+module.css+test per feature in frontend); one actor per file; append-only tables get no UPDATE repositories (enforced by convention + tests).

### Development Workflow Integration

Local: `docker compose up` (postgres, redis, MinIO) + 3 dev processes (bff `dotnet watch`, worker dramatiq, frontend vite) — mirrors prod topology minus Caddy. Fake gateway mode (`LLM_FAKE=1`) replays golden fixtures for UI work without spend. Stripe CLI webhook forwarding documented in runbook for billing dev.

## Architecture Validation Results

### Coherence Validation ✅

- D1 (worker-owned LLM) + D4 (queue topology) compose: coach actor rides the paid-priority worker — coach latency NFR holds under free-tier load.
- D2 (entitlements in BFF) + D1 (gateway budgets in worker) don't overlap: BFF gates COUNTS (analyses, messages), gateway gates SPEND (tokens/$) — two independent guards, both write to the same telemetry spine (usage_events / llm_calls).
- D3 (presigned direct upload) + D5 (anonymous devices) compose: device cookie present at `/uploads/init`; claim re-parents R2 key ownership via DB rows only (keys are job-scoped, no R2 rename needed).
- D7 (share shell from BFF) + D8 (Caddy) compose: Caddy proxies `/r/*` to BFF, everything else static/SPA — no SSR framework introduced.
- No decision contradicts the frozen-v1 rule; verdict-pipeline relocation (api→worker) is the single planned cross-boundary file move and is explicitly scheduled.

### Requirements Coverage Validation ✅

All 49 FRs map to an owner (table above); all NFR categories have a deciding section: performance (D1 concurrency, D4 pools, D3 direct upload), security (D2 webhook idempotency, D3 presigned scopes, D5 rate limits, secrets in D8), reliability (retries existing, D2 reconciliation, D8 backups+restore-test), scalability (W1 replicas, LLM_MAX_CONCURRENCY config), accessibility (UX spec owns; architecture adds nothing blocking), integration (D2/D3/D6/D7/D9), maintainability (CI gates, runbook, enforcement lints).

### Implementation Readiness Validation ✅

Every [N] FR has: owning folder, named tables/actors/endpoints, and at least one named test in CI gates. Config surface enumerated in `.env.example` list. Known-tricky seams have worked fallbacks (coach relay → poll fallback; pub/sub failure ≠ feature death).

### Gap Analysis Results

Accepted gaps (deliberate, documented): dynamic OG images (post-MVP); Redis pub/sub SSE for job progress stays DB-poll (existing, adequate); admin UI is endpoints + Grafana, not a custom panel; affiliate payouts manual; k8s/multi-node none. Watch-items: R2 multipart presign part-count limits for 250 MB (use ≥16 MB parts — fine); EF mapping of worker-written `llm_calls` (read-only entity, keyless query type acceptable); Dramatiq .NET-side enqueue payload compatibility (already proven on branch per audit — keep message schema frozen).

### Architecture Completeness Checklist

- [x] All FRs/NFRs addressed or explicitly deferred
- [x] Brownfield constraints honored (seams, frozen v1, EF canonical)
- [x] Every new table, actor, endpoint, and config knob named
- [x] Cost control structural (two-guard model) not aspirational
- [x] Solo-operator ops: deploy, backup, restore, alert, runbook all decided
- [x] Enforcement encoded as CI lints, not prose hopes

### Architecture Readiness Assessment

**READY.** Downstream consumers: epics can slice along Features/* + actor additions; no open architectural questions block story writing. First-implementation order recommendation: verdict-pipeline relocation + LLM gateway (D1) → billing skeleton (D2) → storage (D3) → the rest in epic order.

### Implementation Handoff

Next workflow: `bmad-create-epics-and-stories` (consume PRD FR tags + this document's mapping table), then `bmad-check-implementation-readiness` across PRD + UX + architecture + epics before dev.
