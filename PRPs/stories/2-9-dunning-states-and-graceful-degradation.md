# Story 2.9: Dunning States & Graceful Degradation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a lapsed subscriber,
I want my access to degrade gracefully without ever losing past reports,
so that a failed card never destroys my trust.

## Acceptance Criteria

1. **Given** a failed renewal, **When** Stripe marks the subscription `past_due`, **Then** the webhook updates local state and the amber DunningBanner shows "Payment failed — retrying {day} · update card" (UX-DR33).
2. **Given** Stripe Smart Retries exhaust, **When** status reaches `canceled`/`unpaid`, **Then** the tier degrades to Free, Pro features lock via BlurLock, **And** every past report remains fully readable (FR33 — results-forever as visible behavior).
3. **Given** the grace window, **When** the subscription is `past_due`, **Then** Pro access continues until a terminal state.
4. **Given** recovery, **When** the payment method updates and Stripe resumes the subscription, **Then** Pro restores with no data loss.

## Tasks / Subtasks

- [x] **Task 1 — Persist Stripe retry date (`next_payment_attempt`) (AC: #1)**
  - [x] Add nullable `next_payment_attempt` (`DateTimeOffset?`) column to the `Subscription` entity: `components/bff/src/Spectr.Data/Entities/Subscription.cs`. It carries the Stripe `Invoice.NextPaymentAttempt` (the "retrying {day}" date) for an open dunning cycle; null whenever no retry is pending (active/recovered/terminal).
  - [x] Scaffold the EF Core 10 migration in `Spectr.Data/Migrations/` (`dotnet ef migrations add AddSubscriptionNextPaymentAttempt --project src/Spectr.Data --startup-project src/Spectr.Bff`). This is a plain nullable column add — no partial-index hand-edit needed (unlike the README's `is_current` caveat). Verify the generated `Up()`/`Down()` before committing.
- [x] **Task 2 — Wire the `invoice.payment_failed` / `invoice.paid` webhooks (AC: #1, #4)**
  - [x] In `BillingEndpoints.cs` `DispatchAsync()` (lines 1050-1057) the `invoice.paid` + `invoice.payment_failed` cases are currently an explicit no-op with the comment "Story 2.9 owns dunning UX state." Replace that no-op with real handling:
    - On `invoice.payment_failed`: read `Invoice.NextPaymentAttempt` and write it to the matching `Subscription.NextPaymentAttempt`. **Match the subscription by `Invoice.CustomerId` → `subscriptions.stripe_customer_id`** (the most stable linkage — see Stripe gotcha below; do NOT rely on `Invoice.Subscription`/`SubscriptionId`, which moved in the 2024 API restructure). If `NextPaymentAttempt` is null (retries exhausted), leave the field — the terminal `customer.subscription.updated`→`canceled`/`unpaid` event drives degradation.
    - On `invoice.paid`: clear `NextPaymentAttempt` (set null) for the matching subscription — recovery (AC #4).
  - [x] Also clear `NextPaymentAttempt` in `SubscriptionMirrorService.ApplyAsync` whenever the incoming Stripe status is `active` or `trialing` (belt-and-suspenders recovery path: a `customer.subscription.updated` → active may arrive without an `invoice.paid` we matched). `components/bff/src/Spectr.Bff/Services/SubscriptionMirrorService.cs:104`.
  - [x] Use a **tracked** subscription lookup for these writes (never `AsNoTracking()` on the write path — see the EF gotcha in CLAUDE.md stems section; an `AsNoTracking()` join silently drops `SaveChanges`).
  - [x] Webhook idempotency: these handlers run under the existing `webhook_events` dedupe (`INSERT … ON CONFLICT (id) DO NOTHING`, conditional on `processed_at IS NOT NULL` — story 2.1 pattern). Don't add a second dedupe.
- [x] **Task 3 — Expose the retry date in `BillingSummaryDto` (AC: #1)**
  - [x] Add `DateTimeOffset? RetryAt` to `BillingSummaryDto` (`components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs:35-45`), append-only (last positional field, defaulted). Populate from `sub.NextPaymentAttempt` in `BuildSummary()` (`BillingEndpoints.cs:578-608`); `FreeSummary()` leaves it null.
  - [x] `Status` is already passed through verbatim (raw Stripe status incl. `past_due`) — confirm, don't duplicate.
- [x] **Task 4 — Confirm + lock entitlement degradation semantics (AC: #2, #3)**
  - [x] **Already correct — verify, don't rebuild.** `EntitlementService.ComputeAsync` (`EntitlementService.cs:73-74`) sets `isPro = status == "active" || status == "past_due"`, so `past_due` keeps Pro (AC #3 grace window ✓) and `canceled`/`unpaid` fall through to credits-or-free (AC #2 degrade ✓). `AuthEndpoints.ResolveTier` (`AuthEndpoints.cs:220-228`) mirrors this for the billing summary tier.
  - [x] Add/confirm `EntitlementServiceTests` cases asserting: `past_due` → tier `pro` (full features); `canceled` → `free` (or `credits` if balance ≥ 1); `unpaid` → `free`/`credits`. If a `past_due`-keeps-pro test already exists, extend rather than duplicate.
  - [x] Do NOT add a separate "grace expiry" timer in our code — Stripe owns the retry schedule and emits the terminal `canceled`/`unpaid` transition. Our grace window === "status is still `past_due`."
- [x] **Task 5 — `retryAt` on the frontend billing type (AC: #1)**
  - [x] Add `retryAt: string | null` to `BillingSummaryResponse` (`components/frontend-spectr-v2/src/api/types.ts:40-51`), mirroring the new DTO field. **MERGE-CAREFULLY:** this file is co-owned by concurrent story 2-8 (usage page). At create time `git status` shows it clean, but re-check before editing — append the one field, do not reorder/rewrite the interface. (Note `BillingSummaryResponse.tier` is `'free' | 'pro'` only — the billing summary collapses credits into free; that's intentional, leave it.)
- [x] **Task 6 — `DunningBanner` component (AC: #1)**
  - [x] Create `components/frontend-spectr-v2/src/features/billing/DunningBanner.tsx` + `DunningBanner.module.css`. Amber tone via the existing `--orange` / `--sev-warning` token (`tokens.css:22,62`) — NO new color literals.
  - [x] Props: `{ summary: BillingSummaryResponse; onUpdatePayment: () => void }`. Renders ONLY when `summary.status === 'past_due'` (return `null` otherwise — caller can mount unconditionally).
  - [x] Copy, verbatim grammar (UX-DR33): `Payment failed — retrying {day} · update card`, where `{day}` is `summary.retryAt` formatted as a weekday (`Intl.DateTimeFormat(undefined, { weekday: 'long' })`); if `retryAt` is null, fall back to `Payment failed — update your card to keep Pro` (no broken "{day}").
  - [x] Single CTA "Update card" → `onUpdatePayment` (opens the Stripe Customer Portal). Reuse the portal-open path already in `ActivePlanCard` (`POST /billing/portal` → `CreatePortalSessionResponse.url`, validated by `isStripeHostedUrl(url, 'portal')` from `features/billing/stripe-url.ts`). Factor the portal-open into a small shared helper/hook if it eases reuse; otherwise inline-mirror it.
  - [x] A11y: banner carries `role="status"` (non-interrupting) and an accessible label; CTA is a real focusable `<button>`/`.btn`.
- [x] **Task 7 — Surface DunningBanner on the Billing page (AC: #1)**
  - [x] In `src/routes/_app/billing.tsx` render `<DunningBanner>` ABOVE the plan cards (the page already loads `['billing','me']` summary at line 38). The billing page already routes `past_due` to `ActivePlanCard` (so the user can reach the portal) — keep that; the banner sits above it as the explicit dunning surface (UX-DR33 "Billing page: … DunningBanner amber").
- [x] **Task 8 — App-shell dunning notice (AC: #1)**
  - [x] In `src/routes/_app.tsx` `AppLayout`, insert the same `DunningBanner` between the sticky `<header>` topnav and `<main>` (around line 179-181) so the dunning state is visible app-wide, not only on the billing page.
  - [x] Add a lightweight `['billing','me']` query in the layout (reuse the same queryKey + 30s staleTime as billing.tsx so it dedupes against the billing page's query — TanStack Query shares the cache; no double fetch). Banner renders only on `past_due`; zero render cost otherwise.
  - [x] On the layout's "Update card" CTA, open the portal the same way. After the portal round-trip and on focus, the 30s-stale `['billing','me']` refetches and the banner self-clears on recovery (AC #4) — no manual state.
- [x] **Task 9 — BlurLock lapsed-Pro degradation (AC: #2)**
  - [x] When the subscription terminates (`canceled`/`unpaid`) the entitlements flip to `free`, so the **existing 2.7 BlurLock gating** on the stems / `.als` upload zones (keyed off `entitlements.stemsEnabled`/`alsEnabled`) already locks automatically. Verify this still holds for a lapsed-Pro user (not just never-Pro) — same `useEntitlements()` source, so it should. Add a test fixture for the lapsed-Pro → free case.
  - [x] **Results-forever (AR15) is the hard guarantee:** do NOT BlurLock or hide any already-delivered report content for a lapsed user. Past analyses (all tabs: verdicts, spectrum, reference, arrangement, .als chips) stay fully readable regardless of tier. Only NEW-analysis depth (stems/.als inputs, new full-verdict runs) is gated. Add/confirm a test asserting a degraded (free) user can still GET + render a previously-completed Pro analysis.
  - [x] If a lapsed-Pro user hits a locked NEW-depth surface, the BlurLock CTA opens the existing `UpgradeSheet` (story 2.7, D2 — one upgrade surface everywhere). No new modal.
- [x] **Task 10 — Tests + gates**
  - [x] **BFF:** webhook test — `invoice.payment_failed` with a `next_payment_attempt` persists `Subscription.NextPaymentAttempt` (matched by customer id); `invoice.paid` clears it; `customer.subscription.updated`→active clears it. `BillingSummaryDto.RetryAt` round-trips. EntitlementService degradation matrix (Task 4). Run `dotnet build && dotnet test`.
  - [x] **Frontend:** `DunningBanner.test.tsx` — renders amber banner + verbatim "{day}" copy when `status==='past_due'` with a `retryAt`; null-retryAt fallback copy; renders nothing for `active`/`canceled`/`free`; CTA fires `onUpdatePayment`; `role="status"` present. Extend `billing-page-state.test.ts` for the banner-visibility predicate. A lapsed-Pro entitlements fixture keeps results readable + locks new-depth.
  - [x] Run all four frontend gates from `components/frontend-spectr-v2/`: `npx tsc --noEmit`, `npm run lint` (--max-warnings 0), `npm run build`, `npx vitest run`. Keep `import type` for type-only imports (verbatimModuleSyntax).

## Dev Notes

### What's already done (do NOT rebuild)
- **Subscription status is already stored raw.** `SubscriptionMirrorService.ApplyAsync` writes `existing.Status = stripeSub.Status` verbatim (`SubscriptionMirrorService.cs:104`) for `customer.subscription.created/updated/deleted`. All 7 Stripe states (`active`, `trialing`, `past_due`, `canceled`, `unpaid`, `incomplete*`) land in `subscriptions.status` already. **2.9 does NOT need to add status mapping — only the retry date + the UI.**
- **Grace window + degradation are already correct in entitlements.** `EntitlementService.cs:73-74`: `isPro = status == "active" || status == "past_due"`. So `past_due` keeps Pro (AC #3) and terminal states degrade (AC #2) WITHOUT new tier logic. `AuthEndpoints.ResolveTier` (`AuthEndpoints.cs:220-228`) mirrors it for the billing summary. Task 4 is verify-and-test, not build.
- **Webhook plumbing exists.** `BillingEndpoints.cs` handles `invoice.paid` + `invoice.payment_failed` (currently explicit no-op at lines 1050-1057, comment literally says "Story 2.9 owns dunning UX state"). Signature verification + `webhook_events` idempotency (story 2.1) already wrap every event — reuse, don't re-add.
- **`BillingSummaryDto.Status` already reaches the frontend** (`BillingDtos.cs:35-45` → `BillingSummaryResponse.status`). The only missing backend field is the retry date.
- **BlurLock + UpgradeSheet shipped in story 2.7.** `src/components/BlurLock.tsx` — `{ locked, reason, ctaLabel, onUnlock, children }`; renders children untouched when unlocked, blurred+inert with an `aria-label` overlay + single CTA when locked. Already applied to the upload dialog's stems/.als zones keyed off entitlements. `UpgradeSheet` is the shared upgrade modal (D2: one surface everywhere).
- **`useEntitlements()`** — `src/api/hooks.ts:105` (`queryKey: ['me','entitlements']`, 30s stale). `EntitlementsDto` (`types.ts:99-112`) has `tier: 'free'|'credits'|'pro'`, `stemsEnabled`, `alsEnabled`, `fullVerdictsEnabled`. No subscription-status field — dunning status comes from `['billing','me']` (`BillingSummaryResponse`), not entitlements.
- **Billing page query:** `src/routes/_app/billing.tsx:38` — inline `useQuery(['billing','me'])`, 30s staleTime. Portal open lives in `ActivePlanCard` (`POST /billing/portal` → URL validated by `isStripeHostedUrl(..,'portal')`).

### Stripe.net gotchas (52.x — see CLAUDE.md .NET section)
- **`Invoice.NextPaymentAttempt`** is a `DateTime?` directly on the `Stripe.Invoice` object — read it from the deserialized invoice in the `invoice.payment_failed` handler. Confirm the exact property name against the installed Stripe.net version during impl (the field is stable, but verify before relying on it).
- **Do NOT use `Invoice.Subscription` / `Invoice.SubscriptionId` to find the local row.** Per the 2024 API restructure (same restructure that moved `CurrentPeriodEnd`/`Price` onto `SubscriptionItem`), subscription linkage on the invoice shifted. **Match on `Invoice.CustomerId` → `subscriptions.stripe_customer_id`** (always present, never moved). The mirror service already keys subscriptions by customer/subscription id, so this is consistent.
- **Idempotency on mutating Stripe calls** still applies if Task 6 adds any portal/session call — but reusing the existing portal path inherits its `IdempotencyKey`. No new Stripe writes are expected for the webhook handlers (they only read the event + write our DB).
- **Tracked lookups on the write path** — never `AsNoTracking()` on the subscription you intend to update (silent `SaveChanges` drop; documented in the stems EF gotcha).

### Pattern to mirror
- **Banner styling:** global utilities + `--orange`/`--sev-warning` token (`tokens.css:22,62`). Match the card/section styling already in `billing.module.css`. Amber, not red — dunning is recoverable, not an error.
- **Portal open:** copy the `pendingAction === 'portal'` flow in `ActivePlanCard` (`billing.tsx:~114+`) — `POST /billing/portal`, validate with `isStripeHostedUrl`, then `window.location.assign(url)` (full-page is fine here — no in-memory File to preserve, unlike the 2.7 upload resume).
- **Degradation copy precedent:** `src/features/results/degradationCopy.ts` is the *analysis* degraded-verdict copy (unrelated to billing) — do not reuse it; dunning copy is verbatim from UX-DR33.

### Decisions
- **D1 — Grace window owner: Stripe.** We do not compute or store a grace-expiry timestamp. "In grace" === `status === 'past_due'`. Stripe Smart Retries emit the terminal `canceled`/`unpaid` transition when retries exhaust; our webhook just mirrors it and entitlements degrade automatically. `next_payment_attempt` is display-only (the "{day}" in the banner), never an access-control gate.
- **D2 — One DunningBanner, two mount points.** The same component renders on the Billing page (Task 7) and in the app shell (Task 8), both reading the shared `['billing','me']` cache. No duplicate fetch (TanStack dedupes by key). App-shell mount makes the state unmissable; billing-page mount sits next to the fix action.
- **D3 — Degradation reuses 2.7 BlurLock, no new gating code.** Terminal status → entitlements flip to `free` → the existing entitlement-keyed BlurLocks lock. 2.9 adds no new lock surfaces; it adds tests proving a *lapsed* (not just never-Pro) user is gated on new depth AND can still read every delivered report (AR15).

### Project Structure Notes
- New frontend files: `src/features/billing/DunningBanner.tsx` + `DunningBanner.module.css` (+ `__tests__/DunningBanner.test.tsx`). Lives under `features/billing/` alongside `useUpgradeCheckout.ts`, `CancelDialog.tsx`, `stripe-url.ts`.
- BFF: entity + migration + DTO field + webhook handler edits + tests. No new BFF files except the migration.
- **Merge watch:** `src/api/types.ts` (Task 5) is co-owned by concurrent story 2-8. Append the single `retryAt` field; do not rewrite the interface. Re-run `git status` before editing — if 2-8 left uncommitted edits, merge by hand, do not overwrite.

### Testing standards
- Frontend: Vitest + Testing Library; four gates mandatory. Assert `role="status"` + accessible CTA on the banner; assert verbatim "{day}" grammar and the null-retryAt fallback.
- BFF: xUnit; webhook handler tests with a faked `invoice.payment_failed`/`invoice.paid` event payload; EntitlementService degradation matrix. `dotnet build` 0 warnings + `dotnet test` green.
- Reuse the AR38 error envelope `{ error: { code, message, details } }` in any error fixtures.

### References
- [Source: PRPs/epics.md#Story-2.9] (epics.md:654-665) — AC verbatim
- [Source: PRPs/epics.md] (line 76, FR33) — dunning sequence + grace + results-forever degradation
- [Source: PRPs/ux-design-specification.md#UX-DR33] (line 278) — Billing page DunningBanner amber "Payment failed — retrying Thursday · update card"; post-grace quiet downgrade via BlurLock; existing reports fully readable
- [Source: PRPs/ux-design-specification.md#UX-DR29] (line 274) — BlurLock contract (reused)
- [Source: components/bff/src/Spectr.Data/Entities/Subscription.cs] — subscription entity (add next_payment_attempt)
- [Source: components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs:1050-1057] — invoice.paid/payment_failed no-op to replace
- [Source: components/bff/src/Spectr.Bff/Services/SubscriptionMirrorService.cs:104] — status mirror (+ clear retry on recover)
- [Source: components/bff/src/Spectr.Bff/Services/EntitlementService.cs:73-74] — isPro incl. past_due (grace) — verify
- [Source: components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs:220-228] — ResolveTier mirror
- [Source: components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs:35-45] — BillingSummaryDto (+ RetryAt)
- [Source: components/frontend-spectr-v2/src/api/types.ts:40-51] — BillingSummaryResponse (+ retryAt) — MERGE WATCH (2-8)
- [Source: components/frontend-spectr-v2/src/routes/_app/billing.tsx:38] — ['billing','me'] query + ActivePlanCard portal open
- [Source: components/frontend-spectr-v2/src/routes/_app.tsx:179-181] — AppLayout topnav/main seam (banner mount)
- [Source: components/frontend-spectr-v2/src/components/BlurLock.tsx] — reused lock primitive
- [Source: components/frontend-spectr-v2/src/features/billing/stripe-url.ts] — isStripeHostedUrl portal validation
- [Source: components/frontend-spectr-v2/src/styles/tokens.css:22,62] — --orange / --sev-warning amber token

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- Frontend `npm run build` (`vite build && tsc -b`) initially failed two TS2741 errors: the pre-existing `FREE`/`PRO_ACTIVE` fixtures in `billing-page-state.test.ts` lacked the newly-required `retryAt` field. (Standalone `tsc --noEmit` passed because it excludes the test tsconfig; the build's `tsc -b` includes it.) Fixed by adding `retryAt: null` to both fixtures.
- First draft of `DunningBanner.test.tsx` imported `@testing-library/react`, which is NOT a project dependency — the vitest env is `node` and components are asserted via `react-dom/server`'s `renderToStaticMarkup` (mirrors `BlurLock.test.tsx`). Rewrote the test to the project's static-markup convention.
- **Concurrency note (story 2-8 running in parallel):** 2-8 (usage page) was live-editing several files this story also touches — `BillingDtos.cs` (added fields to `EntitlementsDto`), `EntitlementServiceTests.cs` (added `Coach`/`AnalysesResetsAt` assertions), `_app.tsx` + `_appLayout.module.css` (added `UsageMeter`/`useEntitlements`). All edits targeted disjoint regions (I touched `BillingSummaryDto`, appended EntitlementService cases h/i/j, added the dunning banner mount + `.dunningSlot`), so they merged cleanly — but every shared-file edit was preceded by a fresh read. Both stories' tests pass together (frontend 353, BFF 144). Flagging for the reviewer: final gate numbers include 2-8's in-flight work.

### Completion Notes List

- **AC1 — DunningBanner:** New `DunningBanner` (`features/billing/`) renders the verbatim UX-DR33 amber notice "Payment failed — retrying {day} · update card" only while `status === 'past_due'` (returns `null` otherwise), with a null-`retryAt` fallback ("Payment failed — update your card to keep Pro"). `{day}` is the weekday of `retryAt` via `Intl.DateTimeFormat`. Surfaced in two places sharing the `['billing','me']` cache: the Billing page (`billing.tsx`, above the plan card) and an app-wide `AppDunningNotice` mounted in `_app.tsx` between topnav and `<main>` (suppressed on `/billing` to avoid a double banner). The "Update card" CTA opens the Stripe Customer Portal via the new shared `useBillingPortal` hook (validated by `isStripeHostedUrl(..,'portal')`). Banner carries `role="status"` + `aria-label`.
- **AC1 backend — retry-date persistence:** Added nullable `subscriptions.next_payment_attempt` (entity + migration `20260623153758_AddSubscriptionNextPaymentAttempt`, a plain nullable column add). The previously no-op `invoice.payment_failed` / `invoice.paid` webhook cases now persist/clear it: payment_failed stamps `Invoice.NextPaymentAttempt`, paid clears it. The subscription is matched by `Invoice.CustomerId → stripe_customer_id` (the stable linkage; invoice→subscription pointers moved in the 2024 Stripe restructure) using a **tracked** lookup. Surfaced via the new defaulted `BillingSummaryDto.RetryAt` (populated only on the read path; write paths project a freshly-mutated active state with no retry).
- **AC2 — degradation:** Confirmed (no rebuild) that terminal `canceled`/`unpaid` already fall through `EntitlementService` to `free` (or `credits` if a balance remains), locking the Pro-depth inputs (`StemsEnabled`/`AlsEnabled`/`FullVerdictsEnabled = false`) — which the existing story-2.7 BlurLock gates key off, so a *lapsed* Pro user is gated identically to a never-Pro user. New `EntitlementServiceTests` cases (h) canceled→free, (i) unpaid→free, (j) canceled+credits→credits pin this. Results-forever (AR15) is structurally proven by the existing `ResultsReadPathEntitlementFreeTest` (the job-status/results read paths never call `EntitlementService`), so a degraded user keeps full read access to every delivered report — no new code or gate added on the read path.
- **AC3 — grace window:** Confirmed `EntitlementService` already keeps Pro on `past_due` (existing case (e) `Pro_PastDue_StillPro`). Our grace window is defined purely by "status is still `past_due`" — no separate expiry timer; Stripe Smart Retries emit the terminal transition. `next_payment_attempt` is display-only, never an access gate.
- **AC4 — recovery:** `invoice.paid` clears the retry date; `SubscriptionMirrorService.ApplyAsync` also clears it whenever an incoming status is `active`/`trialing` (belt-and-suspenders). New webhook test `Webhook_Invoice_Paid_Clears_NextPaymentAttempt` covers it. Tier restores via the normal status mirror; no data touched.
- **Gates:** Frontend `tsc --noEmit` clean, `eslint --max-warnings 0` clean, `build` clean, `vitest` 353/353. BFF `dotnet build` 0 warnings, `dotnet test` 144/144 (incl. new webhook retry-date persist/clear, BillingSummary RetryAt round-trip, and entitlement degradation cases).

### File List

**BFF — new**
- `components/bff/src/Spectr.Data/Migrations/20260623153758_AddSubscriptionNextPaymentAttempt.cs` (+ `.Designer.cs`)
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/invoice_payment_failed.json`
- `components/bff/tests/Spectr.Bff.Tests/Fixtures/StripeEvents/invoice_paid.json`

**BFF — modified**
- `components/bff/src/Spectr.Data/Entities/Subscription.cs` (`NextPaymentAttempt` column)
- `components/bff/src/Spectr.Data/Migrations/AppDbContextModelSnapshot.cs` (regenerated)
- `components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs` (`BillingSummaryDto.RetryAt`)
- `components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs` (invoice webhook handler; `DispatchAsync` `db` param; `BuildSummary` + read-path `retryAt`)
- `components/bff/src/Spectr.Bff/Services/SubscriptionMirrorService.cs` (clear retry on active/trialing recovery)
- `components/bff/tests/Spectr.Bff.Tests/StripeWebhookEndpointTests.cs` (2 retry-date persist/clear tests)
- `components/bff/tests/Spectr.Bff.Tests/EntitlementServiceTests.cs` (cases h/i/j degradation matrix)
- `components/bff/tests/Spectr.Bff.Tests/BillingManageEndpointsTests.cs` (RetryAt round-trip + seed helper param)

**Frontend — new**
- `components/frontend-spectr-v2/src/features/billing/DunningBanner.tsx`
- `components/frontend-spectr-v2/src/features/billing/DunningBanner.module.css`
- `components/frontend-spectr-v2/src/features/billing/AppDunningNotice.tsx`
- `components/frontend-spectr-v2/src/features/billing/useBillingPortal.ts`
- `components/frontend-spectr-v2/src/features/billing/__tests__/DunningBanner.test.tsx`

**Frontend — modified**
- `components/frontend-spectr-v2/src/api/types.ts` (`BillingSummaryResponse.retryAt`)
- `components/frontend-spectr-v2/src/routes/_app/billing.tsx` (DunningBanner above cards + `useBillingPortal`)
- `components/frontend-spectr-v2/src/routes/_app.tsx` (AppDunningNotice mount, suppressed on /billing)
- `components/frontend-spectr-v2/src/routes/_app/_appLayout.module.css` (`.dunningSlot`)
- `components/frontend-spectr-v2/src/features/billing/__tests__/billing-page-state.test.ts` (showsDunning predicate + retryAt fixtures)

### Deferred Scope (explicit, not gaps)

- **D-1 — DunningBanner CTA click→callback unit test:** The project's vitest env is `node` (no DOM events), so component tests assert static markup only — the `onUpdatePayment` wiring is verified by markup presence (single `Update card` button, `disabled`/"Opening…" while pending), not a simulated click. Matches the existing `BlurLock`/`CancelDialog` test convention. A live-DOM interaction test would need a jsdom harness + `@testing-library/react` (not a project dep); defer to a future billing E2E suite.
- **D-2 — `useBillingPortal` not unit-tested:** It mirrors the already-shipped inline portal flow in `ActivePlanCard` (window navigation + `isStripeHostedUrl` guard, both covered by `stripe-url.test.ts`). The hook itself wraps a `window.location.assign`, awkward to unit-test in isolation; covered manually and by the shared URL-validation tests.
- **D-3 — ActivePlanCard not refactored onto `useBillingPortal`:** The story permitted "factor or inline-mirror." To minimise churn on the co-owned `billing.tsx` during 2-8's concurrent work, `ActivePlanCard`'s existing inline portal handler was left as-is; the new hook is used only by the new dunning surfaces. A later cleanup can consolidate `ActivePlanCard` onto the hook.
