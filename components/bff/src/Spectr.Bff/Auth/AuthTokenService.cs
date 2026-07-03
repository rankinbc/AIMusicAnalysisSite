using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Cryptography;
using System.Text;

namespace Spectr.Bff.Auth;

// Story 4.3 — single-use, expiring auth tokens (verify_email / reset_password).
// Raw token (32 RNG bytes base64url) rides only in the emailed link; only
// SHA-256 hex is persisted. Consumption is one atomic UPDATE — a raced double
// submit cannot consume twice.
public sealed class AuthTokenService(AppDbContext db)
{
    public const string PurposeVerifyEmail = "verify_email";
    public const string PurposeResetPassword = "reset_password";

    public static readonly TimeSpan VerifyEmailTtl = TimeSpan.FromHours(24);
    // 30 min (not shorter): reset emails ride the shared maintenance lane and
    // can queue behind a sweep — see docs/runbook.md "Latency".
    public static readonly TimeSpan ResetPasswordTtl = TimeSpan.FromMinutes(30);

    public async Task<string> IssueAsync(
        Guid userId, string purpose, TimeSpan ttl, CancellationToken ct = default)
    {
        var raw = GenerateRawToken();
        db.AuthTokens.Add(new AuthToken
        {
            UserId = userId,
            Purpose = purpose,
            TokenHash = HashRaw(raw),
            ExpiresAt = DateTimeOffset.UtcNow.Add(ttl),
        });
        await db.SaveChangesAsync(ct);
        return raw;
    }

    /// <summary>
    /// Atomically consume a token: returns the owning user id when the token
    /// exists for this purpose, is unconsumed, and unexpired — else null.
    /// </summary>
    public async Task<Guid?> ConsumeAsync(string raw, string purpose, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 128) return null;
        var hash = HashRaw(raw);
        var rows = await db.Database.SqlQuery<Guid>($@"
            UPDATE auth_tokens
            SET consumed_at = now()
            WHERE token_hash = {hash} AND purpose = {purpose}
              AND consumed_at IS NULL AND expires_at > now()
            RETURNING user_id AS ""Value""").ToListAsync(ct);
        return rows.Count == 1 ? rows[0] : null;
    }

    /// <summary>Consume every other outstanding token of a purpose for a user
    /// (a completed reset must kill any concurrently-issued reset links).</summary>
    public async Task InvalidateOutstandingAsync(
        Guid userId, string purpose, CancellationToken ct = default)
        => await db.AuthTokens
            .Where(t => t.UserId == userId && t.Purpose == purpose && t.ConsumedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ConsumedAt, DateTimeOffset.UtcNow), ct);

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
