using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Cryptography;
using System.Text;

namespace Spectr.Bff.Auth;

public sealed class RefreshTokenService(AppDbContext db, IConfiguration config)
{
    private readonly int _days = int.Parse(config["Jwt:RefreshTokenDays"] ?? "30");

    public const string CookieName = "spectr_refresh";

    // Fixed by design (PRP wave 1) — long enough for a burst of restored tabs to
    // settle, short enough that a stolen pre-rotation cookie is useless in a minute.
    public static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(60);

    // Returns (rawToken, persistedRow). Raw goes to the cookie; SHA-256(raw) is persisted.
    public async Task<(string Raw, RefreshToken Row)> IssueAsync(Guid userId, CancellationToken ct = default)
    {
        var raw = GenerateRawToken();
        var row = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = HashRaw(raw),
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(_days),
        };
        db.RefreshTokens.Add(row);
        await db.SaveChangesAsync(ct);
        return (raw, row);
    }

    // Task D5 — guest overload: caller supplies the expiry directly (capped
    // at GuestExpiresAt) instead of the default _days window, so a guest's
    // refresh cookie can never outlive the guest itself.
    public async Task<(string Raw, RefreshToken Row)> IssueAsync(
        Guid userId, DateTimeOffset expiresAt, CancellationToken ct = default)
    {
        var raw = GenerateRawToken();
        var row = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = HashRaw(raw),
            ExpiresAt = expiresAt,
        };
        db.RefreshTokens.Add(row);
        await db.SaveChangesAsync(ct);
        return (raw, row);
    }

    // Returns the matching row only if not revoked and not expired.
    public async Task<RefreshToken?> ResolveAsync(string rawCookie, CancellationToken ct = default)
    {
        var hash = HashRaw(rawCookie);
        var row = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (row is null) return null;
        if (row.RevokedAt is not null) return null;
        if (row.ExpiresAt < DateTimeOffset.UtcNow) return null;
        return row;
    }

    // Revoke current + issue new — atomic rotation. ReplacedById marks the row as
    // rotation-revoked (vs logout/reset), which qualifies it for the grace window.
    public async Task<(string Raw, RefreshToken Row)> RotateAsync(RefreshToken current, CancellationToken ct = default)
    {
        current.RevokedAt = DateTimeOffset.UtcNow;
        var raw = GenerateRawToken();
        var fresh = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = current.UserId,
            TokenHash = HashRaw(raw),
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(_days),
        };
        current.ReplacedById = fresh.Id;
        db.RefreshTokens.Add(fresh);
        await db.SaveChangesAsync(ct);
        return (raw, fresh);
    }

    // Task D5 — guest overload: caps the successor's expiry at expiresAtCap
    // (the guest's GuestExpiresAt) instead of the default _days window, so
    // rotation can never push a guest's session past its sandbox lifetime.
    public async Task<(string Raw, RefreshToken Row)> RotateAsync(
        RefreshToken current, DateTimeOffset? expiresAtCap, CancellationToken ct = default)
    {
        current.RevokedAt = DateTimeOffset.UtcNow;
        var raw = GenerateRawToken();
        var expires = DateTimeOffset.UtcNow.AddDays(_days);
        if (expiresAtCap is { } cap && cap < expires) expires = cap;
        var fresh = new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = current.UserId,
            TokenHash = HashRaw(raw),
            ExpiresAt = expires,
        };
        current.ReplacedById = fresh.Id;
        db.RefreshTokens.Add(fresh);
        await db.SaveChangesAsync(ct);
        return (raw, fresh);
    }

    public sealed record ResolveResult(RefreshToken Row, bool GraceHit);

    // Concurrent-refresh tolerance (E2.1): a token revoked BY ROTATION within `grace`
    // still resolves as long as its successor is alive — the other tab won the rotation
    // race and this tab's request carried the stale cookie. Rows revoked by logout or
    // password reset never have a successor, so they never get grace.
    public async Task<ResolveResult?> ResolveWithGraceAsync(string rawCookie, TimeSpan grace, CancellationToken ct = default)
    {
        var hash = HashRaw(rawCookie);
        var row = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (row is null) return null;

        var now = DateTimeOffset.UtcNow;
        if (row.RevokedAt is null)
            return row.ExpiresAt >= now ? new ResolveResult(row, false) : null;

        if (row.RevokedAt >= now - grace && row.ReplacedById is Guid succId)
        {
            var succ = await db.RefreshTokens.FirstOrDefaultAsync(t => t.Id == succId, ct);
            if (succ is { RevokedAt: null } && succ.ExpiresAt >= now)
                return new ResolveResult(row, true);
        }
        return null;
    }

    public async Task RevokeAsync(RefreshToken row, CancellationToken ct = default)
    {
        if (row.RevokedAt is null)
        {
            row.RevokedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }
    }

    // Story 4.3 (AC2): completing a password reset invalidates EVERY live
    // session for the user — set-based, no row loading.
    public async Task<int> RevokeAllForUserAsync(Guid userId, CancellationToken ct = default)
        => await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, DateTimeOffset.UtcNow), ct);

    public CookieOptions CookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/api/auth",
        Expires = DateTimeOffset.UtcNow.AddDays(_days),
    };

    // Task D5 — guest overload: an explicit expiry (GuestExpiresAt) instead
    // of the default _days window.
    public CookieOptions CookieOptions(DateTimeOffset expires) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/api/auth",
        Expires = expires,
    };

    public CookieOptions ClearCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/api/auth",
    };

    private static string GenerateRawToken()
    {
        Span<byte> buf = stackalloc byte[32];
        RandomNumberGenerator.Fill(buf);
        return Convert.ToBase64String(buf).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static string HashRaw(string raw)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(raw), hash);
        return Convert.ToHexString(hash);
    }
}
