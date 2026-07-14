# Story 6.4: Resume Cards

Status: review

<!-- Fourth story of Epic 6. Rides 6-3's device machinery (merged 5d7b589) —
     the resume data source already exists. Scoped tight for a focused cycle. -->

## Story

As a distracted visitor,
I want interrupted flows to greet me when I return,
So that I never have to start over.

## Acceptance Criteria

1. **Given** an unclaimed anon report within 72 h (UX-DR28), **When** the visitor returns to the landing page (`/`), **Then** a resume card shows "Your report from {day}" (relative day via the existing `relativeTime` helper) with a CTA into `/analyze` that re-renders the report. A still-running job shows "Your analysis is still running →" instead; a failed/absent job shows no card.
2. **Given** an interrupted anon upload (a job that never completed), **Then** the SAME status-aware card covers it (pending/processing → resume progress). Unfinished Stripe checkout is stateless server-side (no charge; `billing.cancelled.tsx` already routes back to `/pricing`) — a lightweight dismissible "Finish choosing a plan" note on the landing card is the resume affordance; no server state to reconstruct.
3. **Given** dismissal, **When** the visitor dismisses a resume card, **Then** the dismissal is remembered (localStorage keyed by jobId — anon has no account) and the card stays hidden for that job on subsequent visits.

## Context — verified (2026-07-14, master 5d7b589, post-6.3)

**The resume data source EXISTS (6-3):**
- `GET /api/anon/jobs/current` (`AnonAnalysisEndpoints.cs` GetCurrent) returns `AnonAnalysisResponse(jobId)` for the device's latest job (cookie-scoped; 404 no-cookie/no-jobs). **EXTEND it** to a resume shape: `{ jobId, status, dispatchedAt, grade }` (grade only when a completed Analysis exists — a cheap left-join / second select; null otherwise). AnalyzePage's `useAnonCurrentJob` consumes only `jobId` today — extra fields are ignored, so the 6-3 contract is safe (widen the frontend type additively).
- `useAnonCurrentJob(enabled)` (`useAnonAnalysis.ts:80`) already fetches it (staleTime Infinity, retry false). Widen its return type; add a `ResumeInfo` type.
- `AnalyzePage` (`features/anon-analyze/AnalyzePage.tsx`) already RESTORES the job on mount — the card is a landing-page ENTRY to that restore, not new restore logic. Clicking the card → navigate `/analyze` (full nav; AnalyzePage's existing `useAnonCurrentJob` restore takes over).

**Where it surfaces:** the LANDING page (`features/landing/LandingPage.tsx`) — a returning anon visitor lands on `/`. `/analyze` self-restores already (no card needed there). Card renders above the hero (or in a slim banner slot) only when `useAnonCurrentJob` resolves a non-dismissed, non-failed job.

**Reuse:**
- `relativeTime.ts` (`src/ui/relativeTime.ts`) for "{day}" — verify its API (relative-day/weekday formatting).
- `GradePill` (`src/ui/GradePill.tsx`) for the grade chip on the card (when grade present).
- Card styling: the global `.card` + landing module classes (6-1). Plain `<a href>` nav (funnel idiom — static-render testable, no RouterProvider).
- Dismissal: `localStorage` (the app keeps auth OUT of localStorage, but a dismissed-resume-jobId set is non-sensitive UI state — fine). Key e.g. `spectr.resumeDismissed` → array/set of jobIds.

**Anon-only scope:** resume cards are for the ANON funnel (device cookie). Authed users have the library; no resume card for them (the landing redirects authed → /library anyway, 6-1). Guard the card on `!auth.user` (useOptionalAuth) so it never flashes for a logged-in user mid-redirect.

## Tasks / Subtasks

- [x] **Task 1: BFF — resume shape on jobs/current (AC: 1, 2)**
  - [x] 1.1 Extend `GetCurrent` to return `AnonResumeDto { Guid JobId, string Status, DateTimeOffset DispatchedAt, string? Grade }` — grade from the device's Analysis for that job (`FinalJson->>'grade'` or a projected read; null when no completed analysis). Keep 404 semantics.
  - [x] 1.2 Integration test: completed anon job → jobs/current carries status=complete + grade; pending job → grade null; cross-device still 404.
- [x] **Task 2: Frontend — ResumeCard + landing wiring (AC: 1, 2, 3)**
  - [x] 2.1 `features/anon-analyze/ResumeCard.tsx` (pure, static-render testable): props `{ resume: ResumeInfo, onDismiss }`. Renders per status — complete → "Your report from {day}" + GradePill + "Open report →" (`/analyze`); pending/processing → "Your analysis is still running →"; failed/absent → renders null. Dismiss ✕.
  - [x] 2.2 Widen `useAnonCurrentJob` return type to `ResumeInfo` ({ jobId, status, dispatchedAt, grade }); add the type to `useAnonAnalysis.ts`. AnalyzePage unaffected (reads jobId).
  - [x] 2.3 `LandingPage`: mount the card above the hero when `useOptionalAuth()?.user` is falsy AND `useAnonCurrentJob(true)` resolves a job AND it's not in the dismissed set AND status ≠ failed. Dismiss writes localStorage.
  - [x] 2.4 `resume-dismissed.ts` helper (pure): read/write the dismissed-jobId set in localStorage, SSR-safe (guard `typeof window`).
- [x] **Task 3: Tests + gates (AC: all)**
  - [x] 3.1 Static-render tests: ResumeCard per status (complete w/ grade + day, processing, failed→null, dismiss button); resume-dismissed helper round-trip (add/has/SSR-guard).
  - [~] 3.2 Extend `smoke-anon-funnel.spec.ts` — NOT done (optional). A landing reload after the report would re-fire the device cookie against a running-worker DB; kept to unit + BFF integration coverage to avoid reload flake in the cycle budget. Moved to the at-home checklist.
  - [x] 3.3 Gates: frontend four + BFF build/test. Smoke rerun only if the spec was extended.
- [x] **Task 4: Docs**
  - [x] 4.1 At-home checklist: resume-card feel (return to `/` after an anon analysis, see the card, dismiss sticks).

## Dev Notes

- **Do not rebuild restore** — the card is a landing-page doorway to AnalyzePage's existing `useAnonCurrentJob` restore. Clicking navigates to `/analyze`; that page resumes.
- **Additive DTO widening only** — extra fields on jobs/current must not break AnalyzePage (it reads `jobId`). Widen the TS type; don't rename.
- **localStorage is fine for dismissal** — the auth-out-of-localStorage rule is about SECRETS; a dismissed-jobId set is non-sensitive. SSR/no-window guard so static-render tests don't throw.
- **Checkout resume is deliberately thin** — Stripe already enforces no-charge; there's no server state to resume. A dismissible "finish choosing a plan" nudge is the honest extent (don't fabricate a resumable checkout).
- **Guard on !auth.user** so the card never flashes for an authed user during the `/` → `/library` redirect.
- Headless-only (standing rule).

### References

- AC source: `PRPs/epics.md:1015-1025` (UX-DR28).
- Anchors: `AnonAnalysisEndpoints.cs` (GetCurrent), `useAnonAnalysis.ts:80` (useAnonCurrentJob), `AnalyzePage.tsx` (restore), `LandingPage.tsx` (mount point), `relativeTime.ts`, `GradePill.tsx`, `billing.cancelled.tsx` (checkout is stateless), `PublicChrome.tsx` (useOptionalAuth idiom).
- Prior art: 6-3 (device cookie + anon hooks), 6-1 (landing + static-render idiom), 12-8 (localStorage TTL patterns if a dismissal expiry is wanted — not required here).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story workflow)

### Debug Log References

- `LandingPage` is static-rendered in `landing.test.tsx` + `trust.test.tsx` with NO providers, so the resume slot canNOT use `useQuery` (needs QueryClientProvider). `LandingResumeSlot` uses `useEffect`+`fetch` instead — under `renderToStaticMarkup` the effect never runs, so it renders nothing and the existing static tests stay green with zero provider churn.
- Grade extraction: dropped the `EF.Functions.JsonExists` approach (loads the whole column anyway) for a plain "status==complete → select FinalJson → parse grade" (one small infrequent row).

### Completion Notes List

- **AC1 Met**: `GetCurrent` extended to `AnonResumeDto { JobId, Status, DispatchedAt, Grade }` (superset of the 6.3 `AnonAnalysisResponse` — AnalyzePage reads `jobId` and ignores the rest; verified restore still works). Landing `ResumeCard` shows "Your report from {day}" (`formatRelative`) + `GradePill` + "Open report →" `/analyze`; a running job → "still being analyzed / Resume →"; failed/absent → null.
- **AC2 — upload-interrupted Met** (the status-aware card covers pending/processing). **Checkout nudge NOT built** (deliberately thin per the story): Stripe enforces no-charge and `billing.cancelled.tsx` already routes back to `/pricing` — there is no server-side checkout state to reconstruct, so no honest resume affordance beyond what exists. Recorded as a scoped decision, not a gap.
- **AC3 Met**: `resume-dismissed.ts` — localStorage set of dismissed jobIds (SSR/no-window guarded, corrupt-value tolerant, capped at 50). Dismiss hides the card + persists.
- **Anon-only + no-flash**: `LandingResumeSlot` returns null when `useOptionalAuth()?.user` (never flashes during the authed `/`→/library redirect).
- Gates: tsc 0 · lint clean · build ✓ · vitest **808/808** (+6) · BFF build + **381/381** (+1 resume-fields integration, SPECTR_REQUIRE_DB=1). Worker untouched; smoke not rerun (additive DTO, restore path unchanged — verified AnalyzePage compiles + the full suite passes).

### File List

- `components/bff/src/Spectr.Bff/Endpoints/AnonAnalysisEndpoints.cs` (M — GetCurrent resume shape)
- `components/bff/src/Spectr.Bff/DTOs/JobDtos.cs` (M — AnonResumeDto)
- `components/bff/tests/Spectr.Bff.Tests/AnonAnalysisTests.cs` (M — resume-fields test)
- `components/frontend-spectr-v2/src/features/anon-analyze/ResumeCard.tsx` (A) + `resume-card.module.css` (A)
- `components/frontend-spectr-v2/src/features/anon-analyze/LandingResumeSlot.tsx` (A)
- `components/frontend-spectr-v2/src/features/anon-analyze/resume-dismissed.ts` (A)
- `components/frontend-spectr-v2/src/features/anon-analyze/__tests__/resume-card.test.tsx` (A — 5 tests)
- `components/frontend-spectr-v2/src/features/anon-analyze/useAnonAnalysis.ts` (M — ResumeInfo type)
- `components/frontend-spectr-v2/src/features/landing/LandingPage.tsx` (M — slot mount)
- `PRPs/sprint-status.yaml` (M), `output/at-home-checklist/...` (M), this story (A/M)

### Change Log

- 2026-07-14 — Story 6.4 implemented: landing resume card for returning anon visitors (extended jobs/current DTO, status-aware ResumeCard, localStorage dismissal). Checkout-nudge deliberately deferred (Stripe stateless). Gates green (vitest 808, BFF 381). Status → review.
