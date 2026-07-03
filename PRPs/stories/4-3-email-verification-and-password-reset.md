# Story 4.3: Email Verification & Password Reset

Status: done

## Story

As a user,
I want to verify my email and recover a forgotten password,
So that my account is provably mine and never permanently locked.

## Acceptance Criteria

1. **Given** registration (FR26), **When** I sign up, **Then** a verification email sends with a single-use expiring token **And** verifying marks my account verified.
2. **Given** a forgotten password, **When** I request a reset, **Then** a reset email sends; the token is single-use and expiring; completing the reset invalidates existing sessions.
3. **Given** the auth forms, **When** rendered, **Then** they use the 380 px card, brand mark, mono labels, and cyan focus ring (UX-DR41).
4. **Given** brute-force protection (NFR8), **When** auth endpoints are hammered, **Then** per-IP token-bucket rate limits apply.

## Decisions of record (recon 2026-07-03)

1. **One polymorphic `auth_tokens` table** (mirrors the RefreshToken shape): `id, user_id, purpose ∈ {verify_email, reset_password}, token_hash (SHA-256 hex, unique idx), expires_at, consumed_at, created_at`. Raw token = 32 RNG bytes base64url (RefreshTokenService recipe), rides ONLY in the emailed link. `AuthTokenService.ConsumeAsync` is atomic single-use: `UPDATE ... SET consumed_at=now() WHERE token_hash=@h AND purpose=@p AND consumed_at IS NULL AND expires_at > now() RETURNING user_id` — no read-then-write race.
2. **`users.email_verified_at`** (`DateTimeOffset?`) — timestamp, not bool (audit). Python mirror updated. Verification does NOT gate login or report viewing (AR26: it gates the SECOND analysis — that enforcement is 4.5's device story; only the flag lands here).
3. **Flows**: register → best-effort verification email (`verifyUrl={App:FrontendOrigin}/verify-email?token=…`, 24 h TTL; email failure must never fail registration); `POST /auth/verify-email {token}`; `POST /auth/resend-verification` (auth, no-op when verified); `POST /auth/forgot-password {email}` → **always 204** (no user enumeration) issuing a 30-min reset token only when the account exists+active; `POST /auth/reset-password {token, newPassword}` → BCrypt rehash + **`RevokeAllForUserAsync`** (new set-based bulk revoke — recon: no such capability existed, AC2 was unimplementable without it) + consume the user's other outstanding reset tokens.
4. **AC4 via the EXISTING `IRateLimiter`** (RedisRateLimiter, per-IP + per-actor arms, 429 ErrorEnvelope — ProfileEndpoints precedent). Note recorded: it's a sliding-window log, not literally a token bucket — same guarantee shape, AR26 wording noted. Limits: login 10/min/IP + 5/min per-email actor; register 5/min/IP; forgot-password 3/15 min per-email + 10/min/IP; verify-email + reset-password 10/min/IP; refresh 60/min/IP (legit high-frequency); dev-login exempt (loopback-only already).
5. **AC3 = close the two real gaps** (380 px card + brand mark already live in `_public` layout): `forms.module.css` `.label` → mono uppercase overline; `.input:focus` → `box-shadow: 0 0 0 3px var(--cyan-dim)` (UX-DR41 literal). Global to all forms using the module — intended.
6. **Frontend routes** under `_public/` (inherit 380 px + brand): `verify-email.tsx` (auto-POST on mount from `?token`, success/expired states), `forgot-password.tsx` (always-success messaging), `reset-password.tsx` (`?token` + new password, then to login). Login gains a "Forgot password?" link. Pure/container split for static-render tests (project convention).
7. **4.2 runbook follow-through**: reset links are time-sensitive on the shared maintenance lane — TTL set to 30 min (not 15) partly for this; the outbox-pattern decision stays deferred (queue payload carries the link; exposure window = single-use + 30 min TTL; recorded).
8. Legacy v1 FastAPI auth untouched (AR3).

## Tasks / Subtasks

- [x] Task 1 — schema: `auth_tokens` (purpose polymorphic, unique token_hash + (user,purpose) idx) + `users.email_verified_at`; migration `AddAuthTokensAndEmailVerified`; python mirror (email_verified_at only)
- [x] Task 2 — services: `AuthTokenService` (Issue; ConsumeAsync = atomic `UPDATE … RETURNING user_id`; InvalidateOutstandingAsync) + `RefreshTokenService.RevokeAllForUserAsync` (set-based ExecuteUpdate)
- [x] Task 3 — endpoints: register → best-effort verification email (failure logged, never fails registration); verify-email (400 envelope on dead token); resend-verification (3/15 min per-user, no-op when verified); forgot-password (ALWAYS 204 — invalid input, unknown account, and email-failure all identical; 3/15 min per-email); reset-password (min-8 validated BEFORE consuming the token, rehash + RevokeAll + sibling-token invalidation); rate limits on login (10/min per-email actor + IP arm), register (5/min IP), refresh (60/min IP), verify/reset (10/min IP). **`RateLimits:Enabled=false` in appsettings.Development.json** — the suite registers hundreds/min from one IP; every other env enforces (default on; the 429 test opts back in via UseSetting)
- [x] Task 4 — BFF tests (5): verify roundtrip + single-use replay 400 + garbage 400; forgot no-enumeration (unknown + malformed both 204, no email); reset kills sessions (pre-reset refresh cookie 401) + old password dead + new works + token replay 400 + weak-password-doesn't-consume; resend no-op; login 429 (Redis-gated, opts into limits)
- [x] Task 5 — frontend: `.label` mono uppercase overline + `.input:focus` `box-shadow: 0 0 0 3px var(--cyan-dim)` (UX-DR41 literal); `AuthFlowViews.tsx` pure views + `verify-email`/`forgot-password`/`reset-password` `_public` routes (380 px + brand inherited); StrictMode double-mount guard on the single-use verify POST; login "Forgot password?" link; 3 static-render view tests
- [x] Task 6 — gates: BFF 308/308 (5 new; two RecordingJobQueue fakes now filter `send_email` — registration rides the same IJobQueue); vitest 677 (102 files); tsc/lint/lint:css clean; shared 27 + ruff

## Dev Notes

- Insertion points: `AuthEndpoints.Register` L29-69 (send after commit); DTOs in `AuthDtos.cs`; `App:FrontendOrigin` read from IConfiguration (CORS local var today).
- Email contract (4.2): `Verification` expects `verifyUrl` (URL slot, absolute http/s) + `expiresHours`; `Reset` expects `resetUrl` + `expiresMinutes`. `IEmailSender.SendAsync` handles suppression/enqueue.
- RefreshTokenService: raw 32B base64url → SHA-256 hex hash; rotation single-use. NO token_hash index exists on refresh_tokens (pre-existing; note only).
- IRateLimiter: `CheckAsync(actorKey, ip, action, limit, window)`, both arms must pass; 429 via `ErrorEnvelope.Build(429, "rate_limited", …)`; IP = `Connection.RemoteIpAddress?.ToString() ?? "unknown"`. Redis-gated tests: SpinePrimitivesTests precedent.
- Frontend: `_public.tsx` layout owns 380 px `.column` + brand; `forms.module.css` `.label` currently NOT mono (L28-34), `.input:focus` has NO ring (L17-22); `--cyan-dim = rgba(0,229,176,0.10)`. AuthContext untouched (new pages call `fetcher` directly — anon endpoints). TanStack `validateSearch` for `?token`.
- Anti-enumeration: identical 204 + identical message; timing difference (email issue path) accepted at beta, noted.
- gitleaks: no new secret-like fixtures needed (tokens generated at runtime in tests).

### References

- [Source: PRPs/epics.md L780-791 (ACs); NFR8; AR26 L204; UX-DR41 L289]
- [Source: components/bff/src/Spectr.Bff/{Endpoints/AuthEndpoints.cs,Auth/RefreshTokenService.cs,Auth/PasswordHasher.cs,Services/IRateLimiter.cs,Services/EmailTemplates.cs}]
- [Source: components/frontend-spectr-v2/src/routes/_public.tsx; src/styles/forms.module.css; src/auth/AuthContext.tsx]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- First full-suite run: dozens of failures — the new auth rate limits tripped on the test suite's same-IP registration volume → `RateLimits:Enabled` knob (off in Development.json, on elsewhere, 429 test opts in).
- Second run: CoachConversation + Dispatch suites failed — registration's verification email rides the same IJobQueue their RecordingJobQueue fakes assert against → fakes filter `send_email`.

### Completion Notes List

- AC1: register → single-use 24 h token → verify stamps `email_verified_at`; resend for recovery; email best-effort (never fails registration).
- AC2: 30-min single-use reset token (TTL sized for the shared maintenance email lane per 4.2's runbook note); completing reset rehashes + revokes EVERY refresh token (new `RevokeAllForUserAsync`) + kills sibling reset tokens. Consumption is one atomic UPDATE — no double-consume race.
- AC3: the two real gaps closed (mono overline labels, literal cyan ring); 380 px + brand were already the `_public` layout's.
- AC4: existing RedisRateLimiter wired onto all auth endpoints (per-IP + per-actor arms); noted it's a sliding-window log, not literally a token bucket — same guarantee.
- Anti-enumeration: forgot-password 204 for unknown/malformed/email-failure alike.

### File List

- BFF: `Entities/{AuthToken.cs (new),User.cs}`, `AppDbContext.cs`, migration `AddAuthTokensAndEmailVerified`, `Auth/{AuthTokenService.cs (new),RefreshTokenService.cs}`, `Endpoints/AuthEndpoints.cs`, `DTOs/AuthDtos.cs`, `Program.cs`, `appsettings.Development.json`
- Tests: `AuthFlowTests.cs` (new, 5); `UploadDeferralTests.cs` + `CoachConversationEndpointsTests.cs` (fake filters)
- Shared: `aimusic_shared/models.py` (email_verified_at mirror)
- Frontend: `styles/forms.module.css`, `features/auth/AuthFlowViews.tsx` (new) + test, routes `_public/{verify-email,forgot-password,reset-password}.tsx` (new), `_public/login.tsx`, routeTree.gen
- Config: `.env.example` (RateLimits__Enabled)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter auth-security + Edge Case Hunter/Acceptance Auditor; auditor confirmed the atomic-consume path executed against real Postgres via token-row inspection and ran both suites). Outcome: **Approve after patches** — 15 patches applied:

- [x] [High] **Consume→write not transactional**: a crash between password-save and RevokeAll could commit "password changed, attacker sessions alive"; an inactive user burned their only link on a dead end → BOTH verify-email and reset-password now wrap consume+writes in one transaction (rollback leaves the token retryable)
- [x] [High] **forgot-password timing oracle**: existing accounts did token-insert + enqueue in-request (measurable delta vs unknown accounts) → issue/send moved to a fire-and-forget background scope; every caller gets an identical immediate 204; tests poll for the recorded email
- [x] [High] **Access-JWT survival overclaim**: reset revokes refresh tokens but outstanding access JWTs live ≤15 min → copy/comments now say so honestly; token-versioning deferred to 4.6 (account deletion needs the same mechanism); revoke count logged
- [x] [Med] Unbounded token issuance → `IssueAsync` invalidates prior same-purpose tokens (ONE active link per purpose — a resend kills the old link in a possibly-compromised inbox); `sweep_retention` purges consumed/7-day-expired `auth_tokens` (worker test incl. absent-table tolerance)
- [x] [Med] Redis outage 500'd every auth endpoint → rate limiter fails OPEN with loud log (availability of login beats the limiter)
- [x] [Med] forgot-password spam ceiling: +10/24 h per-email daily cap (3/15 min alone = 288 unsolicited emails/day at a victim)
- [x] [Med] Raw tokens lingered in URL/browser history → both pages capture-then-`history.replaceState` strip the token before any network call
- [x] [Med] No max password length (BCrypt hash-DoS / 72-byte truncation) → 256-char cap on register AND reset
- [x] [Med] `App:FrontendOrigin` localhost fallback duplicated + silent → single `FrontendOrigin` helper with loud warning (boot validation → 10.1)
- [x] [Low] Verify stamps skipped for inactive users (IsActive in the UPDATE predicate); reset now stamps `EmailVerifiedAt` (consuming an emailed link proves mailbox control — no pointless re-verification at the AR26 gate)
- [x] [Low] Frontend raw "HTTP 400" leaked to users → friendly copy always on forgot/reset; verify-email error copy no longer points at a profile-resend UI that doesn't exist yet
- [x] [Low] Cross-purpose test added (verify token worthless on reset endpoint AND not consumed by the attempt); story decision-4 login-limit text reconciled (10/min both arms)
- Deferred: JWT token-versioning/password_changed_at claim (4.6 — per-request DB check needs design); ForwardedHeaders/trusted-proxy for per-IP arms + `Retry-After` header + `SkippableFact` semantics (10.1/10.2); password-changed notification email (4.4 lifecycle emails); `SqlQuery` composability note accepted (empirically verified on EF10/Npgsql, no LINQ composition wraps it — comment documents the constraint).
- Rejected: FK on auth_tokens.user_id (repo convention: no DB-level FKs — story 1.5 B-M1 precedent; 4.6 delete story owns cleanup); per-email login-arm removal (victim-lockout tradeoff beats unmitigated cross-IP credential stuffing; 1-min window).

### Change Log

- 2026-07-03: implemented on `account/4-3-verify-reset`. Gates: BFF 308/308, vitest 677, shared 27, tsc/lint/lint:css/ruff clean. Status → review.
- 2026-07-03 (review): 15 patches applied. Gates after: BFF 309/309 (7 auth-flow tests), worker 576 + 3 xfail, vitest 677, all linters clean.
