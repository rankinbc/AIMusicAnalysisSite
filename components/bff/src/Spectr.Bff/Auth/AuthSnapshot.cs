namespace Spectr.Bff.Auth;

// D3 — the cached `tver:` lookup (Program.cs OnTokenValidated) widened from
// (Version, Banned) to also carry guest status + expiry, so a single query +
// cache entry can fail an expired guest's token without a second roundtrip.
internal readonly record struct AuthSnapshot(
    int Version, bool Banned, bool IsGuest, DateTimeOffset? GuestExpiresAt);
