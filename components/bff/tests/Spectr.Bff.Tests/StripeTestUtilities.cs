using System.Security.Cryptography;
using System.Text;

namespace Spectr.Bff.Tests;

// Story 2.1 — test-side helpers for Stripe webhook fixtures. Stripe's
// EventUtility.ConstructEvent verifies a header of the shape
//   t=<unix_seconds>,v1=<hex_hmac_sha256(secret, "{t}.{body}")>
// The SDK doesn't expose a public test-only signer, so we implement it
// here. Mirrors the spec at
//   https://stripe.com/docs/webhooks/signatures#verify-manually
internal static class StripeTestUtilities
{
    public const string TestWebhookSecret = "whsec_test_secret_do_not_use_in_prod";

    public static string ComputeSignatureHeader(
        string rawBody, string secret, DateTimeOffset? timestamp = null)
    {
        var ts = (timestamp ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var signedPayload = $"{ts}.{rawBody}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hashBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(signedPayload));
        var sigHex = Convert.ToHexString(hashBytes).ToLowerInvariant();
        return $"t={ts},v1={sigHex}";
    }

    public static string ReadFixture(string name)
    {
        var path = Path.Combine(AppContext.BaseDirectory,
            "Fixtures", "StripeEvents", name);
        return File.ReadAllText(path);
    }
}
