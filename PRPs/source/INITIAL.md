<!--
  INITIAL.md — feature intake for /generate-prp.

  Feature: Audit remediation wave 1 — auth/session integrity + poll terminal states
  Authored: 2026-07-23 from docs/edge-case-report.md (E-numbers) + docs/ux-friction-report.md (F-numbers)
-->

## FEATURE

Close the two highest-leverage root-shape clusters from the 2026-07 audit pair
(`docs/edge-case-report.md`, `docs/ux-friction-report.md`):

**Cluster 1 — auth/session integrity.** The token-refresh contract has three holes that
make sessions silently fail or silently survive: the fetcher's blanket `/auth/*` 401-refresh
exclusion (E2.2 sign-out fails server-side and the session resurrects; E2.3 profile save /
resend-verification break after 15-min idle), zero reuse-grace on refresh rotation (E2.1 —
two tabs restoring together bounce N−1 tabs to /login), and the XHR upload path living
entirely outside the 401-refresh contract (E3.9 — token expiry kills a full 250 MB transfer).
Adjacent front-door fix: the login navigate-race (F8) shares the same "auth state not yet
committed" shape and should be retired in the same pass.

**Cluster 2 — poll terminal states.** Five frontend polls never terminate on error/404
because their `refetchInterval` callbacks read `data?.status` (undefined on error → keep
polling), and three worker actors never write a terminal state the UI could read. Findings:
E1.1 (anon funnel wedges in fake "Analyzing" on poll 404), E3.1 (stems classify failure has
no representation — review step polls forever, confirm disabled), E5.1 (structure-job crash
leaves `arrangement_status='pending'` forever; results poll is uncapped), E5.3 (failed triage
re-enqueues a fresh LLM call on EVERY verdicts view — unbounded spend), E5.6
(`awaiting_stem_mapping` renders as raw string and polls forever), E5.11 (job 404 re-fetched
every 2 s forever).

Deliverable: one PR-sized change set across frontend-spectr-v2 + bff + worker with tests,
closing E2.1, E2.2, E2.3, E3.9, F8, E1.1, E3.1, E5.1, E5.3, E5.6, E5.11.

**Out of scope (later waves):** error-envelope unification (E2.4/E3.7), silent-mutation
toasts (E6.x/E7.x/E8.x), findings/severity unification (F1/F2), all room findings
(E6.8–E6.14 — routed to the listening-room roadmap, not bug-fix work).

## COMPONENTS

### COMPONENT: frontend-spectr-v2

**Pattern**: v2 stack rules in CLAUDE.md (TS strict, CSS Modules, fetcher.ts owns 401-retry)

**Purpose**: Narrow the fetcher's refresh exclusion, add cross-tab refresh single-flight,
give the XHR upload hooks the 401-refresh contract, fix the login navigate race, and
introduce one shared poll-terminal helper applied to every unbounded poll.

**Inputs**: BFF `/api/*` (no new endpoints required beyond what bff component adds)
**Outputs**: browser

**Notes — cluster 1**:
- `src/api/fetcher.ts:136` — change the blanket `!config.url.startsWith('/auth/')` exclusion
  to an explicit no-refresh list: `/auth/refresh`, `/auth/login`, `/auth/register` (401 there
  means bad credentials/expired cookie, not stale access token). Logout, `GET/PATCH /auth/me`,
  and `resend-verification` MUST get the refresh-retry (fixes E2.2, E2.3).
- Cross-tab refresh single-flight (E2.1 client side): wrap `refreshToken()` in
  `navigator.locks.request('spectr-refresh', …)` (Web Locks API; feature-detect and fall
  through to current behavior when absent). The server grace (see bff) is the primary fix;
  the lock reduces rotation churn. Do NOT move tokens to localStorage — access token stays
  module-state only (CLAUDE.md rule).
- XHR hooks (E3.9): before `xhr.open`, await a `getFreshAccessToken()` exported from
  `fetcher.ts` (returns current token if <N min old by decoding `exp`, else silent-refresh
  first). On a 401 `load` result, do ONE refresh + full re-send. Applies to
  `hooks/useFileUpload.ts:40-46`, `hooks/useStemStaging.ts`, and the `useMixUpload.ts:135`
  fast-path (which currently skips the fetcher call that would have refreshed).
- Login race (F8, `routes/_public/login.tsx:33-35,47-49`): after `await login(...)`, await
  `router.invalidate()` before `navigate('/library')`, or have the `_app` guard treat an
  in-flight login like the silent-refresh boot (it already short-circuits on `isLoading`).
  Apply to both the real submit and the dev sign-in button.

**Notes — cluster 2**:
- Add ONE helper, e.g. `src/api/poll-helpers.ts::terminalAwareInterval({ pollMs, isTerminal,
  maxErrors = 3 })` returning a `refetchInterval` callback that reads `query.state.status`
  and `query.state.error` — stops permanently on: terminal data state, error count exceeded,
  or 404. Unit-test it once; apply everywhere:
  - `src/api/hooks.ts:491-503` `useJob` — stop on error/404 (E5.11); treat
    `awaiting_stem_mapping` as terminal-for-polling (E5.6).
  - `src/api/hooks.ts:348-353` `useStemProposals` — add poll cap (~4 min like the review-OFF
    path) + stop on error; expose a `classifyTimedOut` flag (E3.1).
  - `src/api/hooks.ts:525-543` `useJobResults` arrangement poll — stop when
    `arrangement_status` is anything other than `'pending'` (new `'failed'` terminal from
    worker), and cap total polls (~10 min) as a backstop (E5.1).
  - `src/features/anon-analyze/useAnonAnalysis.ts:32,107-111` — stop polling when `anonGet`
    yields null ≥3 consecutive times; surface a distinct `lost` stage (E1.1).
- Anon funnel stage machine (`AnalyzePage.tsx:186-192`): add the `lost`/error branch — copy
  ("We lost track of this analysis — cookies blocked or the report was claimed elsewhere")
  + "Start over" reset affordance that clears local jobId state. Also un-hardcode
  `workerOffline={false}` at `AnalyzePage.tsx:271` by reusing the existing worker-health
  query (E1.5 is a freebie here if trivial; otherwise leave it).
- Stems review step (`UnifiedUploadDialog.tsx:684,1116`): on `classifyTimedOut`, replace the
  spinner with a failure state offering (a) "Retry classification" (re-POST classify) and
  (b) "Assign roles manually" — enabled confirm with all roles editable, defaulting
  unclassified stems to `unknown` (pairs with the worker's degrade-to-unknown change).
- `awaiting_stem_mapping` (E5.6): in `songs.$songId.results.$jobId.tsx:41-42,155-160`,
  branch on the status with honest copy ("Waiting on stem role confirmation") and a link to
  the song page; stop the poll (covered by the helper).
- Results arrangement area: render a terminal "Arrangement analysis failed" note when
  `arrangement_status === 'failed'` (new worker write) instead of eternal "analyzing…".

### COMPONENT: bff

**Pattern**: bff conventions in CLAUDE.md (minimal-API endpoint groups, ErrorEnvelope, EF Core)

**Purpose**: Refresh-rotation reuse-grace, logout that works from the cookie alone, and a
triage re-enqueue guard.

**Inputs**: PostgreSQL (EF Core), Redis (dramatiq dispatch)
**Outputs**: HTTP/JSON

**Notes**:
- Reuse-grace (E2.1, `Auth/RefreshTokenService.cs:37,43-57`): when `RotateAsync` revokes a
  row, stamp `ReplacedById` + `RevokedAt` (add columns via EF migration if absent). In
  `ResolveAsync`, a revoked row presented within a 60 s grace window whose successor is still
  valid → mint an access token off the successor WITHOUT rotating again and WITHOUT touching
  the cookie (the browser already holds the successor value — cookies are shared across
  tabs; only the in-flight request carried the stale one). Outside grace, or no successor →
  401 as today. Test: two concurrent refreshes with the same token → both 200, exactly one
  rotation row created.
- Logout (E2.2 server side, `AuthEndpoints.cs:22,424-437`): change `POST /auth/logout` to
  `AllowAnonymous` and revoke by the `spectr_refresh` cookie (the thing actually being
  killed), clearing the cookie unconditionally; keep best-effort bearer-based `tver` bump
  when a valid bearer is present. Combined with the frontend exclusion fix, logout then
  works in every token state. 204 always (no oracle).
- Triage guard (E5.3, `VerdictEndpoints.cs:61-76`): before lazy-enqueueing `run_triage`,
  skip when (a) `degradation_notice` is non-null (worker now writes one on terminal failure
  — see worker), or (b) a triage enqueue for this analysis happened within the last
  10 minutes (cheap `IMemoryCache` key `triage:{analysisId}`, per-instance is fine — this is
  spend throttling, not correctness).

### COMPONENT: worker

**Pattern**: dramatiq actor conventions in CLAUDE.md (sync `def`, 3-phase tx, fail-markers)

**Purpose**: Every actor failure in scope writes a terminal state the UI can read.

**Inputs/Outputs**: PostgreSQL `analyses` / `song_versions` rows

**Notes**:
- `structure_actor.py:152-161` (E5.1): in the failure path, merge
  `arrangement_status='failed'` (+ short `arrangement_error`) into the analysis
  `final_json` phase-7 block using the same merge-and-write-back pattern
  `rerun_single_phase` uses. Best-effort + idempotent; never raise past the write.
- `triage_actor.py:131-141` (E5.3): on terminal non-budget failure, persist a
  `degradation_notice` (e.g. "Specialist routing unavailable for this analysis") so the BFF
  guard stops re-enqueueing and the frontend's existing degradation-notice rendering shows it.
- `classify_stems` failure (E3.1): wrap per-stem classification so any failure degrades to
  `detected_role='unknown'` instead of leaving NULL — `classified` then completes and the
  review UI falls back to manual role assignment. A whole-actor crash still exists → that's
  what the frontend poll cap + retry button covers.

## SHARED DOCUMENTATION

- `docs/edge-case-report.md` — E1.1, E2.1–E2.3, E3.1, E3.9, E5.1, E5.3, E5.6, E5.11 (file:line
  evidence for every gap this PRP closes; the "recurring root shapes" section is the rationale)
- `docs/ux-friction-report.md` — F8 (login race repro + direction)
- `docs/api-contracts-bff.md` — auth conventions (15-min access token, rotating refresh
  cookie), job status enum incl. `awaiting_stem_mapping`, verdicts lazy-triage behavior
- `CLAUDE.md` — fetcher/token rules (access token in module state ONLY), dramatiq actor
  patterns, EF migration workflow, validation gates
- `components/frontend-spectr-v2/src/api/fetcher.ts` — the single 401-refresh implementation
  every change in cluster 1 hangs off
- `components/bff/src/Spectr.Bff/Auth/RefreshTokenService.cs` — rotation to extend
- `components/worker/app/structure_actor.py`, `triage_actor.py` — failure paths to terminalize

## OTHER CONSIDERATIONS

- **Security posture unchanged**: reuse-grace must only ever mint an ACCESS token for a
  revoked-within-grace token whose successor chain is intact; a token revoked by logout or
  `tver` bump gets no grace (check revocation reason or clear `ReplacedById` on logout).
  Grace window 60 s, constant, not configurable per-request.
- **Retry-of-upload semantics (E3.9)**: a 401 retry re-sends the whole body — acceptable at
  ≤250 MB but make the pre-flight freshness check the primary defense so the retry is rare.
  Do not retry on any other status.
- **Poll helper is the deliverable, not 6 bespoke fixes**: reviewers should see one tested
  utility + thin call-site diffs. Resist inlining per-hook variants.
- **`final_json` write-back caution**: the structure-actor merge touches the same row the
  golden-snapshot tests guard — use the existing merge helpers; do not hand-roll JSON
  surgery. Run `pytest -q components/worker/tests/` + analysis golden tests.
- **Don't fix adjacent findings opportunistically** (envelope shapes E2.4/E3.7 will be
  tempting inside the XHR hooks — leave them; wave 2).
- **Validation gates**: the standard set — frontend `tsc --noEmit` / `lint --max-warnings 0`
  / `build` / `vitest run`; `dotnet build && dotnet test`; `pytest -q components/worker/tests/`;
  plus new tests: reuse-grace concurrency, logout-from-cookie (stale bearer), fetcher
  exclusion list, poll-helper terminal matrix, XHR 401-refresh-retry, structure/triage/classify
  failure write-backs.
- **Manual verification** (stack per `docs/STARTUP.md`): two-tab session-restore stays signed
  in; sign out after >15 min idle actually revokes (next visit does NOT resurrect); kill the
  worker mid-classify → review step shows failure + manual-assign path; a report whose
  structure job was killed shows "Arrangement analysis failed" instead of eternal spinner.
