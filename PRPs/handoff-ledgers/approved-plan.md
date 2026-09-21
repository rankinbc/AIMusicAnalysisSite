# SPECTR first-impression plan — one-click demo, engineering page, public polish

Worktree `C:/Users/badmin/projects/spectr-solo`, branch `solo`. Never touch the main checkout, `master`, or the other session's `AnalysisCompleteModal.*` edits.

## Context

spectrmix.com is about to go public. A likely first visitor is a software hiring manager: no audio file, no audio vocabulary, ~90 seconds, often a phone first. Today the landing offers "Analyze my track free" (needs a track) and "See pricing" (credits are switched OFF), a static sample report in audio jargon, no link to the code, and nothing explaining how it was built. Everything impressive (Listen page, live fixes, streaming coach) sits behind an upload, a wait and a registration.

Covers items 1, 2, 3, 5, 6, 7 from the review (item 4, hero motion, is out).

**Owner decisions already made:** per-visitor sandbox · fully live coach · demo track decided later (seeding must be track-agnostic) · present SPECTR as a product (no personal byline) · engineering page links the GitHub repo as "open source" · guests may upload ONE track · guard allowlist: I may add exactly `demo.tsx` and `trust.how-its-built.tsx` to the FRONTEND allowlist (no BFF guard change needed).

**Findings that shaped the design**
- A per-user demo already exists: `Services/DemoSeeder.cs` seeds a song on every registration, and the solo spec blesses it. So the demo = an instant **guest account**, not a shared/public report. Today it seeds a 5 s sine tone and no routing plan — so every user's demo report already fires paid LLM triage on a plain GET (`VerdictEndpoints.cs:54-87`).
- With credits off the coach COUNT cap is unlimited (`CoachCapService.cs:46-54`); only the $10 global LLM budget stops it, and coach/specialist calls carry no tier (`coach_actor.py:546`, `verdict_actor.py:229`). Guests must get their own spend lane or a bot can take the coach offline for real users.
- Guest purge would delete shared demo audio: `SHARED_STORAGE_KEYS` is one exact key (`retention_actor.py:94`).
- Listen is hard desktop-gated below 1024 px → phone visitors must land on the results page.
- Landing loads a 728 KB (230 KB gz) entry: full posthog-js (no-op without a key), Sentry, zod (four one-field schemas), and whole pages whose route files export their component.
- README claims "free jobs can't starve paid ones"; prod compose runs `worker-paid` on `coach` only (`infra/compose.prod.yml:138`). The engineering page must claim only what is true; README gets corrected.

## How it will be executed

Two PRPs written to `PRPs/` first (spec + plan each, per project convention), then **subagent-driven development** as for the Listen feature: one implementer at a time in the worktree, fresh reviewer per task, ledger with rulings, a whole-branch review on the most capable model, one fix wave, live browser pass (desktop + 390 px), push, CI. All gates after every edit (BFF `dotnet test --artifacts-path …`, pytest with 127.0.0.1 overrides, frontend tsc/lint/lint:css/lint:focus/build/vitest).

- `PRPs/guest-demo-sandbox.md` (+`-plan.md`) — workstream D
- `PRPs/public-surfaces-polish.md` (+`-plan.md`) — workstream P

## Workstream D — guest demo sandbox

**Design**
- Guest = a real `User` row (`is_guest`, `guest_expires_at`, `guest_device_id`); every ownership join and the `?t=` audio stream work unchanged. Email `guest-{id}@guest.spectr.invalid`, one process-wide bcrypt hash; login/forgot-password refuse guests.
- `POST /api/auth/demo` (anonymous; `/api/auth/` is already guard-allowlisted). Same device re-click RESUMES via the `spectr_device` cookie. **Fails closed**: `demo_enabled` flag → resume lookup → `IRateLimiter` per device + IP → daily DB cap → else 503 with friendly copy.
- Server recognises guests by extending the cached `tver:` lookup (`Program.cs:166-184`) with an in-process claim — JWT unchanged. Frontend learns it from `AuthedUser.isGuest` (AuthContext state, not a never-stale query).
- **Default-deny guest guard**: one endpoint filter on the `/api` group; mutations pass only with `.AllowGuest()`, so future endpoints are blocked automatically. Allowed: coach messages, specialist run, verdict state, fix-rack, rack/viz presets + draft, notes, rating, **and the mix upload + `/versions/{id}/analyze` path, capped at one track** (`guest_uploads_max`), plus a global `guest_analyses_per_hour` arm (fail closed) so guest farms can't bury the single VM. Denied: stems/.als/reference uploads, delete/permanent, billing, account export/delete, email/password, phase rerun, job retry.
- **Fully live coach with a safety net**: per-guest `coach_guest_messages` cap + a separate `llm_budget_guest_usd` lane resolved in the worker from `users.is_guest`; guest spend is excluded from the budget real users depend on. All values are live-tunable feature flags.
- **Track-agnostic snapshot**: `POST /api/admin/demo/snapshot {versionId}` (behind `AdminAuth`) exports ONE real analyzed version — final_json, routing plan, verdict rows incl. fix ops (so "Apply live" works), a coach conversation, fix-rack preset, images, audio — under storage prefix `audio/demo/snapshot/` (never in git: repo is public, rights undecided). `DemoSeeder` loads it when present, remaps ids in one `SaveChanges`, and falls back to the sine-tone seed (now WITH an empty routing plan, fixing the existing paid-triage-on-GET leak). Real registrations get the better demo too.
- Purge: expired guests torn down by the retention sweep via the existing account-deletion path; `is_shared_key()` protects everything under `audio/demo/`.
- Frontend: landing CTA + `/demo` deep link → `AuthContext.startDemo()` (bumps `sessionEpoch` so the boot refresh can't wipe the new session; clears the query cache on user change) → ≥1024 px → `/listen-rack/$versionId`, narrower → results page. Slim guest banner; after the one upload is used, "+ Upload" becomes "Create free account"; a `guest_restricted` 403 anywhere opens one upgrade dialog. v1 "create account" = plain `/register?from=demo` (in-place conversion deferred).
- "No track handy? Use ours" on `/analyze`: optional `file` + `sample=true`, COPIES the snapshot audio to the anon key (the 72 h purge deletes anon keys), keeps the 409 + limits, hidden when no snapshot is installed; writes the current-job cache exactly like a real upload.

**Tasks (sequential)**
- D1 Schema + flags — `User.cs`, migrations `AddGuestUsers`, `SeedDemoFlags`, mirror in `components/shared/aimusic_shared/models.py`.
- D2 Worker — `is_shared_key` in `retention_actor.py` + `account_deletion_actor.py`; new `app/llm/lane.py`; guest ceiling + `exclude_tier` in `llm/budget.py`; tier passed at `coach_actor.py:546`, `verdict_actor.py:229`, `triage_actor.py:132`, `fix_rack_actor.py:62`.
- D3 `Services/DemoSnapshot.cs` (+store, 60 s cache) and `DemoSeeder` snapshot path + fallback routing plan; pin `Demo__SnapshotKey=""` in `TestSupport.cs` baseline.
- D4 Exporter `AdminEndpoints.DemoSnapshot.cs` (refuses un-triaged/degraded analyses; aborts if owner id/email leaks into output).
- D5 `DemoAuthEndpoints.cs` (new file — `AuthEndpoints.cs` is already 781 lines) + refresh-lifetime overloads in `RefreshTokenService.cs`.
- D6 `Auth/GuestGuard.cs`, `CoachCapService` guest branch, one-upload allowance + global analysis arm.
- D7 `Services/AccountTeardown.cs` (extracted from `AccountEndpoints.cs:302-330`) + guest pass in `RetentionSweepScheduler`.
- D8 "Use our sample" — `AnonAnalysisEndpoints.cs`, `GET /api/anon/sample`, `useAnonAnalysis.ts`, `AnalyzePage.tsx`.
- D9 Frontend flow — `AuthContext.tsx`, `fetcher.ts` (`NO_REFRESH_RETRY`), `features/demo/{useStartDemo,DemoLauncher,demoDestination}`, `routes/demo.tsx` (+ the approved allowlist line), analytics events.
- D10 Guest shell — `GuestBanner`, upload-once behaviour in `_app.tsx` + `UnifiedUploadDialog` (mix only for guests), `GuestUpgradeDialog` via `mutation-error-toast.ts`.
- D11 Playwright `smoke-demo.spec.ts` (`LLM_FAKE=1`) + deploy step in `docs/azure-deploy-remaining-work.md`.

**Flags seeded:** `demo_enabled`, `guest_ttl_hours=72` (matches the anon purge), `demo_guests_per_ip_hourly=5`, `demo_guests_daily_cap=300`, `guest_uploads_max=1`, `guest_analyses_per_hour=10`, `coach_guest_messages=20`, `llm_budget_guest_usd=5`, `anon_sample_per_hour_global=20`.

## Workstream P — public surfaces

- **P1 Error + 404 screens** — `components/{NotFoundScreen,RouteErrorScreen}.tsx`, `defaultNotFoundComponent`/`defaultErrorComponent` in `main.tsx:42-51` (error screen reports to Sentry itself), one-shot reload on stale-chunk `vite:preloadError`.
- **P2 Public `creditsEnabled`** — extend the already-anonymous `GET /api/billing/plans` (`BillingEndpoints.cs:74-83`, `DTOs/BillingDtos.cs`); `src/lib/public-plans.ts` `useCreditsEnabled(): boolean|null`, Pricing links **hidden by default** (no flash of a wrong link; provider-free so `PublicChrome` stays static-testable). `/pricing` with credits off → "Free while we launch" state reusing `features/account/plan-copy.ts:17-23`; BFF crawler shell switches too. Page component moves to `features/pricing/`.
- **P3 Chrome, CTA, footer** — `LandingPage.tsx:53` "See pricing" → "Explore the demo" (`/demo`); `PublicChrome` gains "How it's built"; new product-style `components/PublicFooter.tsx` (Product · Engineering · Trust · Account, © SPECTR) replacing the three ad-hoc footers. Updates `landing.test.tsx`, `smoke-first-run.spec.ts`.
- **P4 "How it's built"** at `/trust/how-its-built` (+ Caddy short link `/how-its-built`) — thin route file `routes/trust.how-its-built.tsx` (+ approved allowlist line), component in `features/engineering/` on the `TrustPage` scaffold. Sections: what it is + demo link · architecture diagram as semantic HTML/CSS (no mermaid runtime) · six true decisions (coach has its own worker pool; deterministic genre-relative rule engine before the LLM, LLM severity re-scored; LLM spend capped twice and degrades to rule-based findings; DSP graph changes params not topology, fixes A/B-able and never reset your rack; long jobs never hold a DB transaction; guard suites make removed features impossible to re-add) · numbers as **floors** ("1,000+ frontend tests", "350+ BFF tests", "130+ endpoints", 33 tables, 7-phase pipeline) from `stats.generated.json`, written by `scripts/site-stats.mjs` and re-verified by a test so they cannot rot · CI/security (gitleaks full history, Trivy CRITICAL gate, SHA-pinned actions, rollback on failed health) · honest limits · "Source on GitHub" + CI badge. Copy must avoid the guard's banned phrases ("jobs queued/waiting").
- **P5 Plain-language sample report** — `sample-report.ts` gains `plain` per finding + `plainSummary` (words only — honours the no-invented-numbers rule); always-visible lines (tooltips don't work on phones), LUFS gloss from `glossary-terms.ts`, "see the full report in the demo" link; a pinning test ties the numbers to `schemas/samples/`.
- **P6 Link previews** — `usePageMeta` upserts canonical/`og:url`/`twitter:*` (+`noindex` for 404); `index.html` twitter card + absolute og:image; `public/sitemap.xml`, `robots.txt`; BFF shell for the new page in `PublicSiteEndpoints.cs` + its path in `infra/Caddyfile:23`; a parity test (sitemap ↔ Caddy ↔ BFF shell ↔ route file); fix `trust.no-training.tsx:52`, which still mentions sharing.
- **P7 Bundle diet** — dynamic-import posthog (queue events) and Sentry (buffer ≤20 errors), hand-written validators replacing four zod schemas, move trust/kitchen-sink components out of route files, preload the display font, drop unused `recharts`/`wavesurfer.js`/`ai`, build-size assertion (target ≤400 KB raw / 130 KB gz entry). Correct the README fairness claim here.
- **P8 Phone fixes** — don't mount/animate `LightShow` below 1024 px, when paused, hidden, or reduced-motion (`LightShow.tsx:117-119`, `ListenRackPage.tsx:380`); "back to report" on the desktop-only card; top-nav breakpoint (`_appLayout.module.css`); `.rd-row` override in a hand-written `features/results/results-phone.css`.
- **P9 Small hardening** — Caddy: real 404 for missing `/assets/*`, `no-cache` on HTML; bounded triage wait (`hooks.ts:629-635` exposes `triageTimedOut` → existing `LlmDegradationNotice` + Retry); bff compose healthcheck.
- **P10 Public smoke in CI** — `playwright.public.config.ts` on `vite preview` (no backend), Desktop Chrome + Pixel 7: every public URL has a visible h1, no `pageerror`, no horizontal overflow, unknown URL → 404 screen; new CI job after `frontend`.

## Order

1. P1, P2, P5 (independent quick wins)
2. D1 → D7 (demo backend)
3. D9, D10, D8 (demo frontend)
4. P3 → P4 → P6 (needs `/demo` to exist)
5. P8, P7, P9, P10, D11
6. Whole-branch review → one fix wave → live pass → push → CI

If time runs short, cut in this order: `.rd-row` override, compose healthcheck, Pixel 7 project, lazy Sentry (keep posthog + zod), D8 "use our sample".

## Verification

- Gates green after every task: BFF build + tests, worker pytest (5 accepted env failures only), frontend tsc/lint/lint:css/lint:focus/build/vitest; both no-social guard suites pass with exactly two added allowlist lines.
- BFF tests prove: create / same-device resume / expiry re-mint; limiter exception → 503 (fail closed); daily cap; cross-guest 404s on jobs/audio/verdicts; guard theory (403 envelope on every denied route, allowed routes 2xx, second upload refused); seeded analysis enqueues NO triage (recording `IJobQueue`) for snapshot and fallback; purge removes guests but never an `audio/demo/` key. Worker tests prove the guest cap trips without touching pro/global.
- Live, real browser (jsdom has no layout): logged-out `/demo` on desktop → Listen plays, visualizer draws, "Apply live" A/Bs a fix, coach answers, rack change survives a client-side round trip; at 390 px → lands on results, no horizontal scroll on any public page, Pricing link absent with credits off, no LightShow frames in the Performance panel; unknown URL → 404 screen; build twice with a tab open → one reload. `curl -A Slackbot https://…/trust/how-its-built` returns the BFF shell.
- Lighthouse mobile on `vite preview` before/after P7.

## Needs you (no code — can run in parallel)

1. Pick the demo track (audio you may stream publicly); after deploy, analyze it in prod and run the snapshot export once. Until then `demo_enabled` stays **false** in prod — a sine-tone demo is a worse first impression than none.
2. Glance at `public/og-share.png` — it is the literal first impression on LinkedIn/Slack.
3. Deploy prerequisites unchanged (DNS A record, R2/Resend/Anthropic/GHCR accounts, GitHub secrets).

## Risks / rulings I'm making (cheap to reverse — all are feature flags or copy)

- Guest lane is additive: worst-case monthly LLM spend = global cap + `llm_budget_guest_usd`.
- One guest upload + 10 guest analyses/hour globally: a musician visitor can try their own track, but a guest farm cannot bury the single VM; when the arm trips the upload button explains and offers registration.
- Guest rows can outlive their TTL by up to a day (nightly sweep) — accepted.
- Numbers on the engineering page are floors guarded by a test, so they understate rather than rot.
