# Public surfaces polish — design spec (Workstream P)

_Status: binding design authority for `PRPs/public-surfaces-polish-plan.md`._
_Written 2026-09-20 against `solo` @ `915732d`. Every code claim below was
re-verified in the working tree; where the planning reports disagree with the
code, the code wins and the disagreement is listed in §6._
_Sibling workstream: `PRPs/guest-demo-sandbox.md` (the one-click guest demo,
route `/demo`). This spec links TO `/demo`; it never implements it._

---

## 1. The problem

spectrmix.com is about to go public. A likely first visitor is a **software
hiring manager**: no audio file, no audio vocabulary, about ninety seconds,
and very often a phone first and a laptop second. Today that visitor gets:

- a landing whose only two buttons are "Analyze my track free" (needs a track
  they don't have) and "See pricing" — while the credit system is **switched
  off** (`20260723180200_AddCreditsEnabledFlag.cs:21` seeds `'false'`), so
  the pricing page describes plans nobody can buy
  (`features/landing/LandingPage.tsx:50-53`, `components/PublicChrome.tsx:26`);
- a sample report in audio jargon — "−13.3 LUFS", "0.0 dBTP"
  (`features/landing/sample-report.ts:27-48`);
- nothing that says how it was built, and no route to the code;
- a bare "Not Found" string on any mistyped URL and a full-page
  "Something broke." on any render error (`main.tsx:42-51,75-84`;
  `routes/__root.tsx` has neither `notFoundComponent` nor `errorComponent`);
- a 728 KB (≈230 KB gz) entry script on every route, including the landing;
- on a phone, a full-viewport animation painting behind a card that says the
  page is desktop-only (`ListenRackPage.tsx:380`, `LightShow.tsx:15-122`);
- link previews without a Twitter card or canonical for SPA-rendered visits,
  and no sitemap (`index.html:14-20`, `lib/usePageMeta.ts:41-61`, `public/`).

The owner's direction: present **SPECTR as a product** — no personal byline
anywhere on the site. The engineering page may link the public GitHub repo as
"open source". Hero motion (review item 4) is **out of scope**.

---

## 2. Decisions

Binding. Each carries its rationale and what it costs if it is wrong.

### D1 — Ten tasks, three of them independent of the demo

**Decision.** P1 (error/404), P2 (public `creditsEnabled`), P5 (plain-language
sample) run first and depend on nothing. P3 → P4 → P6 run after the sibling
workstream's D9 has shipped `/demo`. P8, P7, P9, P10 close.
**Rationale.** P3 points the landing's secondary CTA at `/demo` and P5 links
to it; shipping them before the route exists would put a dead end on the
first screen. Until D9 lands, P1's 404 screen is what catches `/demo`.
**Cost if wrong.** Re-ordering is free — no task's code depends on D9's code,
only on the URL existing.

### D2 — Product voice; the repo link lives on ONE page

**Decision.** No personal name, avatar, "built by" or résumé link anywhere.
The footer is a product footer ("© {year} SPECTR"). The GitHub repository is
linked **only** from the engineering page, labelled "Source on GitHub", with a
second text link "CI runs on every push →" to the Actions page. No hot-linked
badge image.
**Rationale.** Owner's answer ("SPECTR like it's a product"; repo link "on the
engineering page only"). A hot-linked `badge.svg` would be the site's only
unconditional third-party request — fonts are self-hosted on purpose
(`index.html:8-10`, `scripts/check-no-google-fonts.mjs`) and PostHog/Sentry are
key-gated.
**Cost if wrong.** One `<img>` tag to add.

### D3 — The engineering page is `/trust/how-its-built`

**Decision.** Route file `src/routes/trust.how-its-built.tsx` (≈8 lines);
the component lives in `src/features/engineering/`. It reuses the `TrustPage`
scaffold, generalised by two optional props (`eyebrow`, `updated`) and a
`path: string`. Caddy gains `redir /how-its-built /trust/how-its-built`.
**Rationale.** The BFF guard already allowlists the `/trust/` prefix
(`NoSocialSurfaceTests.cs:53-60`), so the crawler shell needs no guard edit;
the only guard edit is the owner-approved single line in
`no-social-surface.test.ts` `ALLOWED_ROUTE_FILES`. A route file that *exports
its page component* is not code-split (that is how `pricing.tsx` and the trust
pages ended up in the entry chunk), hence the thin file.
**Cost if wrong.** Moving to a top-level URL needs one BFF guard entry.

### D4 — The page claims only what the repo proves (outline in §3)

**Decision.** Every sentence on the page maps to a `path:line` in §3. Two
README claims are **not** repeated: "free-tier jobs can't starve paid ones"
(false for the deployed stack — `infra/compose.prod.yml:137-139` runs
`worker-paid` on `coach` only and `:153-156` has `worker-free` drain both
analysis lanes) and "SHA-pinned actions" (only the Trivy action is pinned —
`ci.yml:241,248,255`; `actions/checkout@v5` etc. are tags). P7 corrects
README lines 49 and 63.
**Rationale.** A technical reader will open the repo. One false claim
discredits the page.
**Cost if wrong.** None — understating is the safe direction.

### D5 — Numbers are floors, recounted by a test

**Decision.** `src/features/engineering/stats.generated.json` holds hand-round
**floors**; the page prints them as "150+". `scripts/site-stats.mjs` recounts
from the repo with the rules in §3.3 (`--json` prints counts; `--write`
re-floors). `site-stats.test.ts` runs the script and fails if any floor exceeds
its recount. Floors only need touching when a count *drops*.
**Rationale.** `infra/Dockerfile.web:12-15` copies only the frontend into the
build, so counts cannot be computed at build time; exact numbers rot on the
next commit; floors never overstate.
**Cost if wrong.** The page understates by up to one rounding step.

### D6 — A logged-out page learns `creditsEnabled` from `/api/billing/plans`, and Pricing is hidden until it says `true`

**Decision.** `PlansResponse` gains `bool? CreditsEnabled` (JSON
`creditsEnabled`). Resolution lives in a new `Services/PublicCredits.cs`:

```csharp
public static async Task<bool?> ResolveAsync(
    IConfiguration config,
    Func<CancellationToken, Task<Dictionary<string, string>>> loadFlags,   // callers pass entitlements.GetFlagsAsync (60 s cache)
    ILogger logger, CancellationToken ct)
// 1. config["Credits:Enabled"] non-empty → EntitlementService.CreditsEnabled(config, empty) — loadFlags is NOT called
// 2. else EntitlementService.CreditsEnabled(config, await loadFlags(ct))
// 3. any exception → log warning, return null ("unknown")
```

Frontend: `src/lib/public-plans.ts` exports `loadPublicPlans()` (one request
per page load, memoised, **never rejects**) and `useCreditsEnabled():
boolean | null` — `true`/`false` only when the server said so, otherwise
`null`. `src/components/PricingLink.tsx` renders the `/pricing` anchor **only
when the hook returns `true`**. Every public Pricing link goes through it:
`PublicChrome`, the landing footer, the `TrustPage` footer (both replaced by
`PublicFooter` in P3). No QueryClient — `PublicChrome` must stay provider-free
(`PublicChrome.tsx:9-14`).
**Rationale.** The endpoint is already anonymous and guard-allowlisted
(`BillingEndpoints.cs:48`, `NoSocialSurfaceTests.cs:58`). Hidden-by-default
means the launch state (credits off) never flashes a wrong link; with credits
on, the link appears at the left of a right-aligned nav, so nothing shifts.
Step 1 keeps `PublicSiteShellTests` Postgres-free (the suite pins
`Credits__Enabled=true`).
**Cost if wrong.** With credits on, the Pricing link appears one fetch late.

### D7 — `/pricing` tells the truth in all four states

**Decision.** The page component moves to `src/features/pricing/`
(`routes/pricing.tsx` becomes a thin shell). States:

| `loadPublicPlans()` result | View |
|---|---|
| pending | `PricingLoadingView` — chrome, "Pricing" heading, skeleton; no prices, no plan copy |
| `creditsEnabled === true` | `PricingPlansView` — today's markup, moved verbatim |
| `creditsEnabled === false` | `PricingOffView` |
| `null` / flag unknown | `PricingLoadingView` with "Pricing couldn't load — refresh to try again." |

`PricingOffView` copy: eyebrow "Pricing"; h1 **"Free while we launch."**; body
"Paid plans are switched off — unlimited analyses, full coach, every
specialist." (the wording already used at `features/account/plan-copy.ts:20-21`);
buttons "Analyze a track" → `/analyze` and "Explore the demo" → `/demo`; text
link "Your reports stay yours" → `/trust/results-forever`. The BFF crawler
shell `PricingShell` switches its description/heading/body on the same
resolver (title stays "Pricing — SPECTR", so `PublicSiteShellTests` rows hold).
**Rationale.** The page stays reachable (old links, Stripe return pages,
`register?next=/pricing`) without advertising plans that cannot be bought.
**Cost if wrong.** Copy only.

### D8 — Landing CTA, chrome and one shared footer

**Decision.**
- Landing secondary CTA "See pricing" → **"Explore the demo"**, `href="/demo"`,
  `data-testid="landing-demo-cta"`, event `demo_cta_clicked {source:'landing'}`.
  If D9 already added a landing demo CTA, P3 leaves exactly one.
- `PublicChrome` nav: "How it's built" (hidden ≤ 480 px), `<PricingLink>`,
  then the existing Sign in / Analyze free (or Open library).
- New `src/components/PublicFooter.tsx` replaces the three ad-hoc footers
  (`LandingPage.tsx:69-77`, `TrustPage.tsx:36-41`, pricing footer links).
  Groups: **Product** (Analyze a track, Explore the demo, `<PricingLink>`),
  **Engineering** (How it's built), **Trust** (the three trust pages),
  **Account** (Sign in, Create account — or Open library when authed), then
  "© {year} SPECTR". `TRUST_PAGES` moves to `features/trust/trust-pages.ts`
  (breaks the import cycle) and is re-exported from `TrustPage.tsx`.
**Cost if wrong.** Copy and one component.

### D9 — The sample report is translated, not tooltipped

**Decision.** `SampleFinding` gains `plain: string`; `SampleReport` gains
`plainSummary: string`. The lines are **always visible** under each finding,
prefixed "In plain English". One LUFS gloss is rendered from the existing
`GLOSSARY` entry (`features/results/glossary-terms.ts:8`) — *not* via
`<Glossify>`, whose CSS lives in the generated 133 KB `.rdx` sheet. A link
"See a full report in the demo →" (`/demo`) joins the existing register link.
Copy (binding; words only — **no digits**, honouring `sample-report.ts:1-9`):

- `plainSummary`: "In plain English: this rough mix is too hot at the top,
  crowded at the bottom and unsteady from side to side — three fixable
  problems, each with a concrete next step."
- TRUE PEAK: "The loudest moments touch the digital ceiling. Streaming
  services re-encode every upload, and that pushes those moments into audible
  distortion."
- LOW END: "Too much energy is piled up in the bass, so the kick and the
  bassline blur together instead of hitting separately."
- STEREO: "The track drifts between wide and narrow for no musical reason, so
  it feels unsteady on headphones and thin on a phone speaker."

A pinning test reads `schemas/samples/sample1_8aeef3b4.json` and asserts grade
`F`, `round(overall_score) = 42`, `danceability_score = 20`,
`round(phase1.bpm) = 71`, `phase1.lufs.toFixed(1) = -13.3`,
`phase1.detected_key = C#`.
**Rationale.** Hover tooltips do not exist on a phone; a manager cannot judge
"−13.3 LUFS".
**Cost if wrong.** Copy.

### D10 — Errors and unknown URLs keep the product on screen

**Decision.** `createRouter` gets `defaultNotFoundComponent: NotFoundScreen`
and `defaultErrorComponent: RouteErrorScreen` (`main.tsx:42-51`). Both render
`PublicChrome`, a heading, one sentence and two links (Home, Analyze a track;
error screen adds "Reload page"). `RouteErrorScreen` reports through
`reportError(err)` (new, in `lib/sentry.ts`) because the router's boundary
catches before `Sentry.ErrorBoundary` sees anything. **Stale chunks:**
`lib/chunk-reload.ts` reloads the page **once per five minutes** (guarded by
`sessionStorage['spectr:chunk-reload-at']`; if storage is unavailable it does
not reload at all) when Vite fires `vite:preloadError` or when the caught
error matches `STALE_CHUNK_RE`. The root fallback in `main.tsx` moves to
`components/AppCrashFallback.tsx` (tokens, no inline hex).
**Rationale.** A deploy while a tab is open turns the next navigation into a
failed dynamic import; one guarded reload is the fix, an unguarded one is a
loop.
**Cost if wrong.** A user sees the error screen instead of a silent reload.

### D11 — One source of truth for "which pages are public"

**Decision.** `public/sitemap.xml` lists `/`, `/analyze` and the four trust
paths (not `/pricing`, not `/demo`) as absolute `https://spectrmix.com/…` URLs;
`robots.txt` gains `Sitemap:` and `Disallow: /demo`. A parity test asserts
that every sitemap path (a) appears in the Caddy `@site_bots` path line with
and without trailing slash (`infra/Caddyfile:23`), (b) has a `path: "…"` shell
in `PublicSiteEndpoints.cs`, (c) has a route file. `usePageMeta(title,
description?, opts?: { path?: string; noindex?: boolean })` additionally
upserts `<link rel="canonical">`, `og:url`, `twitter:title`,
`twitter:description` and (for 404) `robots=noindex`, restoring all on unmount.
`index.html` gains `twitter:card=summary_large_image` and `twitter:image`; it
gets **no** static canonical (it would be wrong on every non-root path).
`trust.no-training.tsx:51-53` stops mentioning sharing ("read only by the
analysis pipeline and your own playback") and `trust.test.tsx:26` follows.
**Rationale.** Crawlers never run the SPA (`Caddyfile:16-28`); a page that is
in one list and not the others silently fails to unfurl.
**Cost if wrong.** A red test naming the missing entry.

### D12 — Bundle diet: ≤ 400 KB raw / ≤ 130 KB gz entry

**Decision.** (1) `posthog-js` becomes a dynamic import made only when
`VITE_POSTHOG_KEY` is set, with a ≤ 50-call queue flushed on load.
(2) `@sentry/react` becomes a dynamic import made only when `VITE_SENTRY_DSN`
is set; `reportError` buffers ≤ 20 errors; `main.tsx` uses a local
`AppErrorBoundary` class. (3) The four one-field zod schemas
(`routes/_public/{login,register,reset-password,verify-email}.tsx`) become
hand-written `validateSearch` functions; `zod` leaves `package.json`.
(4) Trust and kitchen-sink page components move out of their route files
(tests follow). (5) `index.html` preloads the Syne woff2. (6) Unused
`recharts`, `wavesurfer.js`, `ai` leave `package.json`. (7)
`scripts/check-bundle-size.mjs` fails the build when the entry exceeds the
target. README lines 49 and 63 are corrected here.
**Rationale.** Measured contents of the entry: posthog ≈ 220 KB raw, Sentry,
zod, sonner, React DOM, TanStack, plus whole pages exported from route files.
**Cost if wrong.** Lazy Sentry can miss an error thrown before the SDK loads —
hence the buffer.

### D13 — Phone rules

**Decision.** `LightShow` decides for itself: it renders nothing below
1024 px and draws **one static frame** (redrawn on resize, no animation loop)
under `prefers-reduced-motion`. It keeps animating while paused on desktop
(that dimmed idle state is the design — `LightShow.tsx:1-4`); hidden tabs need
no code, browsers already suspend `requestAnimationFrame` there. The desktop-only
card gains "← Back to the report". The app top nav gets a ≤ 640 px breakpoint.
`.rd-row` (`redesign-v3-tabs.css:924`, six fixed columns ≈ 726 px) gets a
phone override in a new hand-written `features/results/results-phone.css`.
**Cost if wrong.** Visual only; each is one rule.

### D14 — Small hardening

**Decision.** Caddy: `/assets/*` is served **without** the SPA fallback (a
missing hashed asset is a real 404, not `index.html` with a JS MIME error) and
HTML gets `Cache-Control: no-cache`. Verdict triage: a new
`useTriageTimedOut(data)` (in `src/api/verdict-polling.ts`) starts a timer
while triage is pending and fires once the existing poll budget is spent
(25 polls × 3 s, `api/hooks.ts:629-635`, plus 5 s grace) — a timer, because
`ReportView` reads only `data` and structurally identical polls do not
re-render it. `ReportView` then renders the existing `LlmDegradationNotice`
with a client-only reason `'triage_timeout'` ("AI specialists are taking
longer than expected — showing rule-based findings for now. Reload the page to
check again."). **No retry button** — that component's documented stance
(`LlmDegradationNotice.tsx:10-12`). Compose: a `healthcheck` on `bff`
(`curl /healthz`), **without** making Caddy depend on it.
**Rationale.** Gating the edge on BFF health would turn a degraded API into a
dead site.
**Cost if wrong.** None of these changes user data.

### D15 — A backend-free public smoke runs in CI on two viewports

**Decision.** `playwright.public.config.ts` (own `testDir:
./playwright-public`, `vite preview` on port 4174, projects Desktop Chrome +
Pixel 7). For `/`, `/analyze`, `/pricing`, the four trust paths, `/login`,
`/register`: a visible `h1`, zero `pageerror` events, and
`documentElement.scrollWidth <= clientWidth`. `/definitely-not-a-page` shows
the 404 screen. New CI job `public-smoke` after `frontend`.
**Rationale.** The existing specs need the full stack and never run in CI
(`ci.yml:125-156`); this one needs only the built SPA and catches exactly the
first-visit failures (blank page, overflow, missing 404).
**Cost if wrong.** ≈ 3 CI minutes.

### D16 — Copy guardrails (apply to every task)

Shipped source must not match the frontend guard's banned regexes
(`no-social-surface.test.ts:57-81`) — notably `jobs? waiting|jobs? queued`,
`queueDepth`, `\bfollowers\b`, `isPublic`, `>pub<`; BFF shell copy must not
match `NoSocialSurfaceTests.cs:121-123` (the bare substring `invite` among
others). No `N.99` literal outside `src/config/**` (`lint:prices`). No `*`
anywhere on `/pricing` (`landing.test.tsx:96`). No digits in the plain-language
sample lines.

---

## 3. "How it's built" — binding outline

Eyebrow "Engineering" · h1 **"How SPECTR is built"** · meta description: "The
architecture, the decisions and the guard rails behind SPECTR — a .NET BFF, a
Python analysis worker and a React audio workstation."

### 3.1 Sections and the claim each makes

| # | Section | Claim on the page | Proof |
|---|---|---|---|
| 1 | What it is | Upload a track; a measurement pipeline grades it; a rule engine and AI specialists explain what to fix; you hear each fix live. Link: "Explore the demo" → `/demo` | `README.md:20-24` |
| 2 | Architecture | Browser talks only to the BFF; work is enqueued to Redis and consumed by a Python worker; results land in PostgreSQL. "No HTTP hop between the services — the BFF writes the worker's queue format directly." | `README.md:30-42`, `CLAUDE.md` (dramatiq wire format) |
| 3a | Decision | "The language split is the architecture" — transactional work in .NET, compute in Python | `README.md:60` |
| 3b | Decision | "Coach chat has its own worker, so a reply never sits behind a running analysis." | `infra/compose.prod.yml:137-139`; four queues `Program.cs:614` |
| 3c | Decision | "Rules first, model second." A deterministic, genre-relative rule engine runs on every analysis; model verdicts are schema-validated and their priority is recomputed by a formula, never trusted | `worker/app/verdict_lib/rule_engine.py:11-13,146`; `shared/aimusic_shared/verdicts/scoring.py:44-75`; `README.md:64` |
| 3d | Decision | "AI spend is capped twice" — a per-plan ceiling and an operator ceiling; when either trips the report falls back to rule-based findings and says so | `worker/app/llm/budget.py:103,168-174`; `compose.prod.yml:135-136`; `LlmDegradationNotice.tsx:18-31` |
| 3e | Decision | "Long jobs never hold a transaction" — claim and commit, compute with no session open, write in a fresh session | `worker/app/tasks_dramatiq.py:151-155` |
| 3f | Decision | "Fixes are auditioned, never imposed." EQ, compression, saturation and width are always wired in, so switching a fix on changes parameters — no gap when you A/B. Un-applying restores the rack you had, never factory defaults | `CLAUDE.md` (Listen DSP chain); `features/listen-rack/useFixOverlay.ts:2-9,33` — **implementer confirms the "always wired in" sentence in `features/listen/useAudioGraph.ts` or drops it** |
| 3g | Decision | "Removed features stay removed" — two guard suites fail the build if a removed surface reappears | `no-social-surface.test.ts:18-81`; `NoSocialSurfaceTests.cs:33-60` |
| 4 | By the numbers | the floors of §3.3, plus fixed facts: a seven-phase pipeline (`progress-phases.ts:10-18`), four named queues (`Program.cs:614`) | see §3.3 |
| 5 | CI and security | Five CI jobs; secrets scan over the **full git history** with a checksum-verified scanner; integration tests against real PostgreSQL and Redis; container images are scanned and a CRITICAL finding blocks the push; deploys verify health and roll back automatically | `ci.yml:43-59` (`fetch-depth: 0`, `sha256sum -c`), `:61-124`, `:211-260`; `infra/deploy.sh:38-53,75-90` |
| 6 | Known limits | Analysis lanes share one worker pool on a single VM; ML stem separation is off by default; the pitch tool couples pitch and tempo; audio streaming uses a short-lived token in the URL | `compose.prod.yml:153-156`; `README.md:120-122` |
| 7 | Source | "SPECTR is open source." → "Source on GitHub" + "CI runs on every push →" | `https://github.com/rankinbc/AIMusicAnalysisSite`, `…/actions/workflows/ci.yml` |

### 3.2 Diagram

Semantic HTML: `<ol>` of five nodes (Browser · BFF · PostgreSQL + Redis ·
Python worker · LLM provider) with a one-line role each and CSS connectors; a
column below 720 px, a row from 720 px. No SVG text, no runtime dependency.

### 3.3 Counting rules (script and test share them by construction — the test runs the script)

Root = repo root. Directories named `node_modules`, `dist`, `bin`, `obj`,
`.venv`, `venv`, `__pycache__` are skipped.

| Key | Rule | 2026-09-20 | Floor |
|---|---|---|---|
| `frontendTestFiles` | files under `components/frontend-spectr-v2/src` matching `\.test\.tsx?$` | 154 | 150 |
| `frontendTestCases` | in those files, matches of `^\s*(?:it|test)(?:\.each\b[^\n]*?)?\(` (multiline) | 953 | 950 |
| `bffTestClasses` | files under `components/bff/tests` ending `Tests.cs` | 57 | 55 |
| `bffTestCases` | in `components/bff/tests/**/*.cs`, matches of `^\s*\[(?:Skippable)?(?:Fact|Theory)\b` | 356 | 350 |
| `pythonTestFiles` | `test_*.py` under `components/{worker,analysis,shared,workerdash}` | 148 | 140 |
| `endpoints` | in `components/bff/src/Spectr.Bff/Endpoints/*.cs`, matches of `\.Map(?:Get|Post|Put|Patch|Delete)\(` | 138 | 130 |
| `migrations` | `components/bff/src/Spectr.Data/Migrations/*.cs` excluding `*.Designer.cs` and `*ModelSnapshot*` | 51 | 50 |
| `tables` | matches of `public\s+DbSet<` in `Spectr.Data/AppDbContext.cs` | 33 | 30 |
| `specialistPrompts` | `components/worker/prompts/experts/*.md` | 28 | 25 |

Flooring (what `--write` does): values ≥ 100 round down to a multiple of 10;
below 100 to a multiple of 5. A floor may be hand-lowered — the test only
requires `floor <= recount` and `floor > 0`. (The runner reports 1,016
frontend tests because `it.each` expands; the page uses the static count so
the script needs no test run.)

---

## 4. Verification that cannot be done in jsdom

jsdom has no layout. These are measured in Chrome (Playwright) at 390 px and
1440 px and recorded in the task report:

1. No horizontal scroll (`scrollWidth <= clientWidth`) on `/`, `/pricing`,
   `/trust/*`, the 404 screen — both widths.
2. Chrome nav at 390 px: one row, no wrap, "How it's built" hidden, CTA visible.
3. With a stubbed `creditsEnabled: true`, the Pricing link appears and the
   x-position of "Sign in" is unchanged.
4. Architecture diagram: `flex-direction: column` at 390 px, `row` at 1440 px.
5. Plain-language lines do not overflow the embed card at 390 px.
6. `LightShow`: at 390 px there is no `canvas.lr-bgfx` in the DOM; at 1440 px
   with reduced motion emulated, the canvas has pixels but
   `requestAnimationFrame` is not re-armed (count frames for one second).
7. `.rd-row` at 390 px fits its container (Reference tab).
8. App top nav at 390 px does not overflow.
9. Stale chunk: `vite build`, open `vite preview`, rebuild, navigate → exactly
   one reload; a second failure within five minutes shows the error screen.
10. Lighthouse mobile on `vite preview`, before and after P7.
11. After deploy: `curl -A Slackbot https://spectrmix.com/trust/how-its-built`
    returns the BFF shell; `caddy validate` passes on the edited Caddyfile.

---

## 5. Out of scope

Hero motion/video; the `/demo` route, guest accounts and "use our sample"
(sibling workstream); an in-page retry for triage; any change to either guard
suite beyond the single approved allowlist line; pricing copy for the
credits-ON state; SSR/prerendering.

---

## 6. Where the planning reports were wrong (code wins)

- "Actions are SHA-pinned" — only `aquasecurity/trivy-action` is
  (`ci.yml:241,248,255`). The page says "checksum-verified scanner" instead.
- "27 prompt-versioned specialists" — `prompts/experts/` holds 28 files and
  `SLUG_TO_FILENAME` differs; the page uses a floor ("25+").
- "`smoke-first-run.spec.ts:53-68` must be updated" — it asserts only the
  primary CTA and its `href`; P3 leaves both alone. No change needed.
- "Pause LightShow when playback is stopped" — the dimmed idle animation is the
  documented design (`LightShow.tsx:1-4`); D13 stops it only off-desktop, when
  hidden, or under reduced motion.
- "`caddy depends_on: bff service_healthy`" — rejected (D14).
- "Retry button on the triage notice" — contradicts
  `LlmDegradationNotice.tsx:10-12`; rejected (D14).
- "`stats.generated.json` is generated" — it holds floors; the script only
  rewrites it on `--write` (D5).
- Counts in the reports (362 / 139 / 140) differ from §3.3 because the rules
  differ; §3.3 is the rule the script implements.
- `trust.test.tsx:26` **pins** the stale sharing sentence
  (`'anyone you explicitly share'`); P6 must update it.
- CI also runs `npm run lint:prices` (`ci.yml`, frontend job) — it is a gate.

---

## 7. Risks

| Risk | Default |
|---|---|
| `https://spectrmix.com` is hard-coded in `sitemap.xml`/`robots.txt` while the edge uses `{$SPECTR_DOMAIN}` | Accept — the domain is bought; one constant in `src/config/site.ts` + two static files |
| Caddy syntax cannot be validated without the image | P9 runs `caddy validate` in `caddy:2` with `SPECTR_DOMAIN=localhost`; if Docker is unavailable, the change ships behind a controller-run check before deploy |
| Lazy Sentry misses errors thrown before the SDK resolves | ≤ 20-error buffer flushed on load |
| `/plans` now touches feature flags | config key short-circuits the DB; failure → `null` → link hidden |
| P3 lands before P4 → "How it's built" links 404 for one commit | Controller does not push between P3 and P4 |
| D9 (sibling) also adds a landing demo CTA and the `demo_cta_clicked` event | P3 reconciles to exactly one CTA; adds the event name only if absent |
