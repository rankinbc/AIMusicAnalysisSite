using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Credit economy rollout — accounts verified before the sign-up bonus shipped
// (a28aa1f) never received it. One operator-triggered, idempotent pass grants
// them the same bonus through the same key, so a re-run (or a user who
// verifies concurrently) can never be granted twice.
public sealed class SignupBonusBackfill(
    AppDbContext db, EntitlementService ents, CreditLedgerService credits, ILogger<SignupBonusBackfill> logger)
{
    public async Task<int> RunAsync(CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        if (!ents.CreditsEnabled(flags)) return 0;
        var amount = (await ents.GetPricesAsync(ct)).SignupGrant;
        if (amount <= 0) return 0;

        var candidates = await db.Users.AsNoTracking()
            .Where(u => !u.IsGuest && u.IsActive && u.BannedAt == null && u.EmailVerifiedAt != null)
            .Select(u => u.Id)
            .ToListAsync(ct);
        var granted = 0;
        foreach (var id in candidates)
        {
            if (await credits.GrantSignupBonusAsync(id, amount, ct))
            {
                ents.InvalidateAsync(id);
                granted++;
            }
        }
        logger.LogInformation("Sign-up bonus backfill: granted {Granted} of {Candidates}", granted, candidates.Count);
        return granted;
    }
}
