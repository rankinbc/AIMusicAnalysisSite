# Spectr.Bff — C# .NET 10 Backend-For-Frontend

Single ASP.NET Core minimal-API process. Talks to React frontend over HTTPS;
dispatches analysis jobs to the Python worker via dramatiq/Redis; owns all
Postgres schema migrations via EF Core.

## Structure

```
src/
  Spectr.Domain/       strongly-typed IDs + cross-cutting enums
  Spectr.Data/         EF Core DbContext + entities + migrations
  Spectr.Bff/          ASP.NET Core minimal APIs + services + endpoints
tests/
  Spectr.Bff.Tests/    xUnit + WebApplicationFactory
```

## Local dev (without docker)

```pwsh
# One-time
dotnet restore
dotnet user-secrets set "Jwt:Key" "<generate-a-32+-byte-random-string>" --project src/Spectr.Bff

# Run (postgres + redis must already be up)
dotnet run --project src/Spectr.Bff
```

API serves at `http://localhost:5000`. OpenAPI doc at `/openapi/v1.json` in
Development.

## EF Core migrations

```pwsh
dotnet ef migrations add Initial --project src/Spectr.Data --startup-project src/Spectr.Bff
dotnet ef database update      --project src/Spectr.Data --startup-project src/Spectr.Bff
```

The `Initial` migration declares the entire schema (greenfield). Existing
data in any older `spectr` database is disposable.

### Manual edit required after `add Initial`

EF Core can't fluently express the *partial* unique index that enforces
"only one current version per song." After the migration is scaffolded,
open the generated `*_Initial.cs` and append to `Up()`:

```csharp
migrationBuilder.Sql(@"
    CREATE UNIQUE INDEX uq_song_versions_one_current_per_song
    ON song_versions (song_id) WHERE is_current;
");
```

and prepend to `Down()`:

```csharp
migrationBuilder.Sql("DROP INDEX IF EXISTS uq_song_versions_one_current_per_song;");
```

Without this, two rows with `is_current = true` can coexist for the same
song and library reads return ambiguous "current" versions.

## OpenAPI doc → frontend codegen

The slice-1 BFF doesn't ship an in-process `--emit-openapi` flag (.NET 10's
OpenAPI document is wired into the HTTP pipeline, not the host). Run the
BFF, curl the doc, generate types:

```pwsh
dotnet run --project src/Spectr.Bff  # in one terminal
# in another:
curl http://localhost:5000/openapi/v1.json -o ../frontend-spectr-v2/openapi.json
cd ../frontend-spectr-v2
npm run gen-types
```

## Schema ownership

All migrations live in this project. The Python worker has SQLAlchemy models
in `aimusic_shared.models` that mirror these entities — drift is caught by
fixture round-trip tests, not by separate migration tooling.

## Audio streaming

`GET /api/versions/{id}/audio` streams the original upload from
`IFileStorage` with `Accept-Ranges: bytes` so the browser can seek
instantly. Auth is via either the standard `Authorization: Bearer` header
OR a `?t=<jwt>` query parameter (HTMLMediaElement can't attach headers).
`JwtBearerEvents.OnMessageReceived` is wired to pull the token from the
query string only for paths matching `/audio`. Same signing key + lifetime
validation as the rest of the JWT pipeline.

**Security note:** tokens in URL query strings leak into server access
logs and shareable links. Before any public exposure, swap to a
short-lived HMAC-signed audio URL minted by a dedicated endpoint, or use
a per-version cookie scoped to `/api/versions/`.

## Dramatiq job queue

`IJobQueue` (Redis-backed) is the canonical interface for dispatching
work to the Python worker. The wire format is dramatiq's native shape:

- `dramatiq:<queue>.msgs` HASH — message_id → JSON message
- `dramatiq:<queue>` LIST — message_ids (worker `LPOP`s here)
- Each message's `options.redis_message_id` MUST equal the HASH key

`DramatiqJobQueue.EnqueueAsync` writes both the HASH entry and the LIST
push inside a `MULTI/EXEC` so they stay in lockstep — the worker's
`redis_message_id` lookup will otherwise see a HASH miss and treat the
message as stale (silently dropped). If a job appears to vanish in dev,
inspect Redis directly:

```
redis-cli HGETALL dramatiq:default.msgs
redis-cli LRANGE dramatiq:default 0 -1
```

## Billing — Stripe Checkout (story 2.1)

The BFF owns the Stripe-mirrored billing state. Three endpoints ship in
story 2.1:

- `GET  /api/billing/plans` — public; returns display cents for the
  pricing page (no inline price literals per AR39).
- `POST /api/billing/checkout/subscription` — authed; creates a hosted
  Stripe Checkout session and returns the URL.
- `POST /api/billing/stripe/webhook` — anonymous; Stripe-signed payloads
  only. AR11 idempotency via `webhook_events.id` PK; the only writer to
  the `subscriptions` mirror table.

### Local dev setup

1. Install the Stripe CLI: https://stripe.com/docs/stripe-cli
2. `stripe login` to authenticate against your test-mode account.
3. Create two Price objects in the test dashboard (Pro Monthly $12.99
   and Pro Annual $99); copy the `price_...` IDs.
4. Store secrets via `dotnet user-secrets`:

   ```bash
   cd components/bff/src/Spectr.Bff
   dotnet user-secrets set Stripe:SecretKey sk_test_<from-dashboard>
   dotnet user-secrets set Stripe:PriceProMonthly price_<monthly>
   dotnet user-secrets set Stripe:PriceProAnnual  price_<annual>
   ```

5. Forward webhooks to the BFF and grab the signing secret:

   ```bash
   stripe listen --forward-to localhost:5000/api/billing/stripe/webhook
   # prints: whsec_<signing-secret>
   dotnet user-secrets set Stripe:WebhookSecret whsec_<signing-secret>
   ```

6. `dotnet run` — the BFF picks up the secrets at startup. With all four
   keys set, the checkout endpoint returns a real Checkout Session URL.

Without keys, the endpoint returns `{ error: { code:
"stripe_not_configured" } }` and the frontend renders a friendly notice.

### Wire-format notes

- AR38 envelope codes: `invalid_cadence` (400), `stripe_not_configured`
  (503), `webhook_signature_invalid` (400).
- The webhook handler reads the raw request body verbatim (the Stripe
  signature is computed over unparsed bytes) and verifies via
  `EventUtility.ConstructEvent`. PCI hygiene: only the SHA-256 hash of
  the body is persisted on `webhook_events.payload_hash` — never the
  full payload.
- Stripe.net 52 moved `current_period_end` and `price` from
  `Subscription` to `SubscriptionItem` (per-item billing periods landed
  in the 2024 API restructure). The mirror service reads both from
  `stripeSub.Items.Data[0]`.

### Manage subscription (story 2.2)

- `GET  /api/billing/me` — billing summary (tier, status, cadence, next charge, cancelAt).
- `POST /api/billing/cancel { reason? }` — sets `cancel_at_period_end=true` on Stripe.
- `POST /api/billing/resubscribe` — reverses cancel.
- `POST /api/billing/change-cadence { cadence }` — Items[0].Price swap with proration.
- `POST /api/billing/portal` — Customer Portal session URL (origin-validated on the frontend).

**Customer Portal configuration** (Stripe dashboard, both test + live modes):
- **Enable**: invoice history, payment-method updates, billing address.
- **Disable**: subscription cancellation, subscription pause, plan changes (the BFF handles these inline for the UX-DR33 two-click rule).

**Config keys added in story 2.2 review:**
- `Stripe:PortalReturnUrl` — explicit landing URL for portal return (defaults to dev origin `http://localhost:5174/billing`). Production sets this to the deployed `/billing` page so users land back on self-service after editing their payment method. Avoids the string-munging-of-SuccessUrl approach that landed users on the checkout-success page instead.
- `App:FrontendOrigin` — single CORS origin (defaults to `http://localhost:5174`). Required in production so OPTIONS preflight from the deployed frontend doesn't 403. `AllowCredentials` forbids `*` so the explicit origin is the only safe shape.

**Architecture D2 — money-boundary enforcement (story 2.2 review):**
The five mutation endpoints (`/checkout/subscription`, `/cancel`, `/resubscribe`, `/change-cadence`, `/portal`) CALL Stripe and project the post-call view into the response body WITHOUT persisting to the local `subscriptions` mirror. The webhook processor + `SubscriptionMirrorService` is the only canonical writer. The HTTP 200 response is the immediate optimistic view; the mirror catches up via the inevitable `customer.subscription.updated` Stripe dispatches as a side effect of the Update call.

**Idempotency key recipe (story 2.2 review):**
- Cancel: `cancel:<userId:N>:<StripeSubscriptionId>`
- Resubscribe: `resubscribe:<userId:N>:<StripeSubscriptionId>`
- Change-cadence: `cadence:<userId:N>:<StripeSubscriptionId>:<CurrentPeriodEnd.ToUnixTimeSeconds()>:<newPriceId>`
- Portal: `portal:<userId:N>:<yyyyMMdd>`

Keys salt with the stable `StripeSubscriptionId` rather than `CurrentPeriodEnd` because story 2.1's mirror service falls back to a `UtcNow + 10y` sentinel when Stripe doesn't supply a period end (which would make timestamp-based keys non-deterministic across pods).

### Tier derivation on `/me`

`GET /api/auth/me` returns a transitional `tier: "free" | "pro"` field.
Computed via LEFT JOIN against `subscriptions`: status ∈ {`active`,
`trialing`} → `pro`; everything else (including no row) → `free`. Story
2.4's `Entitlements.For(user)` resolver will replace this with a richer
object + 60-s cache + webhook-driven invalidation.

## Triage routing plan persistence

`Analysis.routing_plan` (jsonb) holds the Triage step output:
`{specialists_to_run, skip, rationale, estimated_total_tokens}`. Written
once by the worker's `run_triage` actor on first ListVerdicts call;
never recomputed. The same data is also embedded inside
`verdicts_payload.routing_plan` so the v2 frontend can read it without a
second query. Both copies stay in sync — `run_specialist` preserves the
embedded routing_plan when merging piecewise verdicts.
