# Story 6.1: Landing & Pricing Pages

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- First story of Epic 6 (Free Analyzer Funnel & Public Site). Epic flips to in-progress. -->

## Story

As a skeptical visitor,
I want to see what the product does on a real report and what it honestly costs,
So that I can decide to try it in one scroll.

## Acceptance Criteria

1. **Given** an anonymous visitor at `/`, **Then** a real landing page renders (no more blind redirect-to-login): ambient atmosphere, one-scroll pitch, primary CTA **"Analyze my track free"**, and a live sample-report embed rendering REAL report components with demo data (grade hero + top findings — components, not a screenshot). **Given** an authed user at `/`, **Then** they still land on `/library` (today's behavior for logged-in users preserved).
2. **Given** the pricing page, **Then** it gains the slim public chrome, a **tax-inclusive note**, and the plan terms restated AT the buttons (e.g. "Renews monthly · cancel anytime" under the Pro CTA) — no asterisks anywhere. Existing behavior (anon `GET /api/billing/plans`, `formatCents`, register round-trip, checkout URL validation) unchanged.
3. **Given** funnel pages (landing + pricing), **Then** a shared slim public chrome renders: brand + Pricing + Sign in + "Analyze free" CTA (UX-DR6). Auth pages keep their existing narrow column layout untouched.
4. **Given** a crawler (same UA set as the 7-2 share split), **When** it requests `/` or `/pricing`, **Then** Caddy routes it to a BFF-served static meta shell (title, description, OG tags, canonical) while human requests get the SPA; **And** the SPA sets per-route `document.title` + meta description client-side (landing/pricing). LCP (<2.5 s) is verified at home — headless proxy: the landing route must not import any heavy chunk (wavesurfer/recharts/listen-rack).
5. **Given** the Playwright smoke, **Then** it is UPDATED for the new root behavior (anon `/` → landing with the CTA, not `/login`) and stays green headless; all four frontend gates green; BFF gates green (meta-shell endpoint tests).

## Context — what already exists (reuse, do not rebuild; verified 2026-07-14)

**Routing:**
- Root `/` = `src/routes/index.tsx:4-8` — bare `beforeLoad` with unconditional `throw redirect({ to: '/library' })`. THIS is what the landing replaces. `_app`'s guard bounces anon `/library` → `/login`, so today anon `/` → `/login` (and the smoke pins that — see below).
- `_public` layout (`src/routes/_public.tsx:13-24`) = narrow 380px centered auth column with a SPECTR wordmark — NOT a marketing shell. `pricing.tsx` already escapes it with its own `max-width:1120px` shell (`pricing.module.css:1-8`). Do NOT restructure `_public` — auth pages depend on it.
- Auth state in router context: `_app.tsx:27-38` `beforeLoad` reads `context.auth` (`isLoading` short-circuit pattern). The landing's authed-redirect uses the same context.

**Pricing (AC2 is a POLISH, not a build):**
- `_public/pricing.tsx:24-186` — full working page: anon `GET /api/billing/plans` (the ONLY anon price endpoint, `BillingEndpoints.cs:48` `.AllowAnonymous()`), `PlanCard` components, checkout with `checkout.stripe.com` URL validation, `/register?next=/pricing` round-trip. Prices via `formatCents` (`features/billing/format-price.ts`) — **AR39: never hardcode a price literal**; the lint arm is real.
- `PlansResponse` DTO (`BillingDtos.cs:18-25`): ProMonthlyCents/ProAnnualCents/CreditPack5Cents/CreditPack10Cents/Currency. Display defaults in `Options/PricingDisplayOptions.cs:22-30`.
- Existing honest copy to keep/reuse: "Honest billing. No asterisks." (`pricing.tsx:104-108`); trust line "Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio" (`UpgradeSheet.tsx:156`).

**Sample-report embed material:**
- `GradeHero` (`src/features/results/GradeHero.tsx:15`) — ORPHANED (zero importers) but real and prop-tolerant: `{ grade, score, danceability }`, undefined-safe. Reuse it — this story makes it live again (verify render before relying).
- The share page `r.$token.tsx:74-88,145-178` is the minimal-report pattern: `fj.grade`, `fj.overall_score`, `phase1.bpm/detected_key/lufs`, top-3 verdicts via `GradePill` + `Pill`. Mirror this shape for the embed.
- NO frontend final_json fixture exists. Canonical sample = `schemas/samples/sample1_8aeef3b4.json` (repo root; also the 12-8 BFF DemoAssets source). Bundle a TRIMMED extract (grade/score/bpm/key/lufs + top-3 verdicts only — not the whole file) into the frontend with a provenance comment (same convention as `Spectr.Bff/DemoAssets/demo-final-json.json`).

**SEO/prerender:**
- No meta management exists anywhere (only static `<title>SPECTR</title>` in `index.html`; no OG/description). No SSG plugin in `vite.config.ts`.
- The 7-2 pattern IS the prerender path: `infra/Caddyfile:18-24` `@share_bots` (path `/r/*` + crawler UA regex) → `reverse_proxy bff:5000`; humans fall through to the SPA (`:43-49`). BFF side: `ShareEndpoints.cs` + `ShareReportProjection.cs` render the OG shell. Copy this: `@site_bots` matcher for `/` + `/pricing` (+ trust paths later in 6-2) → new anon BFF endpoint serving a static HTML meta shell per path.
- Docker/deploy gotcha (12-8 lesson): anything the BFF serves at runtime must live INSIDE `components/bff` (`Content Update`, never `Include`, never a repo-root link — MSB3030/NETSDK1022).

**Smoke (WILL break without updating):**
- `playwright/smoke-first-run.spec.ts:53-54` asserts anon `/` → `/login` (header comment line 10 says so too). Update: anon `/` → landing (assert the "Analyze my track free" CTA), then proceed to register via the chrome's Sign in/CTA. `playwright/smoke.spec.ts` hits `/login` directly — unaffected.

**Design system:** tokens in `src/styles/tokens.css` (`--bg #070a12`, `--cyan #00e5b0`, `--violet`, grade + tier tokens); ambient atmosphere ALREADY on `body` (`global.css:54-62` — cyan/violet radial glows + grid, fixed attachment) — the landing inherits it for free. Global primitives `.card/.btn/.pill/.label/.mono`, animations `.fade-up/.fade-in/.pulse-glow`, `prefers-reduced-motion` handled. Fonts self-hosted (Syne + JetBrains Mono) — no external fonts (GDPR lint).

## Tasks / Subtasks

- [x] **Task 1: Slim public chrome (AC: 3)**
  - [x] 1.1 `src/components/PublicChrome.tsx` (+ module.css): brand wordmark (link `/`), Pricing link, Sign in link, "Analyze free" primary CTA. CTA + Sign in target `/register` / `/login` (retarget CTA to `/analyze` in story 6.3 — leave a comment). Sticky top, transparent over the body atmosphere.
  - [x] 1.2 Static-render test: links present with correct hrefs.
- [x] **Task 2: Landing page at `/` (AC: 1)**
  - [x] 2.1 Replace `src/routes/index.tsx`: `beforeLoad` redirects to `/library` ONLY when `context.auth` has a resolved user (mirror the `_app` `isLoading` short-circuit — during silent refresh render the landing, do NOT flash `/login`). Anon renders `LandingPage`.
  - [x] 2.2 `src/features/landing/LandingPage.tsx` (+ module.css): PublicChrome + hero (one-line pitch + sub + "Analyze my track free" CTA) + sample-report embed + a 3-point honesty strip (reuse the trust-line copy) + footer links (Pricing; trust-page slots commented for 6-2). NO heavy imports — keep the route chunk lean (AC4 LCP proxy); do not import from `features/listen*` or anything pulling wavesurfer/recharts.
  - [x] 2.3 `src/features/landing/sample-report.ts`: trimmed demo data extracted from `schemas/samples/sample1_8aeef3b4.json` (grade, overall_score, danceability, bpm, key, LUFS, top-3 verdicts w/ headline+severity) with a provenance comment. Typed const, no `unknown` casts leaking.
  - [x] 2.4 `SampleReportEmbed.tsx`: renders `GradeHero` (revives the orphan) + metadata pills (BPM/key/LUFS via the `r.$token.tsx` idiom) + top-3 finding cards + a "this is a real report" caption linking to register. Static-render test: grade letter, pills, 3 findings, caption all present.
- [x] **Task 3: Pricing polish (AC: 2, 3)**
  - [x] 3.1 Add `PublicChrome` to `pricing.tsx` (keep the route in `_public`; the page already escapes the narrow column — verify layout doesn't double-wrap the wordmark: hide the `_public` wordmark on pricing or render chrome inside the page shell).
  - [x] 3.2 Tax-inclusive note near the price cards ("Prices include VAT where applicable" — single source string) + terms restated at each CTA button: Pro monthly "Renews monthly · cancel anytime", annual "Billed yearly · cancel anytime", credits "One-time · never expires". No price literals (AR39) — terms are copy, prices stay `formatCents`.
  - [x] 3.3 Update/extend the existing pricing tests for the new copy.
- [x] **Task 4: SEO meta (AC: 4)**
  - [x] 4.1 Client: tiny `usePageMeta(title, description)` hook (`document.title` + upsert `<meta name="description">`); apply on landing + pricing. Base OG/description tags added to `index.html` (site-generic).
  - [x] 4.2 BFF: `PublicSiteEndpoints.cs` — anon `GET` shells for `/` and `/pricing` under a dedicated path the edge proxies to (mirror `ShareEndpoints` conventions): static HTML with title/description/OG/canonical per page, no DB access, cache headers. Unit test: both shells 200 + contain OG tags.
  - [x] 4.3 `infra/Caddyfile`: `@site_bots` matcher — path `/` OR `/pricing` AND the same crawler UA regex as `@share_bots` → `reverse_proxy bff:5000`. Do NOT touch the `/r/*` matcher. (Prod-only verification lands on the launch checklist; headless = config review.)
- [x] **Task 5: Smoke + gates (AC: 5)**
  - [x] 5.1 Update `playwright/smoke-first-run.spec.ts`: anon `/` → landing (assert CTA text), navigate to register via chrome, rest of flow unchanged. Update the header comment.
  - [x] 5.2 All four frontend gates + BFF `dotnet build && dotnet test` (new endpoint tests) + headless smoke run against the stack.
- [x] **Task 6: Docs**
  - [x] 6.1 At-home checklist: landing LCP <2.5 s (Lighthouse), visual pass, bot-shell curl check (`curl -A discordbot https://<domain>/` post-deploy — launch checklist cross-ref).

## Dev Notes

- **Do not break the authed `/` → `/library` habit** (AC1). The redirect decision needs `context.auth`; mirror `_app.tsx:27-38`'s `isLoading` handling — but INVERTED default: while loading, show the landing (anon-optimistic). A logged-in user gets a brief landing flash then `/library`; acceptable, note it.
- **`/pricing` must stay a `_public` anon route at the same path** — 6 existing consumers incl. `window.location.assign('/pricing')` full-navs from coach chips (`coach-chat-helpers.ts:25`, `CoachGateInline.tsx:28`).
- **AR39**: zero price literals in JSX. Terms copy ok; numbers only via `usePlans()` + `formatCents`.
- **exactOptionalPropertyTypes**: conditional spreads for optional props in new route/components.
- **Fonts/assets self-hosted only** (no-google-fonts lint runs in `npm run lint`).
- **BFF shell endpoint**: serve from anonymous minimal-API GETs returning `Results.Content(html, "text/html")`; keep HTML as C# raw string constants or an embedded asset INSIDE `components/bff` (12-8 Docker-context lesson). No user data → no XSS surface; still HTML-encode nothing dynamic (there is nothing dynamic).
- **Keep the landing chunk light**: import only ui primitives, `GradeHero`, `GradePill`/`Pill`. Route-level code-split comes free from TanStack file routes.
- **Headless-only** (standing rule): no visible windows; smoke `--headed=false` against compose stack + venv worker (`%TEMP%\spectr-lock-venv`, `LLM_FAKE=1`).

### Project Structure Notes

- New: `src/components/PublicChrome.tsx(+css)`, `src/features/landing/{LandingPage.tsx,SampleReportEmbed.tsx,sample-report.ts,landing.module.css}`, `src/features/landing/__tests__/*`, `components/bff/src/Spectr.Bff/Endpoints/PublicSiteEndpoints.cs`, BFF endpoint tests.
- Modified: `src/routes/index.tsx`, `src/routes/_public/pricing.tsx` (+ tests), `index.html`, `playwright/smoke-first-run.spec.ts`, `infra/Caddyfile`.

### References

- AC source: `PRPs/epics.md` Story 6.1 (FR40, UX-DR24/25/6, SEO strategy).
- Anchors: `src/routes/index.tsx:4-8`, `_public.tsx:13-24`, `_public/pricing.tsx:24-186`, `BillingEndpoints.cs:48`, `BillingDtos.cs:18-25`, `PricingDisplayOptions.cs:22-30`, `GradeHero.tsx:15`, `r.$token.tsx:74-178`, `infra/Caddyfile:18-49`, `ShareEndpoints.cs`, `global.css:54-62`, `smoke-first-run.spec.ts:53-54`, `schemas/samples/sample1_8aeef3b4.json`.
- Prior art: 7-2 (OG shell + bot split), 12-8 (Docker Content gotcha, demo-data provenance convention), 12-5 (honest-UI copy rules).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story workflow)

### Debug Log References

- BFF `MapGet("/")` collision: `Program.cs:597` still had the legacy v1-era root status JSON (`{status:"ok",version:"2.0.0"}`); the new landing shell made `/` ambiguous → 500. Verified zero live consumers (deploy/health/alerting all use `/healthz`; only an ARCHIVED PRP curl-waited on `/`), removed the JSON root. The shell now owns `/`.
- TanStack `Link` outside a RouterProvider crashes `renderToStaticMarkup` ("useRouter must be used inside…"). All new funnel components (and the pricing footer link) use plain `<a href>` — the FeedView static-render idiom; full page nav is fine on funnel entry pages (coach chips already `window.location.assign('/pricing')`).

### Completion Notes List

- **Landing at `/`**: `index.tsx` beforeLoad redirects authed users to `/library` (anon-optimistic during `auth.isLoading` — no login flash; `main.tsx` invalidates the router on auth resolve so the redirect fires a beat later for logged-in users). Anon renders `LandingPage`: PublicChrome + hero + `SampleReportEmbed` + honesty strip + footer. Lean chunk — ui primitives + `GradeHero` only.
- **Sample embed is real components + real data**: `sample-report.ts` hand-trimmed from `schemas/samples/sample1_8aeef3b4.json` (provenance comment; grade F ON PURPOSE — the landing shows the tool finding real problems, framed "real pipeline output · rough mix on purpose / SPECTR doesn't flatter"). Revives the orphaned `GradeHero`.
- **Pricing**: moved `_public/pricing.tsx` → `routes/pricing.tsx` (same `/pricing` path — 6 consumers unaffected; escapes the narrow auth column so PublicChrome renders clean). Added header tax note ("Prices in USD. Tax is calculated and shown at checkout before you pay." — replaces the old buried planLine), terms at the Pro buttons ("Monthly renews monthly · Annual is billed once a year · cancel anytime in two clicks") + credits ("One-time purchase · credits never expire"). `PricingPage` exported for the static-render test.
- **SEO**: `usePageMeta` hook (title + description, restores on unmount) on landing + pricing; base OG/description meta in `index.html`; BFF `PublicSiteEndpoints` (anon, static HTML shells for `/` + `/pricing`, OgShareEndpoints conventions, no DB, no user input, canonical + OG, NO noindex); Caddyfile `@site_bots` matcher (path `/` `/pricing`, same UA regex as `@share_bots`).
- **Smoke updated**: anon `/` now asserts the landing CTA (testid `landing-cta`, exact FR40 label) and clicks it to `/register`; rest of the flow unchanged. PASSING headless 34.7s against the full stack.
- Gates: tsc 0 · lint clean · build ✓ · vitest **788/788** (+7) · BFF build 0 err + **371/371** (SPECTR_REQUIRE_DB=1, +3 shell tests) · smoke green.
- At-home items: LCP <2.5 s Lighthouse on `/`, landing/pricing visual pass, post-deploy `curl -A discordbot https://<domain>/` shell check.

### File List

- `components/frontend-spectr-v2/src/components/PublicChrome.tsx` (A) + `.module.css` (A)
- `components/frontend-spectr-v2/src/features/landing/LandingPage.tsx` (A)
- `components/frontend-spectr-v2/src/features/landing/SampleReportEmbed.tsx` (A)
- `components/frontend-spectr-v2/src/features/landing/sample-report.ts` (A)
- `components/frontend-spectr-v2/src/features/landing/landing.module.css` (A)
- `components/frontend-spectr-v2/src/features/landing/__tests__/landing.test.tsx` (A — 7 tests)
- `components/frontend-spectr-v2/src/lib/usePageMeta.ts` (A)
- `components/frontend-spectr-v2/src/routes/index.tsx` (M — landing + authed redirect)
- `components/frontend-spectr-v2/src/routes/pricing.tsx` (R from `_public/pricing.tsx`, M — chrome/tax/terms/meta/export)
- `components/frontend-spectr-v2/src/routes/pricing.module.css` (R, M — taxNote/buttonTerms)
- `components/frontend-spectr-v2/src/routeTree.gen.ts` (M — generated)
- `components/frontend-spectr-v2/index.html` (M — base meta)
- `components/frontend-spectr-v2/playwright/smoke-first-run.spec.ts` (M — landing step)
- `components/bff/src/Spectr.Bff/Endpoints/PublicSiteEndpoints.cs` (A)
- `components/bff/src/Spectr.Bff/Program.cs` (M — map + legacy root JSON removed)
- `components/bff/tests/Spectr.Bff.Tests/PublicSiteShellTests.cs` (A — 3 tests)
- `infra/Caddyfile` (M — @site_bots)
- `PRPs/sprint-status.yaml` (M), `PRPs/stories/6-1-landing-and-pricing-pages.md` (A/M)

### Change Log

- 2026-07-14 — Story 6.1 implemented: public landing at `/` (authed → /library preserved) with live sample-report embed (real components, real trimmed sample data), slim PublicChrome on landing+pricing, pricing tax/terms polish, SEO via usePageMeta + BFF meta shells + Caddy @site_bots, smoke updated. Removed legacy BFF root status JSON (route collision, zero live consumers). Gates green (vitest 788, BFF 371, smoke 34.7s). Status → review.
- 2026-07-14 — 3-layer code review: 10 patch groups applied (see Senior Review Record). Gates post-patch: vitest 789/789, BFF 371/371, smoke 27.8s. Status → done.

## Senior Review Record (2026-07-14)

_3-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) of `master..story/6-1-landing-pricing`._

**Verdict: APPROVED after patches.** Acceptance Auditor: 5/5 ACs Met, all 15 subtasks verified, File List exact.

**Patched findings (10 groups):**
- **P1 (conversion bug, edge)** — PublicChrome was auth-blind: a LOGGED-IN free user reaching /pricing via the coach upgrade chips or the billing CTA saw "Sign in" + a register-bound "Analyze free" — a duplicate-account dead end mid-upgrade. Fix: new `useOptionalAuth()` (non-throwing) in AuthContext; chrome swaps to "Open library" when a user resolves; authed-variant render test added (AuthContext exported for tests).
- **P2 (SEO, blind+edge)** — `@site_bots` included googlebot/bingbot: search engines index BODY content, and serving them a two-sentence stub while humans get the real page is thin-content/cloaking that would actively hurt ranking. Fix: site matcher is SOCIAL-preview bots only (googlebot/bingbot fall through to the SPA, which they render fine); `/pricing/` trailing-slash added; applebot/redditbot added.
- **P3 (blind+edge)** — shells had no `og:image` (flagship pages unfurled text-only while /r/ share links unfurl rich). Fix: `{origin}/og-share.png` + `summary_large_image` in the shells + og:image in index.html; test asserts it.
- **P4 (blind+edge)** — no Cache-Control (task said "cache headers") AND the anon-identity middleware minted a `Set-Cookie` on every crawler hit — a shared-cache cookie-bleed the moment an edge cache appears. Fix: `Cache-Control: public, max-age=3600` + `Set-Cookie` stripped in the shell handler; both test-asserted.
- **P5** — folded into P2 (trailing slash + UA additions).
- **P6 (edge)** — the site is now deliberately indexable but `/robots.txt` fell through to the SPA as unparseable 200 HTML (Search Console errors). Fix: `public/robots.txt` (Allow / · Disallow /api/).
- **P7 (blind)** — static index.html OG tags are landing-specific and leaked onto every route for JS-executing scrapers. Fix: `usePageMeta` now also upserts `og:title`/`og:description` (restore-on-unmount).
- **P8 (blind+auditor)** — test tightening: grade asserted as element text (`>F<`, not a substring of "Free"); PublicChrome anon test pins absence of "Open library".
- **P9 (blind)** — the old anon `/`→`/login` smoke assertion was the suite's only proof of the `_app` guard; the landing update dropped it. Fix: smoke step 1b visits `/library` anonymously and asserts the `/login` bounce.
- **P10 (record-keeping, auditor+edge)** — epics.md 6.1 AC1 as-built note (GradeHero — "VerdictHero" never existed; crawler-only prerender); README route table `/pricing` fix; nginx.conf prod-only-split comment; findings-shape substitution (tag/text from top_fixes/coached_fixes — the sample has no verdicts array) recorded here.

**Rejected (verified false positives):** authed-redirect-never-fires (main.tsx:53-58 `RouterBridge` invalidates on auth resolve — pre-existing, verified); canonical http:// scheme (ForwardedHeaders enabled in compose.prod.yml:61 + Program.cs:471-482); root-JSON removal blast radius (repo-wide sweep: /healthz everywhere, only an archived PRP curl'd /); landing chunk leanness unenforced (vite `autoCodeSplitting: true` + verified transitive import graph is primitives-only); anon-identity per-hit state (stateless, no DB row — cookie handled in P4).

**Deferred:** authed `/`→`/library` automated coverage (needs an authed router harness; the load-bearing line is `main.tsx:53-58` — noted in deferred-work); human-facing SSG/prerender (story-recorded narrowing: crawler shells + lean SPA chunk; LCP measured at home).

**Gates post-patch:** tsc 0 · lint clean · build ✓ · vitest 789/789 · BFF build + 371/371 (SPECTR_REQUIRE_DB=1) · headless smoke 27.8s.
