# Story 6.2: Trust Pages

Status: review

<!-- Second story of Epic 6. Builds directly on 6.1's funnel machinery (merged master 54e2634). -->

## Story

As a producer protective of unreleased music,
I want the no-training pledge, results-forever, and privacy defaults stated as first-class pages,
So that I can verify the promises before paying.

## Acceptance Criteria

1. **Given** the trust commitments (FR41), **Then** three standalone public pages render (UX-DR26): `/trust/no-training` (the pledge, **versioned** — a visible version + effective date, bump-on-change rule stated), `/trust/results-forever`, `/trust/privacy`. Each uses PublicChrome + usePageMeta, plain-`<a>` navigation, and an index/cross-links between them.
2. **Given** signup and pricing surfaces, **Then** both link the trust pages: register page gains a compact trust-links line; pricing footer links them; the landing footer's commented 6-2 slot is filled.
3. **Given** the pledge content (NFR12), **Then** it documents the ACTUAL Anthropic API configuration truthfully: SPECTR calls the Anthropic API (standard commercial terms — API inputs/outputs not used to train models); **raw audio is never sent to any LLM** — only derived analysis text/metrics from the report; audio lives in SPECTR-controlled storage only. NO claim the code doesn't back (verified: `worker/app/llm/gateway.py:119` plain `AsyncAnthropic` + `messages.create` with text prompts built from final_json — no audio upload path to the LLM exists).
4. **Given** the other two pages, **Then** their claims match shipped behavior: results-forever = AR15 (reports remain accessible after cancellation; raw-audio retention is SEPARATE — free 30d / post-lapse 90d purge, story 3.4 — the page must distinguish reports-kept vs raw-audio-purged honestly); privacy defaults = private-by-default library, share links opt-in + revocable (7.1/7.3), anon device data purged after 72h (4.5), GDPR export + account deletion (4.6), no third-party font/CDN calls.
5. **Given** crawlers, **Then** the three trust paths are added to the BFF meta shells (`PublicSiteEndpoints`) and the Caddy `@site_bots` path list (the 6-1 comment marks the spot); shells carry title/description/OG/canonical, no noindex, Cache-Control, no Set-Cookie (6-1 conventions — the shared `Shell()` helper does this already).
6. **Given** the suite, **Then** static-render tests cover all three pages (version string present on the pledge, key claims present, chrome + links) + the register/pricing/landing link additions; BFF shell tests extended for the three paths; all gates green (frontend four + BFF build/test). Smoke untouched (no flow change).
7. **CONTENT REVIEW GATE**: page copy is drafted by the dev agent and is NOT final until Brian reviews it (at-home checklist item + a `<!-- DRAFT: needs founder review before public launch -->` comment in each page source). No legal-advice claims; plain honest language.

## Context — what already exists (verified 2026-07-14, post-6.1)

- **6-1 machinery (reuse everything)**: `PublicChrome` (auth-aware — `src/components/PublicChrome.tsx`), `usePageMeta` (`src/lib/usePageMeta.ts` — also upserts og:title/description), BFF `PublicSiteEndpoints.cs` (`Shell()` helper already sets Cache-Control + strips Set-Cookie + og:image — add three more MapGets reusing it), `infra/Caddyfile` `@site_bots` (comment: "Extend the path list when 6.2 adds trust pages"; social-preview bots only — keep it that way), `landing/LandingPage.tsx` footer comment slot, `PublicSiteShellTests.cs` Theory (add rows).
- **Route placement**: top-level route files (the 6-1 pricing precedent — NOT under `_public`): `src/routes/trust.no-training.tsx`, `trust.results-forever.tsx`, `trust.privacy.tsx` (TanStack dot-notation → `/trust/no-training` etc.). Shared page scaffold worth extracting: `src/features/trust/TrustPage.tsx` (chrome + title + prose shell) so the three routes are content-only.
- **Register page**: `src/routes/_public/register.tsx` — narrow auth column; add a compact mono trust line under the form ("No AI training on your audio · reports stay yours · [trust pages →]"). Do NOT restructure the auth layout.
- **Fact sources for truthful copy**: LLM gateway `worker/app/llm/gateway.py:110-119` (plain Anthropic SDK; prompts are text from final_json — grep `build_prompt`/verdict_lib to confirm no audio bytes); retention `worker/app/retention_actor.py` (30d free / 90d post-lapse, SHARED_STORAGE_KEYS excluded, reports NEVER deleted); AR15 results-forever (billing copy "Reports stay yours forever — even after you cancel", `pricing.tsx`); GDPR `AccountEndpoints` (`/me/export`, `/me/delete`); share revocation 7.3; anon purge 72h (4.5 worker actor); fonts self-hosted (global.css).
- **Versioning the pledge**: a `PLEDGE_VERSION = '1.0'` + effective-date const in the page source, rendered visibly; bump rule stated in the page ("changes bump the version and are noted here"). No DB — the page IS the versioned artifact (git history = audit trail).

## Tasks / Subtasks

- [x] **Task 1: Trust page scaffold + three pages (AC: 1, 3, 4, 7)**
  - [x] 1.1 `src/features/trust/TrustPage.tsx` (+ module.css): PublicChrome + `usePageMeta` + title/updated-line + prose children + cross-links footer to the other two pages. Plain `<a>`.
  - [x] 1.2 `/trust/no-training` — the versioned pledge (PLEDGE_VERSION + effective date + bump rule). Content per AC3 facts ONLY. `<!-- DRAFT: needs founder review -->`.
  - [x] 1.3 `/trust/results-forever` — AR15 + the honest raw-audio-retention distinction (AC4). DRAFT comment.
  - [x] 1.4 `/trust/privacy` — privacy defaults (AC4 list). DRAFT comment. This is a plain-language defaults page, NOT a legal privacy policy — say so on the page and link nothing that doesn't exist.
- [x] **Task 2: Link surfaces (AC: 2)**
  - [x] 2.1 Landing footer: fill the commented slot with the three links.
  - [x] 2.2 Pricing footer: add trust links line.
  - [x] 2.3 Register page: compact trust line under the form (links → /trust/no-training primarily).
- [x] **Task 3: Crawler shells (AC: 5)**
  - [x] 3.1 `PublicSiteEndpoints.cs`: three more MapGets via the existing `Shell()` (title/description per page).
  - [x] 3.2 Caddyfile `@site_bots` path list += `/trust/no-training /trust/results-forever /trust/privacy` (+ trailing-slash variants per the 6-1 lesson).
- [x] **Task 4: Tests + gates (AC: 6)**
  - [x] 4.1 `src/features/trust/__tests__/trust.test.tsx`: three pages render (pledge version visible, key claims: "never sent to any LLM"-class line, reports-after-cancel line, private-by-default line), chrome present, cross-links; register/pricing/landing link assertions.
  - [x] 4.2 `PublicSiteShellTests` Theory rows for the three paths.
  - [x] 4.3 Frontend four gates + BFF build/test. Smoke NOT rerun (no flow change) unless routing files force it.
- [x] **Task 5: Docs (AC: 7)**
  - [x] 5.1 At-home checklist: founder copy review of all three pages BEFORE public launch (blocking item, cross-ref launch-checklist Security & privacy section); visual pass.
  - [x] 5.2 `docs/launch-checklist.md`: add a line under Security & privacy — "Trust pages copy reviewed + approved (6.2 DRAFT markers removed)".

## Dev Notes

- **Truth discipline is the whole story**: every claim must trace to shipped code. If a fact can't be verified in the repo, it doesn't go on the page. The AC3/AC4 fact lists were pre-verified at story creation; re-verify anchors before writing copy.
- **No legal cosplay**: these are plain-language commitment pages (UX-DR26), not Terms of Service / Privacy Policy legal documents. Do not title them as legal docs; the privacy page states it's a defaults summary. (Real ToS/Privacy-Policy remain a launch-checklist item for Brian — note it in deferred-work.)
- **DRAFT markers must survive review patches** — they come out only when Brian approves copy (launch checklist), not when code review passes.
- Keep each trust page in the landing-lean import class (PublicChrome + usePageMeta + css only).
- Headless-only (standing rule).

### References

- AC source: `PRPs/epics.md` Story 6.2 (FR41, UX-DR26, NFR12 at epics.md:124).
- Anchors: `PublicSiteEndpoints.cs` (Shell helper), `Caddyfile` @site_bots, `PublicChrome.tsx`, `usePageMeta.ts`, `LandingPage.tsx` footer slot, `register.tsx`, `pricing.tsx` footer, `gateway.py:110-119`, `retention_actor.py`, `AccountEndpoints.cs`, `landing.test.tsx` (test idiom), `PublicSiteShellTests.cs`.
- Prior art: 6-1 (all mechanics + review lessons: social-bots-only, trailing slashes, cache/set-cookie handled in Shell()).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story workflow)

### Debug Log References

- Re-verified the no-audio-to-LLM claim before writing pledge copy: `verdict_lib` + `coach_lib` contain zero audio-file/bytes/base64 references — prompts are text from final_json only. Gateway is plain `AsyncAnthropic` (`gateway.py:110-119`).
- Caught + fixed a would-be false claim in my own draft: "product analytics are first-party" is FALSE (Sentry + PostHog from 10.3 are third-party). Rewrote as honest disclosure ("error monitoring (Sentry) and product analytics (PostHog)… no advertising trackers, data never sold") and test-pinned both names so the disclosure can't silently vanish.

### Completion Notes List

- Three pages via a shared `TrustPage` scaffold (chrome + meta + prose + cross-links). Pledge exports `PLEDGE_VERSION='1.0'` + effective date, rendered visibly with the bump rule; page-as-versioned-artifact (git history = audit trail).
- Results-forever leads with reports-never-expire, then the honest raw-audio distinction (30d free / 90d post-lapse; report always survives). Privacy page explicitly disclaims legal-policy status.
- Link surfaces: landing footer (3 links), pricing footer line, register `trustLine` (auth.module.css class — no inline styles).
- BFF: three MapGets reusing the 6-1 `Shell()` (Cache-Control/Set-Cookie-strip/og:image inherited); Caddy path list extended incl. trailing-slash variants.
- All DRAFT markers in place (founder review = launch-checklist gate, line added there).
- Gates: tsc 0 · lint clean · build ✓ · vitest **795/795** (+6) · BFF build + **374/374** (+3 Theory rows). Smoke not rerun — no flow change (routes additive).

### File List

- `components/frontend-spectr-v2/src/features/trust/TrustPage.tsx` (A) + `trust.module.css` (A)
- `components/frontend-spectr-v2/src/routes/trust.no-training.tsx` (A)
- `components/frontend-spectr-v2/src/routes/trust.results-forever.tsx` (A)
- `components/frontend-spectr-v2/src/routes/trust.privacy.tsx` (A)
- `components/frontend-spectr-v2/src/features/trust/__tests__/trust.test.tsx` (A — 6 tests)
- `components/frontend-spectr-v2/src/features/landing/LandingPage.tsx` (M — footer links)
- `components/frontend-spectr-v2/src/routes/pricing.tsx` (M — footer links)
- `components/frontend-spectr-v2/src/routes/_public/register.tsx` (M — trust line) + `auth.module.css` (M — trustLine)
- `components/bff/src/Spectr.Bff/Endpoints/PublicSiteEndpoints.cs` (M — 3 shells)
- `components/bff/tests/Spectr.Bff.Tests/PublicSiteShellTests.cs` (M — 3 rows)
- `infra/Caddyfile` (M — trust paths)
- `docs/launch-checklist.md` (M — founder copy-review gate)
- `PRPs/sprint-status.yaml` (M), `PRPs/stories/6-2-trust-pages.md` (A/M)

### Change Log

- 2026-07-14 — Story 6.2 implemented: three trust pages (versioned pledge / results-forever w/ honest retention split / privacy defaults w/ honest Sentry+PostHog disclosure), links on landing/pricing/register, crawler shells + Caddy paths, launch-checklist founder-review gate. Gates green (vitest 795, BFF 374). Status → review.
