using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.Auth;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Task D7 (spec D8) — extracted VERBATIM from AccountEndpoints.DeleteAccount's
// identity teardown (AC4, story 4.6), lines 302-330 (the transaction) plus
// the tver: cache eviction at 335/337. This is a PURE MOVE: real account
// deletion calls this with ("account_delete", "user-initiated (FR27)") and
// must behave exactly as before (AccountGdprTests are unmodified and green).
// The nightly guest-purge pass (RetentionSweepScheduler, D7) calls the SAME
// method with ("guest_purge", "guest sandbox expired") for every expired
// guest row — guests cannot self-delete (POST /api/me/delete is
// guard-denied for guests, Auth/GuestGuard.cs), so this is the ONLY path
// off an expired guest sandbox.
public sealed class AccountTeardown(AppDbContext db, RefreshTokenService refresh, IMemoryCache cache)
{
    public async Task TearDownAsync(User user, string auditAction, string auditReason, CancellationToken ct)
    {
        // AC4 + identity teardown in ONE transaction: the audit row must
        // commit with the delete (actor = the user being removed; audit_log
        // deliberately has no FK for exactly this reason).
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            db.AuditLogs.Add(new AuditLog
            {
                ActorUserId = user.Id,
                Action = auditAction,
                Target = user.Id.ToString(),
                Reason = auditReason,
            });
            await db.SaveChangesAsync(ct);

            await refresh.RevokeAllForUserAsync(user.Id, ct);
            await db.AuthTokens.Where(t => t.UserId == user.Id).ExecuteDeleteAsync(ct);
            await db.RefreshTokens.Where(t => t.UserId == user.Id).ExecuteDeleteAsync(ct);
            // Devices this user claimed: sever attribution AND scrub the
            // peppered ip/ua hashes (hashed network identifiers are still
            // personal data once the account is gone).
            await db.Devices.Where(d => d.ClaimedByUserId == user.Id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(d => d.ClaimedByUserId, (Guid?)null)
                    .SetProperty(d => d.IpHash, "")
                    .SetProperty(d => d.UaHash, ""), ct);

            // The user row: FK-cascades take viz_presets, notifications,
            // reference_sets, session_notes, credit_ledger, usage_events, subscriptions.
            db.Users.Remove(user);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }

        // Local session teardown — must happen even if a caller's enqueue of
        // delete_account_data fails afterward (the deleted user's cached
        // tver must not validate for another 60 s).
        cache.Remove($"tver:{user.Id:N}");
    }
}
