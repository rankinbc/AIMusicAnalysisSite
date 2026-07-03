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

    // Revoke current + issue new — atomic rotation.
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
        db.RefreshTokens.Add(fresh);
        await db.SaveChangesAsync(ct);
        return (raw, fresh);
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
