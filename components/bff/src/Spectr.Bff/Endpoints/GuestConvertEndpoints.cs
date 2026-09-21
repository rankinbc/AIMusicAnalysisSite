using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Task G2 (spec G-D4) — POST /api/auth/guest/convert: a guest who registers
// keeps the SAME users row (same id — songs, analyses, coach conversation,
// rack presets are all untouched). This is the product's conversion moment
// (PRPs/guest-first-upload.md): "Create a free account and let's save our
// progress" must be literally true.
//
// Deliberately reuses AuthEndpoints.Register's building blocks — rate
// limiter, disposable-domain arm, email/password validation, dev
// auto-verify, verification-email dispatch — rather than re-implementing
// them (see the `internal` visibility bump on those helpers). The one new
// piece is GuestConversion.TryConvertAsync, the single atomic UPDATE.
public static class GuestConvertEndpoints
{
    public static IEndpointRouteBuilder MapGuestConvertEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/auth").MapPost("/guest/convert", Convert)
            .RequireAuthorization().AllowGuest();
        return app;
    }

    private static async Task<IResult> Convert(
        RegisterRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        PasswordHasher hasher,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        AuthTokenService authTokens,
        IEmailSender email,
        IConfiguration cfg,
        IWebHostEnvironment env,
        IRateLimiter limiter,
        IMemoryCache cache,
        ILoggerFactory loggerFactory,
        HttpContext httpCtx,
        HttpResponse resp,
        CancellationToken ct)
    {
        // Only a LIVE guest may convert. A real (non-guest) user hitting
        // this route is refused before anything else runs — no rate-limit
        // slot spent, no email touched, no DB write.
        if (!currentUser.IsGuest())
            return ErrorEnvelope.Build(403, "not_a_guest", "This account isn't a guest session.");

        var userId = currentUser.UserId();

        // Same per-IP ceiling as register (AuthEndpoints.cs :162-180) — a
        // conversion is a registration in every abuse sense, fail-closed
        // identically.
        if (await AuthEndpoints.RateLimitAsync(limiter, httpCtx, "auth_register",
                $"ip:{AuthEndpoints.ClientIp(httpCtx)}", 5, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["email"] = ["Valid email required."] });

        var disposables = httpCtx.RequestServices.GetRequiredService<DisposableEmailService>();
        if (await disposables.IsDisposableAsync(req.Email, ct))
        {
            var perHour = await AuthEndpoints.ReadNumericFlagAsync(httpCtx, "disposable_register_per_hour_ip", 2, ct);
            if (await AuthEndpoints.RateLimitAsync(limiter, httpCtx, "auth_register_disposable",
                    $"ip:{AuthEndpoints.ClientIp(httpCtx)}", perHour, TimeSpan.FromHours(1), ct) is { } deniedDisposable)
                return deniedDisposable;
        }
        if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 8)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["password"] = ["At least 8 characters required."] });
        if (req.Password.Length > 256)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["password"] = ["At most 256 characters."] }); // BCrypt truncates at 72 bytes; a MB-sized value is a hash-DoS

        var normalizedEmail = req.Email.Trim();
        // The reserved guest domain can never be a real target address.
        if (GuestIdentity.IsGuestEmail(normalizedEmail))
            return ErrorEnvelope.Build(400, "invalid_email", "That email address can't be used.");

        var existing = await db.Users.AnyAsync(u => u.Email == normalizedEmail, ct);
        if (existing) return ErrorEnvelope.Build(409, "email_taken", "Email already registered.");

        var displayName = AuthEndpoints.DeriveDisplayNameFromEmail(normalizedEmail);
        var autoVerify = env.IsDevelopment()
            && string.Equals(cfg["Auth:DevAutoVerify"], "true", StringComparison.OrdinalIgnoreCase);
        var now = DateTimeOffset.UtcNow;

        int rows;
        try
        {
            rows = await GuestConversion.TryConvertAsync(
                db, userId, normalizedEmail, hasher.Hash(req.Password), displayName, autoVerify, now, ct);
        }
        // TOCTOU belt for the AnyAsync check above — a unique-violation on
        // the email index is still a clean 409, never a raw 500. ExecuteUpdate
        // can surface either shape depending on provider/version.
        catch (DbUpdateException ex) when (DbViolations.IsUniqueViolation(ex))
        {
            return ErrorEnvelope.Build(409, "email_taken", "Email already registered.");
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == "23505")
        {
            return ErrorEnvelope.Build(409, "email_taken", "Email already registered.");
        }

        // 0 rows: the guest was already converted (a concurrent winner), was
        // never a live guest, or expired between page-load and submit.
        if (rows == 0)
            return ErrorEnvelope.Build(410, "guest_expired",
                "This guest session has ended — create a new account to start again.");

        // The OLD access token must die immediately: evict the 60s tver:
        // cache entry Program.cs's OnTokenValidated reads (Story 4.6
        // precedent) so the next request carrying the stale guest JWT fails
        // "stale token version" instead of riding out its 15-minute TTL.
        cache.Remove($"tver:{userId:N}");

        // The guest's refresh row(s) are deleted outright (not merely
        // revoked) — post-conversion this account has exactly one live
        // session: the one this response mints.
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(ct);
        var (rawRefresh, _) = await refresh.IssueAsync(userId, ct);
        resp.Cookies.Append(RefreshTokenService.CookieName, rawRefresh, refresh.CookieOptions());

        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = userId,
            Action = "guest_converted",
            Target = userId.ToString(),
            Reason = "guest created an account",
        });
        await db.SaveChangesAsync(ct);

        // A device cookie from the guest's browsing has nothing left to
        // claim — this account already has everything an anon-device claim
        // would have re-parented. Clear it like Register does for any
        // presented device cookie.
        DeviceService.ClearCookie(resp);

        // Verification email, BEST-EFFORT — never fails the conversion
        // (Register precedent).
        try
        {
            await AuthEndpoints.SendVerificationEmailAsync(
                email, authTokens, cfg, env, loggerFactory, userId, normalizedEmail,
                AuthEndpoints.IsLoopbackRequest(httpCtx), ct);
        }
        catch (Exception ex)
        {
            loggerFactory.CreateLogger("Auth").LogError(ex,
                "Verification email failed for converted guest {UserId}.", userId);
        }

        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, ct);
        var access = jwt.Issue(user);
        return Results.Ok(new AuthResponse(access,
            new AuthedUser(user.Id, user.Email, user.DisplayName,
                await AuthEndpoints.ResolveTierAsync(db, user.Id, ct))));
    }
}
