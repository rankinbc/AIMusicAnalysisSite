# Credit Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Claude-backed action paid for in credits (or Pro allowance), let users buy credit packs, and show their balance and each action's cost before they act.

**Architecture:** One server-side price list (`CreditPricing`, config → feature flag → default) feeds both enforcement (BFF charges through a generalised `CreditLedgerService.ChargeAsync`) and display (prices ride on the existing anonymous `GET /api/billing/plans`). The frontend reads balance from `EntitlementsDto`, prices from `PlansResponse`, renders cost labels, and routes every out-of-credits case into the existing `UpgradeSheet`, extended to sell the three packs.

**Tech Stack:** ASP.NET Core .NET 10 minimal API + EF Core 10/Npgsql (BFF), Python dramatiq worker, React 19 + TS strict + TanStack Query (frontend), Stripe Checkout.

**Spec:** `PRPs/credit-economy.md` (owner-approved 2026-10-01).

**Worktree / branch:** `C:\Users\badmin\projects\spectr-credits` on `feat/credit-economy`.

## Global Constraints

- Prices (defaults): analysis **100**, extra specialist **15**, coach message **5**, Coach Mix **5**; signup grant **500**; Pro **15 analyses + 300 coach messages / calendar month (UTC)**.
- Packs: **500 credits = 700¢**, **1,500 = 1800¢**, **5,000 = 5500¢**; USD; credits never expire.
- Pro overflow draws credits at normal prices. Free: free retry, per-phase re-run, reference analysis, coach brief, triage-routed (auto-run) specialists.
- **Labels only — no confirm dialogs.** Not enough credits → open the buy sheet instead of firing.
- `credits_enabled=false` ⇒ zero behaviour change (everyone premium, no charges, no labels).
- Guests (`users.is_guest`) are never charged and never granted; their existing `guest_*` caps stay.
- No `$`/price literals outside `*Options.cs` / `src/config/**` (AR39 lint `scripts/check-price-literals.mjs`). Frontend never hardcodes a credit cost.
- Every ledger write goes through `CreditLedgerService`; append-only; every charge/refund/grant has an idempotency key ≤ 128 chars.
- TS: `import type` for type-only imports (verbatimModuleSyntax); CSS Modules + tokens, no raw hex.

## Test environment (read before Task 1)

BFF tests run against the docker-compose Postgres/Redis. On this machine `localhost` resolves to a black-holed `::1` (docs/STARTUP.md problem #2) — tests then **silently SKIP** (or crawl to the 30-min limit). Always export:

```bash
export ConnectionStrings__Postgres="Host=127.0.0.1;Port=5432;Database=spectr;Username=spectr;Password=spectr"
export Redis__ConnectionString="127.0.0.1:6379"
```

Check a run's summary says `Passed!` with `Skipped: 0` for the classes you touched. New migrations must be applied to the dev DB before tests that need them:
`cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff` (with the same `ConnectionStrings__Postgres` exported).

Worker tests: `cd components/worker && PYTHONPATH="../shared;." python -m pytest -q -p no:cacheprovider tests`.
Frontend gates: `cd components/frontend-spectr-v2 && npx tsc -b && npm run lint && npm run build && npx vitest run`.

## Review Focus

1. **Signup-grant farming** — a fresh account (500 credits = `credits` tier) must still face the email-verify gate, the disposable-domain cap and the per-IP dispatch limit until it has *paid* (Pro or a purchase). Pinned in Task 4.
2. **Double charge on retry/race** — a replayed POST (network retry, double-click) for the same coach message / specialist must charge once. Pinned in Tasks 2, 6, 7 (idempotency keys).
3. **Refund for something never charged** — a Pro-allowance or free-retry job that fails must not mint credits. Pinned in Task 5 (refund amount = sum of that reference's spend rows; none → no refund).
4. **Balance between 1 and the price** — a user with 40 credits must get the buy sheet on Analyze (not a server 500 or a silent no-op), and the button label must already show they can't afford it. Pinned in Tasks 4 and 13.
5. **Kill switch off** — with `credits_enabled=false` nobody is charged anywhere (dispatch, specialist, coach, Coach Mix) and no cost label renders. Pinned in Tasks 4, 6, 7, 8, 13.

---

### Task 1: Price list, `grant` ledger reason, and flag seeds

**Files:**
- Create: `components/bff/src/Spectr.Bff/Services/CreditPricing.cs`
- Modify: `components/bff/src/Spectr.Bff/Services/EntitlementService.cs` (add `GetPricesAsync`)
- Modify: `components/bff/src/Spectr.Data/AppDbContext.cs:211-213` (reason CHECK adds `'grant'`)
- Create: migration `CreditEconomy` (scaffolded) in `components/bff/src/Spectr.Data/Migrations/`
- Modify: `components/bff/tests/Spectr.Bff.Tests/TestSupport.cs` (`TestProcessBaseline`)
- Test: `components/bff/tests/Spectr.Bff.Tests/CreditPricingTests.cs`

**Interfaces:**
- Produces: `record CreditPrices(int Analysis, int Specialist, int CoachMessage, int CoachMix, int SignupGrant, int ProAnalysesMonthly)`; `static CreditPrices CreditPricing.Resolve(IConfiguration, IReadOnlyDictionary<string,string>)`; `CreditPricing.Defaults`; `Task<CreditPrices> EntitlementService.GetPricesAsync(CancellationToken)`.
- Config keys (each overrides its flag): `Credits:Prices:Analysis|Specialist|CoachMessage|CoachMix`, `Credits:SignupGrant`, `Credits:ProAnalysesMonthly`.

- [ ] **Step 1: Write the failing test**

```csharp
// components/bff/tests/Spectr.Bff.Tests/CreditPricingTests.cs
using Microsoft.Extensions.Configuration;
using Spectr.Bff.Services;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CreditPricingTests
{
    private static IConfiguration Cfg(params (string K, string V)[] kv) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(kv.Select(p => new KeyValuePair<string, string?>(p.K, p.V)))
            .Build();

    [Fact]
    public void Defaults_When_No_Config_And_No_Flags()
    {
        var p = CreditPricing.Resolve(Cfg(), new Dictionary<string, string>());
        Assert.Equal(new CreditPrices(100, 15, 5, 5, 500, 15), p);
    }

    [Fact]
    public void Flag_Overrides_Default_And_Config_Overrides_Flag()
    {
        var flags = new Dictionary<string, string>
        {
            ["credit_cost_analysis"] = "80",
            ["credit_cost_specialist"] = "12",
            ["credit_signup_grant"] = "300",
        };
        var p = CreditPricing.Resolve(Cfg(("Credits:Prices:Analysis", "1")), flags);
        Assert.Equal(1, p.Analysis);        // config wins
        Assert.Equal(12, p.Specialist);     // flag wins over default
        Assert.Equal(300, p.SignupGrant);
        Assert.Equal(5, p.CoachMessage);    // default
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("-5")]
    [InlineData("")]
    public void Garbage_Or_Negative_Falls_Back_To_Default(string raw)
    {
        var p = CreditPricing.Resolve(Cfg(), new Dictionary<string, string> { ["credit_cost_coach_mix"] = raw });
        Assert.Equal(5, p.CoachMix);
    }

    [Fact]
    public void Zero_Is_Allowed_Meaning_Free()
    {
        var p = CreditPricing.Resolve(Cfg(("Credits:SignupGrant", "0")), new Dictionary<string, string>());
        Assert.Equal(0, p.SignupGrant);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd components/bff && dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~CreditPricingTests"`
Expected: build FAIL — `CreditPricing` / `CreditPrices` not defined.

- [ ] **Step 3: Implement `CreditPricing`**

```csharp
// components/bff/src/Spectr.Bff/Services/CreditPricing.cs
namespace Spectr.Bff.Services;

// Credit economy (PRPs/credit-economy.md) — the ONE price list. Enforcement
// (every charge site) and display (GET /api/billing/plans) both read this, so a
// label can never disagree with the charge. Units are credits; ~1 credit ≈ 1¢
// of Claude cost. Live-tunable via feature_flags (60 s cache, no redeploy).
public sealed record CreditPrices(
    int Analysis,
    int Specialist,
    int CoachMessage,
    int CoachMix,
    int SignupGrant,
    int ProAnalysesMonthly);

public static class CreditPricing
{
    public static readonly CreditPrices Defaults = new(
        Analysis: 100, Specialist: 15, CoachMessage: 5, CoachMix: 5,
        SignupGrant: 500, ProAnalysesMonthly: 15);

    // Per value: config key (env / UseSetting — the test suite pins legacy
    // values here, same knob pattern as Credits:Enabled) → feature flag →
    // default. Non-integer or negative → next source; 0 is valid ("free").
    public static CreditPrices Resolve(IConfiguration config, IReadOnlyDictionary<string, string> flags) => new(
        Analysis: Get(config, flags, "Credits:Prices:Analysis", "credit_cost_analysis", Defaults.Analysis),
        Specialist: Get(config, flags, "Credits:Prices:Specialist", "credit_cost_specialist", Defaults.Specialist),
        CoachMessage: Get(config, flags, "Credits:Prices:CoachMessage", "credit_cost_coach_message", Defaults.CoachMessage),
        CoachMix: Get(config, flags, "Credits:Prices:CoachMix", "credit_cost_coach_mix", Defaults.CoachMix),
        SignupGrant: Get(config, flags, "Credits:SignupGrant", "credit_signup_grant", Defaults.SignupGrant),
        ProAnalysesMonthly: Get(config, flags, "Credits:ProAnalysesMonthly", "pro_analyses_monthly", Defaults.ProAnalysesMonthly));

    private static int Get(
        IConfiguration config, IReadOnlyDictionary<string, string> flags,
        string configKey, string flagName, int fallback)
    {
        if (TryParse(config[configKey], out var c)) return c;
        if (flags.TryGetValue(flagName, out var raw) && TryParse(raw, out var f)) return f;
        return fallback;
    }

    private static bool TryParse(string? raw, out int value)
        => int.TryParse(raw, out value) && value >= 0;
}
```

Add to `EntitlementService` (after the `CreditsEnabled` instance overload):

```csharp
    // Credit economy — the resolved price list (config → flag → default).
    public async Task<CreditPrices> GetPricesAsync(CancellationToken ct)
        => CreditPricing.Resolve(config, await GetFlagsAsync(ct));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd components/bff && dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~CreditPricingTests"`
Expected: PASS (6 tests).

- [ ] **Step 5: Add `grant` to the ledger reason CHECK and scaffold the migration**

In `AppDbContext.cs` replace the reason constraint string:

```csharp
        builder.Entity<CreditLedgerEntry>().ToTable(t => t.HasCheckConstraint(
            "ck_credit_ledger_reason",
            "\"reason\" IN ('purchase','spend','reversal','adjustment','grant')"));
```

Run: `cd components/bff && dotnet ef migrations add CreditEconomy --project src/Spectr.Data --startup-project src/Spectr.Bff`
Expected: a migration whose `Up` drops + re-adds `ck_credit_ledger_reason`. Append the flag seeds to the END of `Up` and their removal to the END of `Down`:

```csharp
            // Credit economy (PRPs/credit-economy.md) — live price list. ON CONFLICT
            // keeps an operator's already-tuned value on re-run.
            migrationBuilder.Sql(@"
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                  ('credit_cost_analysis', '100', now()),
                  ('credit_cost_specialist', '15', now()),
                  ('credit_cost_coach_message', '5', now()),
                  ('credit_cost_coach_mix', '5', now()),
                  ('credit_signup_grant', '500', now()),
                  ('pro_analyses_monthly', '15', now()),
                  ('llm_budget_credits_usd', '100', now())
                ON CONFLICT (name) DO NOTHING;");
```

```csharp
            migrationBuilder.Sql(@"
                DELETE FROM feature_flags WHERE name IN (
                  'credit_cost_analysis','credit_cost_specialist','credit_cost_coach_message',
                  'credit_cost_coach_mix','credit_signup_grant','pro_analyses_monthly',
                  'llm_budget_credits_usd');");
```

Verify the seed column names against an existing seed first: `grep -n "INSERT INTO feature_flags" src/Spectr.Data/Migrations/20260723180200_AddCreditsEnabledFlag.cs` — use exactly the columns it uses.

- [ ] **Step 6: Pin legacy-compatible values for the existing suite**

In `TestSupport.cs` `TestProcessBaseline.PinCreditsEnabled()` add (and extend its doc comment: "existing tests were written for a 1-credit analysis and no signup grant; credit-economy tests opt in via UseSetting"):

```csharp
        Environment.SetEnvironmentVariable("Credits__Prices__Analysis", "1");
        Environment.SetEnvironmentVariable("Credits__SignupGrant", "0");
```

- [ ] **Step 7: Apply migration to dev DB and run the whole BFF suite**

Run (with the env from "Test environment"): `dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff && dotnet test`
Expected: all pass, 0 unexpected skips.

- [ ] **Step 8: Commit**

```bash
git add components/bff
git commit -m "feat(credits): price list (config>flag>default), grant ledger reason, flag seeds"
```

---

### Task 2: Generalised ledger — charge any amount, grant, refund a charge

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Services/CreditLedgerService.cs`
- Modify: `components/bff/src/Spectr.Bff/Services/InsufficientCreditsException.cs`
- Test: `components/bff/tests/Spectr.Bff.Tests/CreditLedgerChargeTests.cs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Task<CreditLedgerEntry?> ChargeAsync(Guid userId, int amount, string reference, string? idempotencyKey, string? usageEventType, CancellationToken ct)` — returns the spend row; returns `null` when `idempotencyKey` was already used (already charged — caller proceeds, no second charge); throws `InsufficientCreditsException` (now with `Required`) when balance < amount. `amount == 0` → returns `null` without writing.
  - `Task<CreditLedgerEntry?> GrantAsync(Guid userId, int amount, string reference, string idempotencyKey, CancellationToken ct)` — `+amount` row, reason `grant`; `null` on duplicate key or `amount <= 0`.
  - `Task<CreditLedgerEntry?> RefundChargeAsync(Guid userId, string reference, string refundKey, CancellationToken ct)` — sums this user's `spend` rows with `Reference == reference`; none → `null`; else inserts `+|sum|` reason `reversal` with `refundKey`; duplicate key → `null`.
  - Existing `SpendAsync(userId, jobId, billingPeriod)` and `ReverseAsync(userId, jobId, reasonCode)` keep their signatures and become wrappers (`ChargeAsync(userId, 1, jobId.ToString(), null, "analysis")` / `RefundChargeAsync(userId, jobId.ToString(), $"reversal:{jobId}")`).

- [ ] **Step 1: Write the failing tests**

```csharp
// components/bff/tests/Spectr.Bff.Tests/CreditLedgerChargeTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CreditLedgerChargeTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private async Task<(IServiceScope Scope, CreditLedgerService Svc, AppDbContext Db, Guid UserId)> SeedAsync(int balance)
    {
        var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        var user = new User { Id = Guid.NewGuid(), Email = $"charge+{Guid.NewGuid():N}@spectr.test", HashedPassword = "x" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        if (balance > 0)
            await svc.GrantAsync(user.Id, balance, "seed", $"grant:seed:{user.Id}", CancellationToken.None);
        return (scope, svc, db, user.Id);
    }

    private static async Task CleanupAsync(AppDbContext db, Guid userId)
    {
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Charge_Deducts_Amount_And_Writes_Usage_Event()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(500);
        try
        {
            var row = await svc.ChargeAsync(uid, 100, "job:1", "spend:analysis:1", "analysis", CancellationToken.None);
            Assert.NotNull(row);
            Assert.Equal(-100, row!.Amount);
            Assert.Equal(400, await svc.GetBalanceAsync(uid, CancellationToken.None));
            Assert.Equal(1, await db.UsageEvents.CountAsync(e => e.UserId == uid && e.EventType == "analysis"));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Charge_Same_Key_Twice_Charges_Once()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(500);
        try
        {
            await svc.ChargeAsync(uid, 5, "msg:1", "spend:coach:1", null, CancellationToken.None);
            var second = await svc.ChargeAsync(uid, 5, "msg:1", "spend:coach:1", null, CancellationToken.None);
            Assert.Null(second);
            Assert.Equal(495, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Charge_More_Than_Balance_Throws_With_Required_And_Writes_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(40);
        try
        {
            var ex = await Assert.ThrowsAsync<InsufficientCreditsException>(() =>
                svc.ChargeAsync(uid, 100, "job:2", "spend:analysis:2", "analysis", CancellationToken.None));
            Assert.Equal(40, ex.CurrentBalance);
            Assert.Equal(100, ex.Required);
            Assert.Equal(40, await svc.GetBalanceAsync(uid, CancellationToken.None));
            Assert.Equal(0, await db.UsageEvents.CountAsync(e => e.UserId == uid));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Refund_Returns_Exactly_What_Was_Charged_Once()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(500);
        try
        {
            await svc.ChargeAsync(uid, 15, "specialist:a:low_end", "spend:specialist:a:low_end", null, CancellationToken.None);
            var r1 = await svc.RefundChargeAsync(uid, "specialist:a:low_end", "reversal:specialist:a:low_end", CancellationToken.None);
            var r2 = await svc.RefundChargeAsync(uid, "specialist:a:low_end", "reversal:specialist:a:low_end", CancellationToken.None);
            Assert.Equal(15, r1!.Amount);
            Assert.Null(r2);
            Assert.Equal(500, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Refund_Of_Never_Charged_Reference_Mints_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(0);
        try
        {
            Assert.Null(await svc.RefundChargeAsync(uid, "job:never", "reversal:never", CancellationToken.None));
            Assert.Equal(0, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Grant_Is_Idempotent_And_Zero_Is_NoOp()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(0);
        try
        {
            Assert.Null(await svc.GrantAsync(uid, 0, "signup", "grant:zero", CancellationToken.None));
            Assert.NotNull(await svc.GrantAsync(uid, 500, "signup", $"grant:signup:{uid}", CancellationToken.None));
            Assert.Null(await svc.GrantAsync(uid, 500, "signup", $"grant:signup:{uid}", CancellationToken.None));
            Assert.Equal(500, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~CreditLedgerChargeTests"`
Expected: build FAIL — `ChargeAsync`, `GrantAsync`, `RefundChargeAsync`, `Required` missing.

- [ ] **Step 3: Implement**

`InsufficientCreditsException.cs`:

```csharp
public sealed class InsufficientCreditsException(int currentBalance, int required = 1)
    : Exception($"Insufficient credits: balance {currentBalance}, required {required}.")
{
    public int CurrentBalance { get; } = currentBalance;
    public int Required { get; } = required;
}
```

In `CreditLedgerService`: update the header comment's key list (`spend → "spend:<kind>:<ref>" (optional)`, `grant → "grant:signup:<userId>"`, `reversal → "reversal:<ref>"`), then replace `SpendAsync`/`SpendOnceAsync`/`ReverseAsync` with:

```csharp
    // Legacy analysis spend (1 credit, no key) — kept for existing callers/tests.
    public async Task<CreditLedgerEntry> SpendAsync(
        Guid userId, Guid jobId, string billingPeriod, CancellationToken ct)
        => (await ChargeAsync(userId, 1, jobId.ToString(), null, "analysis", ct))!;

    // Debit `amount` credits (+ an optional usage_events row) in one serializable
    // transaction. Idempotent on `idempotencyKey`: a replay returns null and
    // charges nothing (the caller proceeds — it was already paid). Throws
    // InsufficientCreditsException when balance < amount. Retries ONCE on 40001.
    public async Task<CreditLedgerEntry?> ChargeAsync(
        Guid userId, int amount, string reference, string? idempotencyKey,
        string? usageEventType, CancellationToken ct)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (amount == 0) return null;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                return await ChargeOnceAsync(userId, amount, reference, idempotencyKey, usageEventType, ct);
            }
            catch (Exception ex) when (IsSerializationFailure(ex) && attempt == 0)
            {
                logger.LogWarning("Charge serialization conflict — retrying once. user={UserId}, ref={Ref}", userId, reference);
                db.ChangeTracker.Clear();
            }
        }
        throw new InvalidOperationException("Charge retry exhausted.");
    }

    private async Task<CreditLedgerEntry?> ChargeOnceAsync(
        Guid userId, int amount, string reference, string? idempotencyKey,
        string? usageEventType, CancellationToken ct)
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
                BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"),
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

    public Task<CreditLedgerEntry?> GrantAsync(
        Guid userId, int amount, string reference, string idempotencyKey, CancellationToken ct)
        => amount <= 0
            ? Task.FromResult<CreditLedgerEntry?>(null)
            : InsertKeyedAsync(userId, amount, "grant", reference, idempotencyKey, ct);

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
```

Make `PurchaseAsync` reuse `InsertKeyedAsync(userId, packSize, "purchase", stripePaymentIntentId, idempotencyKey, ct)` after its `packSize <= 0` guard (keep that throw).

- [ ] **Step 4: Run tests**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~CreditLedger|FullyQualifiedName~JobEndpointsCreditReversal"`
Expected: PASS — new tests plus the existing ledger/reversal tests (reversal of a 1-credit spend is still +1).

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): ledger charges any amount idempotently, grants, refunds exact charge"
```

---

### Task 3: Entitlements expose balance, paying status and Pro allowance

**Files:**
- Modify: `components/bff/src/Spectr.Bff/DTOs/` — the file declaring `EntitlementsDto` (find with `grep -rn "record EntitlementsDto" components/bff/src`)
- Modify: `components/bff/src/Spectr.Bff/Services/EntitlementService.cs`
- Test: `components/bff/tests/Spectr.Bff.Tests/EntitlementsCreditFieldsTests.cs`

**Interfaces:**
- Produces (new optional trailing params on `EntitlementsDto`, defaults keep every existing constructor call compiling):
  `int CreditBalance = 0`, `bool IsPaying = false`, `int? ProAnalysesLimit = null`, `int ProAnalysesUsed = 0`.
  - `IsPaying` = Pro subscriber OR has ≥ 1 `purchase` ledger row. Kill switch off → `true`.
  - Pro: `ProAnalysesLimit = prices.ProAnalysesMonthly`, `ProAnalysesUsed` = this period's `analysis` usage events (same invalid_file exclusion as today); `AnalysesRemaining = max(0, limit-used) + balance / prices.Analysis` (allowance then credits).
  - Credits tier: `AnalysesRemaining = prices.Analysis == 0 ? balance : balance / prices.Analysis` (so 40 credits at price 100 → 0).

- [ ] **Step 1: Write the failing tests** (unit-level against a real scope, users seeded directly)

```csharp
// components/bff/tests/Spectr.Bff.Tests/EntitlementsCreditFieldsTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class EntitlementsCreditFieldsTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // Real prices for these tests (the suite baseline pins analysis=1).
    private readonly WebApplicationFactory<Program> factory = baseFactory.WithWebHostBuilder(b =>
        b.UseSetting("Credits:Prices:Analysis", "100").UseSetting("Credits:ProAnalysesMonthly", "15"));

    private async Task<Guid> SeedUserAsync(int grant, bool purchase = false, bool pro = false)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        var uid = Guid.NewGuid();
        db.Users.Add(new User { Id = uid, Email = $"ent+{uid:N}@spectr.test", HashedPassword = "x" });
        if (pro)
            db.Subscriptions.Add(new Subscription { UserId = uid, Status = "active", StripeSubscriptionId = $"sub_{uid:N}" });
        await db.SaveChangesAsync();
        if (grant > 0) await svc.GrantAsync(uid, grant, "signup", $"grant:signup:{uid}", CancellationToken.None);
        if (purchase) await svc.PurchaseAsync(uid, 500, $"pi_{uid:N}", $"credits_purchase:t_{uid:N}", CancellationToken.None);
        return uid;
    }

    private async Task<Spectr.Bff.DTOs.EntitlementsDto> EntAsync(Guid uid)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<EntitlementService>().ForAsync(uid, CancellationToken.None);
    }

    private async Task CleanupAsync(Guid uid)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == uid).ExecuteDeleteAsync();
        await db.Subscriptions.Where(s => s.UserId == uid).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == uid).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Granted_Only_User_Is_Credits_Tier_But_Not_Paying()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 500);
        try
        {
            var e = await EntAsync(uid);
            Assert.Equal("credits", e.Tier);
            Assert.Equal(500, e.CreditBalance);
            Assert.False(e.IsPaying);
            Assert.Equal(5, e.AnalysesRemaining);
        }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Balance_Below_Price_Means_Zero_Analyses_Remaining()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 40);
        try { Assert.Equal(0, (await EntAsync(uid)).AnalysesRemaining); }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Purchaser_Is_Paying()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 0, purchase: true);
        try { Assert.True((await EntAsync(uid)).IsPaying); }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Pro_Reports_Allowance_Plus_Credit_Analyses()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 250, pro: true);
        try
        {
            var e = await EntAsync(uid);
            Assert.Equal("pro", e.Tier);
            Assert.True(e.IsPaying);
            Assert.Equal(15, e.ProAnalysesLimit);
            Assert.Equal(0, e.ProAnalysesUsed);
            Assert.Equal(15 + 2, e.AnalysesRemaining);
        }
        finally { await CleanupAsync(uid); }
    }
}
```

Before writing, confirm the `Subscription` entity's required members with `grep -n "required\|public" components/bff/src/Spectr.Data/Entities/Subscription.cs` and fill any other `required` properties in the seed.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~EntitlementsCreditFieldsTests"`
Expected: build FAIL — `CreditBalance`, `IsPaying`, `ProAnalysesLimit` not on `EntitlementsDto`.

- [ ] **Step 3: Implement**

Append to the `EntitlementsDto` record's parameter list:

```csharp
    // Credit economy — balance + who has actually paid (Pro or ≥1 purchase).
    // IsPaying gates the abuse arms: a signup-grant-only account is NOT paying.
    int CreditBalance = 0,
    bool IsPaying = false,
    int? ProAnalysesLimit = null,
    int ProAnalysesUsed = 0
```

In `EntitlementService.ComputeAsync`:
- Kill-switch branch: add `IsPaying: true`.
- After the balance query add:

```csharp
        var prices = CreditPricing.Resolve(config, flagMap);
        var hasPurchased = await db.CreditLedger.AsNoTracking()
            .AnyAsync(e => e.UserId == userId && e.Reason == "purchase", ct);
        int CreditAnalyses(int bal) => prices.Analysis == 0 ? bal : bal / prices.Analysis;
```

- Pro branch: replace `AnalysesRemaining: null` with `AnalysesRemaining: Math.Max(0, prices.ProAnalysesMonthly - usedThisPeriod) + CreditAnalyses(balance)` and add `CreditBalance: balance, IsPaying: true, ProAnalysesLimit: prices.ProAnalysesMonthly, ProAnalysesUsed: usedThisPeriod`.
- Credits branch: `AnalysesRemaining: CreditAnalyses(balance)`, add `CreditBalance: balance, IsPaying: hasPurchased`.
- Free branch: add `CreditBalance: balance, IsPaying: hasPurchased` (balance is 0 here).

- [ ] **Step 4: Run tests**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~Entitlement"`
Expected: PASS (new + existing `EntitlementServiceTests`). If an existing test asserted `AnalysesRemaining == null` for Pro, update it to the new allowance-plus-credits figure and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): entitlements expose balance, paying status, Pro analysis allowance"
```

---

### Task 4: Charge analyses at dispatch; abuse arms key on paying, not tier

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:1306-1511` (`DispatchAnalysisAsync`)
- Test: `components/bff/tests/Spectr.Bff.Tests/DispatchCreditChargeTests.cs`

**Interfaces:**
- Consumes: `EntitlementService.GetPricesAsync`, `CreditLedgerService.ChargeAsync`, `EntitlementsDto.IsPaying/CreditBalance/ProAnalysesLimit/ProAnalysesUsed`.
- Produces: error envelope `402 insufficient_credits` with details `{ required:int, balance:int }` (frontend Task 12 keys off this code). Charge reference `jobId.ToString()`, key `spend:analysis:{jobId}`.

- [ ] **Step 1: Write the failing tests**

```csharp
// components/bff/tests/Spectr.Bff.Tests/DispatchCreditChargeTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class DispatchCreditChargeTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> Factory(bool creditsOn = true) => baseFactory.WithWebHostBuilder(b =>
        b.UseSetting("Credits:Prices:Analysis", "100")
         .UseSetting("Credits:Enabled", creditsOn ? "true" : "false")
         .UseSetting("RateLimits:Enabled", "false"));

    private static async Task<(HttpClient C, Guid Uid, Guid VersionId)> SeedAsync(
        WebApplicationFactory<Program> f, int grant, bool purchase = false, bool verified = true)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        if (verified)
            await db.Users.Where(u => u.Id == uid).ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow));
        if (grant > 0) await svc.GrantAsync(uid, grant, "signup", $"grant:signup:{uid}", CancellationToken.None);
        if (purchase) await svc.PurchaseAsync(uid, 500, $"pi_{uid:N}", $"credits_purchase:t_{uid:N}", CancellationToken.None);
        scope.ServiceProvider.GetRequiredService<EntitlementService>().InvalidateAsync(uid);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(f, uid);
        return (client, uid, versionId);
    }

    private static async Task<int> BalanceAsync(WebApplicationFactory<Program> f, Guid uid)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);
    }

    [SkippableFact]
    public async Task Analysis_Charges_The_Analysis_Price()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 500);
        var resp = await c.PostAsync($"/api/versions/{vid}/analyze", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.Equal(400, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Balance_Below_Price_Returns_402_Insufficient_Credits()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 40);
        var resp = await c.PostAsync($"/api/versions/{vid}/analyze", null);
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.PaymentRequired, "insufficient_credits");
        Assert.Equal(40, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Grant_Only_Unverified_User_Still_Hits_Verify_Gate_On_Second_Analysis()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, _, vid) = await SeedAsync(f, grant: 500, verified: false);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        var second = await c.PostAsync($"/api/versions/{vid}/analyze", null);
        await TestContract.AssertEnvelopeAsync(second, HttpStatusCode.Forbidden, "email_verification_required");
    }

    [SkippableFact]
    public async Task Purchaser_Skips_Verify_Gate()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, _, vid) = await SeedAsync(f, grant: 0, purchase: true, verified: false);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
    }

    [SkippableFact]
    public async Task Kill_Switch_Off_Charges_Nothing()
    {
        var f = Factory(creditsOn: false);
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 500);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        Assert.Equal(500, await BalanceAsync(f, uid));
    }
}
```

Note: the existing reanalyze route returns `202 Accepted` with the job id — confirm with `grep -n "Accepted\|Results.Ok" components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs | sed -n 1,10p` and adjust the expected status if it returns 200. Add a Pro-overflow test the same way (seed `Subscription` active + 100 credits + 15 `analysis` usage events this period → POST charges 100) using the seeding shown in Task 3.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~DispatchCreditChargeTests"`
Expected: FAIL — balance stays 499 (old 1-credit spend) / 409 instead of 402 / unverified grant user passes the verify gate.

- [ ] **Step 3: Implement in `DispatchAnalysisAsync`**

1. After resolving `ent`, resolve prices (non-fatal):

```csharp
        var prices = await ents.GetPricesAsync(ct);
```

2. Replace the `ent.AnalysesRemaining == 0` gate with a credit-aware one:

```csharp
        if (!freeRetry && ent.AnalysesRemaining == 0)
        {
            // Credit economy: a credits/pro user who can't cover the price gets
            // the buy sheet (402); a free-tier user keeps the legacy 409 grammar.
            return (Guid.Empty, ent.Tier is "credits" or "pro"
                ? ErrorEnvelope.Build(402, "insufficient_credits", "Not enough credits for an analysis.",
                    new { required = prices.Analysis, balance = ent.CreditBalance })
                : ErrorEnvelope.Build(409, "entitlement_exhausted",
                    "You have used all your analyses for this billing period."));
        }
```

3. Abuse arms + verify gate: change both conditions `ent.Tier is not ("pro" or "credits")` (lines ~1313 and ~1397) to `!ent.IsPaying`, and update the adjacent comments ("Paid tiers exempt" → "Paying users (Pro or a purchase) exempt — a signup-grant-only account is not paying (grant farming)").

4. Replace the `else if (ent.Tier == "credits") { … } else { … }` pair with:

```csharp
        else if ((ent.Tier == "pro" && ent.ProAnalysesUsed < (ent.ProAnalysesLimit ?? int.MaxValue))
                 || ent.Tier == "free")
        {
            // Pro within its monthly allowance, or legacy free allotment:
            // job + usage event, no credits.
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId, UserId = userId, VersionId = versionId, ReferenceId = referenceId,
                Tier = ent.Tier, Status = "pending",
            });
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId, EventType = "analysis", BillingPeriod = billingPeriod, Reference = jobId.ToString(),
            });
            await db.SaveChangesAsync(ct);
        }
        else
        {
            // Credits tier, or Pro past its allowance: charge the analysis price.
            var job = new AnalysisJob
            {
                Id = jobId, UserId = userId, VersionId = versionId, ReferenceId = referenceId,
                Tier = ent.Tier, Status = "pending",
            };
            db.AnalysisJobs.Add(job);
            await db.SaveChangesAsync(ct);
            try
            {
                await credits.ChargeAsync(userId, prices.Analysis, jobId.ToString(),
                    $"spend:analysis:{jobId}", "analysis", ct);
            }
            catch (InsufficientCreditsException ex)
            {
                job.Status = "failed";
                job.ErrorCode = "insufficient_credits";
                job.FailedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                return (Guid.Empty, ErrorEnvelope.Build(402, "insufficient_credits",
                    "Not enough credits for an analysis.",
                    new { required = ex.Required, balance = ex.CurrentBalance }));
            }
        }
```

5. After the charge, call `ents.InvalidateAsync(userId);` so the balance chip refreshes on the next entitlements read.

Check `ErrorEnvelope.Build`'s optional `details` parameter name/position with `sed -n 1,40p components/bff/src/Spectr.Bff/Endpoints/ErrorEnvelope.cs` before using it.

- [ ] **Step 4: Run the new tests and the dispatch-related suites**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~Dispatch|FullyQualifiedName~AbuseContainment|FullyQualifiedName~FreeRetry|FullyQualifiedName~JobEndpointsCreditReversal"`
Expected: PASS. Existing tests that bought a 5-pack and expected the abuse arms/verify gate to be skipped still pass (a purchase makes them paying).

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): charge the analysis price at dispatch; Pro allowance then credits; 402 insufficient_credits; abuse arms key on paying"
```

---

### Task 5: Refund failed analyses (any failure, exact amount)

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs:308-340`
- Test: `components/bff/tests/Spectr.Bff.Tests/JobEndpointsCreditReversalTests.cs` (add cases)

**Interfaces:**
- Consumes: `CreditLedgerService.ReverseAsync(userId, jobId, reasonCode)` (Task 2: refunds the job's actual spend).
- Produces: refund on `GET /api/jobs/{id}` for `status == "failed"` with any `ErrorCode` except `insufficient_credits` and `cancelled`.

- [ ] **Step 1: Add failing tests** to `JobEndpointsCreditReversalTests.cs`:

```csharp
    [SkippableFact]
    public async Task GetJob_With_Worker_Failure_Refunds_Full_Spend()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await SeedAuthedAsync(_factory, "jobrev-worker");
        try
        {
            var jobId = Guid.NewGuid();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.AnalysisJobs.Add(new AnalysisJob
                {
                    Id = jobId, UserId = userId, Status = "failed", CurrentPhase = "failed",
                    ErrorCode = "worker_error", ErrorMessage = "boom", FailedAt = DateTimeOffset.UtcNow,
                });
                await db.SaveChangesAsync();
                var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
                await svc.GrantAsync(userId, 500, "seed", $"grant:seed:{userId}", CancellationToken.None);
                await svc.ChargeAsync(userId, 100, jobId.ToString(), $"spend:analysis:{jobId}", "analysis", CancellationToken.None);
            }

            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/jobs/{jobId}")).StatusCode);

            using var check = _factory.Services.CreateScope();
            var balance = await check.ServiceProvider.GetRequiredService<CreditLedgerService>()
                .GetBalanceAsync(userId, CancellationToken.None);
            Assert.Equal(500, balance);
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task GetJob_Failed_Without_Spend_Mints_Nothing()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await SeedAuthedAsync(_factory, "jobrev-nospend");
        try
        {
            var jobId = await SeedFailedInvalidFileJobAsync(userId, withSpend: false);
            await client.GetAsync($"/api/jobs/{jobId}");
            using var scope = _factory.Services.CreateScope();
            Assert.Equal(0, await scope.ServiceProvider.GetRequiredService<CreditLedgerService>()
                .GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }
```

- [ ] **Step 2: Run to verify the first fails**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~JobEndpointsCreditReversalTests"`
Expected: `GetJob_With_Worker_Failure_Refunds_Full_Spend` FAILS (balance 400; only `invalid_file` refunds today).

- [ ] **Step 3: Implement** — replace the `invalid_file`-only condition:

```csharp
        // Credit economy — a failed analysis is refunded whatever the cause
        // (worker crash, dispatch_failed, invalid_file…), for exactly what it
        // cost. Excluded: insufficient_credits (never charged) and a user
        // cancel. ReverseAsync sums the job's spend rows, so Pro-allowance and
        // free-retry jobs (no spend) refund nothing. Idempotent per job.
        if (row.Status == "failed"
            && row.ErrorCode is not ("insufficient_credits" or "cancelled"))
        {
            var entry = await credits.ReverseAsync(userId, jobId, row.ErrorCode ?? "failed", ct);
            if (entry is not null)
                logger.LogInformation("Refunded {Amount} credits for failed job: user={UserId}, jobId={JobId}, code={Code}",
                    entry.Amount, userId, jobId, row.ErrorCode);
        }
```

(The `hasSpend` pre-check is no longer needed — `ReverseAsync` returns null when nothing was spent.)

- [ ] **Step 4: Run tests** — same filter. Expected: PASS (all, including the original invalid-file cases).

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): refund any failed analysis for exactly what it cost"
```

---

### Task 6: Charge extra specialists; routed specialists included; refund failed runs

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs` (`RunSpecialist` ~L174-226; list endpoint ~L55-135)
- Test: `components/bff/tests/Spectr.Bff.Tests/SpecialistChargeTests.cs`

**Interfaces:**
- Consumes: `EntitlementService.ForAsync/GetPricesAsync/CreditsEnabled`, `CreditLedgerService.ChargeAsync/RefundChargeAsync`.
- Produces: charge reference `specialist:{analysisId}:{slug}`, key `spend:specialist:{analysisId}:{slug}`, refund key `reversal:specialist:{analysisId}:{slug}`; `402 insufficient_credits` `{required, balance}`.
- Rule: free when credits off, guest, Pro, or `slug` ∈ `routing_plan.specialists_to_run[].name`; else charge `prices.Specialist`.

- [ ] **Step 1: Write the failing tests**

```csharp
// components/bff/tests/Spectr.Bff.Tests/SpecialistChargeTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SpecialistChargeTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> f = baseFactory.WithWebHostBuilder(b =>
        b.UseSetting("Credits:Prices:Specialist", "15"));

    private async Task<(HttpClient C, Guid Uid, Guid JobId, Guid AnalysisId)> SeedAsync(int grant)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        var analysisId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = uid, Status = "complete", Tier = "credits" });
        db.Analyses.Add(new Analysis
        {
            Id = analysisId, JobId = jobId, UserId = uid, FinalJson = "{}",
            RoutingPlan = "{\"specialists_to_run\":[{\"name\":\"low_end\",\"priority\":1,\"focus\":\"x\"}],\"skip\":[],\"rationale\":\"r\",\"estimated_total_tokens\":1}",
        });
        await db.SaveChangesAsync();
        await scope.ServiceProvider.GetRequiredService<CreditLedgerService>()
            .GrantAsync(uid, grant, "signup", $"grant:signup:{uid}", CancellationToken.None);
        return (client, uid, jobId, analysisId);
    }

    private async Task<int> BalanceAsync(Guid uid)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);
    }

    [SkippableFact]
    public async Task Routed_Specialist_Is_Free()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, _) = await SeedAsync(100);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/reports/{jobId}/verdicts/run/low_end", null)).StatusCode);
        Assert.Equal(100, await BalanceAsync(uid));
    }

    [SkippableFact]
    public async Task Extra_Specialist_Costs_15_Once_Even_When_Posted_Twice()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, _) = await SeedAsync(100);
        await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
        await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
        Assert.Equal(85, await BalanceAsync(uid));
    }

    [SkippableFact]
    public async Task Extra_Specialist_Without_Credits_Returns_402()
    {
        await TestDb.RequireAsync(f);
        var (c, _, jobId, _) = await SeedAsync(10);
        var resp = await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.PaymentRequired, "insufficient_credits");
    }

    [SkippableFact]
    public async Task Failed_Specialist_Is_Refunded_When_Verdicts_Are_Listed()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, analysisId) = await SeedAsync(100);
        await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Verdicts.Add(TestVerdicts.FailMarker(analysisId, "dynamics"));
            await db.SaveChangesAsync();
        }
        await c.GetAsync($"/api/reports/{jobId}/verdicts");
        Assert.Equal(100, await BalanceAsync(uid));
    }
}
```

`TestVerdicts.FailMarker` doesn't exist yet: add it to `TestSupport.cs` as a static helper building a `Verdict` row with `Headline = "Specialist failed"`, `Specialist = slug`, `AnalysisId = analysisId` and every other `required` member filled with harmless values — read `components/bff/src/Spectr.Data/Entities/Verdict.cs` for the required set. Check the `Analysis` entity's required members the same way (`Analysis.cs`). Add per-test cleanup (ledger, verdicts, analyses, jobs, user) in a `finally`, following `CleanupAsync` in `JobEndpointsCreditReversalTests`.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~SpecialistChargeTests"`
Expected: FAIL — balances unchanged (nothing charged), 202 instead of 402.

- [ ] **Step 3: Implement**

Add `EntitlementService ents, CreditLedgerService credits` parameters to `RunSpecialist`. Load `a.RoutingPlan` in the analysis projection (`new { a.Id, a.RoutingPlan }`). After the `exists` check and BEFORE `ClaimSpecialistRunAsync`, insert:

```csharp
        // Credit economy — the analysis price already covers the specialists
        // triage routed; any other specialist costs credits (Pro: included).
        if (!user.IsGuest())
        {
            var flags = await ents.GetFlagsAsync(ct);
            if (ents.CreditsEnabled(flags))
            {
                var ent = await ents.ForAsync(userId, ct);
                var routed = ParseRoutingPlan(analysis.RoutingPlan)?.SpecialistsToRun
                    .Any(e => string.Equals(e.Name, specialist, StringComparison.Ordinal)) ?? false;
                if (ent.Tier != "pro" && !routed)
                {
                    var price = (await ents.GetPricesAsync(ct)).Specialist;
                    try
                    {
                        await credits.ChargeAsync(userId, price,
                            $"specialist:{analysis.Id}:{specialist}",
                            $"spend:specialist:{analysis.Id}:{specialist}", null, ct);
                        ents.InvalidateAsync(userId);
                    }
                    catch (InsufficientCreditsException ex)
                    {
                        return ErrorEnvelope.Build(402, "insufficient_credits",
                            "Not enough credits to run this specialist.",
                            new { required = ex.Required, balance = ex.CurrentBalance });
                    }
                }
            }
        }
```

In the verdicts LIST handler (the one that reads `analysisRow` with `RoutingPlan`), after the verdict rows are loaded and before returning, refund failed specialist runs:

```csharp
        // Credit economy — a specialist that ended as a fail-marker gets its
        // credits back (no-op when it was never charged; idempotent per slug).
        foreach (var failedSlug in verdictRows
                     .Where(v => v.Headline == "Specialist failed")
                     .Select(v => v.Specialist).Distinct())
        {
            await credits.RefundChargeAsync(userId,
                $"specialist:{analysisRow.Id}:{failedSlug}",
                $"reversal:specialist:{analysisRow.Id}:{failedSlug}", ct);
        }
```

Use the handler's real variable names (read L55-135 first); add `CreditLedgerService credits` to its parameters. The `"Specialist failed"` literal mirrors the worker's fail-marker (`components/worker/app/verdict_actor.py::_persist_fail_marker`) — grep to confirm the exact headline string before relying on it.

- [ ] **Step 4: Run tests**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~SpecialistChargeTests|FullyQualifiedName~GuestSpecialistRunCap|FullyQualifiedName~Verdict"`
Expected: PASS (guests still uncharged and capped).

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): extra specialists cost credits (routed ones included); refund failed runs"
```

---

### Task 7: Charge coach messages; Pro overflow draws credits

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs` (`PostMessage`)
- Test: `components/bff/tests/Spectr.Bff.Tests/CoachMessageChargeTests.cs`

**Interfaces:**
- Consumes: `CoachCapService.ResolveAsync`, `EntitlementService`, `CreditLedgerService.ChargeAsync/RefundChargeAsync`.
- Produces: charge reference = user message id, key `spend:coach:{userRowId}`, refund key `reversal:coach:{userRowId}`; `402 insufficient_credits`.
- Rule (credits on, non-guest): `credits` tier → charge `prices.CoachMessage` per message; `pro` within `coach_pro_monthly` → free; `pro` cap reached → charge instead of 403; `free` tier → unchanged (free follow-ups cap, no charge). Brief (`CoachBrief.Mode`) never charged — it uses a different endpoint; confirm `PostMessage` never receives brief mode (`grep -n "CoachBrief.Mode" Endpoints/*.cs`).

- [ ] **Step 1: Write the failing tests** (pattern as Task 6: seed user + job + analysis owned by the user; `UseSetting("Credits:Prices:CoachMessage","5")`):

```csharp
    [SkippableFact]
    public async Task Credits_User_Pays_5_Per_Message()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(grant: 100);
        var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "Why is my kick weak?" });
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
        Assert.Equal(95, await BalanceAsync(uid));
    }

    [SkippableFact]
    public async Task Credits_User_With_Too_Few_Credits_Gets_402_And_No_Message_Row()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(grant: 3);
        var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "hi" });
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.PaymentRequired, "insufficient_credits");
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Conversations.AnyAsync(cv => cv.AnalysisId == analysisId));
    }

    [SkippableFact]
    public async Task Pro_Over_Monthly_Cap_Is_Charged_Instead_Of_Refused()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(grant: 50, pro: true, coachUsedThisMonth: 300);
        var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "one more" });
        Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
        Assert.Equal(45, await BalanceAsync(uid));
    }
```

`SeedAsync` here: register via `TestAuth.RegisterAsync`, insert `AnalysisJob` + `Analysis` (as Task 6, `RoutingPlan` non-null and `DegradationNotice` null so the coach isn't offline), grant credits, optionally an active `Subscription` and `coachUsedThisMonth` rows of `UsageEvent { EventType = "coach_message", BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"), Reference = Guid.NewGuid().ToString() }`. The enqueue goes to the real Redis (127.0.0.1) — that's what the existing `CoachConversationEndpointsTests` do; copy their setup if they stub `IJobQueue`.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~CoachMessageChargeTests"`
Expected: FAIL — balance unchanged; Pro-over-cap returns 403.

- [ ] **Step 3: Implement in `PostMessage`**

Add `CreditLedgerService credits` to the parameters. Replace the `if (capBefore.CapReached) { return … 403 … }` block with:

```csharp
        var capBefore = await capService.ResolveAsync(userId, analysisId, ct);
        var flags = await ents.GetFlagsAsync(ct);
        var creditsOn = ents.CreditsEnabled(flags);
        var ent = creditsOn && !currentUser.IsGuest() ? await ents.ForAsync(userId, ct) : null;
        // Credit economy: credits tier always pays; Pro pays only past its pool.
        var mustPay = ent is not null
            && (ent.Tier == "credits" || (ent.Tier == "pro" && capBefore.CapReached));
        var coachPrice = mustPay ? (await ents.GetPricesAsync(ct)).CoachMessage : 0;

        if (capBefore.CapReached && !mustPay)
        {
            return ErrorEnvelope.Build(
                StatusCodes.Status403Forbidden,
                "coach_cap_reached",
                capBefore.Scope == CoachCapService.ScopeMonth
                    ? "Monthly coach allowance reached."
                    : "Per-analysis follow-up limit reached.",
                new { used = capBefore.Used, limit = capBefore.Limit, scope = capBefore.Scope });
        }
        if (mustPay && ent!.CreditBalance < coachPrice)
        {
            return ErrorEnvelope.Build(402, "insufficient_credits",
                "Not enough credits to message the coach.",
                new { required = coachPrice, balance = ent.CreditBalance });
        }
```

Then, after `userRow` is constructed and BEFORE `db.CoachMessages.Add(userRow)`, charge (id is known; nothing written yet):

```csharp
        if (mustPay)
        {
            try
            {
                await credits.ChargeAsync(userId, coachPrice, userRow.Id.ToString(),
                    $"spend:coach:{userRow.Id}", null, ct);
            }
            catch (InsufficientCreditsException ex)
            {
                return ErrorEnvelope.Build(402, "insufficient_credits",
                    "Not enough credits to message the coach.",
                    new { required = ex.Required, balance = ex.CurrentBalance });
            }
        }
```

In the existing enqueue-failure catch (where the assistant row is marked error), add the refund:

```csharp
            if (mustPay)
                await credits.RefundChargeAsync(userId, userRow.Id.ToString(), $"reversal:coach:{userRow.Id}", ct);
```

`ChargeAsync` clears no tracked entities on the happy path, so the conversation row created earlier (`GetOrCreateConversationAsync`) stays tracked; but because the charge commits its own transaction, keep the charge AFTER `GetOrCreateConversationAsync` and BEFORE adding the message rows exactly as described.

- [ ] **Step 4: Run tests**

Run: `dotnet test tests/Spectr.Bff.Tests --filter "FullyQualifiedName~Coach"`
Expected: PASS (new + existing coach cap / Pro pool / guest cap tests).

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): coach messages cost credits; Pro overflow charges instead of refusing"
```

---

### Task 8: Charge Coach Mix

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/FixRackEndpoints.cs` (`Generate`)
- Test: `components/bff/tests/Spectr.Bff.Tests/CoachMixChargeTests.cs`

**Interfaces:**
- Consumes: `EntitlementsDto` already resolved in `Generate`; `CreditLedgerService.ChargeAsync`.
- Produces: per-POST charge, reference `coachmix:{analysisId}:{requestId}`, key `spend:coachmix:{requestId}` (`requestId = Guid.NewGuid()`); refund key `reversal:coachmix:{requestId}` on enqueue failure; `402 insufficient_credits`.
- Rule: credits on, non-guest, tier ≠ pro → charge `prices.CoachMix`. Degraded racks are not refunded (spec 3.4).

- [ ] **Step 1: Write the failing tests** — seed as Task 6 (user, job, analysis with a non-null `VersionId` — use `TestSeed.SongWithVersionAsync` for the version):

```csharp
    [SkippableFact]
    public async Task Coach_Mix_Costs_5_For_Credits_User()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId) = await SeedAsync(grant: 20);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/reports/{jobId}/fix-rack", null)).StatusCode);
        Assert.Equal(15, await BalanceAsync(uid));
    }

    [SkippableFact]
    public async Task Coach_Mix_Without_Credits_Returns_402()
    {
        await TestDb.RequireAsync(f);
        var (c, _, jobId) = await SeedAsync(grant: 2);
        await TestContract.AssertEnvelopeAsync(
            await c.PostAsync($"/api/reports/{jobId}/fix-rack", null),
            HttpStatusCode.PaymentRequired, "insufficient_credits");
    }

    [SkippableFact]
    public async Task Coach_Mix_Free_For_Pro()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId) = await SeedAsync(grant: 20, pro: true);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/reports/{jobId}/fix-rack", null)).StatusCode);
        Assert.Equal(20, await BalanceAsync(uid));
    }
```

Factory: `UseSetting("Credits:Prices:CoachMix","5")`. Check how `RackPresetEndpointsTests` posts to fix-rack for any queue stubbing to copy.

- [ ] **Step 2: Run to verify failure** — `--filter "FullyQualifiedName~CoachMixChargeTests"`. Expected: FAIL (no charge).

- [ ] **Step 3: Implement** — add `CreditLedgerService credits` param; after `var tier = entitlements.Tier;` insert:

```csharp
        // Credit economy — each Coach Mix generation costs credits (Pro: included).
        var flags = await ents.GetFlagsAsync(ct);
        var requestId = Guid.NewGuid();
        var charged = false;
        if (!user.IsGuest() && ents.CreditsEnabled(flags) && tier != "pro")
        {
            var price = (await ents.GetPricesAsync(ct)).CoachMix;
            try
            {
                charged = await credits.ChargeAsync(userId, price,
                    $"coachmix:{analysis.Id}:{requestId}", $"spend:coachmix:{requestId}", null, ct) is not null;
                ents.InvalidateAsync(userId);
            }
            catch (InsufficientCreditsException ex)
            {
                return ErrorEnvelope.Build(402, "insufficient_credits",
                    "Not enough credits for a Coach Mix.",
                    new { required = ex.Required, balance = ex.CurrentBalance });
            }
        }
```

Wrap the existing `queue.EnqueueAsync(...)` in `try { … } catch { if (charged) await credits.RefundChargeAsync(userId, $"coachmix:{analysis.Id}:{requestId}", $"reversal:coachmix:{requestId}", ct); throw; }`.

- [ ] **Step 4: Run tests** — `--filter "FullyQualifiedName~CoachMixChargeTests|FullyQualifiedName~RackPreset|FullyQualifiedName~Guest"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): Coach Mix costs credits (Pro included), refunded if never queued"
```

---

### Task 9: Signup grant (register + guest conversion) and the one-time backfill

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs` (`Register`, right after the user `SaveChangesAsync` ~L221)
- Modify: `components/bff/src/Spectr.Bff/Endpoints/GuestConvertEndpoints.cs` (before the final `return Results.Ok(new AuthResponse(` ~L196)
- Create: `components/bff/src/Spectr.Bff/Services/SignupGrantService.cs`
- Modify: `components/bff/src/Spectr.Bff/Endpoints/AdminEndpoints.cs` (map `POST /credits/backfill-signup-grant`)
- Modify: DI registration file (find with `grep -rn "AddScoped<CreditLedgerService>" components/bff/src`)
- Test: `components/bff/tests/Spectr.Bff.Tests/SignupGrantTests.cs`

**Interfaces:**
- Produces: `SignupGrantService.GrantAsync(Guid userId, CancellationToken)` → `Task<bool>` (true when credits were added); `SignupGrantService.BackfillAsync(CancellationToken)` → `Task<int>` (users granted). Key `grant:signup:{userId}`. No-op when credits off, user is a guest, or grant = 0.

- [ ] **Step 1: Write the failing tests**

```csharp
// components/bff/tests/Spectr.Bff.Tests/SignupGrantTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SignupGrantTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> F(string grant = "500", string enabled = "true") =>
        baseFactory.WithWebHostBuilder(b => b
            .UseSetting("Credits:SignupGrant", grant)
            .UseSetting("Credits:Enabled", enabled));

    private static async Task<int> BalanceAsync(WebApplicationFactory<Program> f, Guid uid)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);
    }

    [SkippableFact]
    public async Task Register_Grants_500_Once()
    {
        var f = F();
        await TestDb.RequireAsync(f);
        var (uid, _) = await TestAuth.RegisterAsync(f.CreateClient());
        Assert.Equal(500, await BalanceAsync(f, uid));
        using var scope = f.Services.CreateScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<SignupGrantService>().GrantAsync(uid, CancellationToken.None));
        Assert.Equal(500, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Register_With_Credits_Off_Grants_Nothing()
    {
        var f = F(enabled: "false");
        await TestDb.RequireAsync(f);
        var (uid, _) = await TestAuth.RegisterAsync(f.CreateClient());
        Assert.Equal(0, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Backfill_Grants_Existing_Users_Once_And_Skips_Guests()
    {
        var f = F();
        await TestDb.RequireAsync(f);
        Guid oldUser, guest;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            oldUser = Guid.NewGuid();
            guest = Guid.NewGuid();
            db.Users.Add(new User { Id = oldUser, Email = $"old+{oldUser:N}@spectr.test", HashedPassword = "x" });
            db.Users.Add(new User { Id = guest, Email = $"guest+{guest:N}@spectr.test", HashedPassword = "x", IsGuest = true });
            await db.SaveChangesAsync();
            var svc = scope.ServiceProvider.GetRequiredService<SignupGrantService>();
            Assert.True(await svc.BackfillAsync(CancellationToken.None) >= 1);
            await svc.BackfillAsync(CancellationToken.None); // second run: no double grant
        }
        Assert.Equal(500, await BalanceAsync(f, oldUser));
        Assert.Equal(0, await BalanceAsync(f, guest));
    }
}
```

Guest emails must pass `GuestIdentity.IsGuestEmail` rules if the entity validates them — check `GuestIdentity` before seeding; if it requires a pattern, use it. Add cleanup for created users/ledger rows (pattern from Task 2).

- [ ] **Step 2: Run to verify failure** — `--filter "FullyQualifiedName~SignupGrantTests"`. Expected: build FAIL (`SignupGrantService` missing).

- [ ] **Step 3: Implement**

```csharp
// components/bff/src/Spectr.Bff/Services/SignupGrantService.cs
using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Credit economy — the free trial is a one-time credit grant (default 500),
// written when an account is created and back-filled once for accounts that
// predate the credit switch-on. Idempotent per user via "grant:signup:{id}".
public sealed class SignupGrantService(
    AppDbContext db, EntitlementService ents, CreditLedgerService credits, ILogger<SignupGrantService> logger)
{
    public async Task<bool> GrantAsync(Guid userId, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        if (!ents.CreditsEnabled(flags)) return false;
        var amount = (await ents.GetPricesAsync(ct)).SignupGrant;
        if (amount <= 0) return false;
        var isGuest = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.IsGuest).FirstOrDefaultAsync(ct);
        if (isGuest) return false;
        var entry = await credits.GrantAsync(userId, amount, "signup", $"grant:signup:{userId}", ct);
        if (entry is not null) ents.InvalidateAsync(userId);
        return entry is not null;
    }

    public async Task<int> BackfillAsync(CancellationToken ct)
    {
        var ids = await db.Users.AsNoTracking()
            .Where(u => !u.IsGuest
                && !db.CreditLedger.Any(e => e.UserId == u.Id && e.IdempotencyKey == "grant:signup:" + u.Id.ToString()))
            .Select(u => u.Id)
            .ToListAsync(ct);
        var granted = 0;
        foreach (var id in ids)
            if (await GrantAsync(id, ct)) granted++;
        logger.LogInformation("Signup-grant backfill: {Granted} of {Candidates} users granted", granted, ids.Count);
        return granted;
    }
}
```

Register `builder.Services.AddScoped<SignupGrantService>();` next to `CreditLedgerService`. In `Register`, after `await db.SaveChangesAsync(ct);` (user insert) add a `SignupGrantService signupGrant` parameter and:

```csharp
        // Credit economy — the free trial: a one-time credit grant (no-op when
        // credits are off). Best-effort: a ledger hiccup must not fail signup;
        // the admin backfill catches anyone missed.
        try { await signupGrant.GrantAsync(user.Id, ct); }
        catch (Exception ex) { loggerFactory.CreateLogger("Auth").LogError(ex, "Signup grant failed for {UserId}", user.Id); }
```

Same call (same try/catch) in `GuestConvertEndpoints` just before the final `return Results.Ok(new AuthResponse(`, using the converted user's id (after the conversion has cleared `IsGuest`, so `GrantAsync` sees a real user — verify by reading the lines above that return).

Admin: in `MapAdminEndpoints` add `admin.MapPost("/credits/backfill-signup-grant", PostBackfillSignupGrant);` and:

```csharp
    private static async Task<IResult> PostBackfillSignupGrant(SignupGrantService grants, CancellationToken ct)
        => Results.Ok(new { granted = await grants.BackfillAsync(ct) });
```

- [ ] **Step 4: Run tests** — `--filter "FullyQualifiedName~SignupGrantTests|FullyQualifiedName~Auth|FullyQualifiedName~GuestConvert|FullyQualifiedName~Admin"`. Expected: PASS (the baseline pins grant 0, so other register-based tests are unaffected).

- [ ] **Step 5: Commit**

```bash
git add components/bff
git commit -m "feat(credits): 500-credit signup grant (register + guest convert) and admin backfill"
```

---

### Task 10: Three credit packs, prices on /billing/plans, reconciliation + honest math

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Options/PricingDisplayOptions.cs`, `components/bff/src/Spectr.Bff/Options/StripeOptions.cs`
- Modify: `components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs` (`PlansResponse`, new `CreditPackDto`, `CreditCostsDto`)
- Modify: `components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs` (`/plans` ~L80-90, `PostCheckoutCredits` ~L648-680)
- Modify: `components/bff/src/Spectr.Bff/Services/BillingReconciliationService.cs:170-176`, `components/bff/src/Spectr.Bff/Services/HonestMathService.cs:36-46`
- Modify: `.env.example`, `infra/compose.prod.yml` (BFF env)
- Modify tests: `BillingCreditsEndpointsTests.cs`, `BillingReconciliationServiceTests.cs`, `HonestMathServiceTests.cs`
- Test: `components/bff/tests/Spectr.Bff.Tests/CreditPacksTests.cs`

**Interfaces:**
- Produces:
  - `PricingDisplayOptions.CreditPacks : List<CreditPackOption>`; `CreditPackOption { int Credits; int Cents }`; defaults `[500/700, 1500/1800, 5000/5500]`.
  - `StripeOptions.CreditPackPrices : Dictionary<string,string>` keyed by credits (`"500"`) → Stripe price id (env `Stripe__CreditPackPrices__500`); `CreditPacksConfigured` = `IsConfigured` and every display pack has a price id.
  - `record CreditPackDto(int Credits, int Cents)`; `record CreditCostsDto(int Analysis, int Specialist, int CoachMessage, int CoachMix, int SignupGrant, int ProAnalysesMonthly, int ProCoachMonthly)`.
  - `PlansResponse(int ProMonthlyCents, int ProAnnualCents, IReadOnlyList<CreditPackDto> CreditPacks, string Currency, bool? CreditsEnabled = null, CreditCostsDto? Costs = null)` — **replaces** `CreditPack5Cents/CreditPack10Cents`.
  - `BuyCreditsRequest(int PackSize)` unchanged; `PackSize` must equal a configured pack's `Credits`.

- [ ] **Step 1: Write the failing tests**

```csharp
// components/bff/tests/Spectr.Bff.Tests/CreditPacksTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Net.Http.Json;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CreditPacksTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [SkippableFact]
    public async Task Plans_Lists_Three_Packs_And_Costs()
    {
        await TestDb.RequireAsync(f);
        var plans = await f.CreateClient().GetFromJsonAsync<PlansResponse>("/api/billing/plans");
        Assert.NotNull(plans);
        Assert.Equal(new[] { 500, 1500, 5000 }, plans!.CreditPacks.Select(p => p.Credits));
        Assert.Equal(new[] { 700, 1800, 5500 }, plans.CreditPacks.Select(p => p.Cents));
        Assert.NotNull(plans.Costs);
        Assert.Equal(15, plans.Costs!.Specialist);
    }

    [SkippableFact]
    public async Task Checkout_Rejects_Unknown_Pack_Size()
    {
        await TestDb.RequireAsync(f);
        var c = f.CreateClient();
        var (_, token) = await TestAuth.RegisterAsync(c);
        c.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var resp = await c.PostAsJsonAsync("/api/billing/checkout/credits", new { packSize = 5 });
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.BadRequest, "invalid_pack_size");
    }
}
```

(`Costs.Analysis` is pinned to 1 by the test baseline — assert on `Specialist` instead.)

- [ ] **Step 2: Run to verify failure** — `--filter "FullyQualifiedName~CreditPacksTests"`. Expected: build FAIL (`CreditPacks`/`Costs` missing).

- [ ] **Step 3: Implement**

`PricingDisplayOptions` — replace `CreditPack5Cents`/`CreditPack10Cents`:

```csharp
    // Credit economy (2026-10-01) — one-time credit packs (display cents). The
    // BILLED amount is the Stripe Price in StripeOptions.CreditPackPrices[credits];
    // BillingReconciliationService alerts on drift.
    public List<CreditPackOption> CreditPacks { get; init; } =
    [
        new() { Credits = 500, Cents = 700 },
        new() { Credits = 1500, Cents = 1800 },
        new() { Credits = 5000, Cents = 5500 },
    ];
```

```csharp
public sealed class CreditPackOption
{
    public int Credits { get; init; }
    public int Cents { get; init; }
}
```

`StripeOptions` — replace `PriceCreditPack5/10` and `CreditPacksConfigured`:

```csharp
    // Credit economy — Stripe Price id per pack, keyed by credit count
    // (env: Stripe__CreditPackPrices__500=price_…). Not secrets.
    public Dictionary<string, string> CreditPackPrices { get; init; } = new();

    public string? PriceForPack(int credits)
        => CreditPackPrices.TryGetValue(credits.ToString(), out var id) && !string.IsNullOrWhiteSpace(id) ? id : null;

    public bool CreditPacksConfigured(IEnumerable<int> packCredits)
        => IsConfigured && packCredits.All(c => PriceForPack(c) is not null);
```

`BillingDtos.cs` — replace `PlansResponse` and add the two records listed under Interfaces.

`BillingEndpoints` `/plans`: build `CreditPacks: o.CreditPacks.Select(p => new CreditPackDto(p.Credits, p.Cents)).ToList()` and, using the endpoint's flag read, `Costs: new CreditCostsDto(prices.Analysis, prices.Specialist, prices.CoachMessage, prices.CoachMix, prices.SignupGrant, prices.ProAnalysesMonthly, flags.TryGetValue("coach_pro_monthly", out var cp) && int.TryParse(cp, out var cpv) ? cpv : CoachCapService.CoachProMonthlyDefault)` where `prices = CreditPricing.Resolve(config, flags)` (inject `IConfiguration`/`EntitlementService` the way the handler already reads `CreditsEnabled`; read the handler first).

`PostCheckoutCredits`: inject `IOptions<PricingDisplayOptions> display`; replace the 5/10 validation and price lookup:

```csharp
        var packs = display.Value.CreditPacks.Select(p => p.Credits).ToList();
        if (body is null || !packs.Contains(body.PackSize))
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest, "invalid_pack_size",
                $"Pack size must be one of: {string.Join(", ", packs)}.");
        if (!opts.CreditPacksConfigured(packs))
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable, "stripe_not_configured",
                "Stripe is not configured in this environment.");
        var priceId = opts.PriceForPack(body.PackSize)!;
```

The webhook already credits `pack_size` from session metadata — no change.

`BillingReconciliationService` L170-176: replace the two pack tuples with `display.CreditPacks.Select(p => (PriceId: opts.PriceForPack(p.Credits), DisplayCents: p.Cents))` concatenated to the Pro tuples (keep its existing null-PriceId skip).

`HonestMathService`: replace the `5 => …, 10 => …` switch with a lookup:

```csharp
        var centsByCredits = p.CreditPacks.ToDictionary(x => x.Credits, x => x.Cents);
        foreach (var amount in purchaseAmounts)
            spentCents += centsByCredits.TryGetValue(amount, out var c) ? c : 0; // unknown shape — don't guess
```

Update the three existing test files: replace `CreditPack5Cents = 1900, CreditPack10Cents = 3500` with `CreditPacks = [new() { Credits = 5, Cents = 1900 }, new() { Credits = 10, Cents = 3500 }]`, and `["Stripe:PriceCreditPack5"]/["Stripe:PriceCreditPack10"]` with `["Stripe:CreditPackPrices:5"]/["Stripe:CreditPackPrices:10"]` plus `["PricingDisplay:CreditPacks:0:Credits"]="5"`, `[...:0:Cents]="1900"`, `[...:1:Credits]="10"`, `[...:1:Cents]="3500"` so their 5/10 scenarios keep working. (`PricingDisplay` is `PricingDisplayOptions.SectionName`.)

Env wiring: in `.env.example` replace `STRIPE_PRICE_CREDIT_PACK_5/10` lines (whatever names exist — grep `CreditPack` / `CREDIT_PACK`) with:

```
# Credit packs — one-time Stripe Prices (Dashboard → Products). Keyed by credits.
Stripe__CreditPackPrices__500=
Stripe__CreditPackPrices__1500=
Stripe__CreditPackPrices__5000=
```

and in `infra/compose.prod.yml` BFF `environment:` add `Stripe__CreditPackPrices__500: "${STRIPE_PRICE_CREDITS_500:-}"` (and 1500/5000) next to `STRIPE_PRICE_PRO_MONTHLY`.

- [ ] **Step 4: Run tests** — `--filter "FullyQualifiedName~Billing|FullyQualifiedName~HonestMath|FullyQualifiedName~CreditPacks|FullyQualifiedName~PublicCredits"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/bff .env.example infra/compose.prod.yml
git commit -m "feat(credits): 500/1500/5000 packs, prices + costs on /billing/plans, per-pack Stripe ids"
```

---

### Task 11: Worker — real tier on LLM calls + a `credits` budget lane

**Files:**
- Modify: `components/worker/app/llm/settings.py` (`llm_budget_credits_usd`, `tier_ceiling`)
- Create: `components/worker/app/llm/job_tier.py`
- Modify: `components/worker/app/triage_actor.py`, `components/worker/app/verdict_actor.py`, `components/worker/app/coach_actor.py` (pass `tier=`)
- Test: `components/worker/tests/llm/test_job_tier.py`, extend `components/worker/tests/llm/test_budget.py`

**Interfaces:**
- Produces: `tier_for_analysis(session, analysis) -> str | None` — the `analysis_jobs.tier` of `analysis.job_id` (`"pro" | "credits" | "free"`), `None` when unknown. `LlmSettings.tier_ceiling("credits") == llm_budget_credits_usd` (default `Decimal("100.00")`; flag `llm_budget_credits_usd` overrides via the existing `budget._ceiling_override` naming — confirm the flag name pattern in `budget.py`).

- [ ] **Step 1: Write the failing tests**

```python
# components/worker/tests/llm/test_job_tier.py
from types import SimpleNamespace

from app.llm.job_tier import tier_for_analysis


class _Session:
    def __init__(self, job):
        self._job = job

    def get(self, _model, _id):
        return self._job


def test_tier_comes_from_the_analysis_job():
    analysis = SimpleNamespace(job_id="j1")
    assert tier_for_analysis(_Session(SimpleNamespace(tier="credits")), analysis) == "credits"


def test_missing_job_or_tier_is_none():
    assert tier_for_analysis(_Session(None), SimpleNamespace(job_id="j1")) is None
    assert tier_for_analysis(_Session(SimpleNamespace(tier=None)), SimpleNamespace(job_id="j1")) is None
    assert tier_for_analysis(_Session(None), SimpleNamespace(job_id=None)) is None
```

Append to `tests/llm/test_budget.py`:

```python
def test_credits_tier_has_its_own_ceiling():
    from decimal import Decimal

    from app.llm.settings import LlmSettings

    s = LlmSettings(llm_budget_credits_usd=Decimal("42"), llm_budget_global_usd=Decimal("1000"))
    assert s.tier_ceiling("credits") == Decimal("42")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd components/worker && PYTHONPATH="../shared;." python -m pytest -q -p no:cacheprovider tests/llm/test_job_tier.py tests/llm/test_budget.py`
Expected: FAIL — module `app.llm.job_tier` missing; `credits` falls through to the global ceiling.

- [ ] **Step 3: Implement**

```python
# components/worker/app/llm/job_tier.py
"""Resolve the billing tier an LLM call should be metered under.

Credit economy (PRPs/credit-economy.md 3.8): triage/specialist/coach calls
used to pass no tier, so all spend landed in the FREE lane's ceiling — a few
paying users would trip it and take the coach offline for everyone. The tier
the BFF stamped on the analysis job is the authoritative answer.
"""
from __future__ import annotations

from typing import Any

from aimusic_shared.models import AnalysisJob


def tier_for_analysis(session: Any, analysis: Any) -> str | None:
    job_id = getattr(analysis, "job_id", None)
    if job_id is None:
        return None
    job = session.get(AnalysisJob, job_id)
    tier = getattr(job, "tier", None) if job is not None else None
    return tier or None
```

`settings.py`: add `llm_budget_credits_usd: Decimal = Decimal("100.00")` beside the other ceilings, and in `tier_ceiling` add `if tier == "credits": return self.llm_budget_credits_usd`.

Actors — inside each actor's existing Phase-A session block (where the `Analysis` row is loaded), capture `tier = tier_for_analysis(s, analysis)` and pass `tier=tier` to the `gateway.complete_sync(...)` / `gateway.stream_complete_sync(...)` call:
- `triage_actor.py`: next to `caller_id = analysis.user_id`.
- `verdict_actor.py`: next to `track_id = str(analysis.id)`.
- `coach_actor.py`: where it loads the analysis for the context bundle (grep `s.get(Analysis` in `coach_actor.py`); thread `tier` into the `stream_complete_sync` call.
Verify `AnalysisJob` is exported by `aimusic_shared.models` and has `tier` (`grep -n "class AnalysisJob" -A30 components/shared/aimusic_shared/models.py`).

- [ ] **Step 4: Run the whole worker suite**

Run: `cd components/worker && PYTHONPATH="../shared;." python -m pytest -q -p no:cacheprovider tests`
Expected: PASS. Actor tests whose stub `_Session.get` returns the analysis for any model now also get it for `AnalysisJob`; `getattr(..., "tier", None)` makes that harmless (tier `None` → gateway default lane, as before).

- [ ] **Step 5: Commit**

```bash
git add components/worker
git commit -m "fix(worker): meter triage/specialist/coach LLM spend under the job's real tier; credits budget lane"
```

---

### Task 12: Frontend data layer — types, prices, out-of-credits detection, pack checkout

**Files:**
- Modify: `components/frontend-spectr-v2/src/api/types.ts` (`EntitlementsDto`, `PlansResponse`)
- Create: `components/frontend-spectr-v2/src/features/billing/credits.ts`
- Modify: `components/frontend-spectr-v2/src/features/billing/useUpgradeCheckout.ts` (`CheckoutKind` credits)
- Test: `components/frontend-spectr-v2/src/features/billing/__tests__/credits.test.ts`

**Interfaces:**
- Produces (in `credits.ts`):
  - `type PaidAction = 'analysis' | 'specialist' | 'coachMessage' | 'coachMix'`
  - `interface ActionCost { credits: number; included: boolean; affordable: boolean; label: string }`
  - `costOf(action: PaidAction, plans: PlansResponse | undefined, ent: EntitlementsDto | undefined, opts?: { routed?: boolean }): ActionCost | null` — `null` when credits are disabled, data is missing, or the user is a guest-shaped premium; `included` for Pro-within-allowance (analysis), Pro (specialist/coachMix), Pro-under-pool (coach), routed specialists; `label` = `"Included"` or `"${credits} ◆"`.
  - `isOutOfCredits(err: unknown): boolean` — true for `ApiError` with code `insufficient_credits` OR `entitlement_exhausted`.
- `PlansResponse` gains `creditPacks: { credits: number; cents: number }[]`, `costs?: CreditCosts | null`; drops `creditPack5Cents/creditPack10Cents`.
- `EntitlementsDto` gains `creditBalance?: number`, `isPaying?: boolean`, `proAnalysesLimit?: number | null`, `proAnalysesUsed?: number`.
- `CheckoutKind` credits variant becomes `{ type: 'credits'; packSize: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// components/frontend-spectr-v2/src/features/billing/__tests__/credits.test.ts
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../api/fetcher';
import type { EntitlementsDto, PlansResponse } from '../../../api/types';
import { costOf, isOutOfCredits } from '../credits';

const plans = {
  proMonthlyCents: 1299,
  proAnnualCents: 9900,
  creditPacks: [{ credits: 500, cents: 700 }],
  currency: 'USD',
  creditsEnabled: true,
  costs: { analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5, signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300 },
} as PlansResponse;

const ent = (over: Partial<EntitlementsDto>): EntitlementsDto =>
  ({
    analysesRemaining: 4, coachRemaining: 999, stemsEnabled: true, alsEnabled: true,
    fullVerdictsEnabled: true, historyDepth: null, tier: 'credits', analysesLimit: null,
    analysesUsed: 0, creditsEnabled: true, creditBalance: 420, ...over,
  }) as EntitlementsDto;

describe('costOf', () => {
  it('prices an analysis for a credits user', () => {
    expect(costOf('analysis', plans, ent({}))).toEqual({ credits: 100, included: false, affordable: true, label: '100 ◆' });
  });
  it('marks unaffordable when balance is below the price', () => {
    expect(costOf('analysis', plans, ent({ creditBalance: 40 }))?.affordable).toBe(false);
  });
  it('routed specialists are included', () => {
    expect(costOf('specialist', plans, ent({}), { routed: true })).toMatchObject({ included: true, label: 'Included' });
  });
  it('Pro analyses inside the allowance are included, past it they cost credits', () => {
    expect(costOf('analysis', plans, ent({ tier: 'pro', proAnalysesLimit: 15, proAnalysesUsed: 9 }))?.included).toBe(true);
    expect(costOf('analysis', plans, ent({ tier: 'pro', proAnalysesLimit: 15, proAnalysesUsed: 15 }))?.label).toBe('100 ◆');
  });
  it('returns null when credits are disabled', () => {
    expect(costOf('coachMix', { ...plans, creditsEnabled: false }, ent({ creditsEnabled: false }))).toBeNull();
  });
});

describe('isOutOfCredits', () => {
  it('matches both server codes', () => {
    expect(isOutOfCredits(new ApiError(402, { error: { code: 'insufficient_credits', message: 'x' } }))).toBe(true);
    expect(isOutOfCredits(new ApiError(409, { error: { code: 'entitlement_exhausted', message: 'x' } }))).toBe(true);
    expect(isOutOfCredits(new ApiError(403, { error: { code: 'coach_cap_reached', message: 'x' } }))).toBe(false);
    expect(isOutOfCredits(new Error('boom'))).toBe(false);
  });
});
```

Check `ApiError`'s constructor signature first (`grep -n "class ApiError" -A12 src/api/fetcher.ts`) and adapt the `new ApiError(...)` calls to it.

- [ ] **Step 2: Run to verify failure**

Run: `cd components/frontend-spectr-v2 && npx vitest run src/features/billing/__tests__/credits.test.ts`
Expected: FAIL — `../credits` not found.

- [ ] **Step 3: Implement**

`types.ts` — `PlansResponse`:

```ts
export interface CreditPack {
  credits: number;
  cents: number;
}

/** Credit economy — server price list (credits per action). Never hardcode these. */
export interface CreditCosts {
  analysis: number;
  specialist: number;
  coachMessage: number;
  coachMix: number;
  signupGrant: number;
  proAnalysesMonthly: number;
  proCoachMonthly: number;
}

export interface PlansResponse {
  proMonthlyCents: number;
  proAnnualCents: number;
  creditPacks: CreditPack[];
  currency: string;
  creditsEnabled?: boolean | null;
  costs?: CreditCosts | null;
}
```

(Keep whatever doc comments the existing interface has.) `EntitlementsDto` — append the four optional fields listed in Interfaces with one-line doc comments.

```ts
// components/frontend-spectr-v2/src/features/billing/credits.ts
import { ApiError } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
import type { CreditCosts, EntitlementsDto, PlansResponse } from '../../api/types';

// Credit economy (PRPs/credit-economy.md) — what an action costs THIS user,
// derived from the server price list + their entitlements. Labels only:
// callers show `label`, and route an unaffordable click to the buy sheet.

export type PaidAction = 'analysis' | 'specialist' | 'coachMessage' | 'coachMix';

export interface ActionCost {
  credits: number;
  included: boolean;
  affordable: boolean;
  label: string;
}

const PRICE_KEY: Record<PaidAction, keyof CreditCosts> = {
  analysis: 'analysis',
  specialist: 'specialist',
  coachMessage: 'coachMessage',
  coachMix: 'coachMix',
};

function includedForPro(action: PaidAction, ent: EntitlementsDto): boolean {
  if (action === 'specialist' || action === 'coachMix') return true;
  if (action === 'analysis')
    return (ent.proAnalysesUsed ?? 0) < (ent.proAnalysesLimit ?? Number.POSITIVE_INFINITY);
  return !(ent.coach?.capReached ?? false); // coachMessage: inside the monthly pool
}

export function costOf(
  action: PaidAction,
  plans: PlansResponse | undefined,
  ent: EntitlementsDto | undefined,
  opts: { routed?: boolean } = {},
): ActionCost | null {
  if (!plans?.costs || !ent) return null;
  if (plans.creditsEnabled === false || ent.creditsEnabled === false) return null;
  const credits = plans.costs[PRICE_KEY[action]];
  const included =
    (action === 'specialist' && opts.routed === true) ||
    (ent.tier === 'pro' && includedForPro(action, ent));
  const affordable = included || (ent.creditBalance ?? 0) >= credits;
  return { credits, included, affordable, label: included ? 'Included' : `${credits} ◆` };
}

export function isOutOfCredits(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const code = extractApiError(err.body).code;
  return code === 'insufficient_credits' || code === 'entitlement_exhausted';
}
```

Confirm `extractApiError` is exported from `src/api/error-utils.ts` (it's used in `UnifiedUploadDialog.tsx`) and the `coach` field name on `EntitlementsDto` (`CoachCapsDto.capReached`) before relying on them.

`useUpgradeCheckout.ts`: change the credits variant to `{ type: 'credits'; packSize: number }` (send `{ packSize: kind.packSize }` as before).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/features/billing && npx tsc -b`
Expected: tests PASS; `tsc` reports errors ONLY in files still using `creditPack5Cents/creditPack10Cents` or `packSize: 5 | 10` (`BuyCreditsCard.tsx`, `UpgradeSheet.tsx`, their tests) — fixed in Task 13. Don't commit yet if `tsc` fails anywhere else.

- [ ] **Step 5: Commit** (with Task 13 if `tsc` is red; otherwise now)

```bash
git add components/frontend-spectr-v2/src
git commit -m "feat(credits-fe): price list types, costOf + isOutOfCredits helpers, pack-size checkout"
```

---

### Task 13: Buy surface — balance chip, pack sheet, app-wide "buy credits" opener

**Files:**
- Create: `components/frontend-spectr-v2/src/features/billing/BuyCreditsProvider.tsx` (+ `useBuyCredits`)
- Create: `components/frontend-spectr-v2/src/features/billing/CreditBalanceChip.tsx`, `CreditBalanceChip.module.css`
- Modify: `components/frontend-spectr-v2/src/components/UpgradeSheet.tsx` (credit column = the packs)
- Modify: `components/frontend-spectr-v2/src/features/billing/BuyCreditsCard.tsx` (packs from `plans.creditPacks`)
- Modify: `components/frontend-spectr-v2/src/routes/_app.tsx` (wrap layout in provider; chip in `.navRight`)
- Test: `components/frontend-spectr-v2/src/features/billing/__tests__/CreditBalanceChip.test.tsx`, update `UpgradeSheet`/`BuyCreditsCard` tests that reference 5/10 packs

**Interfaces:**
- Consumes: `costOf`, `PlansResponse.creditPacks`, `EntitlementsDto.creditBalance`, `useUpgradeCheckout`.
- Produces: `useBuyCredits(): { open: (opts?: { title?: string; description?: string; onBought?: () => void }) => void }` (no-op outside the provider); `<CreditBalanceChip />`.

- [ ] **Step 1: Write the failing chip test**

```tsx
// components/frontend-spectr-v2/src/features/billing/__tests__/CreditBalanceChip.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CreditBalanceChip } from '../CreditBalanceChip';

const ents = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('../../../api/hooks', () => ({ useEntitlements: () => ents }));
vi.mock('../BuyCreditsProvider', () => ({ useBuyCredits: () => ({ open: vi.fn() }) }));

describe('CreditBalanceChip', () => {
  it('shows the balance', () => {
    ents.data = { tier: 'credits', creditBalance: 420, creditsEnabled: true };
    render(<CreditBalanceChip />);
    expect(screen.getByRole('button', { name: /420 credits/i })).toBeTruthy();
  });

  it('shows the Pro allowance alongside the balance', () => {
    ents.data = { tier: 'pro', creditBalance: 80, proAnalysesLimit: 15, proAnalysesUsed: 9, creditsEnabled: true };
    render(<CreditBalanceChip />);
    expect(screen.getByText(/Pro · 9\/15/)).toBeTruthy();
  });

  it('renders nothing when credits are disabled', () => {
    ents.data = { tier: 'pro', creditsEnabled: false };
    const { container } = render(<CreditBalanceChip />);
    expect(container.firstChild).toBeNull();
  });
});
```

Match the repo's testing-library setup (check an existing `*.test.tsx` that renders a component and uses `vi.mock` of `api/hooks`, e.g. grep `vi.mock('../../../api/hooks'`).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/billing/__tests__/CreditBalanceChip.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// components/frontend-spectr-v2/src/features/billing/BuyCreditsProvider.tsx
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { UpgradeSheet } from '../../components/UpgradeSheet';

// Credit economy — ONE app-wide buy-credits surface. Paid buttons call
// useBuyCredits().open() when the user can't afford the action (labels-only
// rule: no confirm dialogs), and every 402 insufficient_credits lands here.

interface OpenOpts {
  title?: string;
  description?: string;
  onBought?: () => void;
}

const Ctx = createContext<{ open: (opts?: OpenOpts) => void }>({ open: () => {} });

export function useBuyCredits() {
  return useContext(Ctx);
}

export function BuyCreditsProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<OpenOpts | null>(null);
  const open = useCallback((o: OpenOpts = {}) => setOpts(o), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <UpgradeSheet
        open={opts !== null}
        onOpenChange={(o) => {
          if (!o) setOpts(null);
        }}
        title={opts?.title ?? 'Get more credits'}
        description={
          opts?.description ?? 'Credits never expire. Pick a pack, or go Pro for a monthly allowance.'
        }
        onUpgraded={() => {
          const done = opts?.onBought;
          setOpts(null);
          done?.();
        }}
      />
    </Ctx.Provider>
  );
}
```

```tsx
// components/frontend-spectr-v2/src/features/billing/CreditBalanceChip.tsx
import { useEntitlements } from '../../api/hooks';
import { useBuyCredits } from './BuyCreditsProvider';
import s from './CreditBalanceChip.module.css';

// Credit economy — always-visible balance in the app top bar. Click → buy sheet.
export function CreditBalanceChip() {
  const { data: ent } = useEntitlements();
  const { open } = useBuyCredits();
  if (!ent || ent.creditsEnabled === false) return null;
  const balance = ent.creditBalance ?? 0;
  const pro =
    ent.tier === 'pro' && ent.proAnalysesLimit != null
      ? `Pro · ${ent.proAnalysesUsed ?? 0}/${ent.proAnalysesLimit}`
      : null;
  return (
    <button
      type="button"
      className={s.chip}
      onClick={() => open()}
      aria-label={`${balance} credits — buy more`}
    >
      {pro && <span className={s.pro}>{pro}</span>}
      <span className={`mono ${s.balance}`}>◆ {balance}</span>
    </button>
  );
}
```

```css
/* components/frontend-spectr-v2/src/features/billing/CreditBalanceChip.module.css */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.chip:hover {
  border-color: var(--cyan);
}

.chip:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

.balance {
  color: var(--cyan);
}

.pro {
  color: var(--text-2);
}
```

(Check token names exist in `src/styles/tokens.css` — `--border`, `--text`, `--text-2`, `--cyan` are used by `landing.module.css`; and that `scripts/check-focus-ring.mjs` accepts this focus style.)

`_app.tsx`: wrap the returned `<div className={s.shell}>…</div>` in `<BuyCreditsProvider>…</BuyCreditsProvider>`, and render `{creditsOn && !guest.isGuest && <CreditBalanceChip />}` as the first child of `<div className={s.navRight}>`.

`UpgradeSheet.tsx`: replace `creditPrice` (the 5-pack span) with one button per pack, each starting checkout:

```tsx
  const packs = p?.creditPacks ?? [];
  const creditPrice = (
    <div className={s.packs} role="group" aria-label="Credit packs">
      {packs.map((pk) => (
        <button
          key={pk.credits}
          type="button"
          className="btn sm"
          disabled={pending !== null}
          onClick={() => start({ type: 'credits', packSize: pk.credits })}
        >
          {`${pk.credits.toLocaleString()} credits · ${formatCents(pk.cents, currency)}`}
        </button>
      ))}
    </div>
  );
```

Read how the sheet's existing credits CTA calls `start(...)` and remove that now-duplicate button; update `CREDIT_FEATURES` to `['Never expire', 'Pay as you go']`, and `PRO_FEATURES[0]` from `'Unlimited analyses'` to a string built from `p?.costs?.proAnalysesMonthly` (`` `${n} analyses / month` `` falling back to `'Monthly analyses'`). Add `.packs { display: flex; flex-direction: column; gap: 6px; }` to `UpgradeSheet.module.css`.

`BuyCreditsCard.tsx`: replace `type PackSize = 5 | 10` / two labels with `plans.creditPacks` (state `selectedPack: number` initialised to the first pack's credits; render one segmented button per pack, label `` `${pk.credits.toLocaleString()} credits · ${formatCents(pk.cents, plans.currency)}` ``); body copy: "Credits never expire. Analyses, extra specialists, coach messages and Coach Mix draw from your balance."

Update the existing tests that assert `'5 credits'`/`creditPack5Cents` fixtures to the `creditPacks` shape.

- [ ] **Step 4: Run gates**

Run: `npx tsc -b && npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src
git commit -m "feat(credits-fe): balance chip, app-wide buy sheet with three packs"
```

---

### Task 14: Cost labels on every paid action; out-of-credits opens the buy sheet

**Files:**
- Create: `components/frontend-spectr-v2/src/features/billing/CostTag.tsx`, `CostTag.module.css`
- Modify: `components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx` (submit label ~L1200+, gate L370-378, catch L613)
- Modify: `components/frontend-spectr-v2/src/features/results/ReportView.tsx` (re-analyze catch L399; Coach Mix trigger)
- Modify: `components/frontend-spectr-v2/src/features/results/SpecialistTeamModal.tsx:300-307` (replace `'Run · 1 cr'`)
- Modify: `components/frontend-spectr-v2/src/features/results/useSpecialistRuns.ts` (402 → buy sheet)
- Modify: `components/frontend-spectr-v2/src/features/results/CoachComposer.tsx` (hint under input), `components/frontend-spectr-v2/src/features/results/useCoachSession.ts` (402 → buy sheet)
- Modify: `components/frontend-spectr-v2/src/features/results/CoachTab.tsx` (Coach Mix modal create button)
- Test: `components/frontend-spectr-v2/src/features/billing/__tests__/CostTag.test.tsx`

**Interfaces:**
- Consumes: `costOf`, `isOutOfCredits`, `useBuyCredits`, `usePlans`, `useEntitlements`.
- Produces: `<CostTag action routed? />` rendering `cost.label` (nothing when `costOf` is null); hook `usePaidAction(action, opts?)` → `{ cost: ActionCost | null; guard: (run: () => void) => void }` — `guard` runs `run` when affordable, else opens the buy sheet.

- [ ] **Step 1: Write the failing test**

```tsx
// components/frontend-spectr-v2/src/features/billing/__tests__/CostTag.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CostTag, usePaidAction } from '../CostTag';

const open = vi.fn();
vi.mock('../BuyCreditsProvider', () => ({ useBuyCredits: () => ({ open }) }));
vi.mock('../../../api/hooks', () => ({
  usePlans: () => ({
    data: {
      creditsEnabled: true, creditPacks: [], currency: 'USD', proMonthlyCents: 1, proAnnualCents: 1,
      costs: { analysis: 100, specialist: 15, coachMessage: 5, coachMix: 5, signupGrant: 500, proAnalysesMonthly: 15, proCoachMonthly: 300 },
    },
  }),
  useEntitlements: () => ({ data: { tier: 'credits', creditBalance: 10, creditsEnabled: true } }),
}));

function Probe({ onRun }: { onRun: () => void }) {
  const { guard } = usePaidAction('specialist');
  return <button onClick={() => guard(onRun)}>go</button>;
}

describe('CostTag', () => {
  it('renders the price', () => {
    render(<CostTag action="coachMix" />);
    expect(screen.getByText('5 ◆')).toBeTruthy();
  });

  it('guard opens the buy sheet instead of running when unaffordable', () => {
    const run = vi.fn();
    render(<Probe onRun={run} />);
    screen.getByText('go').click();
    expect(run).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/billing/__tests__/CostTag.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// components/frontend-spectr-v2/src/features/billing/CostTag.tsx
import { useCallback } from 'react';

import { useEntitlements, usePlans } from '../../api/hooks';
import { useBuyCredits } from './BuyCreditsProvider';
import { costOf } from './credits';
import type { ActionCost, PaidAction } from './credits';
import s from './CostTag.module.css';

// Credit economy — "what will this cost me" next to every paid action.

export function usePaidAction(action: PaidAction, opts: { routed?: boolean } = {}) {
  const { data: plans } = usePlans();
  const { data: ent } = useEntitlements();
  const { open } = useBuyCredits();
  const cost: ActionCost | null = costOf(action, plans, ent, opts);
  const guard = useCallback(
    (run: () => void) => {
      if (cost && !cost.affordable) {
        open({
          title: 'Not enough credits',
          description: `This costs ${cost.credits} credits and you have ${ent?.creditBalance ?? 0}.`,
          onBought: run,
        });
        return;
      }
      run();
    },
    [cost, ent?.creditBalance, open],
  );
  return { cost, guard };
}

export function CostTag({ action, routed }: { action: PaidAction; routed?: boolean }) {
  const { cost } = usePaidAction(action, { routed });
  if (!cost) return null;
  return (
    <span className={`mono ${s.tag}`} data-included={cost.included} data-short={!cost.affordable}>
      {cost.label}
    </span>
  );
}
```

```css
/* components/frontend-spectr-v2/src/features/billing/CostTag.module.css */
.tag {
  font-size: 11px;
  color: var(--cyan);
  white-space: nowrap;
}

.tag[data-included='true'] {
  color: var(--text-2);
}

.tag[data-short='true'] {
  color: var(--warn, var(--text-2));
}
```

(Use an existing warning token from `tokens.css` in place of `--warn` if one exists — grep `--amber\|--warn\|--sev-major`.)

Wire each surface (read each file's surrounding code first; keep their existing structure):

1. **Upload** (`UnifiedUploadDialog.tsx`): `const analysisCost = usePaidAction('analysis');`. In `handleSubmit` replace the `analysesRemaining === 0` block with `if (analysisCost.cost && !analysisCost.cost.affordable) { analysisCost.guard(() => void runUpload()); return; }` (keep the legacy `analysesRemaining === 0` path for the free tier when `analysisCost.cost` is null). Add `<CostTag action="analysis" />` inside the submit button after its text. In the catch at ~L613 change the condition to `isOutOfCredits(err)`; for code `insufficient_credits` call `analysisCost.guard(() => void runUpload())`'s open path via `useBuyCredits().open({ title: 'Not enough credits', onBought: () => void runUpload() })` instead of `setEntExhausted(true)`.
2. **Re-analyze** (`ReportView.tsx` ~L399): same — `isOutOfCredits(err)` → `useBuyCredits().open(...)` for `insufficient_credits`, existing UpgradeSheet for `entitlement_exhausted`; add `<CostTag action="analysis" />` to the re-analyze button.
3. **Specialist** (`SpecialistTeamModal.tsx` L300-307): replace the literal `'Run · 1 cr'` with `<>Run <CostTag action="specialist" routed={isRouted} /></>` where `isRouted` comes from the modal's routing-plan data (the modal already knows which specialists triage ran — use that list; read L60-120). In `useSpecialistRuns.ts`, when the run mutation rejects with `isOutOfCredits(err)`, call `useBuyCredits().open({ title: 'Not enough credits', onBought: () => runSpecialist(slug) })`.
4. **Coach** (`CoachComposer.tsx`): under the input render `<p className={s.costHint}>{cost && !cost.included ? `${cost.credits} ◆ per message` : null}</p>` using `usePaidAction('coachMessage')`; guard the submit with `guard(...)`. In `useCoachSession.ts` where `postRes` is checked (~L229-240): if `postRes.status === 402`, call the buy sheet `open({ title: 'Not enough credits', onBought: () => send(text) })` and roll back the optimistic message the same way the existing non-OK branch does.
5. **Coach Mix** (`CoachTab.tsx` modal): add `<CostTag action="coachMix" />` to the create button and wrap `onCreate` with `usePaidAction('coachMix').guard`. In `useFixRackGeneration.ts` treat a rejected `generate()` with `isOutOfCredits(err)` by opening the buy sheet.

The Listen page's coach (`features/listen-rack/CoachTabV2.tsx`) reuses `CoachComposer`/`useCoachSession` — confirm with grep; if it has its own input, add the same hint there.

- [ ] **Step 4: Run all four gates**

Run: `npx tsc -b && npm run lint && npm run build && npx vitest run && node scripts/check-css-tokens.mjs && node scripts/check-price-literals.mjs && node scripts/check-focus-ring.mjs`
Expected: all green. Fix any existing test that asserted `'Run · 1 cr'`.

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr-v2/src
git commit -m "feat(credits-fe): cost labels on analyze/specialist/coach/Coach Mix; out-of-credits opens the buy sheet"
```

---

### Task 15: Pricing page, docs, full gates, live pass

**Files:**
- Modify: `components/frontend-spectr-v2/src/features/pricing/PricingPlansView.tsx` (+ its test)
- Modify: `CLAUDE.md` (bff Stack-specific rules: replace the "credits = unlimited coach" description and add the credit-economy rules), `docs/runbook.md` (operator rollout steps)
- Test: `components/frontend-spectr-v2/src/features/pricing/__tests__/*` (update)

- [ ] **Step 1: Update the pricing test first** — assert the free card says "500 credits to start" (from `plans.costs.signupGrant`), the credits card lists the three packs from `creditPacks` and is NOT disabled, and the Pro card shows "15 analyses + 300 coach messages / month" (from `costs`). Run it; expect FAIL.

- [ ] **Step 2: Implement `PricingPlansView`** — Free card features: `` `${costs.signupGrant} credits to start` ``, `'Analysis 100 ◆ · specialist 15 ◆ · coach 5 ◆'` built from `costs` (never literals); credits card: one line per `creditPacks` entry + enable its button (opens checkout for the first pack, or link to `/usage` where `BuyCreditsCard` lets them pick); Pro card first feature `` `${costs.proAnalysesMonthly} analyses + ${costs.proCoachMonthly} coach messages / month` `` and add `'Then pay as you go with credits'`. Run the test; expect PASS.

- [ ] **Step 3: Docs**

`CLAUDE.md` bff section — replace the sentence "credits = unlimited" in the coach-caps bullet and add a bullet:

```markdown
- **Credit economy (PRPs/credit-economy.md, 2026-10)**: prices live in `feature_flags` (`credit_cost_*`, `credit_signup_grant`, `pro_analyses_monthly`) resolved by `CreditPricing` (config `Credits:Prices:*` → flag → default) and served on `GET /api/billing/plans` (`costs`). Charges go through `CreditLedgerService.ChargeAsync` with idempotency keys (`spend:analysis:{jobId}`, `spend:specialist:{analysisId}:{slug}`, `spend:coach:{messageId}`, `spend:coachmix:{requestId}`); refunds via `RefundChargeAsync` (exact amount). Triage-routed specialists are included in the analysis price. Pro = 15 analyses + 300 coach msgs/month, then credits. Abuse arms + verify gate key on `EntitlementsDto.IsPaying` (Pro or ≥1 purchase), NOT tier — a signup-grant-only account is not paying. Test suite pins `Credits__Prices__Analysis=1` and `Credits__SignupGrant=0` (`TestProcessBaseline`); credit-economy tests opt in via `UseSetting`.
```

`docs/runbook.md` — add "Turning credits on": (1) create three one-time Stripe Prices (500 / $7, 1,500 / $18, 5,000 / $55), set `STRIPE_PRICE_CREDITS_500|1500|5000` in the prod env, deploy; (2) raise `LLM_BUDGET_GLOBAL_USD` (prod default is $10/month) and confirm `llm_budget_credits_usd`; (3) `UPDATE feature_flags SET value='0' WHERE name IN ('free_analyses_per_month','coach_free_followups');` (the signup grant replaces the free allowance) and `UPDATE feature_flags SET value='true' WHERE name='credits_enabled';` (≤ 60 s); (4) `curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" https://<host>/api/admin/credits/backfill-signup-grant` (check the admin header name in `AdminAuth`); (5) watch `llm_calls` cost per analysis for a week and retune `credit_cost_*`.

- [ ] **Step 4: Full gates**

```bash
cd components/bff && dotnet build && dotnet test            # env from "Test environment"
cd ../worker && PYTHONPATH="../shared;." python -m pytest -q -p no:cacheprovider tests
cd ../frontend-spectr-v2 && npx tsc -b && npm run lint && npm run build && npx vitest run
cd ../.. && python -m ruff check components/worker/ components/shared/
```

Expected: all green (BFF summary `Failed: 0`, `Skipped: 0` beyond the suite's known skips).

- [ ] **Step 5: Live pass (dev, Stripe test mode)** — start the stack per `docs/STARTUP.md`; set `credits_enabled='true'` in the dev DB and the test-mode Stripe pack price ids in user-secrets. Walk: register → chip shows ◆ 500 → upload + analyze (◆ 400, label said 100 ◆) → run a non-routed specialist (◆ 385) → coach ×2 (◆ 375) → Coach Mix (◆ 370) → buy the 500 pack in Stripe test mode (◆ 870) → force a failed job (stop the worker mid-run or set the job failed in SQL) and reload it (refunded). Then set `credits_enabled='false'` and confirm no chip / no labels / no charges. Record results in the PR description.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(credits): pricing page from server costs; runbook + CLAUDE.md credit economy"
```
