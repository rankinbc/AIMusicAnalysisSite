# PRP — Audit Remediation Wave 3: Silent Mutations + Honest Listen-Rack/Account Surfaces

**Source:** wave-3 scope carved out of the 2026-07 audit pair; waves 1 (auth/session + poll
terminals, commit `a5f0eca`) and 2 (error-envelope unification + missing surfaces, commit
`63d9f00`) shipped — see
`PRPs/archive/2026-07-23_audit-remediation-wave1-auth-and-poll-terminals.md` and
`PRPs/archive/2026-07-23_audit-remediation-wave2-error-envelopes-and-surfaces.md`.
**Closes:** E6.1–E6.7 · E7.1–E7.7 · E8.1–E8.6 (20 findings).
**Finding evidence:** `docs/edge-case-report.md` (Journeys 6–8, file:line per finding; the
"Recurring root shapes" paragraph at line 337 names this wave's root shape: *"mutations with
`onSuccess`-only options so every refusal is silent"*). Read all 20 findings before starting —
every one was re-verified against the current tree on 2026-07-23 and **all 20 are still live**
(line-drift notes in Discovered facts).

**Out of scope (do NOT fix opportunistically):**
- **E6.8–E6.14 (room findings)** — routed to the listening-room roadmap
  (`memory: pivot-listening-room-2026-06`, `listen-rack-canonical-page`). Rooms are
  fixture-backed by design right now; "fixing" their silent mutations would be polishing
  unshipped product. Do not touch `useRoomSession.ts`, `useRoomOrchestration.ts`,
  `useRoomStream.ts`, `useRoomActions.ts`, `roomStateReducer.ts`, or the `PeoplePanel`/
  `ChatPanel` fixtures in `rail.tsx`.
- The ~120 legacy BFF `{error:"text"}` sites (wave-2 bounded inventory) — still a separate
  mechanical follow-on; the wave-2 parser renders them fine.
- Findings/severity unification (F1/F2), F3 (committed-state race + `/applied` 500),
  E3.3 dialog-abort semantics, E1.4 anon claim path.
- Journeys 1–5 mutation sites already handled at their call sites (upload dialog, results
  page, references, song detail) — audited this session, they have error paths.

---

## Goal

One PR-sized change set, **frontend-first** (`frontend-spectr-v2`) with exactly **two
minimal, flagged BFF changes**:

1. **No silent mutation refusals** — every in-scope `useMutation` whose failure currently
   vanishes gets honest feedback: a toast carrying the server's wording (which
   `ApiError.message` now delivers for all three body shapes, thanks to wave 2), an inline
   error state, or a rollback — via **one shared mechanism**: a global `MutationCache`
   `onError` in `main.tsx` that fires **only for mutations that opt in via
   `meta.errorToast`** (decision + rule in Discovered facts #4).
2. **Listen-rack tells the truth** — a 404'd version renders a not-found page (not the demo
   fixture); an unanalyzed version's Stats rail says "not analyzed yet" (not zeros presented
   as measurements); stats from a different version are labeled; "View Report →" navigates;
   the canned Coach rail stops fabricating measurements and points at the real report coach.
3. **Draft integrity** — a failed draft GET pauses autosave (never overwrites the saved
   draft with defaults); failed autosaves surface a deduped warning.
4. **Bookmark note edit can't destroy the bookmark** — server upsert learns to update the
   note; the DELETE+POST dance is deleted (BFF change #1).
5. **Account/billing pages stop lying** — `/billing` and `/usage` get error states instead
   of eternal skeleton / fake "0 credits"; entitlements-down is distinguishable from
   "nothing to show"; the checkout success page and popup-checkout poll confirm the product
   actually bought (BFF change #2: tag the credits SuccessUrl); `/profile` shows the real
   tier.
6. **Version share/invite flow becomes reachable** — a minimal owner share dialog on the
   rack page + an invite-accept route so invite links stop dead-ending (backend already
   fully shipped; zero frontend consumers today).

## Why

- This is the audit's largest remaining root shape: 21 of the 23 in-scope mutation hooks
  have **no error path at hook or call site** — every 403/404/429/500 refusal un-busies the
  button and pretends nothing happened.
- Wave 2 did the hard part already: `ApiError.message` carries the server's copy for the
  envelope, legacy, and RFC7807 shapes (`fetcher.ts:198-200`), so *one* generic handler now
  produces good copy for free. Wave 3 is where that investment pays out across ~20 hooks.
- E6.6 is on the audit's 10-riskiest list (real data loss: autosave clobbers the saved
  draft 1.2 s after a transient GET failure). E8.4 tells paying customers their purchase
  looks failed. E6.1/E6.2/E6.4 present fabricated data as real measurements.

## What (user-visible behavior)

- Rejecting/accepting a suggestion, posting/moderating a comment, bookmarking, following,
  saving a preset/look, importing a preset, sharing, inviting: failures toast the server's
  message (or a clear fallback) — nothing silently un-busies anymore.
- A stale `/listen-rack/{id}` deep link says "This version doesn't exist or was deleted"
  with a Library link — never the "Neon Skyline" demo fixture.
- The Stats rail on an unanalyzed version says "Not analyzed yet — run an analysis from the
  song page." instead of "Integrated 0.0 LUFS · +14.0 LU over".
- Listening to v2 of a song whose latest analysis is v6 shows a small note: "Stats are from
  the latest analysis (v6), not the version you're hearing."
- The Coach rail on a real version shows an honest "the rack coach isn't live yet" panel
  with a link to the report's real AI Coach — no more fabricated "−11.2 LUFS" replies or
  the fixture "KNOWS THIS TRACK · 14/26 RUN" badge.
- "View Report →" opens the song's report.
- Draft GET failure: "Couldn't load your saved rack draft — autosave is paused." with Retry;
  the saved draft survives. Failing autosaves show one (replaced, never stacking) warning.
- Editing a bookmark note can no longer delete the bookmark on a failed second step.
- Profile 429 says "too many requests", not "No one lives here". Notifications "More…"
  appends pages.
- `/billing` and `/usage` failures show an error card with Retry. The nav plan card being
  absent while entitlements are down gets an explicit "plan info unavailable" line on
  /usage.
- A credits buyer returning from Stripe sees "Confirming your credit pack…" → "Credits
  added" (never "your subscription is still being processed"); the popup-checkout resume
  fires only when the bought product actually landed.
- `/profile` shows Free/Credits/Pro truthfully.
- Owners can mint/rotate/revoke a `/v/{token}` link and manage invites from the rack page;
  `/invite/{token}` accepts and lands the invitee on the version.

### Success Criteria

- [ ] All 20 findings closed per the manual verifications in Final Validation.
- [ ] ONE shared error-feedback mechanism: the `MutationCache` handler in `main.tsx`;
      hooks opt in via `meta.errorToast`; zero new bespoke per-hook `toast.error`
      copies except where the PRP explicitly says the site needs more than a toast
      (draft autosave dedupe, invite-accept route state).
- [ ] No double-toasts: every mutation whose call site already passes `onError` to
      `.mutate()` is verifiably NOT opted in (list in Task 2).
- [ ] No behavior change for existing code-keyed branches or the wave-1 poll helper /
      wave-2 parser.
- [ ] All validation gates green (frontend ×4, `dotnet build && dotnet test`, worker pytest
      modulo the 5 known pre-existing failures).

---

## All Needed Context

### Documentation & references

```yaml
- file: docs/edge-case-report.md
  why: E6.1-E6.7 (lines 200-231), E7.1-E7.7 (263-292), E8.1-E8.6 (294-319) — trigger +
       file:line for every gap; line 337 root-shape rationale
- file: PRPs/archive/2026-07-23_audit-remediation-wave2-error-envelopes-and-surfaces.md
  why: structural template; built parseErrorBody/ApiError-message plumbing this wave rides;
       its gotchas carry forward (XHR plain Error, code-keyed branches, worker test failures)
- file: CLAUDE.md
  why: v2 stack rules (CSS Modules, import type, fetcher-only HTTP, validation gates),
       BFF rules (ErrorEnvelope.Build, endpoint file layout, dotnet file-lock note)

# ── shared mechanism ──
- file: components/frontend-spectr-v2/src/main.tsx
  why: QueryClient construction 23-30 (NO MutationCache today — the insertion point);
       Toaster already mounted at 80; `declare module` augmentation precedent at 43-47
- file: components/frontend-spectr-v2/src/api/fetcher.ts
  why: ApiError 10-12 (.status, .body); line 198-200 — message = extractApiError(body).message
       so err.message carries server copy; "HTTP {status}" is the no-message fallback
- file: components/frontend-spectr-v2/src/api/error-utils.ts
  why: wave-2 total parser — extractApiMessage(body) is what the global handler uses to
       avoid toasting raw "HTTP 500"
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx
  why: submitSuggestion 468-485 — the codebase's canonical mutation onError toast idiom
       (call-site onError → must NOT be opted into the global handler);
       also: track fallback 192, RackHeader dead button 117 (header actions 112-118),
       preset hooks 277-295, carry-over machinery 297-327, draft restore 336-352 +
       autosave arm 356-357, onSaveRackPreset 537-543, onSaveVizLook 560-566,
       onImportFile 586-599, navigate import 318
- file: components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx
  why: 40-63 — the code-keyed onError precedent (extractApiError(err.body).code branches
       then message toast); another call-site-onError site to keep OFF the global handler

# ── E6.x: listen-rack ──
- file: components/frontend-spectr-v2/src/routes/_app/listen-rack.$versionId.tsx
  why: useVersion 41 (error never consulted — E6.1), song 42, latestJobId 43-44 (song's
       LATEST analysis — E6.3), buildTrack memo 49-59, page props spread 61-68
- file: components/frontend-spectr-v2/src/features/listen-rack/trackFromAnalysis.ts
  why: buildTrack defaults every metric to 0 when phases are absent (57-81) — E6.2
- file: components/frontend-spectr-v2/src/features/listen-rack/rail.tsx
  why: coachReply canned strings 296-305 + CoachPanel 308-346 (fixture badge 324) — E6.4;
       StatsPanel 485-508 (zeros as facts, "VS SPOTIFY" tile 502-505) — E6.2/E6.3;
       CommentsPanel submit 652-661 (onSuccess-only) + moderation buttons 698-701 +
       delete 701 — E7.3; RightRail props/mounts 782-830 (threading path for new props).
       NOTE: rail.tsx is the ported mockup and uses inline styles throughout — follow the
       file's local conventions, don't refactor it to CSS Modules in this wave.
- file: components/frontend-spectr-v2/src/features/listen-rack/useRackPresets.ts
  why: useSaveRackPreset 97-104, useDeleteRackPreset 106-113 (no onError — E6.7);
       useRackDraft 116-123 (staleTime Infinity), useUpsertRackDraft 125-130,
       useRackDraftAutosave 137-161 (fires the upsert on a 1.2s debounce — toast spam risk)
- file: components/frontend-spectr-v2/src/features/listen-rack/useVizPresetsServer.ts
  why: useSaveVizPreset 47-54, useDeleteVizPreset 56-63 (no onError — E6.7)
- file: components/frontend-spectr-v2/src/features/listen-rack/data.ts
  why: Track interface + TRACK fixture live here — E6.2 adds `analyzed` to both

# ── E7.x: sharing & social ──
- file: components/frontend-spectr-v2/src/features/listen/useSuggestions.ts
  why: useAcceptSuggestion 36-46 / useRejectSuggestion 48-55 (no onError — E7.2);
       useCreateSuggestion 25-32 (call-site handled — do NOT opt in);
       usePostAnonSuggestion 57-62 (ZERO consumers — leave alone)
- file: components/frontend-spectr-v2/src/features/listen/SuggestionCard.tsx
  why: accept 99 / reject 107 — bare .mutate(), busy flag 49; E7.2 call sites
- file: components/frontend-spectr-v2/src/features/listen/useComments.ts
  why: usePostComment 21-28, usePatchCommentStatus 30-37, useDeleteComment 39-46
       (all onSuccess-only — E7.3); usePostAnonComment 58-65 (call-site handled in
       v.$token.tsx:108 — do NOT opt in)
- file: components/frontend-spectr-v2/src/features/listen/useBookmarks.ts
  why: useCreateBookmark 21-28 / useDeleteBookmark 30-36 (no onError — E7.4);
       usePostAnonBookmark 40-46 (ZERO consumers — leave alone)
- file: components/frontend-spectr-v2/src/features/listen/BookmarksRail.tsx
  why: add 54-60, toggleName 63-64, commitNote DELETE+POST 68-83 (the destroy-risk — E7.4),
       delete 171
- file: components/frontend-spectr-v2/src/features/profiles/useFollow.ts
  why: useFollow 25-36 / useUnfollow 38-47 (onSuccess-only — E7.5)
- file: components/frontend-spectr-v2/src/routes/_public/u.$handle.tsx
  why: `if (error || !data)` renders the 404 copy for EVERY error incl. 429 (45-53 — E7.6);
       retry:false at 24; follow toggle 69-70
- file: components/frontend-spectr-v2/src/routes/_public/v.$token.tsx
  why: composer onError 108 + bookmark onError 118 — the anon precedent that DOES toast;
       follow toggle 147-148 (silent — E7.5)
- file: components/frontend-spectr-v2/src/features/listen/useVersionShare.ts
  why: useShareSettings/useUpdateShareSettings/useRotateToken (17-44) — ZERO consumers
       (verified by grep this session) — E7.1
- file: components/frontend-spectr-v2/src/features/listen/useInvites.ts
  why: useInvites/useCreateInvite/useRevokeInvite/useAcceptInvite — ZERO consumers; no
       route can receive an invite token — E7.1
- file: components/bff/src/Spectr.Bff/Endpoints/VersionShareEndpoints.cs
  why: the E7.1 backend is COMPLETE: GET/PUT /share, POST /share/rotate, GET /access,
       invites CRUD (25-36), POST /invites/{token}/accept; ShareSettingsDto shape 50-60
- file: components/frontend-spectr-v2/src/components/SharePublishDialog.tsx
  why: the anatomy to mirror for VersionShareDialog (Radix Dialog + copy-link + onError
       toasts + reset-on-close); uses styles/forms.module.css
- file: components/frontend-spectr-v2/src/features/notifications/NotificationCenter.tsx
  why: page state 78 + useNotifications(page) 83 + onMore page-swap 130 — E7.7
- file: components/frontend-spectr-v2/src/features/notifications/useNotifications.ts
  why: single-page useNotifications 36-47 (convert to infinite); useUnreadCount 49-56
       (keep); markRead/markAll 58-77
- file: components/frontend-spectr-v2/src/features/feed/useFeed.ts
  why: 38-50 — the infinite-query pattern E7.7 copies (its doc comment literally describes
       this exact bug being fixed for the feed)

# ── E8.x: account & billing ──
- file: components/frontend-spectr-v2/src/routes/_app/billing.tsx
  why: `if (isLoading || !data)` 49-58 (no error branch — E8.1); handleChangeCadence
       144-149 — the extractApiMessage toast precedent already in this file
- file: components/frontend-spectr-v2/src/routes/_app/usage.tsx
  why: infinite query 23-37; empty-pages → balance 0 39-48; loading 50-59; the false
       "haven't bought any credits" copy 81-84 — E8.2
- file: components/frontend-spectr-v2/src/features/billing/UsageSummary.tsx
  why: `if (!ent) return null;` 40-41 — E8.3 (isError never read)
- file: components/frontend-spectr-v2/src/routes/_app.tsx
  why: nav meter unmounts when entitlements missing (48, 206) — E8.3 (documented decision:
       nav meter stays hidden; /usage gets the explicit line)
- file: components/frontend-spectr-v2/src/routes/_app/billing.success.tsx
  why: shared-SuccessUrl acknowledgment 35-43 (already invalidates billing/credits);
       poll predicate `me.tier === 'pro'` 56 — E8.4; timeout copy 122-135
- file: components/frontend-spectr-v2/src/features/billing/useUpgradeCheckout.ts
  why: poll 46-73, predicate 54, success invalidations 56-57 (credits balance NOT
       invalidated), start() 75-126 — E8.5. Sole consumer: components/UpgradeSheet.tsx:65
- file: components/frontend-spectr-v2/src/features/billing/BuyCreditsCard.tsx
  why: full-page `window.location.assign` at 52 — app state is destroyed before returning
       to /billing/success, which is WHY the server must tag the URL (E8.4)
- file: components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs
  why: subscription checkout SuccessUrl at 196; credits checkout SuccessUrl at ~734 —
       the one-line server change #2 goes at the credits site
- file: components/bff/src/Spectr.Bff/Options/StripeOptions.cs
  why: line 26 — SuccessUrl default already carries `?session_id={CHECKOUT_SESSION_ID}`,
       so the product tag appends with `&`
- file: components/frontend-spectr-v2/src/routes/_app/profile.tsx
  why: hardcoded `<Pill tone="cyan">Free plan</Pill>` at 143 + plan card literal 243-248 —
       E8.6; useAuth at 31 (NOTE: AuthedUser.tier can't express 'credits' — fact #6)
- file: components/frontend-spectr-v2/src/components/TierChip.tsx
  why: the existing free/credits/pro badge to reuse for E8.6
- file: components/frontend-spectr-v2/src/api/types.ts
  why: AuthedUser.tier 'free'|'pro' ONLY (5-15); EntitlementsDto.tier incl. 'credits'
       (103-110); CreditLedgerEntryDto.reason 'purchase'|… (81-87); CreditsResponse 92-96;
       ShareSettingsDto 388-399; UpdateShareSettingsRequest 401-409; CreateInviteRequest
       445-449; InviteDto 432-443 (token, songVersionId, scope);
       JobResultsDto.versionId 885 + versionNumber 900 (E6.3's frontend-only key)

# ── E7.4 server half ──
- file: components/bff/src/Spectr.Bff/Endpoints/BookmarkEndpoints.cs
  why: Create upsert 109-122 — repeat POST at same (user, version, t) returns the EXISTING
       row and updates ONLY IdentityVisible; Note is never updated (133 is create-path
       only). This is what forces the frontend's DELETE+POST; server change #1 lands here.
```

### Discovered facts that CHANGE the intake's assumptions (trust these)

1. **All 20 findings are still live** — waves 1–2 fixed none of them. What the waves DID
   change: `ApiError.message` now carries the server's wording for all three body shapes
   (`fetcher.ts:198-200`), and `extractApiMessage`/`parseErrorBody` are total
   (`error-utils.ts`). Every toast in this wave rides that. Minor line drift only:
   E7.3's "rail.tsx:657-660" is now 652-661; everything else cited by the report is within
   a couple of lines.
2. **Two mutation call sites in scope already handle errors** and must be excluded from
   any global handler: `usePostAnonComment` (call-site onError, `v.$token.tsx:108`) and
   `useCreateSuggestion` (call-site onError, `ListenRackPage.tsx:480-483`). Outside scope
   but sharing hooks-level plumbing: ~13 more call sites across the app pass `onError` to
   `.mutate()` (DegradationBanner, SharePublishDialog, profile email pref, song-detail,
   references, fix-rack…).
3. **`usePostAnonSuggestion` and `useBookmarks.usePostAnonBookmark` have zero consumers**
   (grep this session) — dead exports; leave them untouched (no meta, no deletion).
4. **Shared-helper decision: global `MutationCache` onError, OPT-IN via `meta.errorToast`
   — NOT opt-out.** Weighed honestly: TanStack v5's `MutationCache.onError(error, vars,
   ctx, mutation)` can see `mutation.options.onError` (the `useMutation` options) but
   **cannot see callbacks passed to `.mutate(vars, { onError })`** — those live on the
   MutationObserver. An opt-out rule ("fire when the hook has no onError") would therefore
   double-toast the ~15 call-site-handled mutations (fact #2's list) and silently
   double-toast any future call site that adds its own handler. The opt-in rule is:
   **the global handler toasts if and only if `mutation.meta?.errorToast` is set**; the
   toast message is `extractApiMessage(err.body) ?? meta.errorToast` for `ApiError`s
   (server copy first, never raw "HTTP 500"), else the `meta.errorToast` string. One
   implementation, explicit per-hook opt-in, zero double-toast risk, copy centralized.
5. **E7.4's DELETE+POST is forced by the API, so fix the API** (server change #1).
   `BookmarkEndpoints.cs:109-122`: the Create upsert returns the existing row but never
   updates `Note`. Making the upsert update the note (contract: **`note: ""` clears,
   absent/null leaves unchanged** — System.Text.Json can't distinguish null-vs-missing
   without extra machinery, and `toggleName` posts without a note key) lets the frontend
   edit a note with a SINGLE POST. The destroy-risk dance is deleted, not "rolled back".
6. **`AuthedUser.tier` is only `'free' | 'pro'`** (`types.ts:14`) — a credits user reads
   `'free'` from `/auth/me`. This both *confirms* E8.4 (the success poll can never satisfy
   `me.tier === 'pro'` for a credits buyer) and *constrains* E8.6: the profile tier must
   come from `EntitlementsDto.tier` (free/credits/pro), not `useAuth().user.tier`.
7. **E8.4 genuinely needs a server change** (server change #2). `BuyCreditsCard` does a
   full-page `window.location.assign` to Stripe — the app is destroyed, so the frontend has
   no memory of what was bought when it returns to the shared SuccessUrl
   (`StripeOptions.cs:26`, one configured URL for both products). One line in the credits
   checkout (`BillingEndpoints.cs:~734`): append `&product=credits` to `opts.SuccessUrl`.
   The subscription site stays untagged (absent param = subscription, back-compat).
8. **E6.3 is closable frontend-only**: `JobResultsDto` carries `versionId` (types.ts:885)
   and `versionNumber` (900) — the rack route already fetches it (`useJobResults` at
   `listen-rack.$versionId.tsx:44`), so version-mismatch labeling needs no server work.
9. **E7.1's backend is 100 % shipped** (`VersionShareEndpoints.cs`: share settings +
   rotate + access + invites CRUD + accept). There is no email delivery — invite tokens
   are copy-paste links. The entire gap is frontend: an owner surface + a route that can
   receive `/invite/{token}`. This is the wave's largest task; the PRP bounds it to a
   minimal dialog + accept route (Task 10).
10. **`billing.success.tsx` already invalidates `['billing','credits']` on mount**
    (story 2.8 AC3, lines 39-43) — E8.4's fix is the poll predicate + copy, not cache
    hygiene.

### Known gotchas

```
# CRITICAL — opt-in only (fact #4): NEVER give meta.errorToast to a hook whose call site
#   passes onError to .mutate(): useCreateSuggestion, usePostAnonComment, and anything in
#   src/api/hooks.ts (those call sites were audited — they handle errors locally). Adding
#   meta there = double toast.
# CRITICAL — meta typing: augment once, next to the QueryClient:
#   declare module '@tanstack/react-query' { interface Register {
#     mutationMeta: { errorToast?: string } } }
#   (precedent: the react-router Register augmentation already in main.tsx:43-47).
# CRITICAL — draft autosave must NOT use meta.errorToast: the upsert fires on a 1.2 s
#   debounce; repeated failures would stack toasts. Use sonner's id-dedupe instead:
#   toast.error(msg, { id: 'rack-draft-save' }) replaces the existing toast with the same
#   id rather than stacking. Same trick for the draft-GET failure toast.
# CRITICAL — E6.6: useRackDraft has staleTime: Infinity and default retry (3×) — isError
#   goes true only after retries exhaust (~a few seconds). The restore effect must treat
#   isError as "do NOT setDraftRestored(true)" (autosave stays disarmed) and re-run when
#   isError flips; draftQuery.refetch() resets error state and re-drives the effect.
# CRITICAL — do not break the story-12.4 carry-over draft machinery (carryPhase
#   'pending'|'applied'|'failed' gates at ListenRackPage:338-341). The new isError branch
#   slots AFTER the carryPhase checks and BEFORE the isFetched check.
# ApiError vs plain Error: everything in this wave goes through fetcher (no XHR paths in
#   scope), so err instanceof ApiError works — but the global handler must still fall back
#   to meta.errorToast for non-ApiError (network TypeError from fetch).
# TanStack v5 (^5.62.7): MutationCache is constructed as
#   new QueryClient({ mutationCache: new MutationCache({ onError: ... }), defaultOptions })
#   — import { MutationCache } from '@tanstack/react-query'.
# Invalidation keys survive the E7.7 infinite-query conversion ONLY if the new key stays
#   under the ['me','notifications'] prefix (markRead/markAll invalidate that prefix).
# React StrictMode double-mounts effects in dev (main.tsx wraps in StrictMode): the
#   invite-accept route must ref-guard its one-shot mutate. The server side is safe
#   regardless — AcceptInvite is idempotent (re-accepting an accepted invite re-stamps
#   and returns 200 + InviteDto; only missing/revoked tokens 404 with an EMPTY body —
#   VersionShareEndpoints.cs:213-225 — so the error copy can't come from the server).
# u.$handle / follow: ApiError carries .status — the 429 branch keys on
#   `error instanceof ApiError && error.status === 429`. Keep retry: false.
# rail.tsx uses inline styles (ported mockup) — the "no inline styles" rule is suspended
#   inside that file by existing convention; match the file, don't refactor it.
# TS strict + verbatimModuleSyntax: `import type` for type-only imports; new components
#   use CSS Modules (or forms.module.css like SharePublishDialog) — except inside rail.tsx.
# TanStack structural sharing (wave-1 lesson): render new banner/error states from query
#   DATA/status fields (isError, data flips), never from query internals/counts.
# dotnet build fails if the BFF exe is running (Windows file lock on
#   bin/Debug/net10.0/Spectr.Bff.exe) — Stop-Process the running BFF first.
# Worker suite has 5 known pre-existing failures unrelated to this work:
#   test_coach_stream_gateway ×3, test_budget_flag_override, test_local_root. Green =
#   everything else passes. (This wave touches no worker code; run the suite anyway per
#   gates.)
# vitest: jsdom, tests next to sources or in __tests__/; the QueryClient-in-test pattern
#   is in features/listen/__tests__/SuggestionCard.test.tsx:23 (retry: false). Tests that
#   exercise the global toast need the SAME MutationCache wiring as main.tsx — export the
#   cache factory so tests construct an identical client (see Task 1).
# Sonner <Toaster> is mounted once in main.tsx:80 — components/tests just call toast.*;
#   in tests, spy on `toast.error` via vi.mock('sonner') (existing precedent in
#   __tests__ files that assert toasts).
# BFF: SuccessUrl already contains a query string — append with '&', and leave
#   {CHECKOUT_SESSION_ID} template intact. Do NOT touch StripeOptions defaults.
# BookmarkEndpoints Note semantics (fact #5): "" clears, absent leaves. The Trim(...,280)
#   helper at :133 applies to the update path too.
```

---

## Implementation Blueprint

Order: mechanism first (Task 1), then the mass opt-in (2), then the surgical sites (3–9),
then the one feature-shaped task (10). Tasks 5 and 8 contain the two flagged BFF changes.

```yaml
Task 1 — frontend: global MutationCache error handler (the shared mechanism):
  MODIFY src/main.tsx:
    - ADD near the QueryClient (or CREATE src/api/mutation-error-toast.ts exporting the
      handler so tests reuse it — preferred):
        import { MutationCache } from '@tanstack/react-query';
        import { toast } from 'sonner';
        import { ApiError } from './api/fetcher';        // adjust path per file location
        import { extractApiMessage } from './api/error-utils';
        export function mutationErrorToast(error: unknown, mutation: { meta?: { errorToast?: string } }) {
          const fallback = mutation.meta?.errorToast;
          if (!fallback) return;                          // opt-in rule — fact #4
          const msg = error instanceof ApiError ? (extractApiMessage(error.body) ?? fallback) : fallback;
          toast.error(msg);
        }
    - WIRE: new QueryClient({ mutationCache: new MutationCache({
        onError: (error, _vars, _ctx, mutation) => mutationErrorToast(error, mutation) }),
        defaultOptions: { ...existing... } })
    - ADD the Register augmentation:
        declare module '@tanstack/react-query' {
          interface Register { mutationMeta: { errorToast?: string } }
        }
  CREATE src/api/__tests__/mutation-error-toast.test.ts:
    - no meta → no toast; meta + ApiError with envelope message → server message;
      meta + ApiError with empty body → fallback string; meta + TypeError → fallback;
      (integration-style, optional) a useMutation with meta in a wrapper client fires
      exactly ONE toast and a mutation with call-site onError + NO meta fires ZERO.

Task 2 — frontend: opt the silent hooks in (closes E6.7-presets, E7.2, E7.3, E7.5;
         hardens share/invite/bookmark hooks for later tasks):
  ADD `meta: { errorToast: '<copy>' }` to exactly these mutations (and ONLY these):
    src/features/listen-rack/useRackPresets.ts:
      useSaveRackPreset   → 'Could not save the preset.'
      useDeleteRackPreset → 'Could not delete the preset.'
      (useUpsertRackDraft: NO meta — Task 3 owns its feedback)
    src/features/listen-rack/useVizPresetsServer.ts:
      useSaveVizPreset    → 'Could not save the look.'
      useDeleteVizPreset  → 'Could not delete the look.'
    src/features/listen/useSuggestions.ts:
      useAcceptSuggestion → 'Could not accept the suggestion.'
      useRejectSuggestion → 'Could not reject the suggestion.'
      (useCreateSuggestion / usePostAnonSuggestion: NO meta — facts #2/#3)
    src/features/listen/useComments.ts:
      usePostComment        → 'Could not post your comment.'
      usePatchCommentStatus → 'Could not update the comment.'
      useDeleteComment      → 'Could not delete the comment.'
      (usePostAnonComment: NO meta — fact #2)
    src/features/listen/useBookmarks.ts:
      useCreateBookmark → 'Could not save the bookmark.'
      useDeleteBookmark → 'Could not delete the bookmark.'
      (usePostAnonBookmark: NO meta — fact #3)
    src/features/profiles/useFollow.ts:
      useFollow   → 'Could not follow.'
      useUnfollow → 'Could not unfollow.'
    src/features/listen/useVersionShare.ts:
      useUpdateShareSettings → 'Could not update sharing.'
      useRotateToken         → 'Could not rotate the share link.'
    src/features/listen/useInvites.ts:
      useCreateInvite → 'Could not create the invite.'
      useRevokeInvite → 'Could not revoke the invite.'
      (useAcceptInvite: NO meta — the accept ROUTE renders a visible error state, Task 10)
    src/features/notifications/useNotifications.ts:
      useMarkAllRead → 'Could not mark notifications read.'
      (useMarkRead: NO meta — fires on click-through navigation; a toast there is noise)
  NOTE: E6.7's "import save" is closed for free — onImportFile
    (ListenRackPage:586-599) funnels through saveRackPresetMut, which now has meta; its
    existing success toast and parse-error toast stay as-is.
  TESTS: extend features/listen/__tests__/SuggestionCard.test.tsx (or a sibling) with one
    failure case: reject → 403 → toast.error called once with the server message
    (vi.mock sonner; wrapper client must use the Task-1 MutationCache).

Task 3 — frontend: rack-draft integrity (E6.6 + the draft-autosave half of E6.7):
  MODIFY src/features/listen-rack/ListenRackPage.tsx restore effect (338-352):
    - AFTER the carryPhase gates, ADD:
        if (draftQuery.isError) {
          toast.error("Couldn't load your saved rack draft — autosave is paused.", {
            id: 'rack-draft-load',
            action: { label: 'Retry', onClick: () => { void draftQuery.refetch(); } },
          });
          return;                       // draftRestored stays false ⇒ autosave stays OFF
        }
      and add draftQuery.isError (+ draftQuery.refetch identity if the linter demands the
      whole query object — prefer destructured stable fields) to the dep array.
    - The success path is UNCHANGED: a real 204 no-draft (isFetched, data undefined,
      no error) still arms autosave — that is legitimate first-visit behavior.
  MODIFY src/features/listen-rack/useRackPresets.ts useUpsertRackDraft:
    - ADD hook-level onError (NOT meta):
        onError: () => toast.error('Draft not saving — your rack changes may not persist.',
                                   { id: 'rack-draft-save' })
      (id-dedupe: repeated debounced failures replace, never stack.)
  TESTS: extend src/features/listen-rack/__tests__/useRackPresets.test.ts:
    - upsert failure fires the deduped toast (same id);
    - (page-level, if a ListenRackPage test harness exists — otherwise unit-test the
      effect logic via a small extracted helper) draft GET error ⇒ draftRestored stays
      false; refetch success ⇒ restore proceeds.

Task 4 — frontend: listen-rack honesty cluster (E6.1, E6.2, E6.3, E6.4, E6.5):
  MODIFY src/routes/_app/listen-rack.$versionId.tsx:
    - const versionQ = useVersion(versionId);  // keep destructure, add isError/error/isLoading
    - BEFORE rendering ListenRackPage:
        versionQ.isError && err instanceof ApiError && err.status === 404
          → render honest not-found: "This version doesn't exist or was deleted." +
            Link to /library (mirror u.$handle's shell styling).
        versionQ.isError (other) → "Couldn't load this version." + Retry (refetch).
        versionQ.isLoading → minimal "Loading…" shell (kills the fixture flash).
    - COMPUTE reportRef = song && song.latestResult
        ? { songId: song.id, jobId: song.latestResult.jobId } : null;
      statsSource = results?.versionId
        ? { mismatch: results.versionId !== versionId,
            versionNumber: results.versionNumber ?? null } : null;
      PASS both as new optional ListenRackPage props.
  MODIFY src/features/listen-rack/trackFromAnalysis.ts + data.ts:            # E6.2
    - Track gains `analyzed: boolean`; buildTrack sets analyzed = Boolean(phase1);
      the TRACK fixture sets analyzed: true (demo route keeps demo behavior).
  MODIFY src/features/listen-rack/ListenRackPage.tsx:
    - props: reportRef?: { songId: string; jobId: string } | null;
             statsSource?: { mismatch: boolean; versionNumber: number | null } | null;
    - RackHeader (76-121): accept reportRef; line 117 becomes a TanStack <Link
        to="/songs/$songId/results/$jobId" params={...}> styled `btn primary sm`
        when reportRef is set; render nothing when null.                     # E6.5
    - Thread reportRef + statsSource + real={realAudio} into <RightRail>.
  MODIFY src/features/listen-rack/rail.tsx:
    - RightRail: accept + forward the three new props.
    - StatsPanel (485-508): when track.analyzed === false → render "Not analyzed yet —
      run an analysis from the song page." (muted, mono) instead of the stat rows and
      the VS-SPOTIFY tile.                                                   # E6.2
      When statsSource?.mismatch → small orange note above the rows: "Stats are from the
      latest analysis{statsSource.versionNumber ? ` (v${n})` : ''}, not the version
      you're hearing."                                                       # E6.3
    - CoachPanel (308-346): add `real?: boolean; reportRef?: {…}|null`. When real:
      render the coach header WITHOUT the fixture badge (delete the "KNOWS THIS TRACK ·
      14/26 RUN" line for real mode), body copy "The rack coach isn't live yet. Your
      real AI coach — grounded in this track's measured analysis — is on the report.",
      and a <Link> "Open the report's AI Coach →" when reportRef is set. NO input box,
      NO canned coachReply in real mode. Mock/demo mode (real falsy) unchanged. # E6.4
  TESTS:
    - trackFromAnalysis.test.ts: analyzed flag true/false per phase1 presence.
    - rail test (new or extend rail.plan.test.tsx sibling): StatsPanel renders the
      not-analyzed state when analyzed=false; mismatch note when statsSource.mismatch.
    - route-level 404 state: assert the not-found copy renders on a 404 ApiError
      (mock useVersion or the fetch layer per existing route-test precedent in
      routes/__tests__/).

Task 5 — E7.4: bookmark note edit stops being destructive (BFF change #1 + frontend):
  MODIFY components/bff/src/Spectr.Bff/Endpoints/BookmarkEndpoints.cs Create (109-122):
    - In the `existing is not null` branch, ADD note handling per fact #5:
        if (body.Note is not null)            // "" clears, null/absent leaves unchanged
        {
            var trimmed = Trim(body.Note, 280);
            if (existing.Note != trimmed) { existing.Note = string.IsNullOrEmpty(trimmed) ? null : trimmed; changed = true; }
        }
      (fold into the existing SaveChanges path used by the IdentityVisible toggle).
  TESTS (mirror existing BFF endpoint test patterns in components/bff/tests):
    - repeat POST same (version,t) with new note → 200, note updated, SAME row id;
    - repeat POST with note "" → note null; repeat POST WITHOUT note key → note preserved
      (the toggleName regression case); identityVisible toggle still works.
  MODIFY src/features/listen/BookmarksRail.tsx commitNote (68-83):
    - REPLACE the deleteMut→createMut chain with ONE createMut.mutate({ targetVersionId,
      t: b.t, note: next ?? '', identityVisible: b.identityVisible }).
      (next ?? '' — empty string is the explicit clear signal; unchanged-skip guard stays.)
    - The hook's meta (Task 2) provides the failure toast; the bookmark row survives any
      failure by construction now.
  TESTS: extend features/listen/__tests__/BookmarksRail.test.tsx — note edit issues a
    single POST and NO delete; a failed edit leaves the bookmark rendered.

Task 6 — E7.6 + E7.7: profile 429 + notifications pagination:
  MODIFY src/routes/_public/u.$handle.tsx (45-53):
    - Branch order: isLoading → loading; error instanceof ApiError && status === 429 →
      "Too many profile views — try again in a minute."; error || !data (404/rest) →
      existing "No one lives here" copy for 404, generic "Couldn't load this profile —
      try again." + retry button for non-404 errors.
  MODIFY src/features/notifications/useNotifications.ts:
    - CONVERT useNotifications to useInfiniteQuery mirroring useFeed.ts:38-50:
      key ['me','notifications','list'] (stays under the invalidation prefix — gotcha),
      initialPageParam 0, getNextPageParam (last) => last.hasMore ? last.page + 1
      : undefined, `enabled` param preserved.
  MODIFY src/features/notifications/NotificationCenter.tsx:
    - DROP the `page` state (78); items = (data?.pages ?? []).flatMap((p) => p.items);
      hasMore = hasNextPage; onMore = () => void fetchNextPage().          # E7.7
  TESTS: update features/notifications/__tests__ for the appending behavior (page 0 items
    still present after More…).

Task 7 — E8.1 + E8.2 + E8.3: billing/usage/entitlements honesty:
  MODIFY src/routes/_app/billing.tsx (49-58):
    - Destructure isError + refetch. NEW branch BEFORE the loading one:
      isError → error card: "Couldn't load your billing info — your subscription is
      unaffected." + Retry button (refetch) + Link to /pricing. Keep loading branch for
      isLoading only (drop `|| !data` into the error branch's domain).      # E8.1
  MODIFY src/routes/_app/usage.tsx:
    - NEW branch after loading (50-59): query.isError → error card "Couldn't load your
      credits — your balance is unaffected." + Retry (refetch). The ledger/balance UI
      then only renders on success (kills the fake "0 credits · you haven't bought any"
      for error states — the empty copy at 81-84 stays for TRUE empty success).  # E8.2
  MODIFY src/features/billing/UsageSummary.tsx (39-41):
    - const { data: ent, isError, refetch } = useEntitlements();
      isError → render the card shell with "Plan info is unavailable right now — your
      plan and limits are unaffected." + small Retry; keep `if (!ent) return null;`
      for the pure-loading case.                                            # E8.3
    - DECISION (document in code comment): the nav meter (_app.tsx:206) stays hidden on
      entitlements failure — a nav popover is the wrong place for an error state; /usage
      carries the explicit message.
  TESTS: extend features/billing/__tests__/usage-summary.test.tsx with the isError render.

Task 8 — E8.4 + E8.5: checkout confirmation tells the truth (BFF change #2 + frontend):
  MODIFY components/bff/src/Spectr.Bff/Endpoints/BillingEndpoints.cs credits checkout
  (~734):
    - SuccessUrl = opts.SuccessUrl + "&product=credits"
      (opts.SuccessUrl already has a query string — StripeOptions.cs:26; leave the
      subscription site at 196 untagged = back-compat default).
  MODIFY src/routes/_app/billing.success.tsx:
    - ADD validateSearch: { product?: 'credits' } (route search param; ignore unknown).
    - product === 'credits' → credits branch:                                # E8.4
        waiting copy: "Confirming your credit pack…";
        poll GET /billing/credits (same 5s/60s cadence): capture the FIRST response's
        balance as baseline; success when balance > baseline OR the newest entry has
        reason === 'purchase' with createdAt within the last 15 minutes (covers the
        webhook-landed-before-first-poll case);
        success copy: "Credits added — you have {balance} credits." + Link to /usage;
        timeout copy: "Your credits purchase is still being processed. Refresh in a
        moment — we never charge twice." (right product, no implied failure);
        on success also invalidate ['billing','credits'] + ['me','entitlements'].
      absent product → existing subscription poll/copy verbatim.
  MODIFY src/features/billing/useUpgradeCheckout.ts:                          # E8.5
    - start(kind): remember kind in a ref. For kind 'credits', BEFORE opening the poll,
      fetch GET /billing/credits once and stash baselineBalance (failure → null).
    - poll(): per-kind predicate:
        subscription → ent.tier === 'pro'            (tightened from tier !== 'free')
        credits      → fetch /billing/credits; success when baselineBalance != null
                       ? balance > baselineBalance
                       : (fallback) newest entry reason==='purchase' created in the last
                         15 min
      On success ALSO invalidate ['billing','credits'] (the missing invalidation at
      56-57).
    - Keep the timeout toast + popup/redirect plumbing untouched.
  TESTS:
    - BFF: assert the credits session's SuccessUrl carries product=credits (extend the
      existing billing endpoint tests' session-options capture if present; else a light
      unit on the options builder).
    - frontend: a hook test for the per-kind predicate (mock fetcher): pro user buying
      credits does NOT fire onUpgraded until balance rises (the E8.5 regression).

Task 9 — E8.6: /profile shows the real tier:
  MODIFY src/routes/_app/profile.tsx:
    - ProfilePage: const { data: ent } = useEntitlements(); thread tier =
      ent?.tier ?? null into Header + OverviewTab.
    - Header (143): replace the literal Pill with <TierChip tier={tier} /> when tier is
      known; render no chip while undefined (never guess "Free").
    - OverviewTab Account card (243-248): per-tier copy —
        free:    existing copy + Link "See plans" → /pricing
        pro:     "Pro plan — unlimited analyses, full coach, every specialist." +
                 Link "Manage subscription" → /billing
        credits: "Credits — pay as you go. Buy more or check your balance on Usage." +
                 Link → /usage
        unknown: neutral "Plan info unavailable." (E8.3 consistency)
  TESTS: a render test per tier (mock useEntitlements) asserting the chip + card copy.

Task 10 — E7.1: minimal version-share/invite owner surface + invite accept route
  (largest task — keep it MINIMAL; the polished share center is future product work):
  CREATE src/features/listen/VersionShareDialog.tsx (mirror SharePublishDialog.tsx:
  Radix Dialog + styles/forms.module.css + reset-on-close):
    - props { open, onOpenChange, versionId, songName }.
    - Reads useShareSettings(versionId); renders:
        visibility select (private / unlisted / public) → useUpdateShareSettings
        when shareToken && visibility !== 'private': the /v/{token} URL + Copy button
          (clipboard idiom from SharePublishDialog.handleCopy) + Rotate (useRotateToken,
          confirm-less; success toast 'Link rotated — the old link is dead.')
        toggles (checkbox row each): showVerdicts, suggestionsAllowed,
          bookmarkingAllowed; commentsPolicy select (off/link/named) → all PUT via
          useUpdateShareSettings (send only the changed field — request fields optional)
        invites: useInvites list (role · email/handle · status · Copy link
          `${origin}/invite/${inv.token}` · Revoke) + create row (role select
          reviewer/listener + email OR handle input) → useCreateInvite.
    - All failure feedback comes from Task 2's meta — add NO local onError; add local
      onSuccess toasts only for copy/rotate/create.
  MODIFY src/features/listen-rack/ListenRackPage.tsx header actions (112-118):
    - when identity.isOwner && realAudio: a "Share" `btn sm` beside View Report opening
      the dialog (local open state; versionId + track.name in scope).
  CREATE src/routes/_app/invite.$token.tsx:
    - _app-gated (login redirect + next handled by the layout guard).
    - On mount: ref-guarded one-shot useAcceptInvite().mutate(token) (StrictMode gotcha).
      pending → "Accepting your invite…"
      success → toast 'Invite accepted.'; navigate to
        invite.songVersionId ? /listen-rack/{songVersionId} : /library
        (already-accepted is NOT an error: the endpoint re-accepts idempotently and
        returns 200 + InviteDto — VersionShareEndpoints.cs:213-225)
      error (404 = missing/revoked, empty body — no server copy exists) → visible state
        (NOT a toast): "This invite is no longer valid — ask for a fresh link." +
        Link to /library.
  TESTS:
    - VersionShareDialog render test: settings load → visibility select + link row +
      invite list render; create-invite success appends (mock fetcher per
      SharePublishDialog.test.tsx harness).
    - invite route: single mutate under StrictMode double-mount (ref guard) — unit-test
      the guard if route harness is heavy.
```

### Integration points

```yaml
DATABASE: none — no EF migration, no Alembic (bookmark note update uses existing columns).
BFF: two surgical edits (BookmarkEndpoints.cs upsert-note; BillingEndpoints.cs credits
  SuccessUrl). No new endpoints, no new packages, statuses unchanged.
FRONTEND: new files — mutation-error-toast.ts (+test), VersionShareDialog.tsx,
  routes/_app/invite.$token.tsx, plus tests. No new deps (MutationCache ships in
  @tanstack/react-query ^5.62.7; sonner already present).
CONFIG: none. The product tag is hardcoded at the credits checkout site by design.
WORKER: untouched.
```

---

## Validation Loop

### Level 1 — build/lint/type

```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build
cd components/bff && dotnet build        # stop any running BFF first (file lock)
```

### Level 2 — unit tests

```bash
cd components/frontend-spectr-v2 && npx vitest run   # incl. mutation-error-toast, rail
                                                     # honesty states, BookmarksRail
                                                     # single-POST edit, notifications
                                                     # append, usage-summary error,
                                                     # upgrade-checkout predicate,
                                                     # VersionShareDialog
cd components/bff && dotnet test                     # incl. bookmark upsert-note +
                                                     # credits SuccessUrl tests
pytest -q components/worker/tests/                   # unchanged; 5 known pre-existing
                                                     # failures excluded (gotchas)
```

### Level 3 — integration

```bash
./scripts/start-spectr.ps1     # per docs/STARTUP.md — verify section 5 before testing
```

Manual verification (each maps to a finding; DevTools "block request URL" / offline
toggle is the standard failure injector for the toast checks):

1. **E6.7 / E7.2 / E7.3 / E7.5 (toast sweep)** — with the BFF stopped (or the specific
   endpoint blocked in DevTools): save a rack preset, save a look, import a preset JSON,
   accept and reject a suggestion, post/pin/resolve/delete a comment, add/delete a
   bookmark, follow from `/u/{handle}` and from `/v/{token}`: EVERY one toasts (server
   copy when the server answered, fallback copy offline). No action double-toasts; the
   suggestion-send from fork-to-suggest still toasts exactly once (call-site handler).
2. **E6.6** — block `GET /versions/{id}/rack/draft` (with a saved draft in place), open
   the rack, wait out the retries: "autosave is paused" toast with Retry appears; twist
   knobs; unblock; reload → the ORIGINAL saved draft restores (was: defaults overwrote
   it). Retry → draft restores in place, autosave re-arms.
3. **E6.1** — open `/listen-rack/{random-uuid}`: not-found page with Library link; no
   "Neon Skyline" fixture, no fixture notes/stats.
4. **E6.2** — open the rack for a just-uploaded, never-analyzed version → Stats tab says
   "Not analyzed yet…"; no "0.0 LUFS", no "+14.0 LU over".
5. **E6.3** — song with ≥2 versions, analysis on the latest only; open the rack on the
   OLDER version → mismatch note names the analyzed version.
6. **E6.4** — Coach tab on a real version: no "KNOWS THIS TRACK · 14/26 RUN", no canned
   reply input; the link opens the report's AI Coach tab.
7. **E6.5** — "View Report →" navigates to `/songs/{id}/results/{jobId}`; hidden for a
   song with no analysis.
8. **E7.4** — edit a bookmark note normally → single POST in the network tab, note
   updates, same bookmark id. Then block the POST and edit → toast, bookmark STILL
   listed with the old note (was: silently destroyed). Name-toggle still works
   (regression: note preserved on a note-less POST).
9. **E7.6** — hammer `GET /api/u/{handle}` past the rate limit (or mock 429): rate-limit
   copy renders, not "No one lives here".
10. **E7.7** — with >1 page of notifications, click "More…": page-0 items remain, next
    page appends.
11. **E8.1 / E8.2** — stop the BFF, open `/billing` and `/usage`: error cards with
    Retry; NO eternal "Loading…", NO "0 credits · You haven't bought any credits yet."
    Restart + Retry → real data.
12. **E8.3** — force `/api/me/entitlements` to fail (block URL): /usage shows "Plan info
    is unavailable…"; nav meter absent (documented); no crash.
13. **E8.4** — buy a credit pack via /usage (Stripe test mode; or hand-navigate to
    `/billing/success?product=credits` with a fresh ledger row): credits copy at every
    stage; after the webhook lands, "Credits added — you have N credits." An untagged
    visit still shows the subscription flow.
14. **E8.5** — as a PRO user, start a credits popup-checkout and CLOSE the popup without
    paying: `onUpgraded` does NOT fire within 60 s (was: fired on the first poll);
    completing payment fires it and `/usage` shows the new balance without reload.
15. **E8.6** — sign in as pro (and as a credits user): /profile chip + Account card show
    the real tier and the right link.
16. **E7.1** — as owner on the rack page: Share → set unlisted → copy `/v/{token}` link →
    opens in an incognito window. Rotate → old link dead, new link works. Create a
    reviewer invite → copy `/invite/{token}` → open as another signed-in user → lands on
    the version's rack with the invite accepted (GET /access reflects it); revoked invite
    → honest error page.

---

## Error handling patterns

- **One rule for the global handler** (fact #4): fires iff `meta.errorToast` is set;
  message = server copy (`extractApiMessage`) when an `ApiError` carries one, else the
  meta fallback. Never `err.message` raw (avoids "HTTP 500" toasts), never a second
  toast for call-site-handled mutations.
- **Toast vs inline vs rollback**: toasts for fire-and-forget actions (this wave's bulk);
  inline error states where the page IS the content (`/billing`, `/usage`, route-level
  404s, invite accept); *structural* fixes where feedback alone can't make the action
  safe (E6.6 pause-autosave, E7.4 single-POST edit).
- **Server changes change shape, not status**: the bookmark upsert stays 200; the credits
  checkout response is untouched (only the Stripe redirect URL string).
- **Never render fabricated data as fallback**: absent analysis → say so; unknown tier →
  render nothing rather than "Free".

## Anti-patterns to avoid

- Don't touch room code (E6.8–E6.14 files listed in Out of scope) — including "just
  adding meta" to `useRoomSession` mutations.
- Don't use an opt-OUT global handler or key it on `mutation.options.onError` — fact #4.
- Don't hand-roll new per-hook `toast.error(err…)` copies where `meta.errorToast`
  suffices; don't put meta on hooks with call-site handlers.
- Don't convert the ~120 legacy BFF envelope sites, and don't "upgrade" the two touched
  BFF endpoints to the AR38 envelope while you're in there — separate follow-on.
- Don't read tier from `useAuth().user.tier` anywhere new (it can't say 'credits').
- Don't let the draft autosave toast stack (sonner `id` is mandatory) and don't block
  autosave forever after one transient upsert failure — only the GET failure disarms it.
- Don't build the full share-center UX (per-invite emails, member management) — the
  Task-10 dialog is deliberately minimal.
- Don't `git commit` with failing gates; don't mock-to-pass (CLAUDE.md).

---

## Confidence score: 7.5/10

Grounded: every cited line was read this session; all 20 findings re-verified live; the
global-handler design was validated against TanStack v5's actual observer-vs-cache
callback visibility (the opt-out trap is real, not theoretical); both server changes were
scoped against the exact endpoint code (bookmark upsert branch, credits SuccessUrl line);
`AuthedUser.tier`'s missing 'credits' and `JobResultsDto.versionId`'s presence were
verified in types.ts. The invite-accept endpoint was read too: idempotent 200 on re-accept,
404-empty-body on missing/revoked — the route's branches are fully specified. Residual
risks: (1) Task 10 is feature-shaped — the dialog + accept route touch a flow with zero
existing UI tests; budget the most time there and cut polish, not error handling, if
squeezed; (2) E8.4's ledger-recency fallback (15-min window) is a heuristic — acceptable
for a confirmation page, but keep the balance-delta check primary; (3) converting
`useNotifications` to infinite changes its query key — the only consumers are
NotificationCenter + its tests (verified), but re-grep before renaming; (4) the rail.tsx
prop-threading (RightRail → StatsPanel/CoachPanel) touches a large ported file — keep the
diff surgical, no drive-by refactors.
