# Frontend v2 Architecture — `components/frontend-spectr-v2`

Deep-scan documentation of the SPECTR v2 SPA (BMAD document-project). All paths below are
relative to `components/frontend-spectr-v2/` unless prefixed with `/`. Grounded in code as of
2026-07-22 (branch `master`).

## Executive Summary

`frontend-spectr-v2` is the primary web client of SPECTR, an AI music-analysis app for music
producers. Users upload a mix (optionally with up to 100 stems, an Ableton `.als` project, and a
reference track), receive a graded 7/8-phase analysis report with AI coach chat, on-demand AI
specialist verdicts and a deterministic "Fix Rack", and can audition their track through a
real-time Web Audio DSP rack ("Listen"). The app also carries the commercial surface (pricing,
Stripe billing, credits, entitlement gating) and an anonymous instant-analysis funnel at
`/analyze` that converts to registration by "claiming" the device-scoped report. It is a
single-user product — no sharing, no public pages, no profiles, no rooms (see
`PRPs/solo-fork-strip-social.md`).

It is a Vite-built React 19 SPA that talks exclusively to the .NET BFF (`components/bff`) over
`/api/*` (Vite dev proxy to `localhost:5000`), with SSE for streaming (coach replies) and XHR for
upload progress.

## Technology Stack

| Category | Technology | Version | Notes |
| --- | --- | --- | --- |
| UI runtime | React / ReactDOM | ^19.0.0 | StrictMode root in `src/main.tsx` |
| Build | Vite | ^6.0.7 | `vite.config.ts`; dev port 5174, `/api` proxy to BFF :5000; `build.target: esnext` |
| Language | TypeScript | ~5.7.2 | strict + `verbatimModuleSyntax` (type-only imports mandatory) |
| Routing | @tanstack/react-router | ^1.92.3 | File-based routes via `@tanstack/router-plugin` (`autoCodeSplitting: true`), generated `src/routeTree.gen.ts` |
| Server state | @tanstack/react-query | ^5.62.7 | Single `QueryClient` (staleTime 30 s, no refetch-on-focus) in `src/main.tsx` |
| Styling | CSS Modules + design tokens | n/a | `src/styles/tokens.css`, `src/styles/global.css`; no Tailwind, no CSS-in-JS |
| Headless UI | Radix UI | dialog 1.1, dropdown 2.1, popover 1.1, select 2.1, slider 1.2, switch 1.1, tabs 1.1, tooltip 1.1 | Dialog-based modals throughout |
| Charts | Recharts | ^2.15.0 | Report/compare visualizations |
| Waveform | wavesurfer.js | ^7.8.13 | Playback UI |
| Toasts | Sonner | ^1.7.1 | `<Toaster theme="dark">` mounted in `main.tsx` |
| Drag & drop | @dnd-kit core/sortable | ^6.3.1 / ^8.0.0 | Reorderable lists |
| Validation | zod | ^3.24.1 | Schema validation |
| Observability | @sentry/react, posthog-js | ^10.63.0 / ^1.396.6 | Both no-op without `VITE_*` keys; init wrapped so failure never blocks mount (`src/lib/sentry.ts`, `src/lib/analytics.ts`) |
| Type generation | orval | ^7.3.0 | `npm run gen-types` against BFF OpenAPI; `src/api/types.ts` is the (partly hand-maintained) DTO mirror |
| Unit tests | vitest + @testing-library/react + jsdom | ^2.1.8 / ^16.3.2 / ^29 | Default env `node`; jsdom opt-in (see Testing) |
| A11y audit | axe-core | ^4.12.1 | Kitchen-sink axe test |
| E2E | @playwright/test | ^1.49.1 | 3 smoke specs, Chromium only |
| Lint | eslint 9 + typescript-eslint 8 + 4 custom scripts | | `--max-warnings 0`; scripts: no-google-fonts, css-tokens (no raw hex in modules), price-literals, focus-ring |
| Unused dep | `ai` (Vercel AI SDK) | ^4.0.20 | In `package.json` dependencies but not imported anywhere in `src/` |

## Architecture Pattern

- **File-based routing with layout gates.** Routes live under `src/routes/`. `_app.tsx` is the
  authenticated shell (topnav, banners, keyboard shortcuts) whose `beforeLoad` redirects
  anonymous users to `/login` — but short-circuits while `auth.isLoading` (silent-refresh boot)
  to avoid a flash-of-redirect. `_public.tsx` is the narrow-column anonymous layout (login,
  register). Funnel pages (`/`, `/analyze`, `/pricing`, `/trust/*`) sit outside both
  layouts and render their own `PublicChrome`. `src/main.tsx` bridges `AuthContext` into router
  context (`RouterBridge`) and calls `router.invalidate()` when auth resolves so cached
  `beforeLoad` guards re-run.
- **Feature folders.** `src/features/<feature>/` owns components + hooks + pure helpers per
  domain (14 folders: account, anon-analyze, auth, billing, health, landing, library, listen,
  listen-rack, references, results, song, trust, upload). Cross-feature dialogs/widgets live in
  `src/components/`; visual primitives in `src/ui/`.
- **Pure/container split.** Presentational pieces are exported as provider-free functions
  (e.g. `ProgressStorylineView`, `AuthFlowViews`) so vitest can assert states via
  `renderToStaticMarkup` without a DOM; route containers own the hooks.
- **Auth model** (`src/auth/AuthContext.tsx` + `src/api/fetcher.ts`):
  - Access token lives in **module state only** (`fetcher.ts` `accessToken`); never localStorage.
  - Refresh token is an httpOnly cookie; `refreshSession()` is the **single-flight** refresh for
    the whole tab — shared by the AuthContext mount-time silent refresh and the fetcher's 401
    handler, because refresh tokens rotate and two concurrent calls would kill the session.
  - A module-level `sessionEpoch` counter invalidates in-flight refreshes on logout.
  - `fetcher<T>()` injects `Authorization: Bearer`, and on 401 (non-`/auth/*`) refreshes once and
    retries; failure clears auth via the `onAuthCleared` callback.
  - Errors throw `ApiError(status, body, message)` with the AR38 envelope's human message
    extracted by `src/api/error-utils.ts`; unhandled-500 `traceId`s are stashed for 30 min and
    prefill the "Report a problem" mailto (`src/lib/report-problem.ts`).

## Routing Map

| Route file (`src/routes/`) | URL | Renders | Access |
| --- | --- | --- | --- |
| `__root.tsx` | — | Root outlet + router context (`queryClient`, `auth`) | — |
| `index.tsx` | `/` | `features/landing/LandingPage` (anon-optimistic; authed users redirect to `/library`) | public |
| `analyze.tsx` | `/analyze` | `features/anon-analyze/AnalyzePage` — anonymous instant-analysis funnel | public |
| `pricing.tsx` | `/pricing` | Pricing page; plan display values fetched from `/api/billing/plans` (no price literals) | public |
| `trust.index.tsx`, `trust.no-training.tsx`, `trust.privacy.tsx`, `trust.results-forever.tsx` | `/trust/*` | `features/trust/TrustPage` + versioned pledge pages | public |
| `_public.tsx` | — | Narrow-column anon layout (wordmark + outlet) | public |
| `_public/login.tsx`, `register.tsx` | `/login`, `/register` | Auth forms (login supports `?next=`) | public |
| `_public/forgot-password.tsx`, `reset-password.tsx`, `verify-email.tsx` | | `features/auth/AuthFlowViews` containers | public |
| `_public/billing.cancelled.tsx` | `/billing/cancelled` | Stripe checkout-cancelled landing | public |
| `_app.tsx` | — | Authed shell: topnav, `AppDunningNotice`, `AppWorkerHealthNotice`, `VerifyEmailBanner`, global shortcuts (⌘K palette, ⌘U upload, `?` sheet), account menu with `UsageMeter` | auth |
| `_app/library.tsx` | `/library` | Songs / References segmented library (`SongsLibrarySection`, `ReferenceLibrarySection`) | auth |
| `_app/songs.$songId.tsx` | `/songs/{id}` | Song detail: cover hero, `ProgressTimeline`, version list, `CompareDialog`, edit/upload dialogs; returns `<Outlet/>` when the results child route is active (`useChildMatches`) | auth |
| `_app/songs.$songId.results.$jobId.tsx` | `/songs/{id}/results/{jobId}` | Results page: job poll → `ProgressStoryline` / fail + free retry / `ReportView` tabs (`?tab=` deep link) | auth |
| `_app/listen-rack.$versionId.tsx` | `/listen-rack/{versionId}` | `ListenRackPage` (canonical Listen page, owner-only) with real audio + analysis-fed track model; `?fixPreset=<uuid>` carry-over | auth |
| `_app/reports.tsx` | `/reports` | All-reports table (filterable, `useReports`) | auth |
| `_app/profile.tsx` | `/profile` | Own profile + settings incl. `DangerZone` (export / delete account) | auth |
| `_app/usage.tsx` | `/usage` | Credits balance, ledger, `BuyCreditsCard`, `UsageSummary`, `HonestMathBanner` | auth |
| `_app/billing.tsx` | `/billing` | Self-service billing: free / pro-active / cancel-pending states, `DunningBanner` | auth |
| `_app/billing.success.tsx` | `/billing/success` | Post-checkout landing; polls `/auth/me` every 5 s up to 60 s for `tier === "pro"` | auth |
| `_app/dev.kitchen-sink.tsx` | `/dev/kitchen-sink` | DEV-gated component inventory (visual-regression + axe audit surface; prod builds tree-shake it) | auth, dev-only |

Note: the legacy `/listen/$versionId` route was deleted; `/listen-rack/$versionId` is canonical.
The Debug results tab is likewise dev-build-only (`buildResultsTabs(..., import.meta.env.DEV)`).

## State Management

- **TanStack Query owns all server state.** Defaults: `staleTime: 30_000`,
  `refetchOnWindowFocus: false` (`src/main.tsx`). ~80 hooks in `src/api/hooks.ts` (one file,
  sectioned by resource); feature-local hooks (rack presets, etc.) live in their feature folders.
- **Polling is interval-function based** (poll only while there is something to wait for):

| Hook | Interval | Stops when / cap |
| --- | --- | --- |
| `useJob` (`hooks.ts:491`) | 2 s (caller-overridable `pollMs`) | status `complete`/`failed` |
| `useAnonJob` (`features/anon-analyze/useAnonAnalysis.ts`) | 2 s | same |
| `useJobResults` (`hooks.ts:533`) | 8 s | only while Phase 7 `arrangement_status === 'pending'` (deferred allin1 structure detection) |
| `useVerdicts` (`hooks.ts:563`) | 3 s | while user-clicked specialists are optimistically running OR Triage routing plan hasn't landed; triage wait capped at 25 polls |
| `useFixRack` (`hooks.ts:615`) | 1.5 s | GET returns 204→`null` until worker persists; capped at 100 polls (150 s) |
| `useStemProposals` (`hooks.ts:338`) | 1.5 s | `classified === true` or zero staged stems |
| `useWorkerHealth` (`hooks.ts:463`) | 30 s healthy / 10 s offline | never (global banner; anonymous endpoint) |
| `useFullHealth` (`hooks.ts:478`) | 30 s | dev-only mount (`DevHealthDot`) |
| `billing.success` page | 5 s via `/auth/me` | tier flips to pro, or 60 s budget exhausted |

- **Client/UI state is local.** `useState`/`useRef` per component; no Redux/Zustand. The only
  module-level state: the access token + trace-id in `fetcher.ts`, the auth `sessionEpoch`, and
  small persisted UX flags (e.g. anon resume-card dismissal). Auth never touches localStorage.
- **Cache-key conventions**: `['jobs', id]`, `['jobs', id, 'results']`, `['verdicts', jobId]`,
  `['fix-rack', jobId]`, `['stems', versionId]`, `['songs']`, `['versions', id]`, `['anon', ...]`,
  `['health', ...]`. Mutations invalidate by prefix; Fix Rack regenerate uses
  `resetQueries` (not invalidate) to restart the poll-count and drop the stale rack.

## Data/API Layer

- **`src/api/fetcher.ts`** — the single fetch wrapper (see Auth model above). All JSON hooks and
  orval-generated call shapes route through it; it prefixes `/api`, serializes `params`, and
  returns `undefined` for 204.
- **`src/api/hooks.ts`** (969 lines) — sections: auth/me → entitlements/plans → songs → versions
  (patch/reanalyze/free-retry/stems stage-classify-poll-confirm/als/notes) → worker health →
  jobs/results → verdicts/specialists/fix-rack → references + reference sets → tags → reports →
  compare.
- **`src/api/types.ts`** (1633 lines) — DTO mirror of the BFF (`FinalJson`, phase data shapes,
  `VerdictDto`, `FixRackDto`, entitlements, coach conversation types...). Regenerated/extended via
  orval config; hand-edited where the OpenAPI is loose.
- **SSE (fetch-based, not `EventSource`)** — needed because Bearer headers can't ride
  `EventSource`. Pattern: `fetch(..., { headers: { Accept: 'text/event-stream' } })` +
  `res.body.getReader()` + manual `\n\n` frame parse + `AbortController`.
  - Coach chat (`features/results/CoachChat.tsx`): two-phase — POST
    `/api/coach/{analysisId}/messages` then GET `.../messages/{id}/stream`; frames `token`,
    `done` (with evidence), `refusal`, `error` (`coach-stream-frames.ts`).
- **Uploads are XHR** for progress events: `hooks/useFileUpload.ts` (generic),
  `hooks/useStemStaging.ts` (bulk stems), `features/anon-analyze/useAnonAnalysis.ts` (anon).
  Mix/stem/als/reference uploads are **presigned-first** (browser PUTs direct to R2/MinIO, then a
  `*-key`/`complete-key` registration call) with automatic fallback to the legacy multipart proxy
  on 501/unreachable-store (`hooks/useMixUpload.ts`, `features/upload/attachment-upload-helpers.ts`,
  `multipart-upload-helpers.ts`, `presigned-fallback.ts`).

## Key User-Facing Flows

### 1. Unified upload (new song / new version, with optional stems, .als, reference)
- Entry: `src/components/UnifiedUploadDialog.tsx` (1161 lines) — mounted by the library, song
  detail, and the ⌘U global shortcut (`_app.tsx`). Helpers: `unified-upload-helpers.ts`
  (`decideDispatchPath`, `buildAutoConfirmPayload`).
- Internal phases: `'form' | 'uploading' | 'classifying' | 'review'`.
- Sequence: mix upload (presigned-first, live `%` status line) → optional `.als` attach with
  `analyze=false` → optional reference (library pick or new upload; reference analysis fires its
  own job) → **single analysis dispatch**: no stems → `POST /versions/{id}/analyze`; with stems →
  stage (per-file progress `i/n (%)`) → `POST .../stems/classify` → either auto-wait
  (`classifying` phase, "Classifying stems…") then auto-confirm from detected roles, or the
  "Review stem roles" step where `useStemProposals` polls at 1.5 s until `classified` and the user
  confirms roles/mode.
- Waiting states the user sees: per-step status text with percentages, the classifying spinner
  phase, the review table filling in detected roles, then navigation to the results route.
- Failure handling: `entitlement_exhausted` → back to form + `UpgradeSheet` (cap reason);
  verify-email 403 → actionable toast with resend; other errors → toast advising retry from the
  song page (the version may already exist).

### 2. Analysis progress → report (results page)
- Entry: `src/routes/_app/songs.$songId.results.$jobId.tsx`; job polled at 2 s.
- While pending/processing: `features/results/ProgressStoryline.tsx` — named phase rows
  (done/current/todo), phase `%`, ticking elapsed clock, escalating hints: "still queued" after
  2 min pending, "taking longer than usual" after 10 min total, and a worker-offline hint
  driven by the shared `useWorkerHealth` poll (worker availability only — no queue-depth number).
- Failed: error panel + one **free retry** button (server-owned eligibility; 409 codes
  `retry_already_used` / `retry_not_eligible` hide it) → navigates to the new job id.
- Complete: `ReportView` (506 lines) renders `SongHeader` (add-input chips) + `ResultsTabs`:
  AI Coach / Findings (fault-count badge) / Project (only with `.als`; otherwise `ProjectUnlock`
  upload CTA) / Reference (only when attached) / Track Info / Debug (dev builds). A
  `DegradationBanner` explains degraded (rule-engine-only) runs; `AnalysisCompleteModal` is the
  post-analysis teaser.
- Coach tab (`CoachTab.tsx`): streams coach replies (SSE, "Coach is responding…" status, aria-live
  throttled at 500 ms), auto-runs the Triage-suggested specialists once per analysis,
  `SpecialistTeamModal` shows per-slug run/running/found states (3 s verdict polling while any
  run), and the Fix Rack lifecycle (below). Findings/moves can be committed "to Listen".

### 3. Fix Rack generation (deterministic mastering chain from committed moves)
- One state machine, `features/results/useFixRackGeneration.ts` (`idle → generating →
  error | timeout`), shared by the coach-header button and `FixRackPanel.tsx` (controlled mode).
- POST `/reports/{jobId}/fix-rack` (202) → `useFixRack` polls GET at 1.5 s (204 until the worker
  persists) capped at 100 polls; a 150 s watchdog flips to `timeout`; a failed POST lands in
  `error` with a toast; both states offer a clean retry via `generate()` (which `resetQueries`
  the cache so Regenerate isn't satisfied by the stale rack).
- Ready state: module list + coach rationale (`coachMeta`) + "Open in Listen rack" which carries
  `?fixPreset=<presetId>` into the Listen route (story 12.4 carry-over).

### 4. Listen rack (real-time Web Audio DSP)
- Entry: `src/routes/_app/listen-rack.$versionId.tsx` → `features/listen-rack/ListenRackPage.tsx`
  (1110 lines). The DSP engine is `features/listen/useAudioGraph.ts` (827 lines): single
  `<audio crossOrigin>` element → `MediaElementSource` → EQ biquads → compressor → saturation →
  M/S width → analysers (spectrum + L/R meters via rAF), with modular effects under
  `features/listen/audio/` (13 effect units, worklet processors for gate/limiter/bitcrusher,
  pure DSP math modules). `ensureContext()` must be called from the play-button gesture.
- Pitch mode decodes the full file to an `AudioBuffer` (cached) and plays via
  `AudioBufferSourceNode.detune` — pitch and tempo are coupled (no phase vocoder yet). Stem deck
  (`useStemEngine` + `StemDeck`) plays per-stem audio.
- Server-backed rack/viz presets (`useRackPresets`, `useVizPresetsServer`), fix carry-over
  overlay (`useFixOverlay` + `fixToRackPatch`). Rack is always editable — there is no read-only
  or room-guest mode. Right rail: notes-only (`NotesSidebar.tsx`); visualizer stages with an AUTO
  director (`viz.tsx`).

### 5. Anonymous funnel `/analyze` (+ landing resume)
- Entry: `features/anon-analyze/AnalyzePage.tsx`. State machine `idle → uploading → processing →
  report`; identity is the server-minted httpOnly `spectr_device` cookie.
- Waiting states: XHR upload `<progress>` with %, then `ProgressStorylineView` + a rotating
  6 s educational explainer keyed to the current phase; job polled at 2 s; failure offers "Try
  another file".
- Report is claim-bait: `GradeHero` + #1 finding + `StreamingCard` visible; remaining findings
  server-withheld and rendered as a `BlurLock`ed placeholder list with a count. "Create free
  account" opens `InlineRegisterCard`; registration rides the device cookie, the server re-parents
  the report, and the page unlocks in place via the authed results endpoint.
- Cold-mount restore via `GET /api/anon/jobs/current`; the landing page mounts `LandingResumeSlot`
  / `ResumeCard` for returning devices with an unclaimed job.

## Styling System

- **`src/styles/tokens.css`** — dark-mode-only design tokens: surfaces (`--bg`, `--card`...),
  accents (`--cyan` #00e5b0 brand, violet/orange/red/green...), text tiers, radii, a 4-px spacing
  scale, severity colors (+ alias namespaces `--sev-warning` vs streaming `--sev-warn` — near-
  identical names, intentionally distinct), grade letter colors A–F, tier colors
  (free/pro/credits), and paywall overlay variables.
- **`src/styles/global.css`** — reset + global utility primitives opted into by className from
  any component: `.card` (+ `.card-hd`, `.card-body`), `.pill[.tone]`, `.dot[.tone]`,
  `.btn[.primary/.ghost/.sm]`, `.label`, `.mono`, `.sr-only`, animation helpers (`.fade-up`,
  `.pulse-glow`...), and the focus-ring rules. `src/styles/forms.module.css` is the shared form
  module.
- **Everything else is per-component CSS Modules** (`*.module.css` beside each component).
  Inline styles only for dynamic values (grade color, cover-art gradients).
- **Enforced by lint scripts** (`scripts/*.mjs`, wired into `npm run lint*`): no raw hex in
  modules (must use tokens), no Google-font imports, no hardcoded price literals, and a
  focus-ring presence check.

## Testing

- **vitest** (`vitest.config.ts`): includes `src/**/*.{test,spec}.{ts,tsx}`; default environment
  is `node` — pure helpers and static-render tests run DOM-free. jsdom is opt-in two ways:
  `environmentMatchGlobs` for `src/features/listen-rack/**`, and per-file
  `// @vitest-environment jsdom` pragmas (~30+ files) for Testing Library component tests.
- **Test idioms**: pure/container split → `renderToStaticMarkup` assertions for view states;
  Testing Library for interactive components (dialogs, chat caps, upload flows); fetch/XHR mocked
  at module boundary. Co-located under `__tests__/` or `*.test.ts(x)` beside the source.
- **A11y**: `src/routes/__tests__/kitchen-sink-axe.test.tsx` runs axe-core over the
  `/dev/kitchen-sink` component inventory.
- **Playwright** (`playwright.config.ts`): Chromium-only smoke suite in `playwright/` —
  `smoke.spec.ts`, `smoke-anon-funnel.spec.ts`, `smoke-first-run.spec.ts`; boots the Vite dev
  server (`webServer`, baseURL `http://localhost:5174`) with a `global-setup.ts`.
- **Gates** (must pass before commit): `npx tsc --noEmit`, `npm run lint` (max-warnings 0 +
  fonts check), `npm run build`, `npx vitest run`.

## Experience-relevant behaviors (latency / waiting / caps the UI surfaces)

- **Job progress**: 2 s status poll; phase storyline with elapsed clock; "still queued" hint at
  2 min pending; "taking longer than usual" at 10 min; worker-offline hint (availability only —
  no queue-depth number).
- **Deferred arrangement score**: report polls itself at 8 s while Phase 7 says `pending`
  (background allin1 structure detection — minutes on CPU) and fills in live.
- **Verdict generation**: specialists run on demand; roster shows optimistic "running" per slug;
  verdict list polls at 3 s while anything runs; Triage's routing plan is lazily fired by the
  first GET, so the page polls (max 25×3 s) until suggestions land.
- **Fix Rack**: POST-then-poll at 1.5 s with a visible `generating` state; explicit `error`
  (failed POST, toast) and `timeout` (150 s with no persisted preset — matches the 100-poll GET
  cap) states, both retryable; Regenerate resets the poll budget.
- **Coach**: streamed tokens with "Coach is responding…" / "Coach finished responding." status;
  offline codes (`coach_offline`, `circuit_open`, `llm_provider_down`, ...) flip the chat into a
  persistent offline card ("Coach is offline — your measured analysis and rule-based findings are
  unaffected"); `coach_cap_reached` instead rolls back the optimistic bubbles and renders
  `CoachGateInline` + `CoachCapChip` (`{used} of {limit} follow-ups · this analysis` for free
  tier; monthly pool for pro; unlimited for credits).
- **Worker outage**: `AppWorkerHealthNotice` banner on every authed page once `healthy === false`
  (30 s/10 s adaptive poll); renders nothing while healthy/unknown to avoid false-outage flashes.
- **Entitlement gating**: `BlurLock` (blur + inert + single CTA) for locked depth; stems/.als are
  pro inputs (`stemsEnabled`/`alsEnabled` flags lock form rows); server race on the last analysis
  slot surfaces `entitlement_exhausted` → `UpgradeSheet`; free-tier unverified email gates the
  next upload (`VerifyEmailBanner` + verify-gate toast with resend).
- **Billing**: app-wide dunning notice when past-due (suppressed on `/billing which has its own
  banner); checkout success page polls up to 60 s for the webhook-driven tier flip and says
  "still processing" rather than misrepresenting after that.
- **Failed analysis**: one server-adjudicated free retry; anon funnel failures offer instant
  re-upload; upload dialogs fall back from presigned PUTs to proxy uploads transparently.
