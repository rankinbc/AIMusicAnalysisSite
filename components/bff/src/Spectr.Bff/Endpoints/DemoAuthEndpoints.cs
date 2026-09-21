using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Endpoints;

// Task D5 — POST /api/auth/demo: one click mints an isolated, purgeable
// GUEST account (a real users row, D1) seeded with the demo song (D3
// DemoSeeder), fail-closed end to end (spec D2). A returning device resumes
// its unexpired guest instead of minting another.
public static class DemoAuthEndpoints
{
    public static IEndpointRouteBuilder MapDemoAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/auth").MapPost("/demo", Start).AllowAnonymous();
        return app;
    }

    private static async Task<IResult> Start(
        HttpContext http, AppDbContext db, DeviceService devices, IGuestSeeder seeder,
        JwtTokenService jwt, RefreshTokenService refresh, PasswordHasher hasher, EntitlementService ents,
        IRateLimiter limiter, IConfiguration cfg, ILoggerFactory lf, CancellationToken ct)
    {
        var log = lf.CreateLogger("Demo");
        Dictionary<string, string> flags;
        try { flags = await ents.GetFlagsAsync(ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "flags unavailable — demo fails closed");
            return Unavailable();
        }

        // 1 — kill switch. Config key wins over the DB flag.
        if (!GuestIdentity.DemoEnabled(cfg, flags)) return Unavailable();

        var rateLimitsEnabled = !string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
        var now = DateTimeOffset.UtcNow;
        var deviceId = devices.ReadDeviceId(http.Request);

        // Fix round 1 (I2) — everything below touches the DB or an external
        // limiter; NONE of it may surface as a raw 500. mintedUserId tracks a
        // row THIS request committed, so a failure downstream of the insert
        // can compensate (delete it) instead of burning a cap slot on a guest
        // nobody can ever reach.
        Guid? mintedUserId = null;
        try
        {
            // 2 — resume. HMAC-verified cookie only; never consumes the
            // CREATION limit (spec D2) — it has its own, separate limit below.
            // Fix round 1 (I4): OrderByDescending — a device can end up with
            // two guest rows (e.g. an earlier orphaned one); always resume
            // the newest.
            if (deviceId is not null)
            {
                var existing = await db.Users
                    .Where(u => u.IsGuest && u.GuestDeviceId == deviceId
                        && u.GuestExpiresAt > now && u.BannedAt == null && u.IsActive)
                    .OrderByDescending(u => u.CreatedAt)
                    .FirstOrDefaultAsync(ct);
                if (existing is not null)
                {
                    // Fix round 1 (C1-ii) — a generous, SEPARATE limiter key so a
                    // cookie holder can't turn "free" resumes into unlimited
                    // unauthenticated DB writes. Fails CLOSED like creation.
                    if (rateLimitsEnabled)
                    {
                        try
                        {
                            var resumeIp = VersionEndpoints.NormalizeIpForLimiting(http.Connection.RemoteIpAddress) ?? "unknown";
                            var resumeVerdict = await limiter.CheckAsync($"device:{deviceId}", resumeIp, "demo_resume",
                                60, TimeSpan.FromHours(1), ct);
                            if (!resumeVerdict.Allowed)
                                return ErrorEnvelope.Build(429, "rate_limited", "You've reopened the demo a few times already — try again in a bit.");
                        }
                        catch (OperationCanceledException) { throw; }
                        catch (Exception ex)
                        {
                            log.LogError(ex, "demo resume limiter unavailable — failing CLOSED");
                            return Unavailable();
                        }
                    }

                    var found = await seeder.FindAsync(existing.Id, ct) ?? await seeder.SeedAsync(existing.Id, CancellationToken.None);
                    if (found is not null) return await SignInAsync(existing, found, resumed: true);

                    // Fix round 1 (I4) — a guest with no reachable demo (find and
                    // seed both came back empty, no exception) is a dead end.
                    // Expire it now so this device can never flap between the
                    // orphan and a freshly minted sandbox.
                    existing.GuestExpiresAt = now;
                    await db.SaveChangesAsync(ct);
                }
            }

            // 3 — rate limit, fail CLOSED. Skipped only when RateLimits:Enabled=false
            // (dev/test), like every other limiter in the codebase.
            if (rateLimitsEnabled)
            {
                try
                {
                    // WHY: prod correctness of the ip: arm depends on
                    // ForwardedHeaders:Enabled=true (infra/compose.prod.yml) so
                    // RemoteIpAddress is the real client IP behind Caddy —
                    // without it every visitor shares ONE proxy IP and the demo
                    // becomes a global 5/hour for everyone.
                    var ip = VersionEndpoints.NormalizeIpForLimiting(http.Connection.RemoteIpAddress) ?? "unknown";
                    // Never one shared "none" bucket when there's no device cookie yet.
                    var actor = deviceId is null ? $"ip:{ip}" : $"device:{deviceId}";
                    var verdict = await limiter.CheckAsync(actor, ip, "demo_create",
                        GuestIdentity.Flag(flags, "demo_guests_per_ip_hourly", 5), TimeSpan.FromHours(1), ct);
                    if (!verdict.Allowed)
                        return ErrorEnvelope.Build(429, "rate_limited", "You've started the demo a few times already — try again in a bit.");
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    log.LogError(ex, "demo limiter unavailable — failing CLOSED");
                    return Unavailable();
                }
            }

            // 4 — daily DB backstop. Always on (no Redis dependency).
            // Controller ruling: the read-then-insert race here is ACCEPTED —
            // the per-IP/per-device limiter above already fronts request
            // volume, so a handful of concurrent requests overshooting the
            // cap by one or two is tolerable and not worth a transaction.
            var cap = int.TryParse(cfg["Demo:DailyCap"], out var c) ? c : GuestIdentity.Flag(flags, "demo_guests_daily_cap", 300);
            if (await db.Users.CountAsync(u => u.IsGuest && u.CreatedAt > now.AddHours(-24), ct) >= cap)
                return Capacity();

            // 5 — mint + seed.
            var device = await devices.GetOrCreateAsync(http, ct);
            var id = Guid.NewGuid();
            var user = new User
            {
                Id = id,
                Email = GuestIdentity.EmailFor(id),
                HashedPassword = GuestIdentity.SharedPasswordHash(hasher),
                EmailVerifiedAt = now,
                NotifyAnalysisComplete = false,
                DisplayName = "Guest",
                IsGuest = true,
                GuestExpiresAt = now.AddHours(GuestIdentity.Flag(flags, "guest_ttl_hours", 72)),
                GuestDeviceId = device.Id,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync(ct);
            mintedUserId = id; // committed — any failure from here compensates by deleting this row

            var seeded = await seeder.SeedAsync(id, CancellationToken.None);
            if (seeded is null)
            {
                // Nothing to show — never hand out an empty sandbox. SeedAsync
                // already cleared its own tracker on failure.
                await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(CancellationToken.None);
                return Unavailable();
            }
            return await SignInAsync(user, seeded, resumed: false);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "demo start failed unexpectedly — failing closed");
            if (mintedUserId is { } uid)
            {
                try { await CompensateAsync(db, uid); }
                catch (Exception cleanupEx)
                {
                    log.LogError(cleanupEx, "guest compensation cleanup failed for {UserId}", uid);
                }
            }
            return Unavailable();
        }

        async Task<IResult> SignInAsync(User u, DemoSeedResult demo, bool resumed)
        {
            var expires = u.GuestExpiresAt!.Value;
            // Fix round 1 (C1-i) — at most ONE live refresh row per guest: a
            // resumed cookie can be replayed indefinitely for free (no
            // password), so without this each resume call would insert an
            // unbounded number of rows for the same guest.
            await db.RefreshTokens.Where(t => t.UserId == u.Id).ExecuteDeleteAsync(ct);
            var (raw, _) = await refresh.IssueAsync(u.Id, expires, ct);
            http.Response.Cookies.Append(RefreshTokenService.CookieName, raw, refresh.CookieOptions(expires));
            return Results.Ok(new DemoStartResponse(
                jwt.Issue(u),
                new AuthedUser(u.Id, u.Email, u.DisplayName, "free", true),
                new DemoTarget(demo.SongId, demo.VersionId, demo.JobId),
                resumed));
        }
    }

    // Fix round 1 (I2) — deletes a guest row this request minted (and
    // whatever DemoSeeder may have partially seeded for it) when a LATER
    // step throws. Never touches a pre-existing (resumed) guest — that row
    // was never "minted" by this request.
    private static async Task CompensateAsync(AppDbContext db, Guid userId)
    {
        var analysisIds = await db.Analyses.Where(a => a.UserId == userId).Select(a => a.Id).ToListAsync();
        await db.Verdicts.Where(v => analysisIds.Contains(v.AnalysisId)).ExecuteDeleteAsync();
        var convoIds = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
        await db.CoachMessages.Where(m => convoIds.Contains(m.ConversationId)).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        var songIds = await db.Songs.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync();
        var versionIds = await db.SongVersions.Where(v => songIds.Contains(v.SongId)).Select(v => v.Id).ToListAsync();
        await db.RackPresets.Where(p => versionIds.Contains(p.SongVersionId)).ExecuteDeleteAsync();
        await db.SongVersions.Where(v => songIds.Contains(v.SongId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // Copy rule (solo principle, spec D2): never describe load or other
    // visitors — no "busy", "queued", "too many visitors".
    private static IResult Unavailable() =>
        ErrorEnvelope.Build(503, "demo_unavailable", "The demo is taking a break — analyze your own track instead.");

    private static IResult Capacity() =>
        ErrorEnvelope.Build(503, "demo_capacity", "The demo is taking a break — analyze your own track instead.");
}
