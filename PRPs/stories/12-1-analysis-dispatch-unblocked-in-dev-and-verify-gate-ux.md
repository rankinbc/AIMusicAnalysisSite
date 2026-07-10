# Story 12.1: Analysis Dispatch Unblocked in Dev & Verify-Gate UX

Status: ready-for-dev

## Story

As a developer (and any unverified free-tier user),
I want the email-verify gate to be satisfiable and clearly communicated,
so that analyses after the first do not fail with an opaque "HTTP 403" and the local dev loop never dead-ends.

## Background (audit evidence)

2026-07-10 full-app audit (`output/audit/2026-07-10_full-app-audit/findings.md` §1) identified this as the PRIME SUSPECT for the reported "upload works once, then every analysis fails" behavior:

- The story-4.5 second-analysis verify gate (`VersionEndpoints.cs:1176-1194`, inside `DispatchAnalysisAsync`) returns `403 email_verification_required` for free-tier users with `EmailVerifiedAt == null` and any prior non-failed job. **Unconditional — not gated by `RateLimits:Enabled`.**
- In local dev the verification email is enqueued but never delivered (`RESEND_API_KEY` empty → `send_email` actor key-less stub), so the gate can never be satisfied.
- The frontend renders the failure as a generic `HTTP 403` toast (`fetcher.ts:9` default message; `UnifiedUploadDialog.tsx:590-594` generic catch) — only `entitlement_exhausted` is special-cased (`:578`).
- Bonus finding: the story-10.6 disposable-email dispatch arm (`VersionEndpoints.cs:1117-1145`, cap=1) is NOT gated by the `limitsOn` flag computed at `:1115` — only the per-IP arm (`:1149`) is. A dev registering with a disposable/test domain gets one analysis then a mislabeled `409 entitlement_exhausted`.

## Acceptance Criteria

1. **Given** `ASPNETCORE_ENVIRONMENT=Development`, **When** a user registers, **Then** the account is auto-verified OR the verification link is logged to the BFF console — the second-analysis gate is satisfiable locally without Resend. (Both mechanisms acceptable; see Dev Notes for the recommended combination.)
2. **Given** a dispatch rejected with `email_verification_required`, **Then** the frontend shows a clear message ("Verify your email to run another analysis") with a resend-verification action — never a raw "HTTP 403" toast. Generic `ApiError` messages prefer the server envelope `message` when present.
3. **Given** an unverified logged-in user, **Then** a persistent dismissible banner in the app shell offers verify status + resend.
4. **Given** Development (or `RateLimits:Enabled=false`), **Then** the disposable-email dispatch cap is gated behind the same `limitsOn` knob as the per-IP arm.
5. **Given** any dispatch-path 4xx, **Then** a test asserts the response carries a machine-readable `error.code`, and the frontend keys off `code` (never message text).

## Tasks / Subtasks

- [ ] Task 1: Dev verify-gate satisfiability (AC: 1)
  - [ ] In `SendVerificationEmailAsync` (`AuthEndpoints.cs:75-85`), when environment is Development, log the constructed `verifyUrl` at Information level to the BFF console (it already builds the exact URL — one `ILogger` call).
  - [ ] Add config-gated auto-verify: `Auth:DevAutoVerify` (default `true` ONLY in `appsettings.Development.json`, absent elsewhere). When true, `Register` (`AuthEndpoints.cs:~236`) sets `EmailVerifiedAt = DateTimeOffset.UtcNow` at creation. Follow the story-4.1 pattern of dev-only settings living in `appsettings.Development.json` (see `// Keys` comment there).
  - [ ] `dev-login` (`AuthEndpoints.cs:294`) target account: ensure verified (idempotent `??=` like `:607`).
  - [ ] Guard: production boot must NOT honor `Auth:DevAutoVerify` — mirror the dev-login environment guard (404-inert outside Development).
- [ ] Task 2: Frontend error surfacing (AC: 2, 5)
  - [ ] `fetcher.ts` `ApiError`: derive `message` from the AR38 envelope (`extractApiError(body).message`, `error-utils.ts:15`) with `HTTP {status}` as fallback only.
  - [ ] `UnifiedUploadDialog.tsx` catch (`:575-595`): add an `email_verification_required` branch beside the existing `entitlement_exhausted` one — toast with verify copy + "Resend email" action (`POST /auth/resend-verification`, already exists `AuthEndpoints.cs:28`).
  - [ ] Same handling on the song-page "retry analysis" path (`/versions/{id}/analyze` caller hook).
- [ ] Task 3: Unverified banner (AC: 3)
  - [ ] App shell (`_app.tsx`): when `me.emailVerifiedAt == null` (profile DTO already exposes it — `AccountEndpoints.cs:66`), render a dismissible banner "Verify your email to unlock more analyses" with a resend button (debounced; success/failure toast). Dismiss state in localStorage, re-shown after a verify-gated 403.
  - [ ] Banner hidden for pro/credits tiers (gate exempts them) and for verified users.
- [ ] Task 4: Disposable arm gating (AC: 4)
  - [ ] Wrap the disposable-domain arm (`VersionEndpoints.cs:1117-1145`) in the existing `limitsOn` check (`:1115`), matching the per-IP arm structure at `:1149`.
  - [ ] Update/extend `AbuseContainmentTests` (J6, story 10.6) — existing disposable-cap tests must set `RateLimits:Enabled=true` explicitly; add one test proving the arm is OFF when the knob is false.
- [ ] Task 5: Error-code contract (AC: 5)
  - [ ] BFF test: dispatch-path rejections (`email_verification_required`, `entitlement_exhausted`, `insufficient_credits`, `rate_limited`, `entitlements_unavailable`) each return the AR38 envelope with the expected `error.code`.
  - [ ] Frontend vitest: `ApiError` message derivation + dialog branch keyed on `code`.
- [ ] Task 6: Validation gates (all)
  - [ ] BFF: `dotnet build && dotnet test`
  - [ ] Frontend: `npx vite build` first (routeTree.gen), then `npx tsc -b`, `npm run lint` + `lint:css`, `npx vitest run`
  - [ ] No Python changes expected; if any, `uvx ruff@0.15.11 check` + per-component pytest

## Dev Notes

### Verified code anchors (2026-07-10 — re-verify before large refactors)

- **Gate:** `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:1176-1194` — free/anon tier + `EmailVerifiedAt is null` + `AnyAsync(j.Status != "failed")` → `ErrorEnvelope.Build(403, "email_verification_required", ...)`. Failed jobs already excluded — do not re-add that logic.
- **Disposable arm:** `VersionEndpoints.cs:1117-1145` — 409 `entitlement_exhausted` at cap (flag `disposable_free_analyses`, default 1). `limitsOn` computed at `:1115`, currently used only by the per-IP arm (`:1149-1173`).
- **Email send:** `AuthEndpoints.cs:75-85` `SendVerificationEmailAsync` builds `{FrontendOrigin}/verify-email?token={raw}`; called from `Register` (`:236-241`, failure-tolerant) and `ResendVerification` (`:477-497`).
- **Verify/resend endpoints exist** (story 4.3): `POST /auth/verify-email` (anon), `POST /auth/resend-verification` (authed, 204, no-op if already verified `:493`).
- **Envelope:** `Endpoints/ErrorEnvelope.cs` — `{ error: { code, message, details } }` (AR38). Server side already conforms; this story's contract work is frontend + tests only.
- **Frontend:** `src/api/fetcher.ts:7-11` (`ApiError`, message defaults `HTTP {status}`, body kept), `src/api/error-utils.ts:15` (`extractApiError` → `{code, message}` — REUSE, do not reinvent), `src/components/UnifiedUploadDialog.tsx:575-595` (catch block; `entitlement_exhausted` pattern to copy at `:578`).
- **Profile DTO:** `AccountEndpoints.cs:66` returns `EmailVerifiedAt` — banner needs no new endpoint.
- **RateLimits dev-off:** `appsettings.Development.json:15-18` + comment explains why (test suite registers hundreds of accounts).

### Constraints & gotchas

- **Never weaken the gate outside Development.** `Auth:DevAutoVerify` must be read like the dev-login guard (inert unless `IHostEnvironment.IsDevelopment()`), not just config-absent. Defense in depth: env check AND config flag.
- **Do not gate the verify gate itself behind `limitsOn`** — it is abuse control (AR26), not rate limiting. Only the disposable arm moves under `limitsOn` (it is throttling, per its own comment "throttling layer only").
- **CORS/auth test style:** BFF integration tests silently no-op without Postgres (known false-green issue, story 12-7) — run with the dev stack up to get real signal.
- **Known BFF parallel-run flakes** (CoachStream etc.) — re-run before diagnosing failures.
- **Frontend conventions:** TS strict + `verbatimModuleSyntax` (`import type`), CSS Modules + global utility classes, no new deps, fetcher-only HTTP (no axios), Sonner `toast` for messages.
- **Banner placement:** `_app.tsx` shell already hosts NotificationBell etc. — follow existing shell patterns; component-specific styles in a `*.module.css`.
- **`Register` currently swallows email-send failures** (`:236-241` try/catch) — keep that behavior; the console-logged link must come from inside `SendVerificationEmailAsync` before the enqueue so it appears even when the queue is down.

### Testing standards

- BFF: xunit integration tests in `components/bff/tests/` — follow `AbuseContainmentTests` (J6) and story 4-5 verify-gate test patterns (search `email_verification_required` in tests for existing coverage to extend, not duplicate).
- Frontend: vitest + jsdom static-render style used across `src/**/*.test.tsx`; mock `fetcher` per existing test utilities.

### Project Structure Notes

- BFF endpoints stay in their existing files (`AuthEndpoints.cs`, `VersionEndpoints.cs`, `AccountEndpoints.cs`) — no new endpoint groups needed.
- New frontend banner component under `src/components/` (shell-level, not a feature folder), e.g. `VerifyEmailBanner.tsx` + module CSS.
- No DB migrations. No new env vars beyond `Auth:DevAutoVerify` in `appsettings.Development.json` (document in root `.env.example` comment only if touched).

### References

- [Source: output/audit/2026-07-10_full-app-audit/findings.md §1 (P0-1, P1-4)]
- [Source: PRPs/epics.md — Epic 12, Story 12.1]
- [Source: PRPs/stories/4-5-anonymous-devices-and-claim.md — AC5 verify-gate origin]
- [Source: PRPs/stories/4-3-email-verification-and-password-reset.md — verify/resend flows]
- [Source: docs/runbook.md — abuse-control intent for the verify gate (no dev bypass was documented as intended; this story adds the sanctioned dev path)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
