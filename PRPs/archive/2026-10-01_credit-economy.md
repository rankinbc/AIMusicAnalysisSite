# PRP — Credit economy: buy credits, see balance, see costs before acting

**Status:** spec approved in chat 2026-10-01 — awaiting written-spec review, then an implementation plan.
**Branch:** `feat/credit-economy` (off `origin/solo`).
**Goal:** turn on paid usage so every Claude API call is covered (break-even, not profit), and make every cost visible before the user spends.

---

## 1. Decisions (owner, 2026-10-01)

| Topic | Decision |
|---|---|
| Tier model | **Credits are the default currency + Pro stays.** No monthly free allowance — the signup grant IS the free trial. |
| Signup grant | **500 credits** to every new account. |
| Prices | Analysis **100** · extra specialist **15** · coach message **5** · Coach Mix **5**. Free: free retry, per-phase re-run, reference analysis, coach opening brief. |
| What "analysis" includes | Triage + every specialist triage routed (the auto-run set) + the coach brief. |
| Packs | **500 / $7**, **1,500 / $18**, **5,000 / $55**. Credits never expire. |
| Pro ($12.99/mo, unchanged price) | **15 analyses + 300 coach messages per calendar month**, specialists + Coach Mix included, stems/.als/full history. |
| Pro overflow | Past either cap, the action **draws from the credit balance** at normal prices. No hard stop. |
| Cost display | **Labels only**: balance chip in the app top bar + cost on every paid button. **No confirm dialogs.** Insufficient balance → the button opens the buy-credits sheet. |

Cost basis (estimate, see the 2026-10-01 session): 1 credit ≈ 1¢ of Claude cost; analysis ≈ $0.40–1.00 before prompt caching (`feat/llm-prompt-caching`).

### Assumptions (stated in the design, not objected to)

- **Existing accounts** get a one-time 500-credit grant when credits are switched on.
- **Guest demo + anonymous `/analyze`** stay free under their existing caps (`guest_*`, `anon_*` flags). Out of scope.
- **Running out never locks past work**: reports, coach history, Listen stay readable at 0 credits.

---

## 2. Current state (facts, `origin/solo` @ 9e3e8b1)

- Ledger: `components/bff/src/Spectr.Bff/Services/CreditLedgerService.cs` — `SpendOnceAsync` hardcodes `Amount = -1` (`:144`), serializable tx, balance ≥ 1 check (`:136-140`). Reasons allowed by CHECK: `purchase|spend|reversal|adjustment` (migration `20260616031132`, `AppDbContext.cs:212`).
- Only spend site: `VersionEndpoints.DispatchAnalysisAsync` (`VersionEndpoints.cs:1461-1490`), only when `ent.Tier == "credits"`.
- Specialists (`VerdictEndpoints.cs:175-226`), Coach Mix (`FixRackEndpoints.cs:25-67`), coach messages (`CoachConversationEndpoints.cs:189`) are unmetered for real users.
- Reversal: only `invalid_file`, lazily on `GET` job (`JobEndpoints.cs:308-340`).
- Packs: sizes 5|10 hardcoded (`BillingEndpoints.cs:659`); display prices `PricingDisplayOptions.cs:28-29`; Stripe price ids `StripeOptions.cs:24-25` (unset everywhere); delivery in the `checkout.session.completed` webhook (`BillingEndpoints.cs:1031-1061`).
- Tiers: `EntitlementService.cs` (free / pro / credits; 60 s cache); coach caps `CoachCapService.cs` (credits tier = unlimited coach).
- Kill switch `credits_enabled` seeded `'false'` → everyone resolves as premium (`EntitlementService.cs:100-116`, `CoachCapService.cs:60-68`).
- Pricing page: `features/pricing/PricingPlansView.tsx` (credits card disabled, "Coming soon"). Price-literal lint: `scripts/check-price-literals.mjs`.
- LLM budget lanes: triage/specialist/coach calls don't pass tier → all metered under the **free** lane (`gateway.py:290`, `lane.py`), ceiling `llm_budget_free_usd=5`.

---

## 3. Design

### 3.1 One price list (server-authoritative, live-tunable)

New `feature_flags` rows (idempotent `INSERT … ON CONFLICT DO NOTHING` migration):

| Flag | Value |
|---|---|
| `credit_cost_analysis` | `100` |
| `credit_cost_specialist` | `15` |
| `credit_cost_coach_message` | `5` |
| `credit_cost_coach_mix` | `5` |
| `credit_signup_grant` | `500` |
| `pro_analyses_monthly` | `15` |

`coach_pro_monthly` (300) already exists. New `CreditPriceService` (BFF, scoped) reads them through the existing 60 s feature-flag cache (`EntitlementService.GetFlagsAsync`) with hard-coded fallbacks equal to the table above.

`GET /api/billing/prices` (anonymous-readable, so the pricing page can render it) → `CreditPricesDto { analysis, specialist, coachMessage, coachMix, signupGrant, proAnalysesMonthly, proCoachMonthly, packs: [{ credits, priceCents }] }`. The frontend never hardcodes a credit cost.

### 3.2 Ledger

- `CreditLedgerService.SpendAsync(userId, amount, reason, idempotencyKey, refType, refId)` replaces the hardcoded `-1`; balance check becomes `balance >= amount`. Keep `SpendOnceAsync` as a thin wrapper until callers migrate, then delete.
- New ledger reason **`grant`** (CHECK constraint migration + `AppDbContext` enum). Used for the signup grant and the one-time backfill.
- Every spend carries an idempotency key (`spend:analysis:{jobId}`, `spend:specialist:{analysisId}:{slug}`, `spend:coach:{messageId}`, `spend:coachmix:{analysisId}:{n}`) so retries never double-charge.

### 3.3 Spend points

A single `ChargeService.TryChargeAsync(user, action, refId)` decides, in order:
1. `credits_enabled` off → free (today's premium behaviour, unchanged).
2. Action is free by rule (see 3.4) → free.
3. User is Pro and the action is within their monthly allowance → free (allowance counted from `usage_events`).
4. Otherwise spend `price(action)` credits; insufficient → `402` with error envelope `insufficient_credits` + `{ required, balance }`.

| Action | Endpoint | Rule |
|---|---|---|
| Analysis | `DispatchAnalysisAsync` (all 6 dispatch sites) | 100; Pro: free for the first `pro_analyses_monthly` per calendar month (UTC). `freeRetry` stays free. |
| Specialist | `POST /reports/{jobId}/verdicts/run/{slug}` | Free if `slug ∈ analyses.routing_plan` (triage's auto-run set — covered by the analysis price). Otherwise 15; Pro: free. One charge per (analysis, slug) — already one verdict per pair. |
| Coach message | `POST` coach message (`CoachConversationEndpoints.PostMessage`) | 5; brief excluded (already excluded from caps). Pro: free within `coach_pro_monthly`. Charge in the same `SaveChanges` as the message + `coach_message` usage event. |
| Coach Mix | `POST /reports/{jobId}/fix-rack` | 5; Pro: free. Re-fetching an existing rack (GET) is free. |
| Per-phase re-run, reference analysis, free retry | — | Free. |

The existing free-tier paths (`free_analyses_per_month`, `coach_free_followups`) stop applying when credits are on: a non-Pro user is a credits user with whatever balance they have (possibly 0). `EntitlementService` tier resolution becomes **pro | credits** under `credits_enabled`.

### 3.4 Refunds

Generalise reversal: when an analysis job ends `failed` for **any** reason except user-cancel, reverse its spend (`reversal:{jobId}`, idempotent). Move it from the lazy `GET` path into the worker-status write path the BFF already observes, keeping the lazy path as a backstop. A specialist that ends as a fail-marker (`headline='Specialist failed'`) reverses its 15. A degraded Coach Mix (LLM failed, deterministic chain kept) is **not** refunded — the user still got a rack.

### 3.5 Signup grant + backfill

- Registration (and anon-device claim on registration) writes `grant +credit_signup_grant` in the same transaction that creates the user. Idempotency key `grant:signup:{userId}`.
- One-time backfill: idempotent BFF startup task (or admin endpoint) that grants 500 to every existing non-guest user without a `grant:signup:*` row. Runs only when `credits_enabled` is true; safe to run repeatedly.

### 3.6 Buying credits

- Pack sizes become config: `CreditPacks: [{credits:500, cents:700, stripePriceId}, {1500, 1800, …}, {5000, 5500, …}]` in `PricingDisplayOptions` / `StripeOptions` (the only place price literals are allowed). `BillingEndpoints.cs:659`'s `5|10` check validates against this list.
- Checkout: existing `/api/billing/checkout/credits` with `{ credits }`; webhook `checkout.session.completed` already credits `+pack_size` idempotently — keep, now with the new sizes.
- **Operator step:** create three one-time Stripe prices and set `Stripe__PriceCreditPack500|1500|5000` (+ compose/env wiring in `infra/compose.prod.yml`, `.env.example`).
- Reconciliation (`BillingReconciliationService`) checks the new display prices against Stripe.

### 3.7 Frontend

- **Balance chip** in the app top nav (`routes/_app.tsx` header): `◆ 420`. Click → buy sheet (packs from `/api/billing/prices`) + link to `/usage` history. Hidden when `creditsEnabled` is false. Pro users see "Pro · 9/15 analyses" plus their balance.
- **Cost labels** (`CostTag` component, reads `useCreditPrices()`):
  - Upload / Analyze: `UnifiedUploadDialog.tsx` submit + re-analyze actions — "Analyze · 100 ◆" (or "Included in Pro (9/15)").
  - Specialist run: `SpecialistTeamModal.tsx` / `ReportView.tsx` — "Run · 15 ◆"; auto-run (routed) specialists show "Included".
  - Coach input: `CoachChat.tsx` and Listen `CoachTabV2.tsx` — "5 ◆ per message" hint under the input.
  - Coach Mix: `useFixRackGeneration` trigger in `ReportView.tsx` — "Coach Mix · 5 ◆".
- **Insufficient balance**: the paid button stays visible; clicking it opens the buy sheet instead of firing. A `402 insufficient_credits` from the server (race) also opens it.
- **No confirm dialogs** (owner decision).
- After any charge, invalidate the entitlements/balance query so the chip updates.
- Pricing page (`PricingPlansView.tsx`): enable the credits card with the three packs; update Free card copy to "500 credits to start"; Pro card copy to "15 analyses + 300 coach messages / month, then credits".

### 3.8 Required fix — LLM budget lanes

Triage, specialist and coach calls must pass the real tier to the gateway (from the job/analysis owner's entitlement) so spend lands in the right lane. Raise `llm_budget_free_usd` to reflect that credits users are now paying (they are metered as `credits`, a new lane with its own ceiling `llm_budget_credits_usd`, seeded generously). Without this, a handful of paying users exhaust the free lane and the coach goes offline for everyone.

### 3.9 Rollout

1. Ship everything dark (`credits_enabled` still `false` → no behaviour change).
2. Operator: create Stripe prices, set env, deploy.
3. Flip `credits_enabled = true` (≤ 60 s propagation) → backfill grant runs → chips/labels appear.
4. Watch `llm_calls` cost per analysis vs. 100 credits for a week; tune prices via flags (no redeploy).

---

## 4. Testing

- **BFF (xUnit):** `SpendAsync` amount + insufficient balance; each spend point charges the right amount, is idempotent on retry, is free when routed / within Pro allowance / kill switch off; Pro overflow draws credits; refund on failed analysis + failed specialist; signup grant once per user; backfill idempotent; pack-size validation; `/api/billing/prices` reflects flag overrides.
- **Worker (pytest):** tier passed to gateway for triage/specialist/coach; `credits` budget lane.
- **Frontend (vitest):** `CostTag` renders from prices; insufficient balance opens the buy sheet; chip hidden when credits disabled; Pro allowance text.
- **Live pass** (dev, Stripe test mode): sign up → 500 → analyze (400) → run extra specialist (385) → coach ×2 (375) → Coach Mix (370) → buy 500-pack (870); fail a job → refund.

## 5. Out of scope

Guest/anon funnel changes · Pro price change · credit expiry · gifting/promo codes · per-region pricing · showing $ next to credits.
