using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/auth").WithTags("auth");

        g.MapPost("/register", Register).AllowAnonymous();
        g.MapPost("/login", Login).AllowAnonymous();
        g.MapPost("/dev-login", DevLogin).AllowAnonymous();
        g.MapPost("/refresh", Refresh).AllowAnonymous();
        g.MapPost("/logout", Logout).RequireAuthorization();
        g.MapGet("/me", Me).RequireAuthorization();
        g.MapPatch("/me", PatchMe).RequireAuthorization();

        // Story 4.3 — verification + reset flows.
        g.MapPost("/verify-email", VerifyEmail).AllowAnonymous();
        g.MapPost("/resend-verification", ResendVerification).RequireAuthorization();
        g.MapPost("/forgot-password", ForgotPassword).AllowAnonymous();
        g.MapPost("/reset-password", ResetPassword).AllowAnonymous();

        return app;
    }

    // ── Story 4.3 helpers ─────────────────────────────────────────────────────

    private static string ClientIp(HttpContext ctx)
        => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    // Loopback-only, mirroring the dev-login guard (a null remote — in-memory
    // TestServer — counts as local). Used to keep the dev verify-link log off
    // any non-loopback request even on a box misconfigured to Development.
    private static bool IsLoopbackRequest(HttpContext ctx)
    {
        var remote = ctx.Connection.RemoteIpAddress;
        return remote is null || System.Net.IPAddress.IsLoopback(remote);
    }

    // NFR8: both arms (per-IP + per-actor) must pass; 429 envelope on deny.
    // RateLimits:Enabled=false (appsettings.Development.json) turns the auth
    // limits off for dev + the test suite — hundreds of same-IP registrations
    // per minute are normal there and would trip any honest ceiling. Any
    // non-Development environment enforces (default true).
    private static async Task<IResult?> RateLimitAsync(
        IRateLimiter limiter, HttpContext ctx, string action, string actorKey,
        int limit, TimeSpan window, CancellationToken ct)
    {
        var cfg = ctx.RequestServices.GetRequiredService<IConfiguration>();
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;
        try
        {
            var verdict = await limiter.CheckAsync(actorKey, ClientIp(ctx), action, limit, window, ct);
            return verdict.Allowed
                ? null
                : ErrorEnvelope.Build(429, "rate_limited", "Too many attempts — slow down.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // FAIL-OPEN: a Redis blip must not take down login/register/reset.
            // Availability of auth beats the limiter; the outage window is
            // short and logged loudly.
            ctx.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("Auth").LogError(ex,
                    "Rate limiter unavailable for {Action} — failing OPEN.", action);
            return null;
        }
    }

    // Single source for the email-link base — see Services/AppUrls.
    private static string FrontendOrigin(IConfiguration cfg, ILoggerFactory lf)
        => AppUrls.FrontendOrigin(cfg, lf.CreateLogger("Auth"));

    private static async Task SendVerificationEmailAsync(
        IEmailSender email, AuthTokenService tokens, IConfiguration cfg,
        IWebHostEnvironment env, ILoggerFactory lf, Guid userId, string toEmail,
        bool localRequest, CancellationToken ct)
    {
        var raw = await tokens.IssueAsync(
            userId, AuthTokenService.PurposeVerifyEmail, AuthTokenService.VerifyEmailTtl, ct);
        var verifyUrl = $"{FrontendOrigin(cfg, lf)}/verify-email?token={raw}";
        // Story 12.1 — local dev has no email delivery (RESEND_API_KEY empty),
        // so surface the link in the BFF console. Logged BEFORE the enqueue so
        // it appears even when the email queue is down. Defense in depth: the
        // raw token (a working verify credential) is logged ONLY in Development
        // AND ONLY for a loopback request — a box misconfigured to Development
        // that serves real users over the network never logs their tokens.
        if (env.IsDevelopment() && localRequest)
            lf.CreateLogger("Auth").LogInformation(
                "DEV verification link for {Email}: {VerifyUrl}", toEmail, verifyUrl);
        await email.SendAsync(toEmail, EmailTemplates.Verification, new Dictionary<string, string>
        {
            ["verifyUrl"] = verifyUrl,
            ["expiresHours"] = ((int)AuthTokenService.VerifyEmailTtl.TotalHours).ToString(),
        }, ct);
    }

    // POST /api/auth/register
    // Story 10.6 — numeric abuse knobs read through the 60 s flag cache;
    // fail-safe to the fallback (a flag outage must not block registration).
    private static async Task<int> ReadNumericFlagAsync(
        HttpContext ctx, string name, int fallback, CancellationToken ct)
    {
        try
        {
            var flags = await ctx.RequestServices.GetRequiredService<EntitlementService>()
                .GetFlagsAsync(ct);
            return flags.TryGetValue(name, out var v) && int.TryParse(v, out var n) && n > 0
                ? n : fallback;
        }
        catch
        {
            return fallback;
        }
    }

    private static async Task<IResult> Register(
        RegisterRequest req,
        AppDbContext db,
        PasswordHasher hasher,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        HandleSeeder seeder,
        DemoSeeder demoSeeder,
        AuthTokenService authTokens,
        IEmailSender email,
        IConfiguration cfg,
        IWebHostEnvironment env,
        IRateLimiter limiter,
        ILoggerFactory loggerFactory,
        HttpContext httpCtx,
        HttpResponse resp,
        CancellationToken ct)
    {
        if (await RateLimitAsync(limiter, httpCtx, "auth_register",
                $"ip:{ClientIp(httpCtx)}", 5, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["email"] = ["Valid email required."] });

        // Story 10.6 (FR47) — disposable domains get a SECOND, much tighter
        // per-IP arm. Throttled, never blocked: a false positive still
        // registers, just not fifty times an hour.
        var disposables = httpCtx.RequestServices.GetRequiredService<DisposableEmailService>();
        if (await disposables.IsDisposableAsync(req.Email, ct))
        {
            var perHour = await ReadNumericFlagAsync(httpCtx, "disposable_register_per_hour_ip", 2, ct);
            if (await RateLimitAsync(limiter, httpCtx, "auth_register_disposable",
                    $"ip:{ClientIp(httpCtx)}", perHour, TimeSpan.FromHours(1), ct) is { } deniedDisposable)
                return deniedDisposable;
        }
        if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 8)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["password"] = ["At least 8 characters required."] });
        if (req.Password.Length > 256)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["password"] = ["At most 256 characters."] }); // BCrypt truncates at 72 bytes; a MB-sized value is a hash-DoS

        var normalizedEmail = req.Email.Trim();
        var existing = await db.Users.AnyAsync(u => u.Email == normalizedEmail, ct);
        if (existing) return Results.Conflict(new { error = "Email already registered." });

        var handle = await seeder.SeedAsync(normalizedEmail, ct);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = normalizedEmail,
            HashedPassword = hasher.Hash(req.Password),
            Handle = handle,
            DisplayName = handle,
        };
        // Story 12.1 — dev auto-verify: local dev delivers no email, so the
        // story-4.5 second-analysis verify gate would otherwise be
        // unsatisfiable. Defense in depth (mirrors the dev-login guard): the
        // flag is honored ONLY in Development AND only when explicitly true —
        // appsettings.Development.json sets it; no other config may.
        if (env.IsDevelopment()
            && string.Equals(cfg["Auth:DevAutoVerify"], "true", StringComparison.OrdinalIgnoreCase))
            user.EmailVerifiedAt = DateTimeOffset.UtcNow;
        db.Users.Add(user);

        await db.SaveChangesAsync(ct);

        // Story 4.5 (AR25/FR28) — CLAIM: a valid spectr_device cookie means
        // this browser ran anonymous analyses; re-parent that device's jobs,
        // reports, and conversations to the new account. The re-parent is ONE
        // transaction (AR25) but a SEPARATE one from the user insert: claim
        // problems must NEVER fail the registration — the user commits first
        // and a failed claim leaves the device unclaimed (retryable, and the
        // 72 h purge clock is the worst case, not a lost account).
        var devices = httpCtx.RequestServices.GetRequiredService<DeviceService>();
        var hasDeviceCookie = httpCtx.Request.Cookies.ContainsKey(DeviceService.CookieName);
        var claimDeviceId = devices.ReadDeviceId(httpCtx.Request);
        if (claimDeviceId is not null)
        {
            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                // Atomic gate: only one registration ever claims a device
                // (ClaimedAt == null predicate; the concurrent loser gets 0).
                var claimed = await db.Devices
                    .Where(d => d.Id == claimDeviceId && d.ClaimedAt == null)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(d => d.ClaimedAt, DateTimeOffset.UtcNow)
                        .SetProperty(d => d.ClaimedByUserId, user.Id), ct);
                if (claimed == 1)
                {
                    // Fingerprint telemetry (non-gating): a claim from a very
                    // different network/browser is worth an abuse log line,
                    // but gating on it would break FR28 for legitimate
                    // network switches (mobile/CGNAT).
                    var dev = await db.Devices.AsNoTracking()
                        .FirstAsync(d => d.Id == claimDeviceId, ct);
                    var nowIpHash = devices.PepperForTelemetry(
                        httpCtx.Connection.RemoteIpAddress?.ToString() ?? "unknown");
                    if (dev.IpHash != nowIpHash)
                        loggerFactory.CreateLogger("Auth").LogWarning(
                            "Device claim fingerprint mismatch: device {DeviceId} claimed by {UserId} from a different network.",
                            claimDeviceId, user.Id);

                    await db.AnalysisJobs.Where(j => j.DeviceId == claimDeviceId)
                        .ExecuteUpdateAsync(s => s
                            .SetProperty(j => j.UserId, user.Id)
                            .SetProperty(j => j.DeviceId, (string?)null), ct);
                    await db.Analyses.Where(a => a.DeviceId == claimDeviceId)
                        .ExecuteUpdateAsync(s => s
                            .SetProperty(a => a.UserId, user.Id)
                            .SetProperty(a => a.DeviceId, (string?)null), ct);
                    await db.Conversations.Where(c => c.DeviceId == claimDeviceId)
                        .ExecuteUpdateAsync(s => s
                            .SetProperty(c => c.UserId, user.Id)
                            .SetProperty(c => c.DeviceId, (string?)null), ct);
                }
                await tx.CommitAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                loggerFactory.CreateLogger("Auth").LogError(ex,
                    "Device claim failed for {DeviceId} during registration of {UserId} — registration proceeds; device stays claimable.",
                    claimDeviceId, user.Id);
            }
        }
        // Clear whenever ANY device cookie was presented — a garbage/wrong-key
        // cookie must not be re-sent for 30 days.
        if (hasDeviceCookie)
            DeviceService.ClearCookie(resp);

        // Story 12.8 (AC1) — first-run demo report, BEST-EFFORT: a clearly
        // labeled sample report so the new library has something to explore
        // before the user's first analysis. Never fails registration
        // (DemoSeeder swallows internally; same contract as the claim above).
        // CancellationToken.None: the user exists — a client disconnect must
        // not leave a permanently demo-less account (no re-seed path exists).
        await demoSeeder.SeedAsync(user.Id, CancellationToken.None);

        var (rawRefresh, _) = await refresh.IssueAsync(user.Id, ct);
        resp.Cookies.Append(RefreshTokenService.CookieName, rawRefresh, refresh.CookieOptions());

        // Story 4.3 (AC1) — verification email, BEST-EFFORT: an email-path
        // failure (Redis down, template bug) must never fail registration;
        // /resend-verification is the recovery.
        try
        {
            await SendVerificationEmailAsync(email, authTokens, cfg, env, loggerFactory, user.Id, user.Email, IsLoopbackRequest(httpCtx), ct);
        }
        catch (Exception ex)
        {
            loggerFactory.CreateLogger("Auth").LogError(ex,
                "Verification email failed for new user {UserId}.", user.Id);
        }

        var access = jwt.Issue(user);
        return Results.Ok(new AuthResponse(access,
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName,
                await ResolveTierAsync(db, user.Id, ct))));
    }

    // POST /api/auth/login
    private static async Task<IResult> Login(
        LoginRequest req,
        AppDbContext db,
        PasswordHasher hasher,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        IRateLimiter limiter,
        HttpContext httpCtx,
        HttpResponse resp,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrEmpty(req.Password))
            return Results.BadRequest(new { error = "Email and password required." });

        // NFR8: per-IP ceiling + per-email actor arm (a distributed guesser
        // burning one address still hits the actor arm).
        if (await RateLimitAsync(limiter, httpCtx, "auth_login",
                $"email:{req.Email.Trim().ToLowerInvariant()}", 10, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        var normalizedEmail = req.Email.Trim();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, ct);
        if (user is null || !hasher.Verify(req.Password, user.HashedPassword))
            return Results.Unauthorized();
        if (!user.IsActive)
            return Results.Unauthorized();
        // Story 10.5 — bans block login with an EXPLICIT code (not a silent
        // 401: a banned user retrying passwords is noise for support).
        if (user.BannedAt is not null)
            return ErrorEnvelope.Build(403, "account_banned",
                "This account is suspended. Contact support.");

        var (rawRefresh, _) = await refresh.IssueAsync(user.Id, ct);
        resp.Cookies.Append(RefreshTokenService.CookieName, rawRefresh, refresh.CookieOptions());

        var access = jwt.Issue(user);
        return Results.Ok(new AuthResponse(access,
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName,
                await ResolveTierAsync(db, user.Id, ct))));
    }

    // POST /api/auth/dev-login — DEVELOPMENT ONLY one-click sign-in. Mints tokens
    // for an existing account WITHOUT a password so local dev can skip the form.
    // Inert (404) outside the Development environment. Defaults to the dev account.
    private static async Task<IResult> DevLogin(
        DevLoginRequest? req,
        IWebHostEnvironment env,
        AppDbContext db,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        HttpResponse resp,
        HttpContext ctx,
        CancellationToken ct)
    {
        if (!env.IsDevelopment()) return Results.NotFound();
        // Story 4.1 review: passwordless token minting must never answer a
        // LAN peer — compose publishes :5000 on 0.0.0.0, so IsDevelopment
        // alone isn't enough on an exposed dev box.
        var remote = ctx.Connection.RemoteIpAddress;
        if (remote is not null && !System.Net.IPAddress.IsLoopback(remote))
            return Results.NotFound();

        var email = string.IsNullOrWhiteSpace(req?.Email)
            ? "brankin92@yahoo.com"
            : req!.Email!.Trim();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user is null)
            return Results.NotFound(new { error = $"Dev user '{email}' not found — register it first." });
        if (!user.IsActive) return Results.Unauthorized();

        // Story 12.1 — the dev account satisfies the story-4.5 verify gate (no
        // email delivery locally). Gated on the SAME Auth:DevAutoVerify flag as
        // register so the switch is consistent: with the flag off, a developer
        // can dev-login and still reproduce the unverified gate. Idempotent;
        // endpoint is already Development-only + loopback-only.
        var devCfg = ctx.RequestServices.GetRequiredService<IConfiguration>();
        if (user.EmailVerifiedAt is null
            && string.Equals(devCfg["Auth:DevAutoVerify"], "true", StringComparison.OrdinalIgnoreCase))
        {
            user.EmailVerifiedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }

        var (rawRefresh, _) = await refresh.IssueAsync(user.Id, ct);
        resp.Cookies.Append(RefreshTokenService.CookieName, rawRefresh, refresh.CookieOptions());

        var access = jwt.Issue(user);
        return Results.Ok(new AuthResponse(access,
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName,
                await ResolveTierAsync(db, user.Id, ct))));
    }

    // POST /api/auth/refresh — reads spectr_refresh cookie, rotates it, returns fresh access token.
    private static async Task<IResult> Refresh(
        HttpRequest httpReq,
        HttpResponse resp,
        AppDbContext db,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        IRateLimiter limiter,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        // Generous — silent refresh is legit high-frequency; this only stops
        // cookie brute-forcing (NFR8).
        if (await RateLimitAsync(limiter, httpCtx, "auth_refresh",
                $"ip:{ClientIp(httpCtx)}", 60, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        if (!httpReq.Cookies.TryGetValue(RefreshTokenService.CookieName, out var raw) || string.IsNullOrEmpty(raw))
            return Results.Unauthorized();

        var row = await refresh.ResolveAsync(raw, ct);
        if (row is null) return Results.Unauthorized();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == row.UserId, ct);
        if (user is null || !user.IsActive) return Results.Unauthorized();
        // Story 10.5 — a banned account must not mint fresh access tokens.
        if (user.BannedAt is not null)
            return ErrorEnvelope.Build(403, "account_banned",
                "This account is suspended. Contact support.");

        var (newRaw, _) = await refresh.RotateAsync(row, ct);
        resp.Cookies.Append(RefreshTokenService.CookieName, newRaw, refresh.CookieOptions());

        var access = jwt.Issue(user);
        return Results.Ok(new AuthResponse(access,
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName,
                await ResolveTierAsync(db, user.Id, ct))));
    }

    // POST /api/auth/logout — revokes the current refresh row + clears the cookie.
    private static async Task<IResult> Logout(
        HttpRequest httpReq,
        HttpResponse resp,
        RefreshTokenService refresh,
        CancellationToken ct)
    {
        if (httpReq.Cookies.TryGetValue(RefreshTokenService.CookieName, out var raw) && !string.IsNullOrEmpty(raw))
        {
            var row = await refresh.ResolveAsync(raw, ct);
            if (row is not null) await refresh.RevokeAsync(row, ct);
        }
        resp.Cookies.Delete(RefreshTokenService.CookieName, refresh.ClearCookieOptions());
        return Results.NoContent();
    }

    // GET /api/auth/me
    private static async Task<IResult> Me(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        // Story 2.1: project user + tier in one roundtrip. Tier derives
        // from a LEFT JOIN against `subscriptions`. Story 2.4 will swap
        // this for the cached Entitlements.For(user) resolver.
        var row = await (
            from u in db.Users.AsNoTracking()
            join s in db.Subscriptions.AsNoTracking()
                on u.Id equals s.UserId into joined
            from sub in joined.DefaultIfEmpty()
            where u.Id == userId
            select new
            {
                u.Id,
                u.Email,
                u.Handle,
                u.DisplayName,
                SubStatus = sub == null ? null : sub.Status,
            }
        ).FirstOrDefaultAsync(ct);
        if (row is null) return Results.Unauthorized();

        var tier = ResolveTier(row.SubStatus);
        return Results.Ok(new AuthedUser(
            row.Id, row.Email, row.Handle, row.DisplayName, tier));
    }

    // Story 2.1 — Stripe subscription status → product tier mapping.
    // active + trialing + past_due → "pro"; everything else (including
    // null = no subscription row) → "free". This mirrors the entitlement
    // model story 2.4 will formalize; the only callers are /me and any
    // other endpoint that needs a quick tier check before story 2.4 ships.
    //
    // Story 2.2 review-fix D2 — `past_due` returns "pro" because Stripe
    // semantics keep the user entitled during the dunning grace period
    // (the subscription hasn't been terminated yet — Stripe will retry
    // the invoice). The billing page must show the management UI in this
    // state so the user can update their payment method via the portal
    // and self-cancel. Story 2.9 will add the dunning banner on top of
    // this tier mapping; the entitlement itself is unchanged.
    internal static string ResolveTier(string? subscriptionStatus)
    {
        if (subscriptionStatus is null) return "free";
        return subscriptionStatus switch
        {
            "active" or "trialing" or "past_due" => "pro",
            _ => "free",
        };
    }

    // ── Story 4.3 — verification + reset handlers ─────────────────────────────

    // POST /api/auth/verify-email {token}
    private static async Task<IResult> VerifyEmail(
        VerifyEmailRequest req,
        AppDbContext db,
        AuthTokenService tokens,
        IRateLimiter limiter,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        if (await RateLimitAsync(limiter, httpCtx, "auth_verify",
                $"ip:{ClientIp(httpCtx)}", 10, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        // Transaction: consume + stamp commit together — a failure after the
        // consume must roll the token back, never strand a burned link.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var userId = await tokens.ConsumeAsync(
            req.Token ?? "", AuthTokenService.PurposeVerifyEmail, ct);
        if (userId is null)
            return ErrorEnvelope.Build(400, "invalid_token",
                "This verification link is invalid, expired, or already used.");

        // IsActive: a deactivated account must not gain a verified stamp.
        await db.Users.Where(u => u.Id == userId && u.IsActive && u.EmailVerifiedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow), ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    // POST /api/auth/resend-verification (auth) — no-op when already verified.
    private static async Task<IResult> ResendVerification(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        AuthTokenService tokens,
        IEmailSender email,
        IConfiguration cfg,
        IWebHostEnvironment env,
        IRateLimiter limiter,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (await RateLimitAsync(limiter, httpCtx, "auth_resend_verify",
                $"user:{userId}", 3, TimeSpan.FromMinutes(15), ct) is { } denied)
            return denied;

        var user = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.Unauthorized();
        if (user.EmailVerifiedAt is not null) return Results.NoContent(); // already done

        var lf = httpCtx.RequestServices.GetRequiredService<ILoggerFactory>();
        await SendVerificationEmailAsync(email, tokens, cfg, env, lf, user.Id, user.Email, IsLoopbackRequest(httpCtx), ct);
        return Results.NoContent();
    }

    // POST /api/auth/forgot-password {email} — ALWAYS 204 (no user
    // enumeration): identical response whether or not the account exists.
    private static async Task<IResult> ForgotPassword(
        ForgotPasswordRequest req,
        AppDbContext db,
        AuthTokenService tokens,
        IEmailSender email,
        IConfiguration cfg,
        IRateLimiter limiter,
        ILoggerFactory loggerFactory,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var address = (req.Email ?? "").Trim();
        if (address.Length == 0 || address.Length > 320 || !address.Contains('@'))
            return Results.NoContent(); // same shape as success — no oracle

        if (await RateLimitAsync(limiter, httpCtx, "auth_forgot",
                $"email:{address.ToLowerInvariant()}", 3, TimeSpan.FromMinutes(15), ct) is { } denied)
            return denied;
        // Daily ceiling per address: 3/15min alone allows 288 unsolicited
        // reset emails/day at a victim's inbox.
        if (await RateLimitAsync(limiter, httpCtx, "auth_forgot_daily",
                $"email:{address.ToLowerInvariant()}", 10, TimeSpan.FromHours(24), ct) is { } deniedDaily)
            return deniedDaily;

        // FIRE-AND-FORGET in a fresh DI scope: the token insert + enqueue for
        // an EXISTING account took measurably longer than the no-account path,
        // making response timing an enumeration oracle. Now every caller gets
        // an identical, immediate 204; the work happens off-request.
        var scopeFactory = httpCtx.RequestServices.GetRequiredService<IServiceScopeFactory>();
        var logger = loggerFactory.CreateLogger("Auth");
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var sdb = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var stokens = scope.ServiceProvider.GetRequiredService<AuthTokenService>();
                var semail = scope.ServiceProvider.GetRequiredService<IEmailSender>();
                var scfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                var slf = scope.ServiceProvider.GetRequiredService<ILoggerFactory>();

                var user = await sdb.Users.AsNoTracking()
                    .FirstOrDefaultAsync(u => u.Email == address && u.IsActive);
                if (user is null) return;

                var raw = await stokens.IssueAsync(
                    user.Id, AuthTokenService.PurposeResetPassword,
                    AuthTokenService.ResetPasswordTtl);
                await semail.SendAsync(user.Email, EmailTemplates.Reset, new Dictionary<string, string>
                {
                    ["resetUrl"] = $"{FrontendOrigin(scfg, slf)}/reset-password?token={raw}",
                    ["expiresMinutes"] = ((int)AuthTokenService.ResetPasswordTtl.TotalMinutes).ToString(),
                });
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Password-reset issue/send failed (background).");
            }
        }, CancellationToken.None);

        return Results.NoContent();
    }

    // POST /api/auth/reset-password {token, newPassword}
    private static async Task<IResult> ResetPassword(
        ResetPasswordRequest req,
        AppDbContext db,
        PasswordHasher hasher,
        AuthTokenService tokens,
        RefreshTokenService refresh,
        IRateLimiter limiter,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        if (await RateLimitAsync(limiter, httpCtx, "auth_reset",
                $"ip:{ClientIp(httpCtx)}", 10, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        if (string.IsNullOrEmpty(req.NewPassword) || req.NewPassword.Length < 8)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["newPassword"] = ["At least 8 characters required."] });
        if (req.NewPassword.Length > 256)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["newPassword"] = ["At most 256 characters."] });

        // ONE transaction around consume → rehash → revoke: a crash after the
        // consume must roll the token back (an inactive-user dead link stays
        // retryable), and "password changed but attacker sessions survive"
        // cannot be a committed state.
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var userId = await tokens.ConsumeAsync(
            req.Token ?? "", AuthTokenService.PurposeResetPassword, ct);
        if (userId is null)
            return ErrorEnvelope.Build(400, "invalid_token",
                "This reset link is invalid, expired, or already used.");

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, ct);
        if (user is null)
            return ErrorEnvelope.Build(400, "invalid_token",
                "This reset link is invalid, expired, or already used.");

        user.HashedPassword = hasher.Hash(req.NewPassword);
        // Consuming an emailed reset link proves mailbox control — at least
        // as strong as the verify link. Don't make this user re-verify.
        user.EmailVerifiedAt ??= DateTimeOffset.UtcNow;
        // Story 4.6 — kill outstanding ACCESS tokens too (the 4.3 gap):
        // OnTokenValidated rejects the old tver within the 60 s cache window.
        user.TokenVersion++;
        await db.SaveChangesAsync(ct);

        // AC2 (refresh sessions): every live refresh token dies + any
        // concurrently-issued reset links die. NOTE: outstanding ACCESS JWTs
        // are stateless and survive until natural expiry (≤15 min) — bounded,
        // recorded; token-versioning lands with 4.6's account deletion.
        var revoked = await refresh.RevokeAllForUserAsync(user.Id, ct);
        await tokens.InvalidateOutstandingAsync(user.Id, AuthTokenService.PurposeResetPassword, ct);
        await tx.CommitAsync(ct);

        // Same-process instant revocation: evict the token-version cache.
        httpCtx.RequestServices
            .GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>()
            .Remove($"tver:{user.Id:N}");

        var authLogger = httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Auth");
        authLogger.LogInformation(
            "Password reset completed for {UserId}; {Count} refresh session(s) revoked.",
            user.Id, revoked);

        // Story 4.4 (4.3 review commitment) — containment signal: tell the
        // mailbox owner the password changed, so an attacker-initiated reset
        // isn't silent. Best-effort, post-commit; deliberately link-free.
        // Catch EVERYTHING incl. cancellation: the reset already committed —
        // a client disconnect during this send must not turn success into 500.
        try
        {
            var emailSender = httpCtx.RequestServices.GetRequiredService<IEmailSender>();
            await emailSender.SendAsync(user.Email, EmailTemplates.PasswordChanged,
                new Dictionary<string, string>(), CancellationToken.None);
        }
        catch (Exception ex)
        {
            authLogger.LogError(ex, "Password-changed notification failed for {UserId}.", user.Id);
        }

        return Results.NoContent();
    }

    // Convenience for register/login/refresh/patch paths that already have
    // the user row but need the tier field on AuthedUser.
    private static async Task<string> ResolveTierAsync(
        AppDbContext db, Guid userId, CancellationToken ct)
    {
        var status = await db.Subscriptions.AsNoTracking()
            .Where(s => s.UserId == userId)
            .Select(s => (string?)s.Status)
            .FirstOrDefaultAsync(ct);
        return ResolveTier(status);
    }

    // PATCH /api/auth/me — partial update of display_name + handle.
    // Null fields are left unchanged. Handle is normalized (lowercase + same
    // [a-z0-9_] sanitization as HandleSeeder) and checked for uniqueness
    // case-insensitively; the column itself is citext so the equality check
    // does case folding too.
    private static async Task<IResult> PatchMe(
        PatchMeRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.Unauthorized();

        var errors = new Dictionary<string, string[]>();

        if (req.DisplayName is not null)
        {
            var trimmed = req.DisplayName.Trim();
            if (trimmed.Length == 0)
            {
                errors["displayName"] = ["Display name cannot be empty."];
            }
            else if (trimmed.Length > 80)
            {
                errors["displayName"] = ["Display name must be 80 characters or fewer."];
            }
            else
            {
                user.DisplayName = trimmed;
            }
        }

        if (req.Handle is not null)
        {
            var normalized = NormalizeHandle(req.Handle);
            if (normalized.Length < 3 || normalized.Length > 32)
            {
                errors["handle"] = ["Handle must be 3–32 characters of [a-z0-9_]."];
            }
            else if (!string.Equals(normalized, user.Handle, StringComparison.OrdinalIgnoreCase))
            {
                var taken = await db.Users
                    .AnyAsync(u => u.Id != userId && u.Handle == normalized, ct);
                if (taken)
                {
                    errors["handle"] = ["Handle is already taken."];
                }
                else
                {
                    user.Handle = normalized;
                }
            }
        }

        if (errors.Count > 0) return Results.ValidationProblem(errors);

        await db.SaveChangesAsync(ct);
        return Results.Ok(new AuthedUser(
            user.Id, user.Email, user.Handle, user.DisplayName,
            await ResolveTierAsync(db, user.Id, ct)));
    }

    // Mirror of HandleSeeder.Sanitize — keeps PATCH consistent with seed.
    private static string NormalizeHandle(string raw)
    {
        var sb = new System.Text.StringBuilder(raw.Length);
        foreach (var c in raw.Trim().ToLowerInvariant())
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')
                sb.Append(c);
            else if (c == '.' || c == '-' || c == '+')
                sb.Append('_');
        }
        return sb.ToString();
    }
}
