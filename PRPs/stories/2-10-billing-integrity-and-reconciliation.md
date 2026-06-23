# Story 2.10: Billing Integrity & Reconciliation

Status: done

## Story

As the operator,
I want billing state provably consistent with Stripe,
So that double-charging is structurally impossible and drift is caught nightly.

## Acceptance Criteria

1. **Given** the nightly reconciliation job (AR14), **When** it compares the subscriptions mirror and credit ledger against Stripe, **Then** any drift emits an alertable structured-log warning **And** the job is idempotent.
2. **Given** webhook replay, **When** Stripe redelivers an already-processed event id, **Then** processing is a no-op — explicit test replays a recorded fixture event and confirms the second dispatch writes nothing (FR35).
3. **Given** entitlement state loss, **When** Stripe subscription events replay from scratch, **Then** local `subscriptions` mirror reconstructs to equivalent state.
4. **Given** money fields, **When** audited, **Then** all amounts in `credit_ledger` are integer cents and the reconciliation job alerts when `PricingDisplayOptions` display amounts drift from the actual Stripe Price `UnitAmount`.

## Tasks / Subtasks

- [x] **Task 1 — Extend `IStripeSubscriptionClient` with read methods (AC: #1, #4)**
  - [x] Add to `IStripeSubscriptionClient` (`components/bff/src/Spectr.Bff/Services/IStripeSubscriptionClient.cs`):
    ```csharp
    Task<Stripe.Subscription?> GetSubscriptionAsync(string subscriptionId, CancellationToken ct);
    Task<Stripe.Price?> GetPriceAsync(string priceId, CancellationToken ct);
    ```
  - [x] Implement in `StripeSubscriptionClient` using `SubscriptionService.GetAsync` and `PriceService.GetAsync`. Return `null` on `StripeException` with code `resource_missing` (deleted subscription); rethrow any other exception.
  - [x] No `IdempotencyKey` needed — these are read-only GET calls.

- [x] **Task 2 — `BillingReconciliationService` background service (AC: #1, #4)**
  - [x] Create `components/bff/src/Spectr.Bff/Services/BillingReconciliationService.cs`.
  - [x] Inherit `BackgroundService`. Constructor args: `IServiceScopeFactory scopeFactory`, `IOptions<StripeOptions> stripeOpts`, `IOptions<PricingDisplayOptions> pricingOpts`, `ILogger<BillingReconciliationService> logger`.
  - [x] `ExecuteAsync`: `PeriodicTimer(TimeSpan.FromHours(24))` loop; call `RunReconciliationAsync(ct)` each tick. Let exceptions log and continue (do NOT crash the host).
  - [x] `RunReconciliationAsync`:
    1. Skip immediately if `!_stripeOpts.Value.IsConfigured` (log info + return).
    2. Create a scope; resolve `AppDbContext` and `IStripeSubscriptionClient`.
    3. **Subscription mirror check**: load all `db.Subscriptions.AsNoTracking().Where(s => s.StripeSubscriptionId != null)`. For each row, call `GetSubscriptionAsync`. On null (not found in Stripe): log `LogWarning("ReconciliationDrift:SubscriptionMissing stripe_subscription_id={Id}", ...)`. On mismatch of `Status`, `PriceId`, or `CurrentPeriodEnd` (>5 min drift): log `LogWarning("ReconciliationDrift:Subscription field={Field} local={Local} stripe={Stripe} subscriptionId={Id}", ...)`. Never write to the DB.
    4. **Price display check**: for each configured price ID (`PriceProMonthly`, `PriceProAnnual`, `PriceCreditPack5`, `PriceCreditPack10`) that is non-null, call `GetPriceAsync`. If returned price currency != `_pricingOpts.Value.Currency` (case-insensitive): log `LogWarning("ReconciliationDrift:PriceCurrencyMismatch priceId={PriceId} stripeCurrency={Stripe} displayCurrency={Display}", ...)`. If `Price.UnitAmount` (long? in cents) != display amount from `PricingDisplayOptions`: log `LogWarning("ReconciliationDrift:PriceAmountMismatch priceId={PriceId} stripeAmountCents={Stripe} displayCents={Display}", ...)`. Skip if `GetPriceAsync` returns null.
    5. Log `LogInformation("Reconciliation run complete. Subscriptions checked: {Count}", count)` at the end.
  - [x] Idempotency is structural: the service only reads from Stripe and DB, never writes. Running it twice is safe.

- [x] **Task 3 — Register the service (AC: #1)**
  - [x] In `Program.cs` (after the `HonestMathService` registration at line ~129):
    ```csharp
    // Story 2.10 — nightly billing reconciliation (read-only drift check).
    builder.Services.AddHostedService<BillingReconciliationService>();
    ```

- [x] **Task 4 — Webhook replay idempotency test (AC: #2)**
  - [x] In `StripeWebhookEndpointTests.cs` add test `Webhook_DuplicateEventId_IsNoOp`:
    - Build the app, seed a user with a customer id.
    - POST a valid `customer.subscription.created` webhook JSON (reuse or adapt the `subscription_created.json` fixture). Record the Stripe-Signature.
    - POST the identical raw body + same signature a second time.
    - Assert both return `200`. Assert `db.WebhookEvents.CountAsync(w => w.Id == eventId) == 1` (only one row, not two). Assert `db.Subscriptions.CountAsync(...) == 1` (mirror written once, not twice).
    - This test proves the `INSERT … ON CONFLICT (id) DO NOTHING` + `processed_at IS NOT NULL` guard works end-to-end.

- [x] **Task 5 — Entitlement reconstruction test (AC: #3)**
  - [x] In `StripeWebhookEndpointTests.cs` add test `Webhook_Replay_ReconstructsSubscriptionMirror`:
    - Start with empty `subscriptions` table for a seeded user.
    - POST `customer.subscription.created` → assert mirror row exists with `status=active`.
    - POST `customer.subscription.updated` with `status=past_due` → assert mirror row updated.
    - POST `customer.subscription.updated` with `status=active` (recovery) → assert row back to `active`.
    - Ordering matters: the third event should re-apply without error even though the row already exists.
    - This proves that replaying from scratch (equivalent to a Stripe "replay all events") reconstructs the expected final state.

- [x] **Task 6 — Integer cents + currency assertion (AC: #4)**
  - [x] In the new `BillingReconciliationServiceTests.cs` (unit test), add `RunReconciliation_DetectsCurrencyMismatch`:
    - Mock `IStripeSubscriptionClient.GetPriceAsync` to return a `Stripe.Price` with `Currency = "eur"` and `UnitAmount = 1299`.
    - Set `PricingDisplayOptions.Currency = "USD"`.
    - Run the reconciliation. Assert that `LogWarning` was called with `"ReconciliationDrift:PriceCurrencyMismatch"`.
  - [x] Add `RunReconciliation_DetectsAmountMismatch`:
    - Mock `GetPriceAsync` to return currency `"usd"` but `UnitAmount = 999` (≠ `ProMonthlyCents = 1299`).
    - Assert `LogWarning` called with `"ReconciliationDrift:PriceAmountMismatch"`.
  - [x] Add `RunReconciliation_SkipsWhenStripeNotConfigured`:
    - `StripeOptions.IsConfigured == false` (no SecretKey).
    - Assert no Stripe calls, no warnings.
  - [x] For credit ledger integer-cents: the `credit_ledger.amount` column is `int` in EF (enforced by schema + `CHECK amount <> 0` constraint). No runtime assertion needed — structural. Document this in Dev Notes.

- [x] **Task 7 — Tests + gates**
  - [x] Run `dotnet build && dotnet test` (BFF). Zero new warnings. All tests green including the 4 webhook-replay + reconciliation tests.
  - [x] No frontend changes — story is BFF-only.
  - [x] Confirm `StripeWebhookEndpointTests` Postgres-gated tests still skip cleanly when Postgres is unreachable.

## Dev Notes

### What's already done (do NOT rebuild)

- **Webhook idempotency infrastructure (AR11):** `WebhookEvent` entity (`id` PK = Stripe event id), `INSERT … ON CONFLICT (id) DO NOTHING` in `PostStripeWebhook`, `processed_at` flip after dispatch, `processing_error` on failure. The `ON CONFLICT DO NOTHING` is conditional: it only skips a row if `processed_at IS NOT NULL` (story 2.1 pattern). Story 2.10's task is to add an explicit end-to-end test (AC2), not rebuild the guard.
- **Subscription mirror:** `SubscriptionMirrorService.ApplyAsync` is the sole writer to `subscriptions`. All 7 Stripe status strings land verbatim. `CustomerSubscription.*` events dispatch to it. Tested by story 2.1 + 2.9.
- **Credit ledger idempotency:** `CreditLedgerEntry.IdempotencyKey` + partial unique index prevents duplicate purchase/reversal rows. `credit_ledger.amount` is `int` — schema enforces integer cents. `CHECK amount <> 0` constraint enforced via migration 20260616031132.
- **Currency display:** `PricingDisplayOptions.Currency` is `"USD"` (default). `PricingDisplayOptions.ProMonthlyCents = 1299`, etc. All in `PricingDisplayOptions.cs`. Comments there already say story 2.10 reconciliation will alert on drift.
- **`IStripeSubscriptionClient` exists** with `UpdateAsync` + `CreatePortalSessionAsync`. Story 2.10 adds `GetSubscriptionAsync` + `GetPriceAsync` (read-only, no `IdempotencyKey`). Implement in `StripeSubscriptionClient` using Stripe SDK's `SubscriptionService.GetAsync` and `PriceService.GetAsync`.

### BackgroundService pattern

`PeriodicTimer` (introduced in .NET 6) is the preferred loop mechanism — it doesn't drift, no Timer callbacks to worry about, no locking:

```csharp
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
    while (await timer.WaitForNextTickAsync(stoppingToken))
    {
        try { await RunReconciliationAsync(stoppingToken); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Reconciliation run failed.");
        }
    }
}
```

The service uses `IServiceScopeFactory` (not injected `AppDbContext`) because `BackgroundService` is singleton-lifetime while `AppDbContext` is scoped. Captive dependency would silently reuse a stale DB context.

### Stripe read API (Stripe.net 52.x)

```csharp
// SubscriptionService + PriceService are stateless, safe to new() per-call.
var subSvc = new Stripe.SubscriptionService();
var sub = await subSvc.GetAsync(stripeSubscriptionId, cancellationToken: ct);

var priceSvc = new Stripe.PriceService();
var price = await priceSvc.GetAsync(priceId, cancellationToken: ct);
// price.UnitAmount is long? (cents). price.Currency is lowercase ISO code ("usd").
```

Handle `StripeException` with `StripeError.Code == "resource_missing"` → return null (subscription deleted from Stripe — this IS a drift condition to log).

### Structured log format (alertable by Epic 10 observability)

All drift warnings use the `ReconciliationDrift:` prefix in the message template so log aggregation (Loki / Datadog / etc.) can define a single alert rule:

```csharp
_logger.LogWarning(
    "ReconciliationDrift:Subscription field={Field} local={Local} stripe={Stripe} subscriptionId={SubId}",
    "Status", localSub.Status, stripeSub.Status, localSub.StripeSubscriptionId);
```

Epic 10's observability story defines the actual alert rule; this story emits the signal.

### Unit test pattern for BillingReconciliationService

BackgroundService unit tests should NOT use `WebApplicationFactory` — that's for integration (HTTP) tests. Instead, use constructor injection with mocked/faked dependencies:

```csharp
// Example mock pattern (use NSubstitute or Moq if available, else hand-roll a fake)
var fakeSvc = Substitute.For<IStripeSubscriptionClient>();
fakeSvc.GetPriceAsync("price_monthly", Arg.Any<CancellationToken>())
    .Returns(new Price { Currency = "eur", UnitAmount = 1299 });

var service = new BillingReconciliationService(
    scopeFactory: ...,  // hand-rolled fake scope returning in-memory EF
    stripeOpts: Options.Create(new StripeOptions { SecretKey = "sk_test_x", ... }),
    pricingOpts: Options.Create(new PricingDisplayOptions { Currency = "USD", ProMonthlyCents = 1299 }),
    logger: loggerFactory.CreateLogger<BillingReconciliationService>());
```

Check which mocking library is in the test project before writing — if none, hand-roll the fakes following the BFF's existing test patterns.

### Gotchas

- **`PriceService.GetAsync` currency is lowercase** (`"usd"`, not `"USD"`). Compare case-insensitive: `!string.Equals(price.Currency, displayCurrency, StringComparison.OrdinalIgnoreCase)`.
- **`Price.UnitAmount` is `long?`** (can be null for usage-based pricing). Cast safely: `(int?)price.UnitAmount`. If null, skip the amount check (Stripe's variable pricing — not applicable to our fixed-price packs, but be defensive).
- **`PeriodicTimer.WaitForNextTickAsync` exits on cancellation** (returns false, not throws). The `while` loop exits cleanly. Ensure the `catch` clause excludes `OperationCanceledException` so shutdown doesn't log a spurious error.
- **`CurrentPeriodEnd` drift tolerance (5 min):** Webhook delivery is async; a sub renewed a moment ago may have a fresh `CurrentPeriodEnd` in Stripe that hasn't arrived via webhook yet. Use `Math.Abs((local - stripe).TotalMinutes) > 5` as the threshold.
- **`IStripeSubscriptionClient` is singleton** (current registration in Program.cs). `BillingReconciliationService` is also singleton (registered as `IHostedService`). This is safe — no scoped dependency captured. DB access goes through a freshly-created scope per run via `IServiceScopeFactory`.
- **Do NOT read `db.CreditLedger` for nightly reconciliation.** The ledger's `SUM(amount)` is the canonical local balance. Comparing against Stripe's payment history requires correlating Stripe PaymentIntents against ledger entries — complex, not in MVP scope. The integer-cents AC (AC4) is satisfied by schema enforcement + the price-display drift check. A full ledger audit is Epic 10 work.
- **Webhook replay fixtures**: reuse the existing `subscription_created.json` fixture in `Spectr.Bff.Tests/Fixtures/StripeEvents/`. If it doesn't exist, create minimal valid JSON with a `customer.subscription.created` event structure. Check `StripeWebhookEndpointTests.cs` for the exact fixture loading pattern to mirror.

### Decisions

- **D1 — Reconciliation runs in BFF as `BackgroundService`, not a separate cron.** No infrastructure additions for MVP. When the Epic 10 observability story ships, the logs this service emits are the signal for any external alerting rule. A dedicated reconciliation process (Lambda, cron job) can replace this when scale demands.
- **D2 — Drift is logged only, never auto-corrected.** Auto-correction is dangerous (could mask a bug or overwrite a valid Stripe state). Operator reviews the log, then either triggers a manual webhook replay via Stripe dashboard or runs `SubscriptionMirrorService.ApplyAsync` via a one-off admin endpoint (Epic 10).
- **D3 — Credit ledger audit deferred.** Full Stripe-vs-ledger reconciliation requires correlating `payment_intent_id` entries against Stripe charges — not in scope for MVP. Schema enforcement (int column, unique idempotency key, compensating reversal pattern) is the structural guarantee. Document the deferred scope explicitly.
- **D4 — AC3 is satisfied by testing the existing webhook dispatch pipeline**, not by building a new "replay" mechanism. The test sends events in order to a clean DB and asserts the final mirror state. This proves `SubscriptionMirrorService.ApplyAsync` is the stable reconstruction function — if Stripe replays events from scratch, the result is deterministic.

### References

- [Source: PRPs/epics.md#Story-2.10] — AC verbatim
- [Source: PRPs/epics.md line 183] — AR14: integer cents everywhere; Stripe = source of truth; nightly reconciliation alerts on drift
- [Source: PRPs/epics.md line 129] — NFR14: webhook idempotent; entitlement state recoverable by replaying Stripe events; nightly reconciliation check
- [Source: PRPs/deferred-work.md] — Currency mismatch detection: `PricingDisplay.Currency` vs actual Stripe Price currency — story 2.10 owns it
- [Source: components/bff/src/Spectr.Bff/Services/IStripeSubscriptionClient.cs] — interface to extend with read methods
- [Source: components/bff/src/Spectr.Bff/Options/PricingDisplayOptions.cs] — display cents + currency (drift source)
- [Source: components/bff/src/Spectr.Bff/Options/StripeOptions.cs] — configured price IDs
- [Source: components/bff/src/Spectr.Data/Entities/WebhookEvent.cs] — AR11 idempotency entity (processed_at IS NOT NULL guard)
- [Source: components/bff/src/Spectr.Data/Entities/CreditLedgerEntry.cs] — int amount, idempotency_key, CHECK constraint
- [Source: components/bff/src/Spectr.Bff/Services/SubscriptionMirrorService.cs] — the sole subscriptions writer; pattern to read for reconstruction test
- [Source: components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs:1059-1115] — invoice.paid/payment_failed webhook (story 2.9) + SupportedSubscriptionEvents set
- [Source: components/bff/tests/Spectr.Bff.Tests/StripeWebhookEndpointTests.cs] — existing webhook tests + fixture loading pattern to extend
- [Source: components/bff/src/Spectr.Bff/Program.cs:129] — HonestMathService registration — add AddHostedService after it

### File List

**BFF — new**
- `components/bff/src/Spectr.Bff/Services/BillingReconciliationService.cs`
- `components/bff/tests/Spectr.Bff.Tests/BillingReconciliationServiceTests.cs`
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/subscription_recovered.json`

**BFF — modified**
- `components/bff/src/Spectr.Bff/Services/IStripeSubscriptionClient.cs` (GetSubscriptionAsync + GetPriceAsync)
- `components/bff/src/Spectr.Bff/Spectr.Bff.csproj` (InternalsVisibleTo Spectr.Bff.Tests)
- `components/bff/src/Spectr.Bff/Program.cs` (AddHostedService<BillingReconciliationService>)
- `components/bff/tests/Spectr.Bff.Tests/StripeWebhookEndpointTests.cs` (Tasks 4 + 5)
- `components/bff/tests/Spectr.Bff.Tests/BillingManageEndpointsTests.cs` (stub GetSubscriptionAsync + GetPriceAsync on RecordingStripeSubscriptionClient)

**Frontend — none**

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-06-23)

### Completion Notes List

- **Task 1**: Added `GetSubscriptionAsync` + `GetPriceAsync` to `IStripeSubscriptionClient` interface and `StripeSubscriptionClient` implementation. Both catch `StripeException` with `resource_missing` code and return null; other exceptions rethrow. `PriceService` added as a third stateless service field.
- **Task 2**: `BillingReconciliationService` created as `internal sealed BackgroundService`. `ExecuteAsync` uses `PeriodicTimer(24h)`; exceptions caught and logged without crashing the host. `RunReconciliationAsync` is `internal` for direct test invocation. `CheckPriceDisplayAsync` is extracted as a separate `internal` method (no DB access) for focused unit testing. Subscription mirror check uses `firstItem.CurrentPeriodEnd` (DateTime) converted to `DateTimeOffset` before comparing with local; 5-min tolerance applied via `Math.Abs(drift.TotalMinutes) > 5`.
- **Task 3**: `AddHostedService<BillingReconciliationService>()` registered in `Program.cs` after `HonestMathService`.
- **Tasks 4+5**: `Webhook_DuplicateEventId_IsNoOp` and `Webhook_Replay_ReconstructsSubscriptionMirror` added to `StripeWebhookEndpointTests.cs`. New fixture `subscription_recovered.json` created for the 3-event AC3 reconstruction sequence. Cleanup handles all 3 event IDs.
- **Task 6**: `BillingReconciliationServiceTests.cs` created with 3 unit tests using hand-rolled fakes (`FakeStripeClient`, `NeverCallScopeFactory`, `CapturingLogger`). Currency mismatch and amount mismatch tests call `CheckPriceDisplayAsync` directly (no DB needed). Skip test calls `RunReconciliationAsync` with `IsConfigured=false` and asserts `NeverCallScopeFactory` is never invoked. `InternalsVisibleTo("Spectr.Bff.Tests")` added to `Spectr.Bff.csproj` via `<AssemblyAttribute>`.
- **Task 7**: `dotnet build` = 0 warnings, 0 errors. `dotnet test` = 149/149 pass (5 new tests + 144 pre-existing). `BillingManageEndpointsTests.RecordingStripeSubscriptionClient` updated with stub implementations of the 2 new interface methods.
- **Integer-cents structural guarantee (AC4)**: `credit_ledger.amount` is `int` in EF (`CreditLedgerEntry.Amount`), enforced at schema level by `CHECK amount <> 0` constraint. No runtime check needed. Price-display drift detection covers the second half of AC4.

### Change Log

- **2026-06-23**: Story implemented (claude-sonnet-4-6). 5 new files/fixtures, 5 modified files. 149/149 BFF tests pass. Status → review.
- **2026-06-23**: Code review (3 adversarial layers, opus-4-8). 4 patches applied, 3 deferred, ~10 rejected as noise:
  - **P1** (edge, high-value): `CurrentPeriodEnd` drift skipped for the `AddYears(10)` mirror sentinel — was a perpetual nightly false positive a read-only job could never self-heal.
  - **P2** (blind+edge+auditor): corrected the false "PeriodicTimer fires immediately" comment; `ExecuteAsync` now runs once at startup (do-while) so a redeploy doesn't reset the 24h clock and starve the check.
  - **P3** (auditor): extracted `CheckSubscriptionDrift` (testable without DB) + 5 new unit tests covering Status / PriceId / period-end drift, the sentinel skip, and the no-drift case (the AC1 subscription branch was previously untested).
  - **P4** (blind+edge): per-subscription try/catch so one transient Stripe error no longer aborts the whole nightly run.
  - Deferred: Stripe rate-limit/batching at scale (Epic 10), null-`UnitAmount` warning for fixed prices, pre-existing test-cleanup-on-failure pattern. 154/154 BFF tests pass.

### Deferred Scope (explicit, not gaps)

- **Full credit ledger ↔ Stripe payment reconciliation** — correlating `credit_ledger.idempotency_key` (e.g. `"credits_purchase:<stripeEventId>"`) against Stripe PaymentIntents/Charges to verify no orphaned purchases or missing reversals. Complex Stripe pagination required. Epic 10 admin/ops surface owns this.
- **Automatic drift correction** — reconciliation job is read-only by design (D2). Admin-triggered correction endpoint is Epic 10 scope.
- **Stuck job credit reversal audit** — `components/bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs:182` notes story 2.10 reconciliation is the backstop for failed jobs the user never re-opens (the lazy-reversal path). A nightly sweep of `failed` jobs with no matching reversal ledger entry is deferred to Epic 10.
