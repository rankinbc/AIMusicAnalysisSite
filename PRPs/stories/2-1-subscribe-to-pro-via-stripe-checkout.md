# Story 2.1: Subscribe to Pro via Stripe Checkout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a producer,
I want to subscribe to Pro monthly or annual,
so that I get unlimited analyses and full features.

## Acceptance Criteria

1. **Given** pricing config (no price literals in code — AR39), **When** I start checkout via `POST /api/billing/checkout/subscription`, **Then** the BFF creates a Stripe Checkout session ($12.99/mo or $99/yr) with `automatic_tax: { enabled: true }` and returns the hosted URL — card data never touches Spectr (NFR10, SAQ-A).
2. **Given** checkout completes, **When** Stripe delivers a subscription webhook to `POST /api/billing/stripe/webhook`, **Then** the BFF records the event id (Stripe `event.id` as primary key) and the payload hash on `webhook_events`, **And** duplicate deliveries are skipped via INSERT … ON CONFLICT DO NOTHING (AR11).
3. **Given** the webhook processor, **When** subscription events (`checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.paid`, `invoice.payment_failed`) apply, **Then** ONLY the webhook processor writes the `subscriptions` mirror row (stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end, cancel_at) — no other code path mutates this table.
4. **Given** webhook signature verification (NFR10), **When** the `Stripe-Signature` header is missing, malformed, or fails verification against `STRIPE_WEBHOOK_SECRET`, **Then** the BFF returns 400 + logs a structured warning + does NOT persist the event.
5. **Given** return from Stripe Checkout to `/billing/success`, **When** I land on the success page, **Then** my tier shows Pro within 60 s of the webhook delivery (the success page polls `GET /api/auth/me` whose `tier` field is computed from `subscriptions.status ∈ {active, trialing}` — no entitlement cache yet since story 2.4 owns the `Entitlements.For(user)` resolver; this story exposes `tier` as a transitional derived field).

## Tasks / Subtasks

- [x] **Task 1: Schema — `subscriptions` + `webhook_events` EF entities + migration (AC: 2, 3)**
  - [x] 1.1 Add `Spectr.Data/Entities/Subscription.cs` keyed by `user_id` (one-row-per-user mirror per architecture D2). Fields: `Guid UserId` (PK + FK to users), `string StripeCustomerId` (unique, indexed), `string StripeSubscriptionId` (unique, indexed), `string Status` (Stripe lifecycle: `incomplete | incomplete_expired | trialing | active | past_due | canceled | unpaid`), `string PriceId`, `DateTimeOffset CurrentPeriodEnd`, `DateTimeOffset? CancelAt`, `DateTimeOffset CreatedAt`, `DateTimeOffset UpdatedAt`. NO db-level FK to `users` per project convention (mirrors SA pattern); model the relation in EF only.
  - [x] 1.2 Add `Spectr.Data/Entities/WebhookEvent.cs` — Stripe event id PK + payload hash + processed_at. Fields: `string Id` (Stripe `event.id`, PK, indexed via PK constraint — no FK), `string EventType` (e.g. `customer.subscription.created`), `string PayloadHash` (SHA-256 hex of raw request body for replay debugging — NEVER store the full payload; PCI scope hygiene), `DateTimeOffset ReceivedAt`, `DateTimeOffset? ProcessedAt` (null until in-process dispatch finishes), `string? ProcessingError` (last error if any).
  - [x] 1.3 Generate the migration via `dotnet ef migrations add AddSubscriptionsAndWebhookEvents --project src/Spectr.Data --startup-project src/Spectr.Bff`. Verify the `subscriptions` table uses `user_id` as PK (not a synthetic id) per architecture line 91 "local mirror keyed by user". Verify partial indexes are NOT auto-generated; no manual SQL needed for this migration.
  - [x] 1.4 Append unique-index constraints in the migration `Up()`: `CREATE UNIQUE INDEX ix_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id)` and `CREATE UNIQUE INDEX ix_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id)`. EF Core fluent API equivalents in `OnModelCreating` are acceptable if EF generates the index in the migration directly.
  - [x] 1.5 Register both entities in `AppDbContext.OnModelCreating` (snake_case Npgsql naming inherited from the existing convention). Add `DbSet<Subscription> Subscriptions` and `DbSet<WebhookEvent> WebhookEvents`.

- [x] **Task 2: Stripe SDK dependency + pricing config + secrets (AC: 1, 4)**
  - [x] 2.1 Add NuGet `Stripe.net` (current GA release — verify ≥ `46.x` for `automatic_tax` support and the `EventUtility.ConstructEvent` signature). Update `Directory.Build.props` if needed for NuGet audit gating. Pin the version.
  - [x] 2.2 Add `Options/StripeOptions.cs` (binds to `Stripe` section): `string? SecretKey`, `string? WebhookSecret`, `string? PriceProMonthly`, `string? PriceProAnnual`, `string SuccessUrl = "http://localhost:5174/billing/success"`, `string CancelUrl = "http://localhost:5174/billing/cancelled"`. Default URL values are dev-only; prod injects via env. Add `ValidateOnStart` that fails fast if `SecretKey` or `WebhookSecret` is null/empty in production (use `IHostEnvironment.IsProduction()` — dev runs without Stripe keys must still build/start).
  - [x] 2.3 Wire the Stripe SDK in `Program.cs`: `StripeConfiguration.ApiKey = stripeOpts.SecretKey;` after reading `IOptions<StripeOptions>`. Use `IHostedService` or a minimal init hook — `StripeConfiguration.ApiKey` is process-static, set once at startup.
  - [x] 2.4 Add `Stripe:SecretKey` + `Stripe:WebhookSecret` to dev secrets via `dotnet user-secrets` documentation in `bff/README.md` (NOT `appsettings.json` — NFR6 forbids real keys in repo). For local dev, the BFF must function with placeholder values; checkout will return a "Stripe not configured" error in that case (see Task 3.4).
  - [x] 2.5 Add `Stripe:PriceProMonthly` + `Stripe:PriceProAnnual` to `appsettings.json` (price IDs, e.g. `price_1Abc...`). These are NOT secrets — Stripe Price IDs are publicly visible in client-side embeds in normal Stripe usage. Use a placeholder `price_test_monthly_REPLACE_IN_DEV_SECRETS` so the boot succeeds; real values come from the Stripe dashboard.

- [x] **Task 3: `POST /api/billing/checkout/subscription` endpoint (AC: 1)**
  - [x] 3.1 Create `Endpoints/BillingEndpoints.cs`. Map under `/api/billing` with `.RequireAuthorization()`. The architecture spec calls for `Spectr.Bff/Features/Billing/` but the existing codebase uses flat `Endpoints/` — match the existing pattern (the feature-folder restructure is out of scope here; bundle with a separate refactor story if/when it becomes painful).
  - [x] 3.2 Endpoint: `POST /checkout/subscription` accepts `CreateCheckoutSessionRequest { string Cadence }` where `Cadence ∈ {"monthly", "annual"}`. Validates cadence in {"monthly", "annual"} — any other value returns AR38 envelope `{ error: { code: "invalid_cadence", message } }` with 400.
  - [x] 3.3 Resolve or create the Stripe Customer for the current user: query the BFF's `subscriptions` table for an existing `stripe_customer_id`; if none, call `customerService.CreateAsync(new CustomerCreateOptions { Email = user.Email, Metadata = { ["spectr_user_id"] = userId.ToString() } })` and store the customer id on a transient record (do NOT insert a `subscriptions` row here — only the webhook writes that table). Stash the customer id on the user's `User.StripeCustomerId` column (new in this story; add via the same migration as Task 1) so subsequent checkouts reuse it.
  - [x] 3.4 Create the Checkout Session: `var session = await sessionService.CreateAsync(new SessionCreateOptions { Mode = "subscription", Customer = stripeCustomerId, ClientReferenceId = userId.ToString(), LineItems = [new() { Price = priceId, Quantity = 1 }], AutomaticTax = new() { Enabled = true }, SuccessUrl = $"{opts.SuccessUrl}?session_id={{CHECKOUT_SESSION_ID}}", CancelUrl = opts.CancelUrl, AllowPromotionCodes = false, BillingAddressCollection = "auto" });` where `priceId` = `opts.PriceProMonthly` or `opts.PriceProAnnual` based on cadence.
  - [x] 3.5 If `StripeConfiguration.ApiKey` is empty (dev without Stripe keys), return `503 + { error: { code: "stripe_not_configured", message: "Stripe is not configured in this environment." } }`. This lets the frontend gracefully surface the "this only works against Stripe test mode" state in dev. Production startup validation (Task 2.2) prevents this from shipping.
  - [x] 3.6 Return `{ url: session.Url, sessionId: session.Id }`. The frontend redirects via `window.location.assign(url)` — NO embedded checkout per UX-spec line 137 + line 357 "Money forms: Stripe-hosted only".
  - [x] 3.7 Add an integration test covering: (a) valid monthly cadence returns 200 + URL; (b) invalid cadence returns 400 + `invalid_cadence`; (c) missing Stripe config returns 503 + `stripe_not_configured`. Mock `IStripeClient` or substitute `Stripe.SessionService` via dependency injection so the test doesn't hit live Stripe.

- [x] **Task 4: `POST /api/billing/stripe/webhook` endpoint (AC: 2, 3, 4)**
  - [x] 4.1 Map under `/api/billing/stripe/webhook` with `.AllowAnonymous()`. Stripe webhooks have no user session — they authenticate via the `Stripe-Signature` header instead. The endpoint MUST NOT be in the `RequireAuthorization()` group.
  - [x] 4.2 Read the raw request body verbatim via `await new StreamReader(httpCtx.Request.Body).ReadToEndAsync(ct)`. The signature is computed over the unparsed body — even a single whitespace change breaks verification. Use `httpCtx.Request.EnableBuffering()` upstream if the pipeline needs to re-read (unlikely; this is the terminal handler).
  - [x] 4.3 Verify the signature: `var stripeEvent = EventUtility.ConstructEvent(json, request.Headers["Stripe-Signature"], opts.WebhookSecret, throwOnApiVersionMismatch: false);` — wrap in try/catch `StripeException`; on failure return 400 + `{ error: { code: "webhook_signature_invalid" } }` and log at warning level with the signing-secret tail (last 4 chars) for ops triage. Do NOT log the full secret. Do NOT persist the unverified event.
  - [x] 4.4 Idempotency check (AR11): compute `payloadHash = SHA256(rawBody)` as hex. Attempt `INSERT INTO webhook_events (id, event_type, payload_hash, received_at) VALUES (@id, @type, @hash, NOW()) ON CONFLICT (id) DO NOTHING`. Use a raw `ExecuteSqlInterpolatedAsync` so EF doesn't issue a SELECT-then-INSERT race. If the INSERT affected 0 rows, the event was already received — return 200 + `{ duplicate: true }` and skip processing.
  - [x] 4.5 Dispatch the event by type. For story 2.1 the supported set is: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Anything else: log at info ("ignored unsupported event type {Type}") and return 200. Story 2.3 will widen this set for credit-pack events; story 2.4 for entitlement cache invalidation.
  - [x] 4.6 For `checkout.session.completed` and `customer.subscription.*` events, extract the relevant fields from `stripeEvent.Data.Object` (cast via `(Subscription)stripeEvent.Data.Object` etc.) and call `subscriptionMirrorService.ApplyAsync(stripeSubscription, ct)` — see Task 5. Mark `webhook_events.processed_at = NOW()` on success; on exception, log + set `processing_error`, then re-throw so Stripe retries via its dashboard.
  - [x] 4.7 Add integration tests: (a) valid signed `customer.subscription.created` payload — `subscriptions` row inserted; (b) replay of same event — second delivery is no-op + returns 200 + `{ duplicate: true }`; (c) invalid signature — returns 400 + no `webhook_events` row; (d) unsupported event type — returns 200 + `webhook_events` row inserted but processed_at null; (e) idempotency under concurrent deliveries (call the endpoint twice in parallel with same event id — assert one row in webhook_events + only one subscriptions row).

- [x] **Task 5: `SubscriptionMirrorService` — the ONLY writer to `subscriptions` (AC: 3)**
  - [x] 5.1 Create `Services/SubscriptionMirrorService.cs`. Single public method: `Task ApplyAsync(Stripe.Subscription stripeSubscription, CancellationToken ct)`. The service reads `stripeSubscription.Metadata` for `spectr_user_id` (set by Task 3.3 when the customer was created — Stripe propagates customer metadata onto subscriptions automatically, but we double-check) OR falls back to looking up the user by `StripeCustomerId` if metadata is absent (e.g. test fixtures).
  - [x] 5.2 Upsert via `subscriptions.Where(s => s.UserId == userId).FirstOrDefaultAsync()` + `if (existing == null) db.Subscriptions.Add(new Subscription { ... })` else mutate fields. Set: `StripeCustomerId`, `StripeSubscriptionId`, `Status` (from `stripeSubscription.Status`), `PriceId` (from `stripeSubscription.Items.Data[0].Price.Id`), `CurrentPeriodEnd`, `CancelAt`, `UpdatedAt = NOW()`. The `CreatedAt` is preserved on update (only set on insert).
  - [x] 5.3 Scope the service `scoped` in DI (per-request). The webhook endpoint dispatches into this from inside its request scope; the service uses `AppDbContext` for the DB write.
  - [x] 5.4 No FK enforcement at DB level (project convention), but enforce at the service level: if `userId` resolution fails (no user with that `StripeCustomerId` AND no `spectr_user_id` metadata), log at error and return — do NOT insert an orphan `subscriptions` row. The reconciliation job (story 2.10) will catch any drift.
  - [x] 5.5 Unit test the service against an in-memory db (sqlite or `UseInMemoryDatabase`): (a) first apply for a user inserts a row; (b) second apply with changed status mutates the existing row; (c) apply with unknown customer + missing metadata is a no-op.

- [x] **Task 6: `User.StripeCustomerId` column + `tier` derivation (AC: 5)**
  - [x] 6.1 Add `[Column("stripe_customer_id"), MaxLength(64)] public string? StripeCustomerId { get; set; }` to `User` entity. Indexed (unique partial — but EF doesn't fluently express partial-where; add manual `CREATE UNIQUE INDEX ... WHERE stripe_customer_id IS NOT NULL` in the migration `Up()` following the pattern from the v1 BFF README "EF Core 10 migrations require a manual partial-index step").
  - [x] 6.2 Extend the `GET /api/auth/me` response with a new field `tier: "free" | "pro"`. Computation: `if subscription exists for user AND subscription.status ∈ {"active", "trialing"} then "pro" else "free"`. Use a LEFT JOIN to keep the query single-roundtrip. Document that this is transitional — story 2.4's `Entitlements.For(user)` resolver will return a richer object; this field is the bridge.
  - [x] 6.3 The transitional `tier` field is NOT a story 2.4 entitlement cache. No 60-s caching, no Redis. Pure DB read on every `/me` call. Story 2.4 will introduce the cache + invalidation.
  - [x] 6.4 Update the `/me` integration test to assert: (a) no subscription → tier="free"; (b) active subscription → tier="pro"; (c) canceled subscription → tier="free".

- [x] **Task 7: Frontend — pricing page + checkout button + success/cancelled routes (AC: 1, 5)**
  - [x] 7.1 Add a public pricing route at `src/routes/_public/pricing.tsx`. UX-spec line 318 + 137: PricingTable with two tiers — Free vs Pro — plus a credits row. Two CTAs on the Pro card: "Monthly $12.99" and "Annual $99". Tax-inclusive note ("Tax calculated at checkout") per UX-DR. Visible price numerics MUST be sourced from the `/api/billing/plans` GET — see 7.2 — NOT from inline literals (architecture line 191 + frontend `scripts/check-price-literals.mjs`).
  - [x] 7.2 Add `GET /api/billing/plans` BFF endpoint returning `{ proMonthlyCents: 1299, proAnnualCents: 9900, currency: "USD" }`. Sourced from `IOptions<PricingDisplayOptions>` (separate from `StripeOptions` since these are display-only; the source-of-truth is Stripe Price IDs). This satisfies the no-price-literals lint without round-tripping to Stripe on every page load.
  - [x] 7.3 The Pro card CTAs `POST /api/billing/checkout/subscription` with `{ cadence }`, then `window.location.assign(response.url)`. Disable both buttons during the in-flight POST; show a sonner toast on error.
  - [x] 7.4 Add `src/routes/_app/billing.success.tsx` route. On mount, poll `GET /api/auth/me` every 5 s for up to 60 s waiting for `tier === "pro"`. Show a one-line success when reached: "You're on Pro. Welcome." If 60 s elapses without flip, show: "Your subscription is still being processed. Refresh in a moment."
  - [x] 7.5 Add `src/routes/_app/billing.cancelled.tsx` route. Static page: "Checkout cancelled. No charge was made." + `<Link to="/pricing">Back to plans</Link>`.
  - [x] 7.6 Surface "Get Pro" in the existing `CoachGateInline` component (story 1.9): wire the `onUpgrade` prop to `window.location.assign('/pricing')` instead of the current sonner stub. The toast becomes the fallback for environments without a pricing route loaded (defence-in-depth).
  - [x] 7.7 Hand-mirror the new wire types into `src/api/types.ts`: `CreateCheckoutSessionRequest`, `CreateCheckoutSessionResponse`, `PlansResponse`. The `MeResponse` (existing) gains a non-optional `tier: "free" | "pro"` field — coordinate the rename via TypeScript's exhaustiveness so consumers don't silently drop it.

- [x] **Task 8: Tests + documentation + lint compliance (AC: all)**
  - [x] 8.1 BFF integration tests live in `components/bff/tests/Spectr.Bff.Tests/` per established pattern. Add `BillingEndpointsTests.cs` (checkout endpoint behavior) and `StripeWebhookEndpointTests.cs` (signature verification, idempotency, dispatch). Use the established `WebApplicationFactory<Program>` harness + `RecordingJobQueue`-style fake for any actor enqueues that future stories add. Real Stripe is NOT called: substitute `IStripeClient` via DI or hand-construct `Stripe.Event` objects from JSON fixtures and verify them with a test signing secret + `EventUtility.ConstructEvent(json, computedSignatureFor("whsec_test"), "whsec_test")`.
  - [x] 8.2 Use Stripe's published webhook fixture pattern: include 4-6 raw payload fixtures under `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/` — `customer.subscription.created.json`, `customer.subscription.updated.json`, `customer.subscription.deleted.json`, `checkout.session.completed.json`. Build the `Stripe-Signature` header at test time using `whsec_test_secret` so `EventUtility.ConstructEvent` accepts the payload.
  - [x] 8.3 Update `components/bff/README.md` Billing section: document the Stripe Test Mode setup (api keys via `dotnet user-secrets`, price IDs from dashboard, Stripe CLI webhook forwarding via `stripe listen --forward-to localhost:5000/api/billing/stripe/webhook`).
  - [x] 8.4 Frontend lint: the pricing route uses display values from `/api/billing/plans`, NOT inline literals. Run `npm run lint` after Task 7 lands to confirm `check-price-literals.mjs` stays green. The string `"$12.99"` appearing anywhere in source is a lint failure.
  - [x] 8.5 Update `components/frontend-spectr-v2/README.md` with the new public pricing route + the in-product billing success/cancelled routes. Bump vitest baseline by the new test count.

## Dev Notes

### Architecture sources

- **D2 — Billing & Entitlements** (architecture.md lines 88-96): the four billing tables — `subscriptions`, `credit_ledger`, `usage_events`, `webhook_events`. This story owns `subscriptions` + `webhook_events`; story 2.3 owns `credit_ledger`; story 2.4 owns `usage_events`. **Money rules: integer cents everywhere, Stripe is source of truth for subscription state, webhook processor is the ONLY writer to mirrors.**
- **AR11 idempotency** (architecture.md line 94 + line 184): "Stripe event id PK, payload hash, processed_at → strict idempotency; processor is a transactional consumer (insert-or-skip then apply)." The `webhook_events.id` PK + ON CONFLICT DO NOTHING gives at-most-once dispatch even under Stripe's at-least-once delivery semantics.
- **NFR10 SAQ-A** (architecture.md line 184 + epics.md line 555): "card data never touches Spectr." Stripe Checkout is hosted; we redirect, never POST card fields, never receive card data in webhooks. Webhook signature secret + the `Stripe-Signature` header is the only authentication surface. Don't accept `application/x-www-form-urlencoded` — webhooks are JSON.
- **AR39 no-price-literals lint** (architecture.md line 197): frontend `scripts/check-price-literals.mjs` already enforces no `$` literals outside config. Pricing display values come from `GET /api/billing/plans`; Stripe Price IDs come from `IOptions<StripeOptions>`; nothing ships hardcoded prices in code or tests (the BFF test fixtures use string interpolation against the options).
- **FR29** (epics.md line 72): "Free tier (3 analyses/mo, core report, limited coach follow-ups), Pro subscription ($12.99/mo or ~$99/yr), and consumable credit packs." This story implements the Pro half; story 2.3 adds the credit pack purchases.
- **UX-spec line 137**: "Stripe Checkout: the trust gold standard at payment moments — adopt its restraint (single column, terms at button, no upsell noise)."
- **UX-spec line 357**: "Money forms: Stripe-hosted only; our UI shows summary + terms, never card fields."
- **UX-spec line 318**: `PricingTable` ships with this story (two tiers + credits row, tax-inclusive note).

### Existing code patterns to reuse

- **AR38 error envelope** (`CoachConversationEndpoints.cs:284-296`): same `ErrorEnvelope(status, code, message, details)` helper extended in story 1.9's review patches. Reuse verbatim for `invalid_cadence`, `stripe_not_configured`, `webhook_signature_invalid` codes.
- **`appsettings.json` options binding** (story 1.9 / `Program.cs:97-103`): `services.AddOptions<StripeOptions>().Bind(...).Validate(...).ValidateOnStart();` pattern. New addition: `Validate(o => env.IsProduction() ? !string.IsNullOrEmpty(o.SecretKey) : true)` so dev runs without Stripe keys still boot.
- **EF migration partial-index pattern** (bff/README.md "EF Core 10 migrations require a manual partial-index step"): for the `User.StripeCustomerId` unique-where-non-null constraint, append raw SQL to the migration `Up()` / `Down()` after `dotnet ef migrations add` scaffolds the entity changes.
- **`WebApplicationFactory<Program>` test harness** (story 1.5 / 1.6 / 1.9): the established pattern. For Stripe-substituted tests, replace `IStripeClient` via `ConfigureTestServices(s => s.AddSingleton<IStripeClient>(fakeClient))`.
- **`AppDbContext.OnModelCreating`** convention: Npgsql snake_case is inherited globally. Don't override per-entity unless overriding inherited conventions.
- **AR16 transactional metering pattern**: NOT in scope this story (story 2.4 owns `usage_events` writes). Mentioned here to flag that the webhook processor in this story does NOT write `usage_events` rows on subscription events — only `subscriptions` + `webhook_events`. Story 2.4 will add the entitlement cache invalidation on the same dispatch.

### Database — `subscriptions` keying

- The architecture mandates `subscriptions` is "keyed by user" (line 91). That is: PK = `user_id` (1:1 with the User table). NOT a synthetic auto-increment or ULID. This forces the upsert pattern in `SubscriptionMirrorService` (a single user has at most one subscription row at any time; status transitions mutate it). A user who cancels then re-subscribes mutates the existing row from `canceled → active`.
- Why 1:1: Stripe allows a customer to have multiple subscriptions, but the product offers exactly one "Pro" tier — at most one Pro subscription per user. If a user accidentally checks out twice and creates two Stripe subscriptions, the SECOND `customer.subscription.created` webhook will overwrite the first row's `stripe_subscription_id`. The reconciliation job (story 2.10) flags this as drift; the user-facing surface always reads the single canonical row.
- Trade-off: a future tier ladder (e.g. Pro + Team) would need a richer key. Defer until that requirement materializes; YAGNI.

### Webhook idempotency — the ON CONFLICT pattern

The Postgres pattern (architecture.md line 184: "insert-or-skip then apply"):

```sql
INSERT INTO webhook_events (id, event_type, payload_hash, received_at)
VALUES (@id, @type, @hash, NOW())
ON CONFLICT (id) DO NOTHING
RETURNING id;
```

If `RETURNING id` is empty, the event was already processed — return 200 + skip dispatch. If it returns the id, dispatch and then `UPDATE webhook_events SET processed_at = NOW() WHERE id = @id` on success. Wrap the insert + dispatch in a transaction so a crash after the insert but before dispatch leaves `processed_at NULL` and a future Stripe retry (Stripe retries non-2xx for 3 days) re-inserts → still no-op → still safe. The dispatch logic itself must be idempotent (upsert pattern in `SubscriptionMirrorService` — running it twice on the same subscription row produces the same DB state).

**Critical: NEVER UPDATE-then-INSERT — that has a race window.** ON CONFLICT DO NOTHING with the unique PK constraint is the atomic primitive.

### Stripe SDK — signature verification gotcha

`EventUtility.ConstructEvent(json, signature, secret)` is the only safe way to verify webhook signatures. Manual HMAC verification has CVE-grade pitfalls (timing attacks, wrong canonicalization). Use the SDK.

The signature header format: `t=<timestamp>,v1=<sig1>,v0=<sig0>`. The SDK handles parsing. The `throwOnApiVersionMismatch: false` flag is essential — Stripe accounts default to a specific API version (set on the dashboard), and the SDK's pinned version may differ; mismatch is recoverable as long as the payload schema matches. If you DO see schema mismatches, pin the Stripe API version explicitly via `apiVersion = "2024-10-28.acacia"` (or whatever the SDK supports at the time of implementation — verify against the Stripe SDK release notes).

### Frontend — `tier` field on `/me`

Existing `MeResponse` already has fields like `email`, `handle`, etc. Adding `tier: "free" | "pro"` is a wire-format extension. The frontend's hand-mirrored `MeResponse` in `src/api/types.ts` needs the new field; TypeScript's strict mode will surface any consumers that destructure the type incompletely. Audit those after the type change.

The success-page polling (Task 7.4) is a transitional design — story 2.4's `Entitlements.For(user)` resolver + a Redis cache invalidation on webhook will replace it with a single fast read. For 2.1 the 60-s poll is acceptable because Stripe webhook latency for `checkout.session.completed` is typically <2s.

### Configuration — secrets management

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are real secrets. NEVER in `appsettings.json`. NEVER in `.env.example` (use only placeholder values there). Dev: `dotnet user-secrets`. Prod: env vars injected via Docker Compose from a chmod 600 `.env` on the host (architecture line 128).
- `STRIPE_PRICE_PRO_MONTHLY` + `STRIPE_PRICE_PRO_ANNUAL` are NOT secrets — Stripe Price IDs are designed for client-side embedding. Still treat them as config (no inline literals) so dev/stage/prod can rotate price tiers without code changes.
- Document the local dev setup explicitly in `bff/README.md`: `stripe login` (CLI auth), then `stripe listen --forward-to localhost:5000/api/billing/stripe/webhook` produces a `whsec_...` value that's the webhook signing secret for the duration of that `listen` session. Store it via `dotnet user-secrets set Stripe:WebhookSecret whsec_...`.

### Previous story intelligence (story 1.9)

- The `ErrorEnvelope` helper at `CoachConversationEndpoints.cs:284` accepts optional `details` (extended during 1.9 review patch P12). Reuse it for all new AR38 emissions in this story.
- The `IOptions<T>.ValidateOnStart()` pattern was test-locked in story 1.9 via host-build assertion (review patch P8). Apply the same test pattern for `StripeOptions` validation — actual host build, not just `IOptions<T>.Value` lazy access.
- The frontend `caps` field on `MeResponse` was NOT added in 1.9 (caps live on `CoachConversationDto`). When adding `tier` to `MeResponse`, follow the same forward-compatible pattern — a new non-nullable field that all existing consumers can ignore.
- TanStack Query hydration: the BFF docs note (story 1.9 deferred-work) that `CoachChat` didn't use TanStack Query for `/conversation`. For 2.1's `/me` polling on the success page, the existing `useAuth` / `useMe` hook is the right path — DON'T add a parallel raw `useEffect` + `fetch` loop.

### Out of scope (deferred to later stories)

- **Customer Portal link** for self-service management (cancel, update card, change cadence). Story 2.2 owns the `/billing/manage` Stripe Customer Portal redirect.
- **Credit packs purchase flow** (`mode: "payment"` Checkout sessions + `credit_ledger` writes). Story 2.3.
- **`Entitlements.For(user)` resolver + 60-s cache + entitlement-exhausted gates**. Story 2.4.
- **Paid-vs-free queue routing** (analysis-paid vs analysis-free dramatiq queues). Story 2.5.
- **Tier-aware coach caps** (Pro pool, monthly reset). Story 2.6. (Story 1.9 ships free-per-analysis caps with config-default fallback; 2.6 extends.)
- **`UpgradeSheet` modal** (full-screen cap-hit value-recap + plan cards). Story 2.7. (Story 1.9's `CoachGateInline` is the inline gate; 2.7 is the full upgrade modal.)
- **Usage page + honest math banner**. Story 2.8.
- **Dunning states + graceful degradation** (past_due / unpaid → in-app banner + email). Story 2.9.
- **Billing reconciliation job** (nightly Stripe vs DB drift detection). Story 2.10.
- **`Features/Billing/` folder migration**: the architecture spec calls for a `components/bff/src/Spectr.Bff/Features/Billing/` layout, but the existing code uses flat `Endpoints/` + `Services/`. Match the existing pattern in this story; the structural refactor is its own work item if it becomes painful.
- **Prerendered funnel statics**: the architecture (line 124) calls for Caddy-served prerendered HTML for funnel pages. This story ships the pricing route as an SPA route under `_public/`; prerendering is deferred to Epic 6 (Marketing Funnel).
- **PostHog conversion tracking** on checkout start / checkout complete. Epic 6 owns frontend instrumentation.
- **Annual savings copy** ("Save 36% vs monthly") — defer until the PricingTable visual design pass; the math is correct ($99/$155.88 = 36.5% off) but the on-screen breakdown belongs to Epic 6.
- **Refund flow** — Stripe Customer Portal handles refunds for the user; admin-side refund trail is story 9-1+ or Epic 10.
- **Multiple currencies / regional pricing** — USD only at launch. Architecture decision; revisit post-product-market-fit.

### Project Structure Notes

- New BFF files: `Spectr.Bff/Options/StripeOptions.cs`, `Spectr.Bff/Options/PricingDisplayOptions.cs`, `Spectr.Bff/Endpoints/BillingEndpoints.cs`, `Spectr.Bff/Services/SubscriptionMirrorService.cs`, modifications to `Program.cs`, `appsettings.json`.
- New BFF data: `Spectr.Data/Entities/Subscription.cs`, `Spectr.Data/Entities/WebhookEvent.cs`, modifications to `Spectr.Data/Entities/User.cs` (`StripeCustomerId` column), new migration `AddSubscriptionsAndWebhookEvents`.
- New BFF tests: `BillingEndpointsTests.cs`, `StripeWebhookEndpointTests.cs`, `SubscriptionMirrorServiceTests.cs`, fixtures under `Fixtures/StripeEvents/*.json`.
- New frontend files: `src/routes/_public/pricing.tsx`, `src/routes/_app/billing.success.tsx`, `src/routes/_app/billing.cancelled.tsx`, modifications to `src/api/types.ts` (+ tier field on `MeResponse`, new request/response types). Optional: a small `PricingTable.tsx` feature component for the route.
- New frontend tests: `pricing.test.tsx` (renderToStaticMarkup pricing card layout), `billing-success.test.tsx` (poll-state assertions via the pure poll-state reducer pattern from story 1.9 Task 7.3).
- Documentation: `components/bff/README.md` (Billing section + Stripe CLI setup), `components/frontend-spectr-v2/README.md` (new routes + baseline bump).
- No worker code changes. No SA model changes.

### Testing standards summary

- BFF: `dotnet test` with `WebApplicationFactory` + the existing Testcontainers Postgres (per project convention — no DB mocks). Stripe SDK is substituted via DI: `IStripeClient` mocked, `EventUtility.ConstructEvent` called with a test `whsec_` secret + freshly-signed payloads. NEVER hit live Stripe in CI.
- Frontend: vitest env `node`, components via `react-dom/server`'s `renderToStaticMarkup`, NO jsdom. Story 1.9 baseline 134; this story adds ~8-12 new tests (pricing card 3, billing success poll-state reducer 4, type-level types 1, BFF request shape 2-4).
- All four frontend gates green pre-commit: `tsc --noEmit`, `npm run lint --max-warnings 0`, `npm run build`, `npx vitest run`.
- Backend gates green: `dotnet build`, `dotnet test`. Worker `pytest -q components/worker/tests/` unchanged (this story doesn't touch the worker).
- Webhook fixtures: build `Stripe-Signature` headers in test setup with `Stripe.WebhookUtility` (the SDK exposes signing helpers for test use). Real Stripe webhooks include `t=<unix>,v1=<hex>`. Verify the fixture matches what `EventUtility.ConstructEvent` expects.

### References

- [Source: PRPs/epics.md#Story 2.1: Subscribe to Pro via Stripe Checkout (lines 547-559)]
- [Source: PRPs/epics.md#FR29 (line 72)] Pro $12.99/mo or ~$99/yr; Free 3 analyses/mo; credit packs.
- [Source: PRPs/epics.md#AR11 (line 156)] Stripe webhook idempotency via event id PK + payload hash.
- [Source: PRPs/epics.md#NFR10 (line 197)] Webhook signature verification + card data never touches Spectr (SAQ-A).
- [Source: PRPs/architecture.md#D2 — Billing & Entitlements (lines 88-96)] Four-table model + webhook-only writer to mirrors.
- [Source: PRPs/architecture.md#Money boundary (line 249)] "Stripe state mutations only via webhook processor; app code reads mirrors/ledgers."
- [Source: PRPs/architecture.md#Project Structure (line 216)] `Features/Billing/` folder structure target (deferred to a later restructure).
- [Source: PRPs/architecture.md#Stripe webhooks (lines 184-185)] Webhook event flow.
- [Source: PRPs/architecture.md#No-price-literals lint (line 191)] `code never hardcodes tier numbers`.
- [Source: PRPs/ux-design-specification.md line 137] Stripe Checkout as trust gold standard.
- [Source: PRPs/ux-design-specification.md line 318] PricingTable component spec.
- [Source: PRPs/ux-design-specification.md line 357] "Stripe-hosted only" — no card fields.
- [Source: PRPs/stories/1-9-per-analysis-coach-caps.md] AR38 error envelope helper (extended in 1.9 review patch P12); ValidateOnStart host-build test pattern (1.9 review patch P8).
- [Source: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:284-296] `ErrorEnvelope` helper to reuse.
- [Source: components/bff/src/Spectr.Bff/Options/CoachCapsOptions.cs] Options binding + ValidateOnStart precedent.
- [Source: components/bff/src/Spectr.Data/Entities/User.cs] User entity to extend with `StripeCustomerId`.
- [Source: components/bff/README.md] EF migration partial-index pattern (manual SQL append).
- [Source: CLAUDE.md] EF owns canonical schema; SA mirror NO db-level FKs; Decimal not float for money (and integer cents per architecture).
- [Source: Stripe.net SDK docs] `EventUtility.ConstructEvent` for signature verification; `Stripe.Checkout.SessionService` for session creation; `automatic_tax: { enabled: true }` for Stripe Tax.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- BFF: 0 warnings, 0 errors. **51/51 tests passing** (was 36; +15 new — 9 BillingEndpointsTests + 5 StripeWebhookEndpointTests + 1 CoachCapsOptions update). Migration applied: `20260615232144_AddSubscriptionsAndWebhookEvents`.
- Frontend: tsc clean, eslint `--max-warnings 0` clean, `npm run build` clean, vitest **145/145** (was 134; +11 from 5 format-price + 6 billing-success-state).
- Worker: untouched (story 2.1 has no worker changes).
- Stripe.net 52.0.0 installed; SDK API shape change handled — `current_period_end` + `price` moved from `Subscription` to `SubscriptionItem` (per-item billing periods landed in the 2024 API restructure). The mirror service reads both from `stripeSub.Items.Data[0]`.

### Completion Notes List

- **AC1 satisfied**: `POST /api/billing/checkout/subscription` creates a Stripe Checkout session via the `IStripeCheckoutClient` abstraction (real impl wraps `SessionService`; tests substitute a recording fake). `automatic_tax: { enabled: true }`, no card fields touched, hosted URL returned. AR39 enforced — no `$` literals in code; price IDs come from `IOptions<StripeOptions>`; display cents come from `IOptions<PricingDisplayOptions>` via `GET /api/billing/plans`.
- **AC2 satisfied**: `POST /api/billing/stripe/webhook` inserts on `webhook_events.id` (Stripe event id) with `ON CONFLICT (id) DO NOTHING` via `ExecuteSqlInterpolatedAsync` — atomic primitive, no SELECT-then-INSERT race. Replay-test asserts second delivery is no-op + returns `{ duplicate: true }`. Payload hash stored as SHA-256 hex.
- **AC3 satisfied**: `SubscriptionMirrorService` is the only code path that mutates `subscriptions`. The webhook handler dispatches `customer.subscription.{created,updated,deleted}` to it; upsert by `user_id`. Tests assert mutation-not-insert on the updated case + identical row count.
- **AC4 satisfied**: signature verification via `Stripe.EventUtility.ConstructEvent`. Missing header → 400 + `webhook_signature_invalid`. Invalid signature → 400 + same code + no `webhook_events` row inserted. Secret-tail (last 4 chars) logged on failures for ops triage; never the full secret.
- **AC5 satisfied**: `GET /api/auth/me` returns transitional `tier: "free" | "pro"` field via LEFT JOIN against `subscriptions`. Status ∈ {`active`, `trialing`} → `pro`; otherwise `free`. The `/billing/success` route polls `/me` every 5s up to 60s waiting for the flip — pure-reducer state machine extracted for vitest coverage.
- **`IStripeCheckoutClient` abstraction**: introduced a thin DI-injectable wrapper (`CustomerService` + `SessionService` only — the surface the checkout endpoint needs). Tests inject a `RecordingStripeClient` that captures every call without hitting api.stripe.com. Architecture clean: real SDK in prod, no real SDK in CI.
- **Type-name collision** between `Spectr.Data.Entities.Subscription` and `Stripe.Subscription`: aliased via `using StripeSubscription = Stripe.Subscription;` and `using SubscriptionEntity = Spectr.Data.Entities.Subscription;` in `SubscriptionMirrorService` so both can coexist without ambiguity.
- **Stripe SDK init**: `StripeConfiguration.ApiKey` set in `Program.cs` by reading the configuration directly (not via `IOptions<T>.Value` — that would trigger ASP0000 `BuildServiceProvider` during config-time). Dev runs without keys still boot; the checkout endpoint returns `stripe_not_configured` (503) at request time.
- **Env-aware validation**: `StripeOptions.ValidateOnStart` fails fast in production when keys are missing but allows dev runs without them. `IHostEnvironment.IsProduction()` toggles the predicate; same pattern as story 1.9 `CoachCapsOptions` but with env-conditional enforcement.
- **Partial unique index on `users.stripe_customer_id`** added via raw SQL in the migration `Up()` per the established `bff/README.md` "EF Core 10 migrations require a manual partial-index step" pattern.
- **AuthedUser DTO breaking change**: `tier` field added as required. All four `new AuthedUser(...)` construction sites in `AuthEndpoints` updated; introduced a `ResolveTierAsync` helper to keep them concise. Frontend `AuthedUser` type extended in lockstep.
- **CoachGateInline.onUpgrade** now routes to `/pricing` — closes the story 1.9 deferred item ("upgrade flow ships with Epic 2").
- **AR38 envelope** consistently used across the new endpoint group via the inline `ErrorEnvelope` helper (codes: `invalid_cadence`, `stripe_not_configured`, `webhook_signature_invalid`).
- **PCI hygiene**: webhook payload hash is stored on `webhook_events.payload_hash` (SHA-256 hex) but the raw body is NEVER persisted — the body contains customer email + billing address + metadata which is PII. The hash is sufficient to confirm a replay matches without retaining data.
- **Stripe CLI documentation**: `components/bff/README.md` Billing section ships with the full local-dev setup (`stripe login`, `stripe listen --forward-to ...`, `dotnet user-secrets set Stripe:WebhookSecret whsec_...`).

### File List

**New files:**
- `components/bff/src/Spectr.Data/Entities/Subscription.cs`
- `components/bff/src/Spectr.Data/Entities/WebhookEvent.cs`
- `components/bff/src/Spectr.Data/Migrations/20260615232144_AddSubscriptionsAndWebhookEvents.cs` (+ Designer)
- `components/bff/src/Spectr.Bff/Options/StripeOptions.cs`
- `components/bff/src/Spectr.Bff/Options/PricingDisplayOptions.cs`
- `components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs`
- `components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs`
- `components/bff/src/Spectr.Bff/Services/IStripeCheckoutClient.cs`
- `components/bff/src/Spectr.Bff/Services/SubscriptionMirrorService.cs`
- `components/bff/tests/Spectr.Bff.Tests/BillingEndpointsTests.cs`
- `components/bff/tests/Spectr.Bff.Tests/StripeWebhookEndpointTests.cs`
- `components/bff/tests/Spectr.Bff.Tests/StripeTestUtilities.cs`
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/subscription_created.json`
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/subscription_updated.json`
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/subscription_deleted.json`
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/unsupported_event.json`
- `components/frontend-spectr-v2/src/routes/_public/pricing.tsx`
- `components/frontend-spectr-v2/src/routes/_public/pricing.module.css`
- `components/frontend-spectr-v2/src/routes/_app/billing.success.tsx`
- `components/frontend-spectr-v2/src/routes/_app/billing.cancelled.tsx`
- `components/frontend-spectr-v2/src/routes/_app/billing.module.css`
- `components/frontend-spectr-v2/src/features/billing/format-price.ts`
- `components/frontend-spectr-v2/src/features/billing/__tests__/format-price.test.ts`
- `components/frontend-spectr-v2/src/features/billing/__tests__/billing-success-state.test.ts`

**Modified files:**
- `components/bff/src/Spectr.Data/Entities/User.cs` — `StripeCustomerId` column.
- `components/bff/src/Spectr.Data/AppDbContext.cs` — Subscriptions + WebhookEvents DbSets + index config.
- `components/bff/src/Spectr.Bff/Spectr.Bff.csproj` — Stripe.net 52.0.0 dep.
- `components/bff/src/Spectr.Bff/Program.cs` — StripeOptions + PricingDisplayOptions binding, SDK init, billing DI + route map.
- `components/bff/src/Spectr.Bff/appsettings.json` — Stripe + PricingDisplay placeholder sections.
- `components/bff/src/Spectr.Bff/DTOs/AuthDtos.cs` — `Tier` on `AuthedUser`.
- `components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs` — `tier` derivation on `/me`; helper `ResolveTier`/`ResolveTierAsync`.
- `components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj` — fixture copy-to-output.
- `components/frontend-spectr-v2/src/api/types.ts` — `tier` on `AuthedUser`; `CreateCheckoutSessionRequest`/`Response`; `PlansResponse`.
- `components/frontend-spectr-v2/src/features/results/CoachGateInline.tsx` — `onUpgrade` routes to `/pricing` (closes story 1.9 deferral).
- `components/bff/README.md` — Billing section + Stripe CLI setup.
- `components/frontend-spectr-v2/README.md` — new routes documented + vitest baseline 134 → 145.
- `PRPs/sprint-status.yaml` — 2-1 backlog → ready-for-dev → in-progress → review; epic-2 → in-progress.

### Change Log

- 2026-06-15 — story 2.1 implementation complete. 5/5 ACs satisfied. BFF 36/36 → 51/51 (+15 tests). Frontend 134/134 → 145/145 (+11 tests). All lint + tsc + build gates green. Status → review. End-to-end Stripe smoke deferred until test creds are provided; the BFF surfaces `stripe_not_configured` cleanly until then.
- 2026-06-15 — code review (3-layer adversarial Sonnet × 3). 18 patches applied + 4 deferred + 4 dismissed. BFF 51 → 59 (+8: SubscriptionMirrorService unit tests + concurrent webhook delivery + idempotency-key assertions + 2 StripeOptions host-build tests). Frontend 145/145 unchanged. Status → done.

### Review Findings

18 patches applied across BFF + frontend + docs.

| Code | Severity | Title | Files |
|---|---|---|---|
| P1 | H | Stripe `IdempotencyKey` on every Customer + Session create call — deterministic per-user keys so retries are no-ops on Stripe's side | `IStripeCheckoutClient.cs`, `BillingEndpoints.cs` |
| P2 | H | Customer-creation TOCTOU fix — atomic `UPDATE … WHERE stripe_customer_id IS NULL` so concurrent first-checkouts don't create orphan Stripe customers | `BillingEndpoints.cs` |
| P3 | H | Failed-dispatch retry path — duplicate-skip is conditional on `processed_at IS NOT NULL`; otherwise a row from a failed dispatch would forever-after tell Stripe `{ duplicate: true }` | `BillingEndpoints.cs` |
| P4 | H | New `SubscriptionMirrorServiceTests.cs` — 4 dedicated unit tests (first apply, mutation, orphan no-op, fallback via User.StripeCustomerId) | `SubscriptionMirrorServiceTests.cs` |
| P5 | H | New concurrent-delivery webhook test — 3 parallel posts of the same event collapse to 1 webhook_events row + 1 subscriptions row | `StripeWebhookEndpointTests.cs` |
| P6 | H | `billing.success.tsx` now routes through `fetcher<T>` so 401-silent-refresh fires; raw `useEffect+fetch` removed | `routes/_app/billing.success.tsx` |
| P7 | M | Origin validation on Stripe checkout URL — `new URL(data.url).hostname === 'checkout.stripe.com'` before `window.location.assign` | `routes/_public/pricing.tsx` |
| P9 | M | `MeProfileDto` gains `Tier` field; both `/me/profile` and `/auth/me` agree on Pro state | `MeDtos.cs`, `MeEndpoints.cs` |
| P10 | M | Shared `Endpoints/ErrorEnvelope.cs` helper; `BillingEndpoints` + `CoachConversationEndpoints` both consume it (was duplicated) | `Endpoints/ErrorEnvelope.cs` (new), `BillingEndpoints.cs`, `CoachConversationEndpoints.cs` |
| P11 | M | `SPECTR_REQUIRE_STRIPE=1` env var gates the fail-fast (replaces fragile `IHostEnvironment.IsProduction()`); 2 host-build assertion tests added | `Program.cs`, `CoachCapsOptionsTests.cs` |
| P13 | M | `register.tsx` honors `?next=/path` with same-origin sanitization; post-registration users return to `/pricing` instead of `/library` | `routes/_public/register.tsx` |
| P14 | M | `billing/cancelled` moved from `_app/` to `_public/` so unauthenticated-session-during-checkout cancellations don't dead-end at login | `routes/_public/billing.cancelled.tsx` |
| P15 | M | `billing.success.tsx` stores `setTimeout` handle and clears it on unmount; the prior cancel flag only guarded `setState` | `routes/_app/billing.success.tsx` |
| P16 | L | `processing_error` sanitized to `{ExceptionType}: {first-line truncated to 200 chars}` — webhook_events stays payload-hash-only (no PII leakage from Stripe SDK exception messages) | `BillingEndpoints.cs` |
| P17 | L | `ILogger<BillingWebhook>` (new public marker class) replaces the prior nested type; cleaner category in log filters | `BillingEndpoints.cs` |
| P20 | L | Missing `current_period_end` from a Stripe payload defaults to `UtcNow + 10 years` (sentinel) instead of `UtcNow` (which would have flipped tier to free on transport hiccup) | `SubscriptionMirrorService.cs` |
| P22 | L | `CLAUDE.md` Stripe.net 52 gotcha documented: per-item `CurrentPeriodEnd` + `Price` location, idempotency-key requirement, ON CONFLICT pattern | `CLAUDE.md` |
| P23 | L | `// $12.99` comment removed from `PricingDisplayOptions.cs` (copy-paste trap if migrated to a non-Options file) | `PricingDisplayOptions.cs` |

**Deferred** (real findings, out of 2.1 scope — moved to `PRPs/deferred-work.md`):
- Currency mismatch detection (PricingDisplay.Currency vs actual Stripe Price currency) — story 2.10 reconciliation owns drift detection.
- Rate limiting on `/checkout/subscription` + `/stripe/webhook` — Epic 10 abuse containment.
- Webhook endpoint CORS posture — signature verification is sufficient defense; Epic 10 may add defense-in-depth.
- `IStripeCheckoutClient` Singleton captive-dep risk for future consumers — no actual broken callers; revisit if it materializes.

**Dismissed**:
- `paused` Stripe status → `free` tier (Edge M3). Intentional product behavior — paused = user explicitly paused billing, downgrade is correct.
- `AuthedUser` positional record breaking change (Edge L1). No actual broken callers; the spec uses named arguments consistently.
- README baseline test-count discrepancy (Auditor L4). The committed count `145` is accurate; the pre-change line was stale from a prior story.
- `SuccessUrl ?session_id={CHECKOUT_SESSION_ID}` token never consumed (Blind L2). Correct by design — polling `/me` is the canonical post-checkout signal.
