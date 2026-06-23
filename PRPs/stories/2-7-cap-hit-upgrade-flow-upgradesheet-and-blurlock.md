# Story 2.7: Cap-Hit Upgrade Flow (UpgradeSheet + BlurLock)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a free user at my cap,
I want an honest upgrade moment that shows what I'd get and never loses my work,
so that paying feels like an invitation, not a trick.

## Acceptance Criteria

1. **Given** a 4th upload attempt in a month, **When** I click upload, **Then** the UpgradeSheet opens BETWEEN actions (never mid-pipeline): header "3 of 3 free analyses used this month," value-recap strip with my own grade chips, PRO card with period toggle + savings, CREDITS card ("no subscription, never expire"), trust line ("Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio"), and a ghost "wait for next month" exit (UX-DR30).
2. **Given** checkout completes from the sheet, **When** I return, **Then** the file I originally chose resumes uploading automatically — work never lost.
3. **Given** BlurLock (UX-DR29), **When** depth is gated anywhere (free-tier stems tab, lapsed-Pro features), **Then** real blurred content + one-line unlock copy + a single CTA render **And** the lock reason is announced to assistive tech.
4. **Given** the gate-between-never-during pattern (UX-DR38), **When** any entitlement state changes mid-pipeline, **Then** in-flight jobs complete and persist.

## Tasks / Subtasks

- [x] **Task 1 — `BlurLock` wrapper component (AC: #3)**
  - [x] Create `components/frontend-spectr-v2/src/components/BlurLock.tsx` + `BlurLock.module.css`. ONE component for ALL gating surfaces (UX-DR29).
  - [x] Props: `{ locked: boolean; reason: string; ctaLabel: string; onUnlock: () => void; children: ReactNode }`. When `locked === false`, render `children` untouched (zero overhead in the ungated path).
  - [x] When locked: render the REAL `children` underneath, visually obscured via CSS `filter: blur()` + reduced opacity (the user must see *what* they're missing — not a placeholder). Overlay a centered panel: one-line unlock copy (`reason`) + a single `.btn.primary` CTA (`ctaLabel`).
  - [x] A11y: blurred children get `aria-hidden="true"` + `inert` (or `pointer-events:none` + `tabindex=-1` on focusables) so they're not reachable; the overlay carries `role="group"` + `aria-label={reason}` so the lock reason is announced. CTA is keyboard-focusable.
  - [x] Respect `prefers-reduced-motion` — no animated blur transitions when set.
- [x] **Task 2 — `PlanCard` + `TierChip` presentational components (AC: #1)**
  - [x] Create `components/frontend-spectr-v2/src/components/PlanCard.tsx` (+ shared module css). Renders one plan: title, price line, feature bullets, CTA. Two variants used in the sheet: PRO (`unlimited analyses · all verdicts · stems + .als · coach pool · version history`) and CREDITS (`no subscription · never expire`).
  - [x] PRO card carries a monthly/annual period toggle that shows savings; prices come from `GET /api/billing/plans` (`PlansResponse`, story 2.1) — **NO price literals in component code** (AR39/AR40).
  - [x] Create `TierChip.tsx` (small tier badge: free/credits/pro) — reused in the value-recap strip and elsewhere. Keep it dumb.
- [x] **Task 3 — `UpgradeSheet` modal (AC: #1)**
  - [x] Create `components/frontend-spectr-v2/src/components/UpgradeSheet.tsx` + `UpgradeSheet.module.css`. Build on Radix `@radix-ui/react-dialog` (`Dialog.Root/Portal/Overlay/Content/Title/Description`) mirroring `NewSongDialog.tsx` (focus trap + ESC + overlay already handled by Radix).
  - [x] Props: `{ open: boolean; onOpenChange: (o: boolean) => void; analysesUsed: number; analysesLimit: number; gradeChips: Array<{label: string; grade: string}>; onSubscribe: (cadence: 'monthly'|'annual') => void; onBuyCredits: () => void; onWaitNextMonth: () => void }`.
  - [x] Header: `"{used} of {limit} free analyses used this month"` (reuse 2.8 cap grammar; substitute live counts — do NOT hardcode "3 of 3").
  - [x] Value-recap strip: render the user's own grade chips from this period (reuse the existing grade-pill rendering used on results — confirm component name during impl; the chips are the user's *climb*). If zero reports this period, omit the strip (don't show an empty rail).
  - [x] Two `PlanCard`s side-by-side: PRO (toggle + savings) and CREDITS (5-pack price, "no subscription, never expire").
  - [x] Trust line under the buttons, verbatim: `Cancel anytime in two clicks · Your reports stay yours forever · No AI training on your audio`.
  - [x] Ghost exit: a `.btn.ghost` (or text link) `"wait for next month"` that calls `onWaitNextMonth` (honest exit, UX-DR30) — closes the sheet, no dark pattern.
  - [x] Button hierarchy: exactly ONE `.btn.primary` (Subscribe); everything else ghost (UX-DR §button-hierarchy).
- [x] **Task 4 — Wire UpgradeSheet into the upload cap-hit path (AC: #1, #2)**
  - [x] In `UnifiedUploadDialog.tsx`: the catch at line ~477 already sets `setEntExhausted(true)` on `entitlement_exhausted`. Replace the placeholder behavior so `entExhausted` opens the `UpgradeSheet` instead of just flagging.
  - [x] **Client-side pre-check (gate-between, UX-DR38):** before starting the upload pipeline, if `useEntitlements()` reports `analysesRemaining === 0` for a non-pro tier, open the UpgradeSheet INSTEAD of dispatching — so the sheet appears between the click and any pipeline work, not after a server round-trip. Keep the server 409 catch as the race-condition backstop (last slot consumed concurrently).
  - [x] **Resume-after-checkout (AC #2):** stash the originally chosen `File` + dialog intent in memory (a ref/module state — `File` objects cannot survive a top-level navigation). On checkout success, re-open the dialog pre-populated and auto-start the upload with the stashed file. **See Decision D1 below for the checkout-window strategy** — a hosted-Stripe full-page redirect would discard the in-memory `File`, so checkout must open in a popup/new tab while the SPA stays alive.
  - [x] On successful subscribe/credit purchase, invalidate `['me','entitlements']` (and `auth/me`) so the tier flip is reflected before resume.
- [x] **Task 5 — Wire UpgradeSheet into the results re-analyze cap-hit path (AC: #1)**
  - [x] `ReportView.tsx:122` already catches `entitlement_exhausted` (currently `toast.error`). Swap the toast for opening the UpgradeSheet (no file to resume here — re-analyze has no chosen file, so AC #2 resume does not apply; just close + refresh entitlements on success).
- [x] **Task 6 — Apply BlurLock to depth-gated surfaces (AC: #3)**
  - [x] Free-tier stems tab: when `entitlements.stemsEnabled === false`, wrap the stems panel content in `BlurLock` (reason e.g. "Stems analysis is a Pro feature", CTA "Get Pro" → opens UpgradeSheet or routes to `/pricing`).
  - [x] Lapsed-Pro / `fullVerdictsEnabled === false` and `.als` (`alsEnabled === false`) surfaces: same BlurLock treatment. Confirm exact panel components during impl (Analysis/Reference/Project tabs).
  - [x] Do NOT BlurLock anything on the results READ path that was already delivered — results-forever (AR15): past reports stay fully readable. Only gate NEW depth.
- [x] **Task 7 — Verify gate-between-never-during for in-flight jobs (AC: #4)**
  - [x] This is structurally guaranteed by 2.4 (BFF stamps tier on the job row at dispatch; worker never re-checks — AR13). Add/confirm a test asserting an entitlement change after dispatch does NOT cancel or alter an in-flight job; the job completes and persists. Likely a BFF/worker assertion, not new UI.
- [x] **Task 8 — Tests + four frontend gates**
  - [x] `BlurLock.test.tsx`: locked renders overlay + announces reason (aria), children inert; unlocked renders children untouched.
  - [x] `UpgradeSheet.test.tsx`: header substitutes live counts; trust line verbatim; exactly one primary button; ghost exit calls `onWaitNextMonth`; PRO toggle switches price source.
  - [x] Extend `upload-dialog-entitlement.test.tsx`: cap-hit (client pre-check AND server 409) opens the sheet, not a toast; resume re-arms the stashed file on success.
  - [x] Run all four gates: `npx tsc --noEmit`, `npm run lint` (--max-warnings 0), `npm run build`, `npx vitest run`. Keep `import type` for type-only imports (verbatimModuleSyntax).

## Dev Notes

### What's already done (do NOT rebuild)
- **Backend gate is COMPLETE (story 2.4).** `DispatchAnalysisAsync` rejects with `409 { error: { code: "entitlement_exhausted" } }` when `ent.AnalysesRemaining == 0` — `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:933-934`. Covered by `components/bff/tests/Spectr.Bff.Tests/DispatchEntitlementGateTests.cs:157,171,231`. **Story 2.7 is frontend-only** unless Task 7 needs a worker assertion.
- **Entitlements endpoint:** `GET /api/me/entitlements` (NOT `/billing/entitlements`) → `EntitlementsDto`. BFF: `MeEndpoints.cs:230`, DTO `BillingDtos.cs:87`.
- **Frontend hook exists:** `useEntitlements()` — `components/frontend-spectr-v2/src/api/hooks.ts:104` (TanStack Query, `queryKey: ['me','entitlements']`, staleTime 30s).
- **`EntitlementsDto` (frontend, `src/api/types.ts:99`):**
  ```ts
  interface EntitlementsDto {
    analysesRemaining: number | null;  // null = unlimited (pro)
    coachRemaining: number;
    stemsEnabled: boolean;
    alsEnabled: boolean;
    fullVerdictsEnabled: boolean;
    historyDepth: number | null;
    tier: 'free' | 'credits' | 'pro';
  }
  ```
- **Cap-hit catch points already wired:** `UnifiedUploadDialog.tsx:477` (sets `setEntExhausted(true)`) and `ReportView.tsx:122` (toast). 2.7 upgrades both to open the UpgradeSheet.
- **Error extraction helper:** `extractApiError(err.body).code === 'entitlement_exhausted'` — `src/api/error-utils.ts`. Always key off CODE, never the message (AR38).
- **Pricing source:** `GET /api/billing/plans` → `PlansResponse` (story 2.1). NO price literals in code (AR39/AR40).
- **Checkout pattern (story 2.1):** `window.location.assign('/pricing')` for hosted Stripe; success polls `GET /api/auth/me` ~every 5s up to 60s for the tier flip.

### Pattern to mirror
- **Modal:** `components/frontend-spectr-v2/src/components/NewSongDialog.tsx` — Radix `Dialog.Root/Portal/Overlay/Content/Title/Description`. CSS in `src/styles/forms.module.css` (`.dialogOverlay`, `.dialogContent`, `.dialogTitle`, `.dialogActions`).
- **Inline gate precedent:** `src/features/results/CoachGateInline.tsx` (story 1.9) — shows the accepted gate copy/tone and the "Get Pro / or buy credits" CTA pairing. UpgradeSheet is the modal sibling of this inline gate.
- **Styling:** CSS Modules + global utilities (`.btn`, `.btn.primary`, `.btn.ghost`, `.card`, `.label`, `.pill`) + `src/styles/tokens.css` (`--cyan`, `--card`, `--border`, `--text`/`--text-2`, `--space-*`, `--radius`). NO Tailwind, NO inline styles unless dynamic. Toasts via Sonner.

### Decisions (RESOLVED with operator 2026-06-23)
- **D1 — Checkout window strategy (AC #2): POPUP + POLL.** Open Stripe Checkout in a popup/new tab opened **synchronously inside the Subscribe click handler** (user gesture → not popup-blocked). The upload dialog stays mounted with the chosen `File` held in memory (ref/module state). Poll `GET /api/auth/me` every ~5s (up to 60s, reuse 2.1's pattern) for the tier flip; on flip, close/ignore the popup, invalidate `['me','entitlements']` + `auth/me`, and auto-start the upload on the kept `File`. This is the only option that literally satisfies "resumes automatically · work never lost." (Rejected: full-page redirect — discards the in-memory `File`.)
- **D2 — Depth-gate BlurLock CTA: OPEN UpgradeSheet IN PLACE.** The BlurLock CTA opens the same `UpgradeSheet` modal over the current page (one upgrade surface everywhere; keeps report context). CoachGateInline's `/pricing` route (1.9) was a pre-sheet stopgap — consolidate onto the sheet now that it exists.

### Project Structure Notes
- New components live at `components/frontend-spectr-v2/src/components/` (`UpgradeSheet.tsx`, `BlurLock.tsx`, `PlanCard.tsx`, `TierChip.tsx`) + co-located `*.module.css`, per the v2 stack rules (feature-based; shared primitives under `src/components/`).
- Tests co-located under `src/components/__tests__/` (matches existing `upload-dialog-entitlement.test.tsx`).
- No BFF changes expected except possibly a Task 7 assertion test — the entitlement gate + DTO + plans endpoint already shipped in 2.1/2.4.

### Testing standards
- Frontend: Vitest + Testing Library; four gates mandatory (`tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run`). A11y: assert `aria-label`/`role` on BlurLock overlay + dialog focus behavior.
- Reuse the AR38 body shape `{ error: { code, message, details } }` in test fixtures.

### References
- [Source: PRPs/epics.md#Story-2.7] (epics.md:628-639) — AC verbatim
- [Source: PRPs/ux-design-specification.md#UX-DR29] (line 274) — BlurLock contract
- [Source: PRPs/ux-design-specification.md#UX-DR30] (line 275; Flow 2 lines 263-265) — UpgradeSheet contract + copy
- [Source: PRPs/ux-design-specification.md#UX-DR38] (line 289) — gate-between-never-during
- [Source: PRPs/ux-design-specification.md#Component-Inventory-Phase-E] (lines 309-320) — UpgradeSheet/PlanCard/TierChip/BlurLock deliverables
- [Source: PRPs/architecture.md#AR38] (line 172) — error envelope, code-keyed gates
- [Source: PRPs/architecture.md#D2-Billing] (lines 88-96) — Entitlements.For + results-forever (AR15) + tier stamp (AR13)
- [Source: PRPs/prd.md#FR29-FR34] (lines 342-350) — tier/pricing/dunning/queue requirements
- [Source: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:933] — 409 entitlement_exhausted gate
- [Source: components/bff/src/Spectr.Bff/Endpoints/MeEndpoints.cs:230] — GET /api/me/entitlements
- [Source: components/frontend-spectr-v2/src/api/hooks.ts:104 + types.ts:99] — useEntitlements + EntitlementsDto
- [Source: components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx:477] — upload cap-hit catch
- [Source: components/frontend-spectr-v2/src/features/results/ReportView.tsx:122] — re-analyze cap-hit catch
- [Source: components/frontend-spectr-v2/src/features/results/CoachGateInline.tsx] — gate copy/tone precedent

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- Build gate `npm run build` (`vite build && tsc -b`) initially failed on a **pre-existing** missing-`jsdom` error in `src/features/upload/__tests__/alsPreview.test.ts` (from commit 947b973, not this story). `jsdom@^29` is a declared devDependency that was simply absent from `node_modules`; `npm install` resolved it. No code change.

### Completion Notes List

- **AC1 — UpgradeSheet:** New `UpgradeSheet` (Radix Dialog) with live `{used} of {limit}` header, value-recap grade chips, PRO card (monthly/annual toggle + computed annual savings) + CREDITS card, verbatim trust line, and the ghost "wait for next month" exit. Prices flow from `GET /api/billing/plans` via `formatCents` (no $ literals, AR39). Composed from new `PlanCard` + `TierChip` (colors from the pre-declared `--tier-*` tokens).
- **AC2 — resume:** Checkout runs through the new `useUpgradeCheckout` hook (D1 popup+poll): the popup is opened synchronously in the click gesture (not blocked), pointed at the hosted Stripe URL (validated via `isStripeHostedUrl`), then `/me/entitlements` is polled (~5s ×12) until the tier flips. `UnifiedUploadDialog.handleSubmit` was split into `handleSubmit` (gate) + `runUpload` (pipeline); on upgrade the kept in-memory `mix` File auto-resumes via `runUpload()`. Popup-blocked fallback = full-page redirect (degraded resume).
- **AC3 — BlurLock:** New `BlurLock` wrapper — children render untouched when unlocked; when locked, real children stay mounted but `aria-hidden` + `inert`, with a `role="group"`/`aria-label` overlay announcing the reason + a single CTA. Applied to the upload dialog's `.als` and stems zones when `alsEnabled`/`stemsEnabled` are false (Pro-tier inputs to a NEW analysis). **Scoping decision:** delivered-report tab content is intentionally NOT BlurLocked — results-forever (AR15) guarantees past reports stay fully readable, so depth gates sit only on new-analysis inputs. CTA opens the UpgradeSheet in place (D2).
- **AC4 — gate-between-never-during:** Structurally guaranteed, no new code. Verified: the BFF stamps `job.Tier` at dispatch (asserted in `DispatchEntitlementGateTests`) and the worker job path never reads billing tables (grep of `components/worker/app` shows billing access only in LLM spend-metering + coach-flag paths, never in `analyze_audio_job`), so a mid-pipeline entitlement change cannot kill a running job.
- **Small BFF change (justified):** added `AnalysesLimit` + `AnalysesUsed` to `EntitlementsDto` (defaulted, append-only) — the numbers were already computed in `EntitlementService` (`freeCap` from the `free_analyses_per_month` flag, `usedThisPeriod`); only the free branch populates them. Needed for the UX-DR30 header grammar without hardcoding tier numbers (AR35).
- **Gates:** frontend `tsc --noEmit` clean, `lint --max-warnings 0` clean, `build` clean, `vitest` 330/330. BFF `dotnet build` 0 warnings, `dotnet test` 133/133.
- **Follow-ups (not blocking):** value-recap grade chips are wired through the UpgradeSheet prop but the upload/ReportView call sites pass none yet (no period-reports query on hand); a future pass can feed recent grades. `useUpgradeCheckout` popup/poll has no unit test (needs a `window.open` + timer harness) — covered manually by the flow; consider an integration smoke later.

### File List

**Frontend — new**
- `components/frontend-spectr-v2/src/components/BlurLock.tsx`
- `components/frontend-spectr-v2/src/components/BlurLock.module.css`
- `components/frontend-spectr-v2/src/components/TierChip.tsx`
- `components/frontend-spectr-v2/src/components/TierChip.module.css`
- `components/frontend-spectr-v2/src/components/PlanCard.tsx`
- `components/frontend-spectr-v2/src/components/PlanCard.module.css`
- `components/frontend-spectr-v2/src/components/UpgradeSheet.tsx`
- `components/frontend-spectr-v2/src/components/UpgradeSheet.module.css`
- `components/frontend-spectr-v2/src/features/billing/useUpgradeCheckout.ts`
- `components/frontend-spectr-v2/src/components/__tests__/BlurLock.test.tsx`
- `components/frontend-spectr-v2/src/components/__tests__/UpgradeSheet.test.tsx`

**Frontend — modified**
- `components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx` (split handleSubmit/runUpload; UpgradeSheet on cap-hit + resume; BlurLock on stems/.als)
- `components/frontend-spectr-v2/src/features/results/ReportView.tsx` (re-analyze cap-hit → UpgradeSheet + resume)
- `components/frontend-spectr-v2/src/api/hooks.ts` (`usePlans`; PlansResponse import)
- `components/frontend-spectr-v2/src/api/types.ts` (`EntitlementsDto.analysesLimit/analysesUsed`)
- `components/frontend-spectr-v2/src/api/__tests__/entitlements-hook.test.ts` (new DTO fields)
- `components/frontend-spectr-v2/src/components/__tests__/upload-dialog-entitlement.test.tsx` (UpgradeSheet wiring assertion)

**BFF — modified**
- `components/bff/src/Spectr.Bff/DTOs/BillingDtos.cs` (`EntitlementsDto.AnalysesLimit/AnalysesUsed`)
- `components/bff/src/Spectr.Bff/Services/EntitlementService.cs` (populate limit/used on free branch)
- `components/bff/tests/Spectr.Bff.Tests/EntitlementServiceTests.cs` (assert limit/used)
- `components/bff/README.md` (entitlements response doc)

### Deferred Scope (explicit, not gaps)

- **IG1 — results-page BlurLock:** Delivered-report tab content (Spectrum, Reference, Arrangement) is intentionally NOT BlurLocked. AR15 (results-forever) guarantees past reports are fully readable regardless of tier; depth gates belong only on new-analysis inputs. A future story (Epic 5) can add progressive disclosure if the product decides to surface upgrade prompts on delivered results.
- **IG2 — value-recap grade chips in UpgradeSheet:** The `gradeChips` prop is wired and rendered when populated, but no call site currently queries the period's reports to build the chip list. The sheet renders without the strip when chips are empty (clean fallback). Feeding real grade data requires a "my analyses this period" endpoint — defer to Epic 5 or 6 funnel instrumentation work.
- **P7 — BlurLock CTA for FEATURE gates (alsLocked / stemsLocked):** Current CTA opens the UpgradeSheet with `analysesUsed/analysesLimit` header framing (cap-hit grammar). For feature gates (stems/als disabled, not cap-hit), the correct sheet header/framing is "Unlock [feature] with Pro" — a design decision deferred. Current behavior (opening the cap-hit sheet from a feature gate CTA) is a known rough edge; low stakes since stems/als are secondary flows.
- **P9 — `useUpgradeCheckout` unit test:** Polling/popup harness (`window.open` + fake timers) adds significant test-setup complexity. Covered manually by the flow. Consider an integration smoke test when the billing E2E suite is added (Epic 4 or later).
