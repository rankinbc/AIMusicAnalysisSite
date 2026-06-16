using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
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

        return app;
    }

    // POST /api/auth/register
    private static async Task<IResult> Register(
        RegisterRequest req,
        AppDbContext db,
        PasswordHasher hasher,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        HandleSeeder seeder,
        HttpResponse resp,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || !req.Email.Contains('@'))
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["email"] = ["Valid email required."] });
        if (string.IsNullOrEmpty(req.Password) || req.Password.Length < 8)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["password"] = ["At least 8 characters required."] });

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
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        var (rawRefresh, _) = await refresh.IssueAsync(user.Id, ct);
        resp.Cookies.Append(RefreshTokenService.CookieName, rawRefresh, refresh.CookieOptions());

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
        HttpResponse resp,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrEmpty(req.Password))
            return Results.BadRequest(new { error = "Email and password required." });

        var normalizedEmail = req.Email.Trim();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, ct);
        if (user is null || !hasher.Verify(req.Password, user.HashedPassword))
            return Results.Unauthorized();
        if (!user.IsActive)
            return Results.Unauthorized();

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
        CancellationToken ct)
    {
        if (!env.IsDevelopment()) return Results.NotFound();

        var email = string.IsNullOrWhiteSpace(req?.Email)
            ? "brankin92@yahoo.com"
            : req!.Email!.Trim();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user is null)
            return Results.NotFound(new { error = $"Dev user '{email}' not found — register it first." });
        if (!user.IsActive) return Results.Unauthorized();

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
        CancellationToken ct)
    {
        if (!httpReq.Cookies.TryGetValue(RefreshTokenService.CookieName, out var raw) || string.IsNullOrEmpty(raw))
            return Results.Unauthorized();

        var row = await refresh.ResolveAsync(raw, ct);
        if (row is null) return Results.Unauthorized();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == row.UserId, ct);
        if (user is null || !user.IsActive) return Results.Unauthorized();

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
