using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Cryptography;
using System.Text;

namespace Spectr.Bff.Services;

// Story 4.5 (AR24) — the stateful anonymous DEVICE identity: a durable
// `devices` row referenced by the signed httpOnly `spectr_device` cookie.
// Owns analyses and gets CLAIMED into an account (AR25).
//
// Cookie value: "{deviceId}.{hex(HMAC_SHA256(deviceId))}". ip_hash/ua_hash
// are SHA-256 digests peppered with the signing key — raw IP/UA never
// stored (abuse correlation without PII).
public sealed class DeviceService(
    AppDbContext db,
    IConfiguration config,
    ILogger<DeviceService> logger)
{
    public const string CookieName = "spectr_device";
    private static readonly TimeSpan CookieLifetime = TimeSpan.FromDays(30);

    private readonly AppDbContext _db = db;
    private readonly ILogger<DeviceService> _logger = logger;
    private readonly string _key = config["Anon:SigningKey"]
        ?? throw new InvalidOperationException("Missing Anon:SigningKey");

    /// <summary>Verified device id from the request cookie, or null.</summary>
    public string? ReadDeviceId(HttpRequest request)
    {
        if (!request.Cookies.TryGetValue(CookieName, out var cookie)) return null;
        return Verify(cookie, _key);
    }

    /// <summary>
    /// AC1: resolve the request's device — verified cookie + live row, or a
    /// fresh row + cookie. Called by the anon analysis path (6.3).
    /// </summary>
    public async Task<Device> GetOrCreateAsync(
        HttpContext ctx, CancellationToken ct = default)
    {
        var existingId = ReadDeviceId(ctx.Request);
        if (existingId is not null)
        {
            // AsNoTracking: the claimed check must see the DB, not a stale
            // identity-map entry from earlier in the same scope.
            var existing = await _db.Devices.AsNoTracking()
                .FirstOrDefaultAsync(d => d.Id == existingId, ct);
            // A claimed device keeps working as a cookie (harmless) but new
            // anonymous work needs a FRESH identity — claimed rows must never
            // re-accumulate anonymous children.
            if (existing is not null && existing.ClaimedAt is null)
                return existing;
        }

        var device = new Device
        {
            Id = UlidGen.NewUlid(),
            IpHash = Pepper(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
            UaHash = Pepper(ctx.Request.Headers.UserAgent.ToString()),
        };
        _db.Devices.Add(device);
        await _db.SaveChangesAsync(ct);

        ctx.Response.Cookies.Append(CookieName, Sign(device.Id, _key), new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = DateTimeOffset.UtcNow.Add(CookieLifetime),
        });
        _logger.LogInformation("Anonymous device created: {DeviceId}", device.Id);
        return device;
    }

    /// <summary>AC4: one active analysis per device.</summary>
    public async Task<bool> HasActiveAnalysisAsync(string deviceId, CancellationToken ct = default)
        => await _db.AnalysisJobs.AsNoTracking().AnyAsync(
            j => j.DeviceId == deviceId
                && (j.Status == "pending" || j.Status == "processing"
                    || j.Status == "awaiting_stem_mapping"), ct);

    public static void ClearCookie(HttpResponse response)
        => response.Cookies.Delete(CookieName, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Lax,
            Path = "/",
        });

    private string Pepper(string value)
        => Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes(value + "|" + _key))).ToLowerInvariant();

    /// <summary>Same pepper, exposed for claim-time fingerprint TELEMETRY
    /// (never gating — mobile/CGNAT churn makes ip matching too brittle).</summary>
    public string PepperForTelemetry(string value) => Pepper(value);

    // Constant-time verify (HMAC signature check).
    internal static string Sign(string deviceId, string key)
        => $"{deviceId}.{Convert.ToHexString(Hmac(deviceId, key))}";

    internal static string? Verify(string? cookie, string key)
    {
        if (string.IsNullOrEmpty(cookie)) return null;
        var dot = cookie.IndexOf('.');
        if (dot <= 0 || dot == cookie.Length - 1) return null;
        var deviceId = cookie[..dot];
        if (deviceId.Length != 26) return null;
        byte[] provided;
        try { provided = Convert.FromHexString(cookie[(dot + 1)..]); }
        catch (FormatException) { return null; }
        var expected = Hmac(deviceId, key);
        return provided.Length == expected.Length
            && CryptographicOperations.FixedTimeEquals(provided, expected)
                ? deviceId
                : null;
    }

    private static byte[] Hmac(string deviceId, string key)
    {
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return h.ComputeHash(Encoding.UTF8.GetBytes(deviceId));
    }
}
