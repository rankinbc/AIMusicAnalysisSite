# Task D6 — fix round 1 (from the Opus review of commit 0b63dfe)

The original task brief is `task-D6-brief.md` (same folder); the spec is `PRPs/guest-demo-sandbox.md` (D3, D4, D5, D7, §7). The review CONFIRMED the guard is sound: the filter wraps every nested `/api` group, guest marking survives the fail-open auth path, every analysis entry point is covered, the quota cannot be reset or forged, specialists are one-shot per slug, the coach cap is 20 LIFETIME. What follows is what it required. BFF only (`components/bff`). Do NOT edit `components/worker`.

Already known from the previous (exhausted) implementer — it made NO edits:
- Hard-coded `DramatiqQueues.AnalysisPaid`: `Endpoints/VerdictEndpoints.cs` ~line 77 (lazy `run_triage`) and ~line 191 (`RunSpecialist`); `Endpoints/FixRackEndpoints.cs` ~line 54 (`Generate`). All three handlers already receive the `ClaimsPrincipal`, so `user.IsGuest()` is available.
- `usage_events.event_type` has a DB CHECK constraint (`ck_usage_events_type`, `IN ('analysis','coach_message')`, `AppDbContext.cs` ~224-226) and `RackPreset` has no "pending" status — so DO NOT count fix racks with a usage event. CONTROLLER RULING: bound fix racks with the ATOMIC limiter instead (item 2) — no schema change.

## IMPORTANT
1. **Guest LLM work rides the free lane.** When the caller is a guest, those three enqueues target `DramatiqQueues.AnalysisFree`; real users unchanged. One small helper (e.g. `GuestLimits.QueueFor(ClaimsPrincipal, string defaultQueue)`), not three copies. The worker dispatches by `actor_name`, so an actor declared on `analysis-paid` is consumed fine from `analysis-free`. Check no BFF test pins these enqueue targets in a way this breaks. Test with the recording `IJobQueue`: guest → `analysis-free`, real user → unchanged, for all three.
2. **`POST /api/reports/{id}/fix-rack/` is unbounded per guest** (every POST enqueues an LLM generation; the only brake is the $5/month lane shared by ALL guests, so one attacker kills the demo coach for everyone). New flag `guest_fix_racks_max` (seed `2`). Enforce with `IRateLimiter` — atomic INCR keyed `guest_fix_rack:{userId}`, limit = the flag, window = the guest TTL (`guest_ttl_hours`). Over the limit → 403 `guest_restricted` (ErrorEnvelope). Limiter exception → 503 with friendly copy (FAIL CLOSED). Real users untouched.
3. **Upload quota race.** The filter's read-then-count lets N parallel `POST /api/versions/` all pass (each up to 250 MB) and that route has NO rate limiter. Put an atomic backstop IN FRONT of the count: `IRateLimiter` keyed `guest_upload:{userId}`, limit = `guest_uploads_max`, window = guest TTL; fail CLOSED (503). Test: 8 parallel guest uploads with `RateLimits:Enabled=true` in that factory → exactly `guest_uploads_max` version rows created.
4. **Per-IP analysis arm.** The global `guest_analyses_per_hour` bucket has no per-IP dimension — two IPs can close the demo for everyone. New flag `guest_analyses_per_ip_hourly` (seed `2`), checked BEFORE the global arm, keyed on the normalised client IP (reuse the existing `NormalizeIpForLimiting`; `GuestLimits.CheckAnalysisAsync` already receives `HttpContext` and discards it). Fail closed like the global arm. WHY comment: prod IP correctness depends on `ForwardedHeaders__Enabled=true` in `infra/compose.prod.yml`.
9. **Marker inventory test.** The exhaustive test EXCLUDES every endpoint carrying an allow marker and only 7 of 22 markers have a dedicated test, so a wrongly added `.AllowGuest()` (e.g. on `DELETE /versions/{id}`) is caught by nothing. Add a test that enumerates `EndpointDataSource`, collects every endpoint with `GuestAllowed`/`GuestDenied` as `(HTTP method, raw route pattern, quota kind)` and asserts the set EQUALS a frozen literal list. Opening a route to guests must require editing that list.

Copy rule for every new 503/403: never describe load or other visitors; never the words "jobs queued/waiting".

## MINOR (do all)
- NULL-safe non-demo predicate at both sites in `GuestLimits.cs`: `v.FilePath == null || !v.FilePath.StartsWith("audio/demo/")`.
- `GuestGuardTests.cs` ~164-172 and ~269-277 build a factory without disposing it and register users they never delete; `One_Upload_Then_The_Quota_Closes` writes a WAV nothing deletes — fix all three with the same try/finally + cleanup the other tests use.
- A test that a REAL user can upload two versions and analyze twice (both 2xx) and the dispatch still targets the tier queue, not `analysis-free`.
- Two tests parked from the D5 review (they use the existing `IGuestSeeder` seam in `Services/DemoSeeder.cs` / `Endpoints/DemoAuthEndpoints.cs`): (a) `SeedAsync` returning NULL on the CREATE path of `POST /api/auth/demo` → 503 `demo_unavailable` and NO leftover guest row; (b) the refresh response's literal `Set-Cookie` `Expires` for a guest is ≤ `GuestExpiresAt` (parse the header).
- Accepted as-is, no change: `/uploads/init` can be called repeatedly before the first version exists (10/min limiter + retention sweep).

## Migration
ONE new EF migration seeding the two flags idempotently (`INSERT … ON CONFLICT (name) DO NOTHING`, pattern: `Migrations/20260921023047_SeedDemoFlags.cs`); `Down` deletes exactly those two names. The model snapshot must not change. Scaffold + apply with env `ArtifactsPath` set to your scratch dir (avoids the running BFF's exe lock) and the 127.0.0.1 overrides; verify both rows with a read-only SQL check. Extend the DB-free pin test `GuestSchemaTests.Seed_Migration_Pins_The_Value`-style for the new migration.

## Limits
`GuestLimits.cs` stays under ~500 lines; split `GuestGuardTests.cs` by theme if it passes ~500.

## Commit
ONE commit: `fix(bff): guests get per-guest caps on fix racks and uploads, a per-IP analysis arm, the free lane for LLM work, and a frozen marker inventory`
