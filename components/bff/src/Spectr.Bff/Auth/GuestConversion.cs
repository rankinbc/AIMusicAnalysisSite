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
                // Verify-before-sign-in — the pending sign-up (if any) is
                // now the real one; never leave a stale copy behind.
                .SetProperty(u => u.PendingEmail, (string?)null)
                .SetProperty(u => u.PendingPasswordHash, (string?)null)
                .SetProperty(u => u.TokenVersion, u => u.TokenVersion + 1)
                // Fix round 1 (item 1) — a guest is stamped EmailVerifiedAt
                // at mint (DemoAuthEndpoints ~142) for an address nobody
                // proved. Outside auto-verify (dev) mode, conversion must
                // CLEAR that synthetic stamp exactly as register leaves a
                // brand-new row: null until the owner verifies the REAL
                // address (see GuestConvertEndpoints' autoVerify decision,
                // which mirrors AuthEndpoints.Register's verbatim).
                .SetProperty(u => u.EmailVerifiedAt, autoVerify ? now : (DateTimeOffset?)null),
                ct);
    }

    // Owner decision (2026-10): the seeded demo song is for guests only. Call
    // AFTER a successful (committed) conversion — the row is now non-guest,
    // which is exactly what DemoLibraryCleanup's predicate requires. DB-only:
    // the shared "audio/demo/" blobs other guests still play are never touched.
    // Best-effort: the account is already real, so a failure here must never
    // fail the conversion response (the demo just lingers; the user can
    // delete it like any song — song/version deletes skip shared demo keys).
    // CancellationToken.None: the conversion already committed — a client
    // disconnect must not strand the demo in a registered library.
    internal static async Task RemoveGuestDemoAsync(
        AppDbContext db, Guid userId, ILoggerFactory loggerFactory)
    {
        try
        {
            await DemoLibraryCleanup.RemoveForUserAsync(db, userId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            loggerFactory.CreateLogger("Auth").LogError(ex,
                "Demo removal failed for converted guest {UserId} — conversion unaffected.", userId);
        }
    }
}
