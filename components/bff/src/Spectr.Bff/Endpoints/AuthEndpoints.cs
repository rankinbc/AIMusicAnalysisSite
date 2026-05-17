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
        g.MapPost("/refresh", Refresh).AllowAnonymous();
        g.MapPost("/logout", Logout).RequireAuthorization();
        g.MapGet("/me", Me).RequireAuthorization();

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
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName)));
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
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName)));
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
            new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName)));
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
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.Unauthorized();
        return Results.Ok(new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName));
    }
}
