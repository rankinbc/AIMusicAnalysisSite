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
        HttpContext http, AppDbContext db, DeviceService devices, DemoSeeder seeder,
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

        var now = DateTimeOffset.UtcNow;
        var deviceId = devices.ReadDeviceId(http.Request);

        // 2 — resume. HMAC-verified cookie only; never consumes a limit.
        if (deviceId is not null)
        {
            var existing = await db.Users.FirstOrDefaultAsync(u => u.IsGuest && u.GuestDeviceId == deviceId
                && u.GuestExpiresAt > now && u.BannedAt == null && u.IsActive, ct);
            if (existing is not null)
            {
                var found = await seeder.FindAsync(existing.Id, ct) ?? await seeder.SeedAsync(existing.Id, CancellationToken.None);
                if (found is not null) return await SignInAsync(existing, found, resumed: true);
            }
        }

        // 3 — rate limit, fail CLOSED. Skipped only when RateLimits:Enabled=false
        // (dev/test), like every other limiter in the codebase.
        if (!string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
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

        var seeded = await seeder.SeedAsync(id, CancellationToken.None);
        if (seeded is null)
        {
            // Nothing to show — never hand out an empty sandbox. SeedAsync
            // already cleared its own tracker on failure.
            await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(CancellationToken.None);
            return Unavailable();
        }
        return await SignInAsync(user, seeded, resumed: false);

        async Task<IResult> SignInAsync(User u, DemoSeedResult demo, bool resumed)
        {
            var expires = u.GuestExpiresAt!.Value;
            var (raw, _) = await refresh.IssueAsync(u.Id, expires, ct);
            http.Response.Cookies.Append(RefreshTokenService.CookieName, raw, refresh.CookieOptions(expires));
            return Results.Ok(new DemoStartResponse(
                jwt.Issue(u),
                new AuthedUser(u.Id, u.Email, u.DisplayName, "free", true),
                new DemoTarget(demo.SongId, demo.VersionId, demo.JobId),
                resumed));
        }
    }

    // Copy rule (solo principle, spec D2): never describe load or other
    // visitors — no "busy", "queued", "too many visitors".
    private static IResult Unavailable() =>
        ErrorEnvelope.Build(503, "demo_unavailable", "The demo is taking a break — analyze your own track instead.");

    private static IResult Capacity() =>
        ErrorEnvelope.Build(503, "demo_capacity", "The demo is taking a break — analyze your own track instead.");
}
