# PRP: F1 — production analytics + signup attribution

Written 2026-10-04 against `develop` @ `60d15c7` (worktree `C:\Users\badmin\projects\spectr-worker-logs`). Merge flow: feature branch → `develop` → fast-forward `solo` (a push to `solo` deploys).

## Goal

Make every acquisition channel measurable end to end:

1. PostHog actually runs in the production bundle.
2. The funnel has no missing edges: landing → upload → report → signup → verified → purchase.
3. Each visitor's first-touch source (UTM / `ref` / `via` / referrer) is captured once, attached to PostHog events, and persisted on the `users` row so revenue can be grouped by source in SQL.

## Why

This is item F1 of the approved go-to-market plan. Nothing else in that plan (SEO, creators, ads) can be judged until cost per paying customer can be computed per channel. Today:

- The live bundle contains no PostHog key (`VITE_POSTHOG_KEY` secret is unset), so zero events are recorded.
- No event fires for sign-up, email verification or purchase.
- `src/lib/attribution.ts` exists but nothing imports it; no UTM or referrer handling anywhere.
- The `users` table has no source column, so Stripe revenue cannot be joined to a channel.

## What

### Success criteria

- [ ] A visit to `/?utm_source=test&utm_medium=manual&utm_campaign=f1` followed by upload → report → register → verify → credit-pack purchase shows these events in PostHog, in order, on one person, each carrying `spectr_source=test`: `landing_viewed`, `guest_upload_started`, `report_viewed`, `signup_completed`, `email_verified`, `purchase_completed`.
- [ ] That user's row has `signup_source='test'`, `signup_medium='manual'`, `signup_campaign='f1'`.
- [ ] A direct (non-guest) registration from the same kind of link also stores the source.
- [ ] A second visit with a different `utm_source` does not overwrite the first (first touch wins, client and server).
- [ ] With no key (dev, tests, CI) everything remains a silent no-op.
- [ ] The runbook has a working SQL query for signups, verified users, payers and revenue by source.
- [ ] All gates in "Validation loop" pass.

### Out of scope

- Server-side PostHog events (the Stripe webhook stays the source of truth for revenue; `purchase_completed` is best-effort from the browser).
- An admin metrics endpoint or dashboard (SQL in the runbook is enough for now).
- A cookie/consent banner. **Owner decision needed before EU-targeted promotion**: PostHog and the attribution stash both use `localStorage`. This PRP does not change that existing behaviour and does not add consent UI.
- Ad pixels (Meta, TikTok, Google).
- Frontend Sentry (`VITE_SENTRY_DSN` is also unset; separate decision).

## All needed context

### Files to read first

| File | Why |
|---|---|
| `components/frontend-spectr-v2/src/lib/analytics.ts` (89 lines) | The PostHog wrapper: lazy import, bounded queue, `EventName` union. Extend it; do not replace it. |
| `components/frontend-spectr-v2/src/lib/attribution.ts` (41 lines) | Existing `sanitizeSource` + drain-once `readAttribution`. Unused. Rewritten here. |
| `components/frontend-spectr-v2/src/lib/__tests__/{analytics,analytics-lazy,attribution}.test.ts` | Test patterns to follow and update. |
| `components/frontend-spectr-v2/src/main.tsx` lines 20–31 | Where `initAnalytics()` is called at boot. |
| `components/frontend-spectr-v2/src/auth/AuthContext.tsx` lines 155, 203–300 | `identifyUser` on auth resolve; `register`, `convertGuest`, `verifyEmail`, `startDemo` request bodies. |
| `components/frontend-spectr-v2/src/routes/_public/register.tsx` | Submit handler; note the pending branches return before `capture('guest_converted')`. |
| `components/frontend-spectr-v2/src/routes/_public/verify-email.tsx` | Where the verification link lands. |
| `components/frontend-spectr-v2/src/routes/_app/billing.success.tsx` | Post-Checkout polling page (subscription and credits variants). |
| `components/frontend-spectr-v2/src/features/pricing/PricingPage.tsx` line 95 | Only current `checkout_started` site (subscription). |
| `components/bff/src/Spectr.Bff/DTOs/AuthDtos.cs` | `RegisterRequest(string Email, string Password)`, shared by register and guest convert. |
| `components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs` lines 152–260 | `Register`: new-user creation at ~234; pending re-register branch at ~211. |
| `components/bff/src/Spectr.Bff/Endpoints/DemoAuthEndpoints.cs` lines 22, 140–157 | Guest mint (`POST /api/auth/demo`); currently takes no body. |
| `components/bff/src/Spectr.Bff/Endpoints/GuestConvertEndpoints.cs` | Guest → account, same `users` row. |
| `components/bff/src/Spectr.Data/Entities/User.cs` | Add columns here. |
| `components/bff/src/Spectr.Bff/Endpoints/AccountEndpoints.cs` ~line 66 | Account data export enumerates user fields. |
| `components/bff/tests/Spectr.Bff.Tests/{AuthEndpointsTests,DemoAuthEndpointsTests,GuestConvertTests,NoSocialSurfaceTests,TestSupport}.cs` | Test patterns and standing guards. |
| `components/frontend-spectr-v2/src/features/trust/pages/PrivacyDefaultsPage.tsx` lines 46–54 + `features/trust/__tests__/trust.test.tsx` | Existing PostHog disclosure and its test. |
| `docs/runbook.md` lines 263–285 | PostHog section and KPI table to update. |
| `.github/workflows/ci.yml` lines 277–279, `infra/Dockerfile.web` | The key is already plumbed as a build arg; only the secret is missing. |

External: posthog-js docs for `register_once` (super properties) and `identify`. Installed version is `posthog-js ^1.396.6`.

### How the funnel works today (verified in code)

- The main funnel is the guest path: `/analyze` upload → `POST /api/auth/demo` mints a guest `users` row → report → `/register?from=guest` → `POST /api/auth/guest/convert` → email link → verified. The guest row **is** the future account (same id), so the source must be stored at guest mint.
- Direct path: `/register` → `POST /api/auth/register` → email link → verified.
- Both sign-up paths normally answer "pending" (verify-before-sign-in). In `register.tsx` both pending branches `return` early, so `guest_converted` almost never fires today and nothing fires for direct sign-ups.
- `AuthContext` already calls `identifyUser(user.id)` for guests and real users, so one PostHog person spans guest → account. A verification link opened in another browser is merged when `verifyEmail` signs the user in.
- Events already emitted that the exit gate relies on: `landing_viewed` (`LandingPage.tsx:23`), `guest_upload_started` (`AnalyzePage.tsx:171`), `report_viewed` (`songs.$songId.results.$jobId.tsx:169`).

### Gotchas

- **posthog-js loads lazily** (dynamic import after boot). Its own UTM auto-capture reads the URL when the SDK finishes loading, which can be after an SPA navigation. Capture attribution synchronously at boot ourselves and push it as super properties; do not rely on PostHog's auto-capture.
- **PII in `?ref=`**: the value is free text (`?ref=jane@x.com`). It must be slugified before it is stored or sent, and `ref`/`via` must be stripped from the address bar before PostHog loads, because `capture_pageview: true` records `$current_url`. Leave `utm_*` params in the URL.
- **`verbatimModuleSyntax`**: type-only imports need `import type`.
- **Minimal-API body binding**: `POST /api/auth/demo` is called with no body today. A new body parameter must be nullable so an empty body still binds; keep the existing body-less tests green.
- **`RegisterRequest` is positional**: add the new member last with a default so existing callers and tests compile.
- **`NoSocialSurfaceTests` / `no-social-surface.test.ts`** guard the register JSON and banned phrases. No new routes are added here. Run both.
- **EF migration**: plain nullable columns, no partial index needed. BFF must be stopped before `dotnet build` on Windows, or use `dotnet test --artifacts-path <scratch>`.
- **The Python `aimusic_shared` `User` mirror does not need these columns** (the worker never reads them). `shared/tests/test_guest_user_mirror.py` checks only guest columns; run it to confirm.
- **Guest rows are purged** after expiry; their source goes with them. That is fine: PostHog keeps the top-of-funnel record, the DB only needs converted users.
- **BFF tests write to the dev `spectr` DB** and `TestProcessBaseline` pins `Credits__Enabled=true`.

## Implementation blueprint

### Data model

`users` gets four nullable columns (EF entity `User.cs`):

| Column | Type | Content |
|---|---|---|
| `signup_source` | varchar(64) | `utm_source`, else `via`, else `ref`; slug |
| `signup_medium` | varchar(64) | `utm_medium`; slug |
| `signup_campaign` | varchar(64) | `utm_campaign`; slug |
| `signup_referrer` | varchar(128) | referring **host only**, lower-case; null when same-site or absent |

Wire shape (camelCase JSON), sent by the client on three calls:

```
attribution?: { source?: string; medium?: string; campaign?: string; referrer?: string }
```

Rules: first touch wins. The server writes each field only when the stored value is null, and re-sanitizes everything (never trust the client).

### Tasks, in order

**Task 1 — Frontend: rewrite `src/lib/attribution.ts`**

- Keep `ATTRIBUTION_KEY` and `sanitizeSource` (allow `[a-z0-9._-]`, cap 64 to match the DB).
- Add `captureAttribution(): void`, called once at boot:
  - If a stash already exists in `localStorage` and is younger than 30 days, do nothing (first touch wins).
  - Otherwise read `utm_source`/`utm_medium`/`utm_campaign`, `via`, `ref`, and `document.referrer`. Reduce the referrer to its host; drop it if it equals `window.location.host`. If nothing is present, store nothing.
  - Store `{ source?, medium?, campaign?, referrer?, at: <epoch ms> }` as JSON.
  - If `ref` or `via` was in the URL, remove just those params with `history.replaceState` (keep path, other params and hash).
- Add `getAttribution(): Attribution` (non-draining read; `{}` when absent, expired or malformed, including the legacy bare-string stash).
- Remove the drain-once `readAttribution` (it has no callers) and update its test file.
- Every storage and URL access stays inside try/catch (private mode, SSR).

**Task 2 — Frontend: `analytics.ts`**

- Add `registerAttribution(a: Attribution)`: via the existing `run()` queue, call `p.register_once({ spectr_source, spectr_medium, spectr_campaign, spectr_referrer })`, omitting undefined keys. No-op when all are absent.
- Extend `EventName` with:
  - `'signup_completed'` — props `{ path: 'direct' | 'guest', pending: boolean }`
  - `'email_verified'` — props `{ session: boolean }`
  - `'purchase_completed'` — props `{ product: 'subscription' | 'credits' }`
- Keep every existing event name (additive only).

**Task 3 — Frontend: boot order in `main.tsx`**

Inside the existing try block, before `initAnalytics()`: `captureAttribution(); registerAttribution(getAttribution());`. Order matters: the `ref`/`via` strip must happen before PostHog loads.

**Task 4 — Frontend: send attribution on the three account-creating calls (`AuthContext.tsx`)**

- `register`: `data: { email, password, attribution: getAttribution() }`
- `convertGuest`: same.
- `startDemo`: `data: { attribution: getAttribution() }`.
- Send `attribution` only when it has at least one field.

**Task 5 — Frontend: emit the missing events**

- `register.tsx`: after a successful `register(...)` or `convertGuest(...)` response and **before** any early `return`, call `capture('signup_completed', { path, pending })`. Leave the existing `guest_converted` call untouched.
- `verify-email.tsx`: in the `.then` of `verifyEmail`, call `capture('email_verified', { session: !!res })` before navigating.
- Purchase: set a `sessionStorage` marker `spectr_checkout_pending` (`'subscription'` or `'credits'`) immediately before each Stripe redirect: at `PricingPage.tsx:95` and at the credits checkout call site (grep `/billing/checkout/credits`). In `billing.success.tsx`, when the subscription poll reaches `'pro'` or the credits poll confirms, fire `capture('purchase_completed', { product })` **only if the marker is present**, then remove it. This prevents a reload of the success page from double-counting.
- Also add `capture('checkout_started', { product: 'credits' })` at the credits call site (today only subscriptions emit it).

**Task 6 — BFF: model + migration**

- Add the four properties to `User.cs` with `[Column]` + `[MaxLength]`.
- `dotnet ef migrations add AddUserSignupAttribution --project src/Spectr.Data --startup-project src/Spectr.Bff`. Confirm the generated `Up()` is four `AddColumn` calls and nothing else.

**Task 7 — BFF: DTO + sanitizer**

- `AuthDtos.cs`: `record SignupAttribution(string? Source, string? Medium, string? Campaign, string? Referrer);` and `RegisterRequest(string Email, string Password, SignupAttribution? Attribution = null)`; `record DemoStartRequest(SignupAttribution? Attribution = null)`.
- New `Services/SignupAttributionWriter.cs` (static, pure, unit-testable):
  - `Slug(string?)`: trim, lower-case, keep `[a-z0-9._-]`, cap 64, empty → null.
  - `Host(string?)`: accept a host or full URL, return the lower-case host only, cap 128; reject anything containing `@` or whitespace; null for the site's own host.
  - `Apply(User user, SignupAttribution? a)`: for each field, assign only when the user's current value is null.

**Task 8 — BFF: call `Apply` at the three sites**

- `AuthEndpoints.Register`: on the new `User` before `db.Users.Add`; and in the pending re-register branch before its `SaveChangesAsync` (fills nulls only).
- `DemoAuthEndpoints.Start`: add `DemoStartRequest? req` (nullable body); apply on the newly minted `User` only, not when an existing guest for the device is reused.
- `GuestConvertEndpoints.Convert`: apply on the guest row (fills nulls only, so the mint-time source survives).

**Task 9 — BFF: account data export**

Add the four fields to the user projection in `AccountEndpoints.cs` (~line 66) so the export stays complete.

**Task 10 — Docs and copy**

- `docs/runbook.md`: update the PostHog bullet with the three new events and the `spectr_*` super properties; replace the obsolete "Share-link k-factor" KPI row with "Acquisition by source" pointing at this query (confirm the purchase reason string against the CHECK constraint in `CreditLedgerEntry.cs` and the pack price mapping before committing it):

```sql
SELECT COALESCE(u.signup_source, u.signup_referrer, 'direct') AS source,
       COUNT(*)                                               AS signups,
       COUNT(u.email_verified_at)                             AS verified,
       COUNT(*) FILTER (WHERE s.user_id IS NOT NULL
                           OR p.user_id IS NOT NULL)          AS payers
FROM users u
LEFT JOIN (SELECT DISTINCT user_id FROM subscriptions) s ON s.user_id = u.id
LEFT JOIN (SELECT DISTINCT user_id FROM credit_ledger
           WHERE reason = 'purchase') p ON p.user_id = u.id
WHERE NOT u.is_guest AND u.created_at >= now() - interval '30 days'
GROUP BY 1 ORDER BY signups DESC;
```

- `PrivacyDefaultsPage.tsx`: add one sentence to the existing PostHog bullet saying the campaign tag or referring site that brought the visitor is recorded. Trust pages are founder-reviewed; flag the sentence in the PR for the owner. Mirror it in the BFF bot shell for `/trust/privacy` in `PublicSiteEndpoints.cs` if that shell repeats the bullet. Keep `trust.test.tsx` green.
- `docs/launch-checklist.md` line 102: extend the PostHog sanity line to name the six funnel events.

**Task 11 — Owner steps (cannot be done by the implementer)**

1. Create a PostHog project in the **EU** cloud (the host `https://eu.i.posthog.com` is hard-coded).
2. `gh secret set VITE_POSTHOG_KEY --repo <owner/repo>` with the project key (`phc_…`).
3. After the next `solo` deploy, run the live check in Level 3.

### Integration points

- Database: one EF migration; applied automatically on BFF boot in prod (confirm against `docs/runbook.md`).
- CI: no workflow change; the build arg already exists.
- No worker, no Python, no new routes, no new dependencies.

## Validation loop

### Level 1 — build and lint

```bash
cd components/frontend-spectr-v2 && npx tsc -b && npm run lint
cd components/bff && dotnet build
```

### Level 2 — tests to add or update

Frontend (vitest, jsdom):
- `attribution.test.ts`: captures UTM; `via`/`ref` fallback order; first touch not overwritten; expired stash replaced; referrer reduced to host and dropped when same-site; `?ref=jane@x.com` stored as a slug with no `@`; `ref`/`via` stripped from the URL while `utm_*` and other params remain; legacy string stash and malformed JSON return `{}`; storage throwing does not throw.
- `analytics.test.ts`: the three new events and `registerAttribution` are no-ops without a key.
- `analytics-lazy.test.ts` pattern: with a key, `register_once` is called with the `spectr_*` props and queued calls flush in order.
- `register` route test: `signup_completed` fires on the pending branch for both direct and guest paths; `attribution` is in the request body when a stash exists and absent when it does not.
- `verify-email` test: `email_verified` fires once (StrictMode double-mount guard still holds).
- `billing.success` test: fires once with the marker, never without it, and not again on re-mount.

BFF (xunit, follow `AuthEndpointsTests` / `GuestConvertTests` / `DemoAuthEndpointsTests`):
- Register with attribution persists sanitized values; without it leaves nulls and still returns the same status.
- Hostile input (`"Jane@X.com <script>"`, 500-char strings, a full URL as referrer) is slugged, capped or nulled.
- Pending re-register does not overwrite an existing source.
- `POST /auth/demo` with no body still succeeds; with a body stores the source on the new guest; a reused guest is unchanged.
- Guest convert keeps the mint-time source and fills only nulls.
- Unit tests for `Slug`, `Host`, `Apply`.

```bash
cd components/frontend-spectr-v2 && npx vitest run && npm run build
cd components/bff && dotnet test
pytest -q components/shared/tests/
```

### Level 3 — live checks

Local (stack up per `docs/STARTUP.md`, restart the BFF after the migration):
```bash
# guest mint with attribution, then confirm the row
curl -s -X POST http://localhost:5000/api/auth/demo -H "Content-Type: application/json" \
  -d '{"attribution":{"source":"test","medium":"manual","campaign":"f1"}}' -c /tmp/c.txt
psql "$DATABASE_URL" -c "select signup_source, signup_medium, signup_campaign from users order by created_at desc limit 1;"
```
(Requires `demo_enabled=true` locally; clear `ratelimit:demo_create:*` in Redis if rate-limited.)

Production, after the owner sets the secret and `solo` deploys:
```bash
# key is baked into the entry chunk
curl -s https://spectrmix.com/ | grep -o '/assets/index-[^"]*\.js' | head -1 \
  | xargs -I{} curl -s https://spectrmix.com{} | grep -c 'phc_'
```
Then walk the success-criteria journey with `?utm_source=test` and confirm the six events on one PostHog person. Refund the test purchase.

## Final checklist

- [ ] `tsc -b`, lint, build, vitest all pass
- [ ] `dotnet build` and `dotnet test` pass, including `NoSocialSurfaceTests`
- [ ] `pytest -q components/shared/tests/` passes
- [ ] Migration contains only the four `AddColumn` calls
- [ ] Keyless build still imports nothing from `posthog-js`
- [ ] Runbook query runs against the dev DB
- [ ] Privacy sentence flagged for owner review
- [ ] Owner steps in Task 11 listed in the PR description

## Anti-patterns to avoid

- Do not send raw `ref`/`via`/referrer values anywhere; sanitize on the client and again on the server.
- Do not store a full referrer URL (it can contain search terms or tokens); host only.
- Do not let a later visit or a later request overwrite a stored source.
- Do not make the demo endpoint require a body.
- Do not fire `purchase_completed` from the poll alone; a reload would double-count.
- Do not remove or rename existing events (`guest_converted` and the unused names stay).
- Do not add email, user-entered text or audio names to any event props.
- Do not add a new analytics library, ad pixel or consent UI in this PRP.
- Do not mock around a failing test; fix the cause.

## Confidence

8/10 for one-pass implementation. The two risks: locating the credits checkout call site and its tests (not traced here), and the exact purchase reason string for the runbook query (to be confirmed against the ledger CHECK constraint).

## Addendum 2026-10-04 — F1b: first-party analytics (owner decision)

The owner chose a first-party event log over PostHog. Built on the same branch:

- `analytics_events` table (migration `AddAnalyticsEvents`) and `POST /api/events`
  (`Endpoints/EventEndpoints.cs`): anonymous, write-only, always 204, per-IP rate
  limit, event-name allowlist, sanitized path/props/attribution, no IP or user agent.
- Frontend `lib/first-party-events.ts`; `capture()` sends every event to it
  (off under vitest). `page_viewed` fires on route change (`main.tsx`).
- `/api/events` added to the `NoSocialSurfaceTests` anonymous allowlist.
- Account deletion removes the user's events (`AccountTeardown`).
- PostHog wrapper is unchanged and stays inert without `VITE_POSTHOG_KEY`, so
  Task 11 (owner PostHog steps) is now optional.
- Deviations from the PRP body: purchase marker uses `localStorage` (the upgrade
  popup is a separate window); guest mint reads its body tolerantly.

Open: live walk-through after deploy; no time-based purge of `analytics_events`;
the privacy page still names PostHog as running analytics.
