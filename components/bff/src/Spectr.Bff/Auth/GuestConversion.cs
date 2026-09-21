using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Auth;

// Task G2 (spec G-D4) — the atomic guest→account conversion. A guest who
// registers keeps the SAME users row (same id, same songs/analyses/coach
// conversation/rack presets) instead of creating a second account.
//
// ONE UPDATE statement, gated on `id == userId AND is_guest AND
// guest_expires_at > now`. Two concurrent callers (a double-submit, or a
// conversion racing the nightly purge's batch select) can never both
// succeed: Postgres row-locks the first UPDATE; the second re-evaluates the
// WHERE clause against the now-committed row (is_guest already false, or
// guest_expires_at already null) and matches zero rows. No transaction is
// needed — a single statement is already atomic.
internal static class GuestConversion
{
    // Returns the number of rows updated: 1 = converted, 0 = not a live
    // guest (already converted, never was a guest, or expired).
    internal static Task<int> TryConvertAsync(
        AppDbContext db, Guid userId, string email, string passwordHash,
        string? displayName, bool autoVerify, DateTimeOffset now, CancellationToken ct)
    {
        return db.Users
            .Where(u => u.Id == userId && u.IsGuest
                && u.GuestExpiresAt != null && u.GuestExpiresAt > now)
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.Email, email)
                .SetProperty(u => u.HashedPassword, passwordHash)
                .SetProperty(u => u.DisplayName, displayName)
                .SetProperty(u => u.IsGuest, false)
                .SetProperty(u => u.GuestExpiresAt, (DateTimeOffset?)null)
                .SetProperty(u => u.GuestDeviceId, (string?)null)
                .SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1)
                .SetProperty(u => u.EmailVerifiedAt, u => autoVerify ? now : u.EmailVerifiedAt),
                ct);
    }
}
