# Story 6.5: Funnel Instrumentation

Status: done

<!-- Last story of Epic 6. Wires PostHog events onto the funnel edges built in
     6-1/6-3/6-4. Tight cycle — the analytics wrapper + identity stitch already exist. -->

## Story

As the operator,
I want every funnel edge measured privately,
So that conversion leaks are findable from day one.

## Acceptance Criteria

1. **Given** the no-op-safe PostHog wrapper (10.3 `lib/analytics.ts`), **When** funnel edges fire, **Then** the acquisition path records events with NO PII in props (job_id/cadence/source ok; never email/audio/token): `landing_viewed`, `analyze_started`, `analyze_completed`, `report_claimed`, `pricing_viewed`, `checkout_started`, `resume_shown`, `resume_clicked` (semantic cover of the epics AC1 set land/upload_start/report_view/signup/checkout_start).
2. **Given** a claim (device→user), **Then** identities stitch — already handled: `AuthContext` calls `identifyUser(user.id)` on auth-resolve (`AuthContext.tsx:102`); registering a claimed anon device stitches automatically. Verify + a `report_claimed` event so the device→user moment is queryable.
3. **Given** the KPI table, **Then** time-to-first-insight is derivable (`analyze_started` + `analyze_completed` carry `job_id`, pairing with job timestamps) and free→paid via `checkout_started`.
4. **Given** inbound attribution (the 7.4 `spectr_attribution` localStorage stash + a `?ref`/`?via` URL param), **When** a visit/claim arrives, **Then** the source is captured on the signup-class event (`report_claimed` / register) — draining the "write-only until 6.5" stash the share pages already populate (`r.$token.tsx:288`, `ProducerCta.tsx:19`).

## Context — verified (2026-07-14, master c982f99, post-6.4)

- **`lib/analytics.ts`** — `capture(event: EventName, props?)` is a silent no-op without `VITE_POSTHOG_KEY` (dev/tests/self-host). `EventName` is a UNION — **extend it** with the funnel events. `identifyUser` + `initAnalytics` already wired (`main.tsx:18`, `AuthContext.tsx:102`). `report_viewed`/`coach_message_sent`/`upload_completed`/`verdict_feedback` already fire (authed side).
- **Attribution stash exists, write-only**: `localStorage['spectr_attribution']` = `share_{token}` set by `r.$token.tsx:288` + `ProducerCta.tsx:19` (both comment "until 6.5"). 6.5 READS + drains it. Also a `?via=share_{token}` param on `/register` (`r.$token.tsx:285`) and PRD `?ref`.
- **Funnel-edge anchors** (the surfaces to instrument):
  - Landing: `features/landing/LandingPage.tsx` (mount).
  - Pricing: `routes/pricing.tsx` `PricingPage` (mount); `startCheckout` (`pricing.tsx`) for `checkout_started`.
  - Anon analyze: `features/anon-analyze/AnalyzePage.tsx` — `onFile`→upload success sets jobId (`analyze_started`); stage transition to `report` (`analyze_completed`); `InlineRegisterCard.onClaimed` (`report_claimed`).
  - Resume: `features/anon-analyze/LandingResumeSlot.tsx` (`resume_shown` when a card resolves), `ResumeCard` click (`resume_clicked`).
- **Privacy (6-2 trust page)**: the published privacy page says "operational tooling: product analytics (PostHog)… no advertising trackers, data never sold." Event props MUST stay PII-free to keep that true (job_id is a random GUID — fine; NEVER email/audio/share-token-as-identity).
- **Test idiom**: `vi.mock('../../lib/analytics')` + assert `capture` called with the event name at each edge (the module no-ops without a key, so real PostHog is never hit). `analytics.test.ts` already covers the no-op safety.

## Tasks / Subtasks

- [x] **Task 1: Extend the event vocabulary + attribution helper (AC: 1, 4)**
  - [x] 1.1 Add the funnel events to `EventName` in `lib/analytics.ts` (with a one-line prop comment each). No behavior change to `capture`.
  - [x] 1.2 `lib/attribution.ts` (pure, SSR-safe): `readAttribution()` → drains `localStorage['spectr_attribution']` + reads a `?ref`/`?via` URL param, returns `{ source: string } | null` (prefer the URL param; fall back to the stash; clear the stash on read so it attaches once). No PII.
- [x] **Task 2: Wire the anon-funnel edges — the core (AC: 1, 2, 3)**
  - [x] 2.1 `AnalyzePage`: `capture('analyze_started', { job_id })` on upload success; `capture('analyze_completed', { job_id })` once on the stage→report transition (guard against re-fire on re-render); `capture('report_claimed', { job_id, ...readAttribution() })` in the claim success path.
  - [x] 2.2 `LandingResumeSlot`: `capture('resume_shown', { status })` when a resume card first resolves; `ResumeCard` "Open/Resume" click → `capture('resume_clicked', { status })` (thread an `onOpen` callback, or capture in the slot's click handler).
- [x] **Task 3: Wire the top-of-funnel + checkout edges (AC: 1, 3)**
  - [x] 3.1 `LandingPage`: `capture('landing_viewed')` on mount (effect, once).
  - [x] 3.2 `pricing.tsx`: `capture('pricing_viewed')` on mount; `capture('checkout_started', { cadence })` in `startCheckout` before the redirect.
- [x] **Task 4: Tests + gates (AC: all)**
  - [x] 4.1 Vitest with `vi.mock('lib/analytics')`: assert `capture` fires with the right event+props at each wired edge (landing mount, pricing mount, checkout, resume card, and the AnalyzePage transitions via the pure helpers where possible). `attribution.ts` round-trip test (URL param wins, stash drains, PII-free).
  - [x] 4.2 Extend `analytics.test.ts` for the new event names (no-op-safe capture of each).
  - [x] 4.3 Gates: frontend four (tsc/lint/build/vitest). No BFF/worker change. Smoke NOT rerun (no flow change — events are fire-and-forget no-ops without a key).
- [x] **Task 5: Docs**
  - [x] 5.1 `docs/runbook.md` (or the 10.3 KPI mapping): add the Epic-6 funnel events to the event→KPI table.
  - [x] 5.2 At-home checklist: with `VITE_POSTHOG_KEY` set, PostHog EU shows the funnel events firing (land→analyze→claim).

## Dev Notes

- **No PII, ever** — this is the whole privacy contract. job_id (random GUID), status, cadence, source-token are fine; email, audio, or anything that de-anonymizes is NOT. A review layer must confirm.
- **`capture` is no-op without a key** — so wiring is safe in dev/tests/CI; the tests mock the module to assert the CALL, not the network.
- **Guard once-per-transition** — `analyze_completed`/`resume_shown` fire on a state that persists across re-renders; use a ref/effect-dep so they fire once, not every render.
- **AC2 identity stitch is already done** — don't re-wire `identifyUser`; just verify the claim path lands a user id (it does via AuthContext on register) and add `report_claimed` for the queryable moment.
- **Attribution drains on read** — clear the stash after attaching so a later unrelated signup doesn't inherit a stale share source.
- Headless-only (standing rule). No BFF/worker/migration.

### References

- AC source: `PRPs/epics.md:1027-1038` (FR43, AR37, NFR27).
- Anchors: `lib/analytics.ts` (capture/EventName/identifyUser), `main.tsx:18`, `AuthContext.tsx:102`, `AnalyzePage.tsx` (funnel), `LandingResumeSlot.tsx`/`ResumeCard.tsx` (6-4), `LandingPage.tsx`, `pricing.tsx`, `r.$token.tsx:285-288` + `ProducerCta.tsx:19` (attribution stash), `analytics.test.ts` (no-op test idiom).
- Prior art: 10.3 (analytics wrapper + identity + KPI events), 7.4 (attribution stash), 6-1/6-3/6-4 (the funnel surfaces).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story workflow)

### Debug Log References

- `vi.mock('../../../lib/analytics')` resolves to the same module id every consumer imports, so the mock applies to LandingPage/pricing/LandingResumeSlot alike — asserting the call, not the network. The jsdom "Not implemented: navigation" stderr on the resume-anchor click test is harmless (jsdom won't follow `<a href>`).

### Completion Notes List

- **Event vocabulary extended** (`lib/analytics.ts`): 8 funnel events added to the `EventName` union with PII-free prop comments. `capture` unchanged (no-op without a key).
- **Attribution** (`lib/attribution.ts`): `readAttribution()` prefers a `?via`/`?ref` URL param, falls back to the 7.4 `spectr_attribution` stash, and DRAINS the stash on read (attaches once). PII-free (share token / ref slug). SSR-safe.
- **Edges wired**: landing mount → `landing_viewed`; pricing mount → `pricing_viewed`; `startCheckout` → `checkout_started {cadence}`; anon upload success → `analyze_started {job_id}`; report first-render (ref-guarded, once) → `analyze_completed {job_id}`; claim → `report_claimed {job_id, ...readAttribution()}`; resume card resolve → `resume_shown {status}`; resume open → `resume_clicked {status}` (via a new `onOpen` on ResumeCard). AC2 identity stitch untouched (already `AuthContext.identifyUser`).
- **Privacy**: every prop is a random GUID / enum / share-slug — no email/audio/token-as-identity. Keeps the 6-2 privacy-page "operational analytics, no ad trackers" claim true.
- Gates: tsc 0 · lint clean · build ✓ · vitest **816/816** (+7: attribution 3, funnel-events 4; analytics no-op extended). No BFF/worker/migration; smoke not rerun (events are fire-and-forget no-ops without a key — zero flow change).
- **Epic 6 COMPLETE** with this story (6-1..6-5 all done).

### File List

- `components/frontend-spectr-v2/src/lib/analytics.ts` (M — funnel EventName)
- `components/frontend-spectr-v2/src/lib/attribution.ts` (A)
- `components/frontend-spectr-v2/src/lib/__tests__/attribution.test.ts` (A — 3), `analytics.test.ts` (M — funnel no-op)
- `components/frontend-spectr-v2/src/features/anon-analyze/AnalyzePage.tsx` (M — started/completed/claimed)
- `components/frontend-spectr-v2/src/features/anon-analyze/LandingResumeSlot.tsx` (M — shown/clicked) + `ResumeCard.tsx` (M — onOpen)
- `components/frontend-spectr-v2/src/features/anon-analyze/__tests__/funnel-events.test.tsx` (A — 4)
- `components/frontend-spectr-v2/src/features/landing/LandingPage.tsx` (M — landing_viewed)
- `components/frontend-spectr-v2/src/routes/pricing.tsx` (M — pricing_viewed + checkout_started)
- `docs/runbook.md` (M — funnel events + k-factor source), `PRPs/sprint-status.yaml` (M), `output/at-home-checklist/...` (M), this story (A/M)

### Change Log

- 2026-07-14 — Story 6.5 implemented: PostHog funnel-edge events across landing/pricing/anon-analyze/resume surfaces + attribution drain, all PII-free via the 10.3 no-op-safe wrapper. Epic 6 complete. Gates green (vitest 816). Status → review.
- 2026-07-14 — 2-layer adversarial review (privacy-focused): 5 patch groups. Gates post-patch: vitest 817. Status → done.

## Senior Review Record (2026-07-14)

_Blind Hunter + Edge Case Hunter — a privacy audit of the telemetry. Both converged; Edge Hunter verified the identify-ordering (report_claimed lands under the anon distinct_id, then identify stitches — correct), no null job_id, and static-render safety._

**Patched (5):**
- **P1 (CRITICAL) — attribution `source` forwarded de-anonymizing values.** A `share_{token}` resolves to a specific account; `?ref=` is uncontrolled free text (`?ref=jane@x.com`). Both went verbatim into `report_claimed.source`, breaking the PII-free contract. Fix: `sanitizeSource` reduces a share token to the CHANNEL `"share"` (per-share/viral join stays server-side via the /register `?via=` handler) and slugifies a ref to `[a-z0-9-]` capped at 32 (drops non-slug junk). Tests pin token→channel + ref slugify + junk-dropped.
- **P2 — `analyze_completed` fired on RESTORE with no paired `analyze_started`** (returning visitor whose completed report is restored) → inflated completions + orphaned/negative TTFI. Fix: `startedThisSessionRef` gates it — fires only for a job this mount actually uploaded.
- **P2 — `checkout_started` fired before the auth gate** (anon click → bounce to /register, no Stripe redirect) → inflated free→paid edge. Fix: moved to fire ONLY after the validated Stripe URL, immediately before the redirect.
- **P3 — `||` not `??`** so an empty `?via=` no longer shadows the `?ref=` fallback.
- **P3 — `ATTRIBUTION_KEY` exported + bound** — the two writers (`r.$token.tsx`, `ProducerCta.tsx`) now import the const instead of a duplicated `'spectr_attribution'` literal (drift = broken feature with no failing test, closed). Vacuous static-markup resume test replaced with the DOM click assertion.

**Accepted / recorded (deferred-work):** attribution attaches only on the /analyze inline claim (register-path signup attribution is a follow-up — the server-side `?via=` still has it); stale-first-attach (bounded); resume_clicked/view-event delivery on full-nav / StrictMode double-fire (low-impact counts); post-register de-anonymization is by design (documented in the runbook).

**Gates post-patch:** tsc 0 · lint clean · build ✓ · vitest 817/817. Frontend-only.
