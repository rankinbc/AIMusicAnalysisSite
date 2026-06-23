using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Spectr.Bff.DTOs;
using Spectr.Bff.Options;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 2.8 / FR32 / UX-DR32 — the "honest math" behind the dismissible
// HonestMathBanner: over a rolling 90-day window, has the user spent at least
// what Pro would have cost? Pure read; no writes; no Stripe API calls.
//
// The credit ledger stores credit COUNTS, not cents, so 90-day spend is
// reconstructed by mapping each credit-PURCHASE row to its pack DISPLAY price
// from PricingDisplayOptions (5 → CreditPack5Cents, 10 → CreditPack10Cents).
// Non-standard amounts (e.g. operator `adjustment` rows that happen to carry a
// purchase reason, or future pack sizes) are skipped — we never invent a price.
// Pro-equivalent = (PeriodDays / 30) months of ProMonthlyCents. All cents come
// from config (AR39 — no price literals in code).
public sealed class HonestMathService(AppDbContext db, IOptions<PricingDisplayOptions> pricing)
{
    public const int PeriodDays = 90;

    public async Task<HonestMathDto> ForAsync(Guid userId, CancellationToken ct)
    {
        var p = pricing.Value;
        var since = DateTimeOffset.UtcNow.AddDays(-PeriodDays);

        var purchaseAmounts = await db.CreditLedger
            .AsNoTracking()
            .Where(e => e.UserId == userId
                && e.Reason == "purchase"
                && e.CreatedAt >= since)
            .Select(e => e.Amount)
            .ToListAsync(ct);

        var spentCents = 0;
        foreach (var amount in purchaseAmounts)
        {
            spentCents += amount switch
            {
                5 => p.CreditPack5Cents,
                10 => p.CreditPack10Cents,
                _ => 0, // unknown pack shape — can't price it, don't guess
            };
        }

        var months = PeriodDays / 30; // 3 monthly cycles ≈ 90 days
        var proEquivalentCents = p.ProMonthlyCents * months;

        // Qualifies only when the user has actually spent at least Pro's cost.
        var qualifies = spentCents > 0 && spentCents >= proEquivalentCents;

        return new HonestMathDto(
            Qualifies: qualifies,
            CreditsSpentCents: spentCents,
            ProEquivalentCents: proEquivalentCents,
            PeriodDays: PeriodDays,
            Currency: p.Currency);
    }
}
