# Story 2.4: Server-Side Entitlements & Metering

Status: ready-for-dev

## Story

As the operator,
I want every gated action checked against one server-side entitlement resolver,
So that tiers are enforced consistently and client tampering is irrelevant.

## Acceptance Criteria

1. **Given** `Entitlements.For(user)` (AR12), **When** resolved, **Then** it derives `{analyses_remaining, coach_remaining, features{stems, als, full_verdicts, history_depth}}` purely from subscription status, credit balance, and period usage — cached 60 s per user, invalidated on webhook/spend.
2. **Given** upload dispatch, **When** a free user has consumed 3 analyses in the current `billing_period`, **Then** the request rejects 409 with error code `entitlement_exhausted` **And** the frontend keys off the code, not the message (AR38).
3. **Given** dispatch, **When** a job is created, **Then** the BFF stamps the tier (`"free"`, `"credits"`, `"pro"`) onto the job row and writes a `usage_events` row (type=`analysis`, billing_period=YYYY-MM, reference=jobId) in the same DB transaction as the `analysis_jobs` INSERT — the worker never reads billing tables (AR13). The queue enqueue happens AFTER the transaction commits.
4. **Given** results-forever (AR15), **When** a lapsed user opens a previously delivered report via `GET /api/jobs/{id}/results` or `GET /api/jobs/{id}`, **Then** no entitlement check runs on those paths — an integration test asserts `EntitlementService.ForAsync` is never called by the result-read handlers.
5. **Given** metering, **When** analyses are dispatched, **Then** `usage_events` rows append and are never updated (append-only invariant carried forward from story 2.3 schema).

## Tasks / Subtasks

- [ ] **Task 1: Schema — `feature_flags` table + `analysis_jobs.tier` column + migration (AC: 1, 2, 3)**
  - [ ] 1.1 Create `Spectr.Data/Entities/FeatureFlag.cs`. Fields: `string Name` (PK, text), `string Value` (text, NOT NULL), `DateTimeOffset UpdatedAt` (default `now()`). Append `DbSet<FeatureFlag> FeatureFlags` to `AppDbContext`; configure in `OnModelCreating` (snake_case Npgsql convention; PK on `name`).
  - [ ] 1.2 Add `[Column("tier"), MaxLength(16)]` nullable `string? Tier` to `AnalysisJob` entity. Values: `"free"` / `"credits"` / `"pro"`; null for rows predating this story.
  - [ ] 1.3 Generate migration `AddFeatureFlagsAndJobTier` via `dotnet ef migrations add ... --project src/Spectr.Data --startup-project src/Spectr.Bff`. Append raw SQL to `Up()` for: (a) `CREATE TABLE IF NOT EXISTS feature_flags (name text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`; (b) `ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS tier text NULL`; (c) seed initial flags with `INSERT ON CONFLICT DO NOTHING` for `free_analyses_per_month=3`, `coach_free_followups=3`, `history_depth_free=10`, `history_depth_credits=30`. Add rollback in `Down()`. EF scaffold may already emit the tier column DDL — skip the raw ALTER TABLE if so.

- [ ] **Task 2: BFF — `EntitlementService` (the resolver) (AC: 1, 2, 3)**
  - [ ] 2.1 Create `Services/EntitlementService.cs`. Inject `AppDbContext` (scoped), `IMemoryCache`. Public method: `Task<EntitlementsDto> ForAsync(Guid userId, CancellationToken ct)`. Cache key `ent:{userId:N}`, 60 s absolute TTL. On cache miss, compute from DB.
  - [ ] 2.2 `EntitlementsDto` record in `DTOs/BillingDtos.cs`: `int? AnalysesRemaining` (null = unlimited), `int CoachRemaining`, `bool StemsEnabled`, `bool AlsEnabled`, `bool FullVerdictsEnabled`, `int? HistoryDepth` (null = unlimited), `string Tier`.
  - [ ] 2.3 Resolver logic (no Stripe API calls): (1) query `subscriptions` most-recent row for user; `isPro = status IN ('active','past_due')`. (2) `SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE user_id=@uid`. (3) count `usage_events` for current `billing_period` (YYYY-MM) and event_type='analysis'. (4) read feature flags via `GetFlagsAsync` (cache key `feature_flags_global`, 60 s). (5) derive tier — see table in Dev Notes.
  - [ ] 2.4 `InvalidateAsync(Guid userId)` public method: `_cache.Remove($"ent:{userId:N}")`. Inject `IMemoryCache` directly into `CreditLedgerService` (avoids circular DI) and call `Remove` after `SpendAsync` commits and after `PurchaseAsync` inserts. Call from webhook handler on subscription events (Task 6).
  - [ ] 2.5 Register `AddScoped<EntitlementService>()` in `Program.cs`. Add `builder.Services.AddMemoryCache()` if not already present.

- [ ] **Task 3: BFF — `GET /api/me/entitlements` endpoint (AC: 1)**
  - [ ] 3.1 Add handler at `GET /api/me/entitlements`, `.RequireAuthorization()`. Returns `EntitlementsDto`. On DB error, return 503 `entitlements_unavailable` via `ErrorEnvelope.Build`. Response: `Cache-Control: no-cache`.

- [ ] **Task 4: BFF — dispatch-path entitlement gate + tier stamp (AC: 2, 3)**
  - [ ] 4.1 Add private static helper `DispatchAnalysisAsync(Guid userId, Guid versionId, Guid? referenceId, AppDbContext db, EntitlementService ents, CreditLedgerService credits, IJobQueue queue, CancellationToken ct)` to `VersionEndpoints.cs`.
  - [ ] 4.2 Helper sequence: (1) `var ent = await ents.ForAsync(userId, ct)`. (2) If `ent.AnalysesRemaining == 0` return 409 `entitlement_exhausted`. (3) For `"free"` and `"pro"` tiers: ReadCommitted TX, INSERT `AnalysisJob` with `Tier=ent.Tier` + INSERT `UsageEvent`, COMMIT, THEN enqueue. (4) For `"credits"` tier: INSERT `AnalysisJob` with `Tier="credits"` (outside TX). Call `CreditLedgerService.SpendAsync(userId, jobId, billingPeriod, ct)` which inserts both `UsageEvent` + `credit_ledger -1` in its own Serializable TX. On `InsufficientCreditsException` (race): mark job failed, return 409 `insufficient_credits`. THEN enqueue on success.
  - [ ] 4.3 Replace all 5 `EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, ...)` call sites in `VersionEndpoints.cs` with calls to `DispatchAnalysisAsync`. Thread `EntitlementService ents` and `CreditLedgerService credits` as DI parameters in affected handlers.
  - [ ] 4.4 Remove the `CreditSpendEnabled` feature-flag branch and `appsettings.json` entry from story 2.3.

- [ ] **Task 5: BFF — extend `SpendAsync` to write `UsageEvent` (AC: 3)**
  - [ ] 5.1 Extend `CreditLedgerService.SpendAsync` to accept `string billingPeriod` (already present from story 2.3) and INSERT the matching `UsageEvent` row inside its Serializable TX — so credits-tier dispatch has a single atomic TX for ledger + usage.
  - [ ] 5.2 Confirm `_cache.Remove($"ent:{userId:N}")` is called AFTER the Serializable TX commits (not before).
  - [ ] 5.3 Update `CreditLedgerServiceTests` to assert the `UsageEvent` row is created by `SpendAsync`.

- [ ] **Task 6: BFF — cache invalidation on subscription events (AC: 1)**
  - [ ] 6.1 In `BillingEndpoints.DispatchAsync`, inject `IMemoryCache cache`. After `SubscriptionMirrorService.UpsertAsync` succeeds for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_succeeded` — call `cache.Remove($"ent:{userId:N}")`. Derive `userId` from the existing customer lookup.

- [ ] **Task 7: BFF — results-forever test (AC: 4)**
  - [ ] 7.1 Verify by code review that `GetStatus` and results handlers do NOT inject `EntitlementService`.
  - [ ] 7.2 Write `ResultsReadPathEntitlementFreeTest.cs`: register a counting-spy `EntitlementService`, seed a free user with 3 used analyses + completed job, call `GET /api/jobs/{id}` and results endpoint, assert 200 AND spy call count == 0.

- [ ] **Task 8: README (AC: 1)**
  - [ ] 8.1 Update `components/bff/README.md` Billing section: (a) story 2.3 deferred user-secrets lines for `Stripe:PriceCreditPack5/10`; (b) feature-flag override instructions; (c) entitlement resolver description.

- [ ] **Task 9: Frontend — types + hook (AC: 1)**
  - [ ] 9.1 Add `EntitlementsDto` to `src/api/types.ts`: `{ analysesRemaining: number | null; coachRemaining: number; stemsEnabled: boolean; alsEnabled: boolean; fullVerdictsEnabled: boolean; historyDepth: number | null; tier: 'free' | 'credits' | 'pro'; }`.
  - [ ] 9.2 Add `useEntitlements()` to `src/api/hooks.ts`: key `["me", "entitlements"]`, `staleTime: 30_000`.

- [ ] **Task 10: Frontend — handle `entitlement_exhausted` (AC: 2)**
  - [ ] 10.1 `UnifiedUploadDialog.tsx`: call `useEntitlements()`. If `analysesRemaining === 0` at dispatch step, show inline error with text links to `/_app/usage` and `/_app/billing`. No UpgradeSheet — that is story 2.7.
  - [ ] 10.2 Catch 409 `entitlement_exhausted` from the dispatch API response (server-side gate) and surface same inline error via `extractApiError(err).code === 'entitlement_exhausted'`.
  - [ ] 10.3 In `ReportView.tsx` `handleReanalyze`: catch `entitlement_exhausted` code from re-analyze mutation, call `toast.error('You have used all your analyses for this period.')`.

- [ ] **Task 11: Tests (AC: all)**
  - [ ] 11.1 `EntitlementServiceTests.cs`: (a) free 0 used -> remaining=3; (b) free 3 used -> remaining=0; (c) credits balance=2 -> tier="credits", remaining=2; (d) Pro active -> remaining=null, tier="pro"; (e) Pro past_due -> tier="pro"; (f) InvalidateAsync clears cache; (g) feature flag free_analyses_per_month=5 overrides.
  - [ ] 11.2 `DispatchEntitlementGateTests.cs`: (a) free user 2 used -> succeeds, tier="free" on job, usage_events row; (b) free user 3 used -> 409 entitlement_exhausted, no rows; (c) credits balance=1 -> succeeds, tier="credits", credit_ledger -1, usage_events row; (d) credits balance=0 -> 409; (e) Pro always succeeds; (f) concurrent credits dispatches with balance=1 -> exactly one succeeds.
  - [ ] 11.3 `ResultsReadPathEntitlementFreeTest.cs` — Task 7.2.
  - [ ] 11.4 Frontend: `entitlements-hook.test.ts` (staleTime assertion, DTO mapping); `upload-dialog-entitlement.test.tsx` (inline error state when remaining=0).

## Dev Notes

### Tier derivation table

| Tier | Condition | `analyses_remaining` | Features |
|---|---|---|---|
| `"pro"` | sub status `IN ('active','past_due')` | `null` (unlimited) | all enabled, `history_depth=null` |
| `"credits"` | no active sub AND credit_balance >= 1 | `creditBalance` | all enabled, `history_depth=30` |
| `"free"` | all other cases | `max(0, cap - usedThisPeriod)` | stems=false, als=false, full_verdicts=false, `history_depth=10` |

`"past_due"` counts as Pro — story 2.9 owns dunning. Treating `past_due` as Free breaks paying customers mid-retry.

### Architecture sources

- **AR12** (epics.md line 181): "`Entitlements.For(user)` pure function … cached 60 s, invalidated on webhook/spend."
- **AR13** (epics.md line 182): "BFF stamps tier at dispatch; worker never reads billing tables."
- **AR15** (epics.md line 184): "Read access to existing reports never entitlement-checked."
- **AR16** (epics.md line 185): "Usage event written at dispatch; refunded on validation-fail — never UPDATE."
- **AR35** (epics.md line 216): "`feature_flags` table cached 60 s."
- **AR38** (epics.md line 222): "Stable error codes; frontend keys off code, not message."
- **D2 line 95** (architecture.md): Full resolver spec.

### Existing patterns to reuse

- `ErrorEnvelope.Build` — new code: `entitlement_exhausted` (409); `entitlements_unavailable` (503). Existing: `insufficient_credits` (409).
- `IMemoryCache` — confirm registered; add if absent.
- `extractApiError` from `api/error-utils.ts` (story 2.2).
- TanStack `staleTime: 30_000` — story 2.2 review-fix P28.
- `WebApplicationFactory` + `PostgresReachable()` silent-skip — consistent with existing BFF test classes.

### Out of scope

- UpgradeSheet / BlurLock (story 2.7)
- UsageMeter nav (story 2.8)
- `coach_pro_monthly` pooled cap (story 2.6 — falls back to int.MaxValue here)
- Worker queue routing by tier (story 2.5)
- Admin endpoint for feature_flags (Epic 10)
- `history_depth` query truncation (story 2.7)
- Anonymous / device-scoped entitlements (Epic 5)

### Project structure notes

**New BFF files:** `FeatureFlag.cs`, `<ts>_AddFeatureFlagsAndJobTier.cs` (+ Designer), `EntitlementService.cs`, `EntitlementServiceTests.cs`, `DispatchEntitlementGateTests.cs`, `ResultsReadPathEntitlementFreeTest.cs`.

**Modified BFF files:** `AnalysisJob.cs` (Tier), `AppDbContext.cs` (DbSet<FeatureFlag>), `BillingDtos.cs` (EntitlementsDto), `MeEndpoints.cs` (GetEntitlements), `VersionEndpoints.cs` (DispatchAnalysisAsync + 5 sites), `BillingEndpoints.cs` (cache invalidation), `CreditLedgerService.cs` (SpendAsync extended + cache invalidation), `Program.cs` (register EntitlementService; remove CreditSpendEnabled), `appsettings.json` (remove CreditSpendEnabled), `README.md`.

**New frontend files:** `entitlements-hook.test.ts`, `upload-dialog-entitlement.test.tsx`.

**Modified frontend files:** `types.ts` (EntitlementsDto), `hooks.ts` (useEntitlements), `UnifiedUploadDialog.tsx` (inline error), `ReportView.tsx` (toast on re-analyze gate).

**No worker changes.** Worker reads `analysis_jobs.tier` in story 2.5.

### Testing standards

- BFF baseline: **100 tests** (story 2.3). Adds ~12.
- Frontend baseline: **189 vitest** (story 2.3). Adds ~4.
- Four frontend gates: `tsc --noEmit`, `npm run lint --max-warnings 0`, `npm run build`, `npx vitest run`.

### References

- [Source: PRPs/epics.md#Story 2.4 (lines 588-601)]
- [Source: PRPs/epics.md#AR12-AR16, AR35, AR38]
- [Source: PRPs/architecture.md line 95] D2 entitlement resolver spec
- [Source: PRPs/stories/2-3-buy-credits-with-append-only-ledger.md] CreditLedgerService, SpendAsync TX, CreditSpendEnabled (removed here)
- [Source: PRPs/stories/2-1-subscribe-to-pro-via-stripe-checkout.md] ErrorEnvelope.Build, IMemoryCache, webhook structure
- [Source: PRPs/stories/2-2-manage-subscription-self-service.md] TanStack staleTime, extractApiMessage
- [Source: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs] 5 dispatch sites
- [Source: components/bff/src/Spectr.Data/Entities/AnalysisJob.cs] Entity shape
