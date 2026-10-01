using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Story 2.3 / AR11 / AR14 / AR16 — the ONLY writer to the credit_ledger
// table. Architecture D2 money-boundary rule: any code that mutates the
// balance routes through this service.
//
// Append-only invariant: NEVER UPDATE existing rows. Adjustments come as
// compensating entries (purchase = +N, spend = -N, reversal = +|spent|).
//
// Idempotency-key shape (story 2.2 review-fix P3 convention — salt with
// stable Stripe ids, never UtcNow timestamps):
//   purchase   → "credits_purchase:<stripeEventId>"
//   reversal   → "reversal:<ref>"
//   spend      → "spend:<kind>:<ref>" (optional; keyless spends rely on the
//                serializable transaction + balance check)
//   signup     → "signup_bonus:<userId>" (GrantSignupBonusAsync)

public sealed class CreditLedgerService(
    AppDbContext db,
    IMemoryCache cache,
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

        var entry = await InsertKeyedAsync(
            userId, packSize, "purchase", stripePaymentIntentId, idempotencyKey, ct);
        if (entry is null)
            logger.LogInformation(
                "Credit purchase idempotency collision (already recorded): user={UserId}, idempotencyKey={Key}",
                userId, idempotencyKey);
        return entry;
    }

    // Legacy analysis spend (1 credit, no key) — kept for existing callers/tests.
    public async Task<CreditLedgerEntry> SpendAsync(
        Guid userId, Guid jobId, string billingPeriod, CancellationToken ct)
        => (await ChargeAsync(userId, 1, jobId.ToString(), null, "analysis", ct, billingPeriod))!;

    private const int MaxChargeAttempts = 4;

    // Debit `amount` credits (+ an optional usage_events row) in one serializable
    // transaction. Idempotent on `idempotencyKey`: a replay returns null and
    // charges nothing (the caller proceeds — it was already paid). Throws
    // InsufficientCreditsException when balance < amount. Retries on 40001 (a few
    // concurrent charges by one user serialize behind each other).
    public async Task<CreditLedgerEntry?> ChargeAsync(
        Guid userId, int amount, string reference, string? idempotencyKey,
        string? usageEventType, CancellationToken ct, string? billingPeriod = null)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (amount == 0) return null;
        for (var attempt = 0; attempt < MaxChargeAttempts; attempt++)
        {
            try
            {
                return await ChargeOnceAsync(userId, amount, reference, idempotencyKey, usageEventType, billingPeriod, ct);
            }
            catch (Exception ex) when (IsSerializationFailure(ex) && attempt < MaxChargeAttempts - 1)
            {
                logger.LogWarning("Charge serialization conflict — retrying. user={UserId}, ref={Ref}", userId, reference);
                db.ChangeTracker.Clear();
            }
        }
        throw new InvalidOperationException("Charge retry exhausted.");
    }

    private async Task<CreditLedgerEntry?> ChargeOnceAsync(
        Guid userId, int amount, string reference, string? idempotencyKey,
        string? usageEventType, string? billingPeriod, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

        if (idempotencyKey is not null
            && await db.CreditLedger.AnyAsync(e => e.IdempotencyKey == idempotencyKey, ct))
            return null; // already charged

        var balance = await db.CreditLedger
            .Where(e => e.UserId == userId)
            .SumAsync(e => (int?)e.Amount, ct) ?? 0;
        if (balance < amount)
            throw new InsufficientCreditsException(balance, amount);

        var spend = new CreditLedgerEntry
        {
            UserId = userId,
            Amount = -amount,
            Reason = "spend",
            Reference = reference,
            IdempotencyKey = idempotencyKey,
        };
        db.CreditLedger.Add(spend);
        if (usageEventType is not null)
        {
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId,
                EventType = usageEventType,
                BillingPeriod = billingPeriod ?? DateTimeOffset.UtcNow.ToString("yyyy-MM"),
                Reference = reference,
            });
        }
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            db.ChangeTracker.Clear(); // concurrent twin won the key
            return null;
        }
        logger.LogInformation("Credit charge: user={UserId}, amount=-{Amount}, ref={Ref}", userId, amount, reference);
        cache.Remove($"ent:{userId:N}");
        return spend;
    }

    // Legacy job reversal — now refunds whatever that job actually spent.
    public Task<CreditLedgerEntry?> ReverseAsync(
        Guid userId, Guid jobId, string reasonCode, CancellationToken ct)
        => RefundChargeAsync(userId, jobId.ToString(), $"reversal:{jobId}", ct);

    // Refund exactly what was charged under `reference` (sum of its spend rows).
    // Nothing charged → null (never mints credits). Idempotent on refundKey.
    public async Task<CreditLedgerEntry?> RefundChargeAsync(
        Guid userId, string reference, string refundKey, CancellationToken ct)
    {
        var spent = await db.CreditLedger.AsNoTracking()
            .Where(e => e.UserId == userId && e.Reason == "spend" && e.Reference == reference)
            .SumAsync(e => (int?)e.Amount, ct) ?? 0;
        if (spent >= 0) return null;
        return await InsertKeyedAsync(userId, -spent, "reversal", reference, refundKey, ct);
    }

    private async Task<CreditLedgerEntry?> InsertKeyedAsync(
        Guid userId, int amount, string reason, string reference, string key, CancellationToken ct)
    {
        var entry = new CreditLedgerEntry
        {
            UserId = userId, Amount = amount, Reason = reason, Reference = reference, IdempotencyKey = key,
        };
        try
        {
            db.CreditLedger.Add(entry);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Credit {Reason}: user={UserId}, amount=+{Amount}, key={Key}", reason, userId, amount, key);
            cache.Remove($"ent:{userId:N}");
            return entry;
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            db.Entry(entry).State = EntityState.Detached;
            return null;
        }
    }

    // Sign-up bonus (owner decision 2026-10) — +N once per user when a
    // permanent account is ACTIVATED (email verified). Idempotency is the
    // ledger's partial unique index on idempotency_key ("signup_bonus:<id>"),
    // expressed as ON CONFLICT DO NOTHING rather than catch-on-violation:
    // this runs INSIDE the verify transaction, and a raised unique violation
    // would abort that whole Postgres transaction (activation included).
    // Returns true only when THIS call inserted the row.
    public const string ReasonSignupBonus = "signup_bonus";
    public const string SignupBonusFlag = "signup_bonus_credits";

    public static string SignupBonusKey(Guid userId) => $"signup_bonus:{userId:N}";

    public async Task<bool> GrantSignupBonusAsync(Guid userId, int amount, CancellationToken ct)
    {
        if (amount <= 0) return false;
        var key = SignupBonusKey(userId);
        var rows = await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO credit_ledger (id, user_id, amount, reason, reference, idempotency_key, created_at)
            VALUES ({Guid.NewGuid()}, {userId}, {amount}, {ReasonSignupBonus}, {ReasonSignupBonus}, {key}, now())
            ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
            """, ct);
        if (rows == 1)
        {
            logger.LogInformation(
                "Sign-up bonus recorded: user={UserId}, amount=+{Amount}", userId, amount);
            cache.Remove($"ent:{userId:N}");
        }
        return rows == 1;
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is PostgresException pg && pg.SqlState == "23505";

    // Walks the inner-exception chain: EF's Npgsql execution strategy wraps a
    // 40001 raised inside a user transaction in an InvalidOperationException
    // ("transient failure") around the DbUpdateException.
    private static bool IsSerializationFailure(Exception? ex)
    {
        for (; ex is not null; ex = ex.InnerException)
            if (ex is PostgresException { SqlState: "40001" }) return true;
        return false;
    }
}
