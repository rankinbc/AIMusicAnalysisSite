# Story 2.4: Server-Side Entitlements & Metering

Status: done

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

- [x] **Task 1: Schema — `feature_flags` table + `analysis_jobs.tier` column + migration (AC: 1, 2, 3)**
  - [x] 1.1 Create `Spectr.Data/Entities/FeatureFlag.cs`. Fields: `string Name` (PK, text), `string Value` (text, NOT NULL), `DateTimeOffset UpdatedAt` (default `now()`). Append `DbSet<FeatureFlag> FeatureFlags` to `AppDbContext`; configure in `OnModelCreating` (snake_case Npgsql convention; PK on `name`).
  - [x] 1.2 Add `[Column("tier"), MaxLength(16)]` nullable `string? Tier` to `AnalysisJob` entity. Values: `"free"` / `"credits"` / `"pro"`; null for rows predating this story.
  - [x] 1.3 Generate migration `AddFeatureFlagsAndJobTier` via `dotnet ef migrations add ... --project src/Spectr.Data --startup-project src/Spectr.Bff`. Append raw SQL to `Up()` for: (a) `CREATE TABLE IF NOT EXISTS feature_flags ...`; (b) `ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS tier text NULL`; (c) seed initial flags with `INSERT ON CONFLICT DO NOTHING` for `free_analyses_per_month=3`, `coach_free_followups=3`, `history_depth_free=10`, `history_depth_credits=30`. Add rollback in `Down()`.

- [x] **Task 2: BFF — `EntitlementService` (the resolver) (AC: 1, 2, 3)**
  - [x] 2.1 Create `Services/EntitlementService.cs`. Inject `AppDbContext` (scoped), `IMemoryCache`. Public method: `Task<EntitlementsDto> ForAsync(Guid userId, CancellationToken ct)`. Cache key `ent:{userId:N}`, 60 s absolute TTL. On cache miss, compute from DB.
  - [x] 2.2 `EntitlementsDto` record in `DTOs/BillingDtos.cs`: `int? AnalysesRemaining` (null = unlimited), `int CoachRemaining`, `bool StemsEnabled`, `bool AlsEnabled`, `bool FullVerdictsEnabled`, `int? HistoryDepth` (null = unlimited), `string Tier`.
  - [x] 2.3 Resolver logic (no Stripe API calls): (1) query `subscriptions` most-recent row for user; `isPro = status IN ('active','past_due')`. (2) `SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE user_id=@uid`. (3) count `usage_events` for current `billing_period` (YYYY-MM) and event_type='analysis'. (4) read feature flags via `GetFlagsAsync` (cache key `feature_flags_global`, 60 s). (5) derive tier — see table in Dev Notes.
  - [x] 2.4 `InvalidateAsync(Guid userId)` public method: `_cache.Remove($"ent:{userId:N}")`. Called from `CreditLedgerService.SpendAsync` and `PurchaseAsync` after commit. Called from webhook handler on subscription events (Task 6).
  - [x] 2.5 Register `AddScoped<EntitlementService>()` in `Program.cs`. `AddMemoryCache()` already present.

- [x] **Task 3: BFF — `GET /api/me/entitlements` endpoint (AC: 1)**
  - [x] 3.1 Add handler at `GET /api/me/entitlements`, `.RequireAuthorization()`. Returns `EntitlementsDto`. On DB error, return 503 `entitlements_unavailable` via `ErrorEnvelope.Build`. Response: `Cache-Control: no-cache`.

- [x] **Task 4: BFF — dispatch-path entitlement gate + tier stamp (AC: 2, 3)**
  - [x] 4.1 Add private static helper `DispatchAnalysisAsync(...)` to `VersionEndpoints.cs`.
  - [x] 4.2 Helper sequence: (1) `var ent = await ents.ForAsync(userId, ct)`. (2) If `ent.AnalysesRemaining == 0` return 409 `entitlement_exhausted`. (3) For `"free"` and `"pro"` tiers: implicit EF TX, INSERT `AnalysisJob` with `Tier=ent.Tier` + INSERT `UsageEvent`, SaveChanges, THEN enqueue. (4) For `"credits"` tier: INSERT `AnalysisJob` with `Tier="credits"`, call `CreditLedgerService.SpendAsync` (serializable TX). On `InsufficientCreditsException`: mark job failed, return 409 `insufficient_credits`. THEN enqueue on success.
  - [x] 4.3 Replace all 5 `EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, ...)` call sites in `VersionEndpoints.cs` with calls to `DispatchAnalysisAsync`. Thread `EntitlementService ents` and `CreditLedgerService credits` as DI parameters in affected handlers.
  - [x] 4.4 Remove the `CreditSpendEnabled` feature-flag branch and `appsettings.json` entry from story 2.3.

- [x] **Task 5: BFF — `SpendAsync` already writes `UsageEvent` (AC: 3)**
  - [x] 5.1 `CreditLedgerService.SpendAsync` already accepts `billingPeriod` and INSERTs matching `UsageEvent` inside its Serializable TX (implemented in story 2.3). Verified no change needed.
  - [x] 5.2 Confirmed `cache.Remove($"ent:{userId:N}")` is called AFTER the Serializable TX commits in `SpendOnceAsync`.

- [x] **Task 6: BFF — cache invalidation on subscription events (AC: 1)**
  - [x] 6.1 In `BillingEndpoints.DispatchAsync`, inject `IMemoryCache cache`. After `SubscriptionMirrorService.ApplyAsync` succeeds for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` — call `cache.Remove($"ent:{resolvedUserId.Value:N}")`.

- [x] **Task 7: BFF — results-forever test (AC: 4)**
  - [x] 7.1 Verified by code inspection that `GetStatus` and results handlers do NOT inject `EntitlementService`.
  - [x] 7.2 `ResultsReadPathEntitlementFreeTest.cs`: counting-spy `EntitlementService` subclass registered in DI; seeds free user with 3 used analyses + completed job; calls `GET /api/jobs/{id}` and `GET /api/jobs/{id}/results`; asserts 200 AND spy call count == 0.

- [x] **Task 8: README (AC: 1)**
  - [x] 8.1 Updated `components/bff/README.md` Billing section: (a) story 2.3 deferred user-secrets lines for `Stripe:PriceCreditPack5/10`; (b) feature-flag override instructions; (c) entitlement resolver description with tier table and AR15 guarantee.

- [x] **Task 9: Frontend — types + hook (AC: 1)**
  - [x] 9.1 Added `EntitlementsDto` to `src/api/types.ts`: `{ analysesRemaining: number | null; coachRemaining: number; stemsEnabled: boolean; alsEnabled: boolean; fullVerdictsEnabled: boolean; historyDepth: number | null; tier: 'free' | 'credits' | 'pro'; }`.
  - [x] 9.2 Added `useEntitlements()` to `src/api/hooks.ts`: key `["me", "entitlements"]`, `staleTime: 30_000`.

- [x] **Task 10: Frontend — handle `entitlement_exhausted` (AC: 2)**
  - [x] 10.1 `UnifiedUploadDialog.tsx`: calls `useEntitlements()`. If `analysesRemaining === 0` at dispatch step, shows inline error with text links to `/_app/usage` and `/_app/billing`.
  - [x] 10.2 Catches 409 `entitlement_exhausted` from dispatch API response; surfaces same inline error via `extractApiError(err).code === 'entitlement_exhausted'`.
  - [x] 10.3 In `ReportView.tsx` `handleReanalyze`: catches `entitlement_exhausted` code from re-analyze mutation, calls `toast.error('You have used all your analyses for this period.')`.

- [x] **Task 11: Tests (AC: all)**
  - [x] 11.1 `EntitlementServiceTests.cs`: 7 cases — free 0 used, free 3 used exhausted, credits balance=2, pro active, pro past_due, InvalidateAsync clears cache, flag free_analyses_per_month=5 override.
  - [x] 11.2 `DispatchEntitlementGateTests.cs`: 6 cases — free 2 used succeeds (tier=free, usage row), free 3 used 409, credits balance=1 succeeds (tier=credits, ledger -1, usage row), credits balance=0 409, pro always succeeds, concurrent credits drains to 0 (one spend row).
  - [x] 11.3 `ResultsReadPathEntitlementFreeTest.cs` — AC4 / AR15 assertion.
  - [x] 11.4 Frontend: `entitlements-hook.test.ts` (staleTime, DTO mapping); `upload-dialog-entitlement.test.tsx` (inline error when remaining=0).

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

### Out of scope

- UpgradeSheet / BlurLock (story 2.7)
- UsageMeter nav (story 2.8)
- `coach_pro_monthly` pooled cap (story 2.6)
- Worker queue routing by tier (story 2.5)
- Admin endpoint for feature_flags (Epic 10)
- `history_depth` query truncation (story 2.7)
- Anonymous / device-scoped entitlements (Epic 5)

## Dev Agent Record

### Implementation Notes

- `FeatureFlag.cs` entity + `AppDbContext.FeatureFlags` DbSet created; migration `AddFeatureFlagsAndJobTier` seeds 4 operator flags.
- `AnalysisJob.Tier` (nullable, max 16) stamps tier at dispatch for worker (AR13).
- `EntitlementService` is `virtual`/non-sealed so the results-forever test can subclass it with a counting spy without Moq.
- `DispatchAnalysisAsync` is the single authoritative dispatch path — all 5 `AnalyzeAudioJob` enqueue sites in `VersionEndpoints.cs` route through it (Reanalyze, UploadVersion, UploadStems, UploadAls, ConfirmStems).
- Credits path: job inserted first (outside serializable TX), then `SpendAsync` atomically writes `credit_ledger -1 + usage_events` in a serializable TX. On `InsufficientCreditsException` (race), job is marked failed before returning 409.
- Free/Pro path: single `SaveChangesAsync` (implicit EF TX) inserts both `AnalysisJob` and `UsageEvent` atomically, then enqueues.
- Cache invalidation wired in: `CreditLedgerService.PurchaseAsync`, `CreditLedgerService.SpendOnceAsync`, and `BillingEndpoints.DispatchAsync` (subscription webhook events).
- `CreditSpendEnabled` flag removed entirely from `appsettings.json` and codebase.
- Frontend: `useEntitlements()` hook with `staleTime: 30_000`; `UnifiedUploadDialog` shows inline error on `analysesRemaining === 0` or 409 `entitlement_exhausted`; `ReportView` toasts on re-analyze gate.

### Test Results

- BFF: 118/118 passed (baseline 100 + 18 new: 7 EntitlementService + 6 DispatchGate + 1 ResultsForever + 4 existing suite)
- Frontend vitest: 201/201 passed (baseline 189 + 12 new)
- `tsc --noEmit`: clean
- `npm run lint --max-warnings 0`: clean
- `npm run build`: clean

## File List

**New BFF files:**
- `components/bff/src/Spectr.Data/Entities/FeatureFlag.cs`
- `components/bff/src/Spectr.Data/Migrations/20260616052555_AddFeatureFlagsAndJobTier.cs`
- `components/bff/src/Spectr.Data/Migrations/20260616052555_AddFeatureFlagsAndJobTier.Designer.cs`
- `components/bff/src/Spectr.Bff/Services/EntitlementService.cs`
- `components/bff/tests/Spectr.Bff.Tests/EntitlementServiceTests.cs`
- `components/bff/tests/Spectr.Bff.Tests/DispatchEntitlementGateTests.cs`
- `components/bff/tests/Spectr.Bff.Tests/ResultsReadPathEntitlementFreeTest.cs`

**Modified BFF files:**
- `components/bff/src/Spectr.Data/Entities/AnalysisJob.cs` (Tier column)
- `components/bff/src/Spectr.Data/AppDbContext.cs` (DbSet<FeatureFlag>, feature_flags config)
- `components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs` (EntitlementsDto)
- `components/bff/src/Spectr.Bff/Endpoints/MeEndpoints.cs` (GET /me/entitlements)
- `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs` (DispatchAnalysisAsync + 5 sites)
- `components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs` (cache invalidation on sub events)
- `components/bff/src/Spectr.Bff/Services/CreditLedgerService.cs` (cache.Remove in PurchaseAsync + SpendOnceAsync)
- `components/bff/src/Spectr.Bff/Program.cs` (AddScoped<EntitlementService>; CreditSpendEnabled removed)
- `components/bff/src/Spectr.Bff/appsettings.json` (CreditSpendEnabled removed)
- `components/bff/README.md` (Billing section — entitlements + feature flags + credit pack secrets)

**New frontend files:**
- `components/frontend-spectr-v2/src/api/__tests__/entitlements-hook.test.ts`
- `components/frontend-spectr-v2/src/components/__tests__/upload-dialog-entitlement.test.tsx`

**Modified frontend files:**
- `components/frontend-spectr-v2/src/api/types.ts` (EntitlementsDto)
- `components/frontend-spectr-v2/src/api/hooks.ts` (useEntitlements)
- `components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx` (inline error gate)
- `components/frontend-spectr-v2/src/features/results/ReportView.tsx` (toast on re-analyze gate)

## Change Log

- 2026-06-16: Story 2.4 implemented. EntitlementService + 60s IMemoryCache; analysis_jobs.tier migration; DispatchAnalysisAsync wired to all 5 dispatch sites; GET /api/me/entitlements; cache invalidation on credit spend/purchase and subscription webhooks; results-forever guarantee tested (AR15); frontend useEntitlements hook + upload gate. CreditSpendEnabled flag removed. BFF 118/118, frontend 201/201.
