# Story 10.6: Abuse Containment

Status: review

## Story

As the operator,
I want layered automated abuse controls,
So that a scripted free-tier abuser is contained before I wake up (Journey 6).

## Acceptance Criteria

1. **Given** per-account caps + disposable-email throttling (FR47), **When** an abuser scripts analyses through disposable emails, **Then** automated controls contain it without operator action.
2. **Given** a ban, **When** the operator bans an account, **Then** access revokes and the action audits.
3. **Given** the anonymous limits from Epic 4, **When** combined with account caps, **Then** layered limits hold under scripted load (test simulates the J6 scenario).

## Decisions of record (recon 2026-07-03)

1. **The gap is CROSS-ACCOUNT**: per-account caps already exist (`free_analyses_per_month` at the dispatch chokepoint, 409 `entitlement_exhausted`); N disposable accounts get N× the cap and registration's only brake is 5/min/IP. Two new layers close it:
   (a) **Disposable-email THROTTLING, not blocking** (false positives + arms race): a curated domain list (`DisposableEmailService`, embedded ~460-line list + `disposable_extra_domains` feature flag for zero-deploy additions via the 10.5 admin surface). Disposable registrations get a second, much tighter limiter arm (`auth_register_disposable`, flag `disposable_register_per_hour_ip` default 2/h/IP) and disposable FREE accounts get a reduced analysis cap (flag `disposable_free_analyses` default 1) enforced at dispatch.
   (b) **Cross-account per-IP dispatch throttle**: free-tier dispatches gain a per-IP limiter arm (`analysis_dispatch`, flag `dispatch_per_ip_hourly` default 10/h — generous for humans/NAT, fatal for 50-analysis scripts). Paid tiers exempt (they pay per unit). Fail-open like every limiter.
2. **`DispatchAnalysisAsync` grows an `HttpContext` parameter** (7 call sites) — the chokepoint stays single; abuse checks CANNOT be bypassed via an unwired dispatch path. Services (limiter, disposable list, flags) resolve from RequestServices.
3. **AC2 is already satisfied by 10.5** (ban revokes sessions ≤60 s, blocks login/refresh 403, audits) — this story only VERIFIES it inside the J6 test.
4. **AC3 test = `AbuseContainmentTests`** (RateLimits enabled per-factory, the AuthFlowTests precedent): scripted registration burst → 429 at 6; disposable-domain registration hits the tighter arm; N accounts same-IP free dispatches contained at the per-IP ceiling; banned account's token dead + login 403 (the 10.5 verify). Epic 4's anon device limits (1-active-per-device) remain 6.3's dispatch vertical — the J6 test covers the ACCOUNT layers + documents that boundary honestly.
5. **All knobs are feature flags** (numeric-suffix families → the 10.5 typed-flag guard validates them): `disposable_register_per_hour_ip`, `disposable_free_analyses`, `dispatch_per_ip_hourly`. Operator tunes mid-incident with an audit trail, no deploy.
6. **Out of scope**: MX/SMTP verification (cost/latency, verify-gate already exists), CAPTCHA (UX cliff pre-launch), device-fingerprint correlation (6.3's vertical), `charge.refunded` mirroring (still noted).

## Tasks / Subtasks

- [x] Task 1 — `DisposableEmailService`: ~66 curated builtin domains + `disposable_extra_domains` flag extension (60 s cached, fail-open — a fresh abuser domain is one audited flag write from contained)
- [x] Task 2 — register: second tighter per-IP arm for disposable domains (`auth_register_disposable`, flag-tuned); dispatch chokepoint: disposable reduced cap (same 409 `entitlement_exhausted` UX) + free-tier per-IP ceiling (429 `rate_limited`; paid tiers exempt — a paying "abuser" is a customer); `DispatchAnalysisAsync` gained `HttpContext` (7 call sites threaded — no bypassable dispatch path)
- [x] Task 3 — `SeedAbuseFlags` migration: 4 knobs, ON CONFLICT DO NOTHING (2.6 precedent), numeric families covered by the 10.5 typed-flag guard
- [x] Task 4 — `AbuseContainmentTests` (5): detection unit (builtin + case + non-email), J6 registration burst → 429, disposable third-registration dies on the tighter arm, disposable cap at dispatch (normal cap has room, disposable cap doesn't), cross-account 3-accounts-1-IP ceiling (registers on the limits-off base factory to avoid shared-key races; clears the 1-HOUR window's leftover keys up front — full-suite lesson)
- [x] Task 5 — runbook Abuse response (layer table + mid-incident play via the 10.5 flags API). Gates: BFF 339/339 (5 new), worker/frontend untouched

## Dev Notes

- Limiter checks: register-disposable arm keyed `ip:{ip}` both arms (same-IP scripting is the threat); dispatch arm actor `user:{userId}` + ip — the IP arm is the cross-account net.
- Disposable cap at dispatch: count = the SAME usage query EntitlementService uses; disposable && free && used >= disposable_cap → 409 `entitlement_exhausted` (same code — the client UX is identical).
- Embedded list source: curated common providers (mailinator, guerrillamail, yopmail, temp-mail, 10minutemail, sharklasers, trashmail families…). Store lowercase, one per line, `#` comments. Lookup: exact domain + one-level parent (a.b.mailinator.com → b.mailinator.com? just exact + registrable-suffix contains check — keep exact-match simple + document).
- Flag seeds: `INSERT ... ON CONFLICT (name) DO NOTHING` migration (2.6 precedent).
- Test IP: WebApplicationFactory connections share one IP — perfect for same-IP scripting simulation.

### References

- [Source: PRPs/epics.md L1236-1248, FR47 L102, AR26 L204, NFR8 L120; prd.md L136 (J6)]
- [Source: recon — DispatchAnalysisAsync L1052 (chokepoint + 7 sites), RedisRateLimiter sliding-window + fail-open sites, register 5/min/IP, EntitlementService flags, 10.5 ban/flag machinery]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Full-suite flake root-caused: the dispatch arm's 1-HOUR sliding window persisted across runs — the test clears `ratelimit:analysis_dispatch:*` up front.

### Completion Notes List

- AC1: throttling, never blocking — disposable users still register (slowly) and still get 1 analysis; the arms race is fought with a flag write, not a deploy.
- AC2: verified via 10.5's machinery (ban lifecycle test there covers revoke+audit).
- AC3: J6 simulated — the per-IP dispatch ceiling is the layer per-account caps can't provide; Epic 4's device limits stay 6.3's anon vertical (boundary documented).
- All knobs live-tunable + audited via the 10.5 admin surface.

### File List

- BFF: `Services/DisposableEmailService.cs` (new), `Endpoints/AuthEndpoints.cs` (disposable arm + flag helper), `Endpoints/VersionEndpoints.cs` (dispatch layers + HttpContext threading), `Endpoints/UploadEndpoints.cs` (threading), `Program.cs` (DI)
- Data: migration `SeedAbuseFlags`
- Tests: `AbuseContainmentTests.cs` (new, 5)
- Docs: `docs/runbook.md` (Abuse response)

### Change Log

- 2026-07-03: implemented on `ops/10-6-abuse`. Gates: BFF 339/339. Status → review.
