using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Story 2.3 / AR11 / AR14 / AR16 — the ONLY writer to the credit_ledger
// table. Architecture D2 money-boundary rule: any code that mutates the
// balance routes through this service.
//
// Append-only invariant: NEVER UPDATE existing rows. Adjustments come as
// compensating entries (purchase = +N, spend = -1, reversal = +1).
//
// Idempotency-key shape (story 2.2 review-fix P3 convention — salt with
// stable Stripe ids, never UtcNow timestamps):
//   purchase   → "credits_purchase:<stripeEventId>"
//   reversal   → "reversal:<jobId>"
//   spend      → no key (concurrency via serializable transaction)

public sealed class CreditLedgerService(
    AppDbContext db,
    ILogger<CreditLedgerService> logger)
{
    // SUM(amount) WHERE user_id. No cache in story 2.3; story 2.4 adds
    // the 60-s cache via Entitlements.For(user).
    public async Task<int> GetBalanceAsync(Guid userId, CancellationToken ct)
    {
        var balance = await db.CreditLedger
            .AsNoTracking()
            .Where(e => e.UserId == userId)
            .SumAsync(e => (int?)e.Amount, ct);
        return balance ?? 0;
    }

    // Append a +N purchase row. Returns null if the partial unique index
    // on idempotency_key collides (duplicate Stripe event delivery).
    // Returns the inserted entry otherwise so the caller can log.
    public async Task<CreditLedgerEntry?> PurchaseAsync(
        Guid userId,
        int packSize,
        string stripePaymentIntentId,
        string idempotencyKey,
        CancellationToken ct)
    {
        if (packSize <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(packSize), packSize, "Pack size must be positive.");
        }

        var entry = new CreditLedgerEntry
        {
            UserId = userId,
            Amount = packSize,
            Reason = "purchase",
            Reference = stripePaymentIntentId,
            IdempotencyKey = idempotencyKey,
        };

        try
        {
            db.CreditLedger.Add(entry);
            await db.SaveChangesAsync(ct);
            logger.LogInformation(
                "Credit purchase recorded: user={UserId}, amount=+{Amount}, paymentIntent={PaymentIntentId}, idempotencyKey={Key}",
                userId, packSize, stripePaymentIntentId, idempotencyKey);
            return entry;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            logger.LogInformation(
                "Credit purchase idempotency collision (already recorded): user={UserId}, idempotencyKey={Key}",
                userId, idempotencyKey);
            // The entity got added to the tracker; detach so subsequent
            // SaveChanges on the same context doesn't retry the insert.
            db.Entry(entry).State = EntityState.Detached;
            return null;
        }
    }

    // Append a -1 spend row + the matched usage_events row in one
    // serializable transaction. Throws InsufficientCreditsException
    // if the user's balance is < 1 at spend time (caller maps to 409).
    //
    // Retries ONCE on Postgres serialization_failure (40001) — the
    // serializable isolation level may abort one of two concurrent
    // transactions; a single retry suffices since the second attempt
    // sees the winner's spend and either retries cleanly or hits the
    // insufficient-balance path.
    public async Task<CreditLedgerEntry> SpendAsync(
        Guid userId,
        Guid jobId,
        string billingPeriod,
        CancellationToken ct)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                return await SpendOnceAsync(userId, jobId, billingPeriod, ct);
            }
            catch (DbUpdateException ex)
                when (IsSerializationFailure(ex) && attempt == 0)
            {
                logger.LogWarning(
                    "Spend serialization conflict — retrying once. user={UserId}, jobId={JobId}",
                    userId, jobId);
            }
        }
        // Unreachable — the loop either returns or throws.
        throw new InvalidOperationException("Spend retry exhausted.");
    }

    private async Task<CreditLedgerEntry> SpendOnceAsync(
        Guid userId,
        Guid jobId,
        string billingPeriod,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);

        var balance = await db.CreditLedger
            .Where(e => e.UserId == userId)
            .SumAsync(e => (int?)e.Amount, ct) ?? 0;
        if (balance < 1)
        {
            throw new InsufficientCreditsException(balance);
        }

        var spend = new CreditLedgerEntry
        {
            UserId = userId,
            Amount = -1,
            Reason = "spend",
            Reference = jobId.ToString(),
            // Spend uses no idempotency_key — the serializable
            // transaction + balance check is the concurrency guard.
            IdempotencyKey = null,
        };
        var usage = new UsageEvent
        {
            UserId = userId,
            EventType = "analysis",
            BillingPeriod = billingPeriod,
            Reference = jobId.ToString(),
        };

        db.CreditLedger.Add(spend);
        db.UsageEvents.Add(usage);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        logger.LogInformation(
            "Credit spend recorded: user={UserId}, jobId={JobId}, billingPeriod={Period}",
            userId, jobId, billingPeriod);
        return spend;
    }

    // Append a +1 reversal row with idempotency_key="reversal:<jobId>".
    // Returns null on partial-unique-index collision (already reversed).
    public async Task<CreditLedgerEntry?> ReverseAsync(
        Guid userId,
        Guid jobId,
        string reasonCode,
        CancellationToken ct)
    {
        var entry = new CreditLedgerEntry
        {
            UserId = userId,
            Amount = 1,
            Reason = "reversal",
            Reference = jobId.ToString(),
            IdempotencyKey = $"reversal:{jobId}",
        };

        try
        {
            db.CreditLedger.Add(entry);
            await db.SaveChangesAsync(ct);
            logger.LogInformation(
                "Credit reversal recorded: user={UserId}, jobId={JobId}, reasonCode={ReasonCode}",
                userId, jobId, reasonCode);
            return entry;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            logger.LogDebug(
                "Reversal idempotency collision (already reversed): user={UserId}, jobId={JobId}",
                userId, jobId);
            db.Entry(entry).State = EntityState.Detached;
            return null;
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is PostgresException pg && pg.SqlState == "23505";

    private static bool IsSerializationFailure(DbUpdateException ex)
        => ex.InnerException is PostgresException pg && pg.SqlState == "40001";
}
