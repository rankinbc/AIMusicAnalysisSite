# PRP — Audit Remediation Wave 1: Auth/Session Integrity + Poll Terminal States

**Source intake:** `PRPs/source/INITIAL.md` (2026-07-23)
**Closes:** E2.1 E2.2 E2.3 E3.9 F8 (cluster 1 — auth) · E1.1 E3.1 E5.1 E5.3 E5.6 E5.11 (cluster 2 — polls)
**Finding evidence:** `docs/edge-case-report.md` (E-numbers) and `docs/ux-friction-report.md` (F8) carry
file:line evidence for every gap — treat them as part of this PRP's context and read both finding
sets before starting.

---

## Goal

One PR-sized change set across `frontend-spectr-v2` + `bff` + `worker`:

1. **Auth/session integrity** — the token-refresh contract works in every state: sign-out
   actually revokes after idle; profile-save/resend-verification survive idle; two tabs
   refreshing concurrently both stay signed in; XHR uploads survive token expiry; login
   never bounces a successful sign-in back to the form.
2. **Poll terminal states** — no frontend poll ever runs forever on error/404/undefined
   status, and every in-scope worker failure writes a terminal state the UI renders honestly.

## Why

- The audits found five recurring root shapes; these two clusters are the highest
  user-impact-per-line: silent logout failure is a security expectation broken (E2.2),
  the two-tab bounce hits every session-restore (E2.1), and E5.3 is unbounded LLM spend.
- One tested poll helper + thin call-site diffs closes six findings at once.

## What (user-visible behavior)

- Sign out always revokes the refresh token server-side, in any token state; next visit does NOT resurrect the session.
- Restoring N tabs: all N stay signed in (no `/login?next=…` bounce).
- Profile save / resend-verification work after >15 min idle without a mystery failure.
- A mix/stems/als/reference upload started with a stale token silently refreshes and succeeds.
- Login (real and dev button) lands on `/library` on first click.
- Anon funnel: blocked cookies / claimed-elsewhere job → honest "We lost track of this analysis" + Start over (no infinite fake spinner).
- Stems review: classification stall → failure state with "Retry classification" and "Assign roles manually" (no infinite "Classifying stems…").
- Report: structure-job crash → "Arrangement analysis failed" note (no eternal "analyzing…"); failed triage → degradation notice renders and NO further LLM dispatches occur.
- `awaiting_stem_mapping` renders honest copy + link to the song page, and stops polling.
- A 404'd job stops being polled after the error renders.

### Success Criteria

- [ ] All 11 findings closed with the manual verifications in "Final Validation" passing
- [ ] One shared poll helper (unit-tested) used by every changed poll site — no bespoke variants
- [ ] No security regression: grace never applies to logout/reset-revoked tokens; access token stays in module state only
- [ ] All validation gates green (frontend ×4, `dotnet build && dotnet test`, worker pytest)

---

## All Needed Context

### Documentation & references

```yaml
- file: docs/edge-case-report.md
  why: E1.1, E2.1-E2.3, E3.1, E3.9, E5.1, E5.3, E5.6, E5.11 — exact trigger + file:line for each gap
- file: docs/ux-friction-report.md
  why: F8 (login race) — repro + direction
- file: CLAUDE.md
  why: v2 stack rules (fetcher owns 401-retry; access token in module state ONLY — never
       localStorage), dramatiq actor rules (sync def, 3-phase tx), EF migration workflow,
       validation gates, queue topology (run_triage rides analysis-paid)
- file: components/frontend-spectr-v2/src/api/fetcher.ts
  why: THE single-flight refresh (refreshSession, story 12.7) all cluster-1 work extends.
       Line 136 is the blanket exclusion to narrow. ApiError carries .status.
- file: components/bff/src/Spectr.Bff/Auth/RefreshTokenService.cs
  why: rotation to extend with grace (RotateAsync:43-57, ResolveAsync:32-40)
- file: components/bff/src/Spectr.Data/Entities/RefreshToken.cs
  why: entity to add replaced_by_id to (currently: id/user_id/token_hash/expires_at/revoked_at/created_at)
- file: components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs
  why: Refresh handler 385-421 (rotation + cookie append), Logout 423-437 (ALREADY
       cookie-driven — only the .RequireAuthorization() at line 22 is wrong)
- file: components/bff/src/Spectr.Bff/Endpoints/VerdictEndpoints.cs
  why: lines 61-76 — lazy triage enqueue ALREADY guarded by DegradationNotice is null.
       E5.3's fix is therefore worker-side (write the notice); BFF change optional.
- file: components/frontend-spectr-v2/src/api/hooks.ts
  why: the poll sites — useJob:491-503, useStemProposals:340-355, useJobResults:533-544
       (+isArrangementPending:525-531), useVerdicts:563-586 (the 25-poll cap is the
       pattern precedent for bounded polls)
- file: components/frontend-spectr-v2/src/features/anon-analyze/useAnonAnalysis.ts
  why: anonGet maps 404→null (line 32); useAnonJob:102-112 is the unbounded anon poll;
       NOTE anon flow does NOT use fetcher/ApiError — its terminal logic is bespoke (Task 8)
- file: components/frontend-spectr-v2/src/features/anon-analyze/AnalyzePage.tsx
  why: stage machine 186-192 (add 'lost' branch), workerOffline={false} literal at 271,
       failed-state affordance 274-281
- file: components/frontend-spectr-v2/src/hooks/useFileUpload.ts
  why: XHR pattern — token snapshot at line 44-45, load/error/abort listeners; mirror the
       same preflight+retry change in useStemStaging.ts and useMixUpload.ts
- file: components/frontend-spectr-v2/src/hooks/useMixUpload.ts
  why: line ~135 fast-path (cached presignedAvailable=false skips the fetcher call that
       would have refreshed); abort-on-part-failure at 118-124
- file: components/frontend-spectr-v2/src/routes/_public/login.tsx
  why: handleSubmit:29-41 + handleDevLogin:44-55 — both navigate before auth state commits (F8)
- file: components/frontend-spectr-v2/src/auth/AuthContext.tsx
  why: login/applyAuth flow; logout():156-165; the _app guard's isLoading short-circuit
       referenced by F8's fix direction (routes/_app.tsx:32-40)
- file: components/worker/app/structure_actor.py
  why: Phase B except at 147-161 marks the structure JOB failed but never touches
       analysis.final_json — that's E5.1. Phase C (163-174) shows the write-back pattern
       (reassign row.final_json inside SessionFactory.begin()).
- file: components/worker/app/triage_actor.py
  why: LlmBudgetExceeded path (119-130) is the pattern to copy for the LlmError (131-133)
       and parse-failure (136-141) holes — both currently just `return`, leaving
       routing_plan AND degradation_notice NULL (E5.3)
- file: components/worker/app/verdict_lib/degraded.py
  why: write_degradation_notice(aid, reason=..., detail=...) at line 35 — reuse; check its
       reason vocabulary and add e.g. "triage_failed" consistently; run_rule_engine_for_analysis
       is idempotent and should follow the notice (users still get rule-engine findings)
- file: components/worker/app/tasks_dramatiq.py
  why: classify_stems:497-556 — per-stem failure ALREADY degrades to role "other" inside
       classify_audio; the hole is Phase B raising (resolve/fetch/import failure) before
       anything is written. Phase C shows the JSONB reassign-not-mutate rule.
- file: components/frontend-spectr-v2/src/routes/_app/songs.$songId.results.$jobId.tsx
  why: status branching at 41-42, 94-103, 155-160 (awaiting_stem_mapping falls through to
       "in progress"); ProgressStoryline active flag (ui/ProgressStoryline.tsx:71)
- file: components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx
  why: review step — "Classifying stems…" 684, confirm disabled until classified 1116,
       review-OFF waitClassified ~4 min bound at 102-112 (the timeout precedent)
```

### Discovered facts that CHANGE the intake's assumptions (trust these)

1. **Logout handler is already cookie-driven** (`AuthEndpoints.cs:430-435` reads the cookie,
   not the bearer). Server fix = change `.RequireAuthorization()` → `.AllowAnonymous()` on
   line 22's logout mapping. Everything else about E2.2 is the frontend exclusion.
2. **BFF triage guard already exists** (`VerdictEndpoints.cs:61`): enqueue is skipped when
   `RoutingPlan` OR `DegradationNotice` is non-null. E5.3 is closed by making the worker
   write a notice on terminal non-budget failure. An IMemoryCache throttle is optional
   defense-in-depth (Task 12) for crash-before-write loops.
3. **classify_stems already maps per-stem failures to "other"**. Only the whole-actor crash
   (Phase B raise) and worker-down need handling: a try/except writing "other" roles for
   all entries, plus the frontend poll cap.

### Known gotchas

```
# CRITICAL — fetcher.ts refresh single-flight (story 12.7): AuthContext boot and the 401
#   handler MUST keep sharing refreshSession(); build the Web Locks wrapper INSIDE it,
#   don't add a second refresh path.
# CRITICAL — access token lives in module state only. Never localStorage/sessionStorage,
#   never BroadcastChannel the token itself (CLAUDE.md rule). Cross-tab consistency comes
#   from the server grace window, not token sharing.
# CRITICAL — refresh cookie Path=/api/auth (RefreshTokenService.CookieOptions) — logout,
#   refresh, login all live under it; nothing to change there.
# CRITICAL — grace must NOT apply to logout/reset revocations: only rotation sets
#   replaced_by_id, and grace requires a live successor. RevokeAsync/RevokeAllForUserAsync
#   never set replaced_by_id → revoked-by-logout rows have no successor → no grace. Keep it
#   that way; add a test asserting it.
# CRITICAL — on a grace hit: mint the ACCESS token only. Do NOT RotateAsync again, do NOT
#   Cookies.Append (the browser already holds the successor cookie — cookies are shared
#   across tabs; only the in-flight request carried the stale value).
# EF Core: plain add-column migration (no partial-index hand-editing needed here — that
#   gotcha applies only to is_current). Commands in Validation Loop.
# TanStack Query: `retry: false` does NOT stop interval refetches — refetchInterval fires
#   regardless of error state unless the callback returns false. That's the whole bug class.
# refetchInterval callback receives the query object: use query.state.data,
#   query.state.error, query.state.dataUpdateCount, query.state.errorUpdateCount.
#   Precedent for bounded polls: useVerdicts (hooks.ts:581) caps via dataUpdateCount < 25.
# ApiError (fetcher.ts) carries .status — the helper's 404 detection keys off
#   `err instanceof ApiError && err.status === 404`. The ANON flow does not use fetcher:
#   anonGet maps 404 → null resolved data (not an error). Its terminal logic is bespoke.
# SQLAlchemy JSONB: in-place mutation is NOT tracked — always reassign the column
#   (pattern at tasks_dramatiq.py:548-554 and structure_actor.py Phase C).
# Dramatiq actors are sync def; worker uses db_sync SessionFactory (never async sessions).
# structure_actor Phase B raises after marking the job failed → dramatiq may retry
#   (max_retries=1). Pre-writing arrangement_status='failed' is SAFE: a later successful
#   retry's Phase C overwrites final_json wholesale with the merged result.
# XHR 401 retry re-sends the entire body — keep the preflight freshness check primary so
#   the retry is rare; retry ONCE on 401 only, never on other statuses.
# Web Locks API: feature-detect (`navigator.locks?.request`) — fall through to current
#   behavior when absent (Safari <15.4, some webviews).
# vitest: fetcher/hooks tests live next to sources (*.test.ts[x]); jsdom environment;
#   fetch is mockable via vi.stubGlobal. Follow existing test files' shape.
```

---

## Implementation Blueprint

Order matters: BFF grace lands before the frontend lock (frontend behavior depends on it);
worker terminal writes land before the frontend renders them (but frontend backstops are
independent). Tasks 1–4 = cluster 1 server, 5–7 = cluster 1 client, 8–11 = cluster 2,
12 = optional hardening.

```yaml
Task 1 — bff: RefreshToken.replaced_by_id + migration:
  MODIFY components/bff/src/Spectr.Data/Entities/RefreshToken.cs:
    - ADD: [Column("replaced_by_id")] public Guid? ReplacedById { get; set; }
  RUN: dotnet ef migrations add RefreshTokenReplacedBy (see Validation Loop for exact form)
  VERIFY: migration is a plain AddColumn — no raw SQL needed.

Task 2 — bff: rotation grace in RefreshTokenService:
  MODIFY Auth/RefreshTokenService.cs:
    - RotateAsync: after creating `fresh`, set current.ReplacedById = fresh.Id (same SaveChanges).
    - ADD: public sealed record ResolveResult(RefreshToken Row, bool GraceHit);
    - ADD ResolveWithGraceAsync(string rawCookie, TimeSpan grace, CancellationToken):
        row = find by hash; null → null
        if row.RevokedAt is null && row.ExpiresAt >= now → ResolveResult(row, false)
        if row.RevokedAt within grace && row.ReplacedById is Guid succId:
            succ = find by Id == succId
            if succ is { RevokedAt: null } && succ.ExpiresAt >= now → ResolveResult(row, true)
        else → null
    - KEEP ResolveAsync unchanged (Logout still uses it).
    - Grace window: private static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(60);

Task 3 — bff: Refresh handler uses grace; Logout goes anonymous:
  MODIFY Endpoints/AuthEndpoints.cs:
    - line 22: g.MapPost("/logout", Logout).AllowAnonymous();   # handler body unchanged
    - Refresh (385-421): call ResolveWithGraceAsync(raw, RotationGrace).
        GraceHit == false → existing path verbatim (rotate + append cookie).
        GraceHit == true  → SKIP RotateAsync and SKIP Cookies.Append; still load user,
                            check IsActive + BannedAt (same 401/403 branches); return
                            Results.Ok(AuthResponse) with a fresh jwt.Issue(user).
  TESTS (mirror existing auth endpoint test patterns in components/bff tests):
    - concurrent-refresh: resolve+rotate token A, then present A again within grace → 200,
      access token minted, NO new refresh row created, cookie NOT re-set.
    - grace expiry: revoke A via rotation, advance/mock beyond 60 s → 401.
    - logout kills grace: RevokeAsync'd (no ReplacedById) row presented → 401 even instantly.
    - reset kills grace: RevokeAllForUserAsync rows → 401.
    - logout with no/garbage bearer + valid cookie → 204 AND row revoked (regression E2.2).

Task 4 — bff (optional, do last if time allows): none required for triage —
  the DegradationNotice guard already exists. See Task 12 for optional throttle.

Task 5 — frontend: fetcher exclusion list + getFreshAccessToken + Web Locks:
  MODIFY src/api/fetcher.ts:
    - REPLACE line 136 predicate:
        const NO_REFRESH_RETRY = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/dev-login'];
        if (res.status === 401 && !NO_REFRESH_RETRY.some((p) => config.url.startsWith(p))) { ... }
      (logout, /auth/me GET+PATCH, resend-verification, verify-email now refresh-retry — E2.2/E2.3)
    - WRAP the network part of refreshSession's IIFE in Web Locks when available:
        const doRefresh = async () => { ...existing fetch+hydrate... };
        navigator.locks?.request ? navigator.locks.request('spectr_refresh', doRefresh) : doRefresh()
      Keep the module-level refreshInFlight ??= single-flight EXACTLY as is (per-tab dedupe);
      the lock adds same-browser cross-tab serialization on top. Grace (Task 2) is the
      correctness net — the lock just reduces rotation churn.
    - ADD export getFreshAccessToken(minTtlSeconds = 120): Promise<string | null>:
        decode accessToken JWT payload exp (atob on segment [1]; try/catch → treat as stale);
        if missing/expiring within minTtl → await refreshSession();
        return getAccessToken();
  TESTS (src/api/fetcher.test.ts, extend existing if present):
    - 401 on /me → refresh called then retried; 401 on /auth/login → NOT retried;
    - 401 on /auth/logout → refresh called + retried (the E2.2 regression case);
    - getFreshAccessToken with near-expiry token triggers refreshSession once.

Task 6 — frontend: XHR hooks join the 401 contract:
  MODIFY src/hooks/useFileUpload.ts (pattern; replicate in useStemStaging.ts and the XHR
  path of useMixUpload.ts — including its presignedAvailable=false fast-path):
    - Make upload() async: const token = await getFreshAccessToken(); before xhr.open.
    - EXTRACT the send into a local attempt(token) returning Promise<UploadResponse>; on
      xhr.status === 401 && !retried: retried = true; const fresh = await refreshSession();
      fresh ? resolve(attempt(fresh.accessToken)) : reject.
    - PRESERVE progress/abort/error listener behavior and the existing state shape exactly.
    - DO NOT touch safeParseError bodies (envelope unification is wave 2 — resist).
  TEST: mock XMLHttpRequest (existing pattern or vi.stubGlobal): first attempt 401 →
    refresh called → second attempt 200 resolves; non-401 failure → no retry.

Task 7 — frontend: login race (F8):
  MODIFY src/routes/_public/login.tsx handleSubmit AND handleDevLogin:
    - after await login(...) / await devLogin(...):
        await router.invalidate();            // useRouter() from @tanstack/react-router
        await navigate({ to: next ?? '/library' });
    - If the _app guard still races in manual testing, ALSO make the guard treat an
      in-flight login like the boot silent-refresh (routes/_app.tsx:32-40 already
      short-circuits on isLoading — extend that state through login mutation).
  VERIFY manually: dev sign-in lands on /library first click (was the F8 repro).

Task 8 — frontend: shared poll-terminal helper:
  CREATE src/api/poll-helpers.ts:
    - export function terminalPoll<TData>(opts: {
        pollMs: number | ((data: TData) => number);
        active: (data: TData) => boolean;      // data says keep polling
        maxPolls?: number;                     // total fetch cap (data+error updates)
        maxErrors?: number;                    // default 3
      }): (query: { state: { data?: TData; error: unknown; dataUpdateCount: number;
                             errorUpdateCount: number } }) => number | false
    - Semantics (unit-test all):
        error instanceof ApiError && status === 404          → false (immediately)
        errorUpdateCount >= maxErrors                        → false
        dataUpdateCount + errorUpdateCount >= maxPolls (set) → false
        data && !active(data)                                → false
        else                                                 → resolved pollMs
  CREATE src/api/poll-helpers.test.ts covering the matrix incl. "error then recovery
  keeps polling until maxErrors total" (document: total, not consecutive — simpler and
  strictly safer).

Task 9 — frontend: apply helper + render terminal states:
  MODIFY src/api/hooks.ts:
    - useJob: refetchInterval: terminalPoll({ pollMs: opts?.pollMs ?? 2000,
        active: (d) => d.status !== 'complete' && d.status !== 'failed'
                       && d.status !== 'awaiting_stem_mapping' })          # E5.11 + E5.6
    - useStemProposals: terminalPoll({ pollMs: 1500,
        active: (d) => !d.classified && d.stems.length > 0, maxPolls: 160 })  # ~4 min, E3.1
    - useJobResults: terminalPoll({ pollMs: 8000, active: isArrangementPending,
        maxPolls: 75 })                                                     # ~10 min backstop, E5.1
  MODIFY routes/_app/songs.$songId.results.$jobId.tsx:
    - ADD status === 'awaiting_stem_mapping' branch: honest copy ("Waiting on stem role
      confirmation — finish the stems review from the song page") + Link to /songs/$songId.
  MODIFY features/results (arrangement area — locate via isArrangementPending consumers):
    - arrangement_status === 'failed' → render "Arrangement analysis failed" note where
      "analyzing…" currently shows (worker now writes this — Task 10).
  MODIFY components/UnifiedUploadDialog.tsx review step:
    - Surface a stalled state when useStemProposals' poll terminated without classified
      (expose e.g. `stalled` from a thin wrapper or compute from query.state counts):
      replace spinner copy with failure text + two actions:
        "Retry classification" → re-POST /versions/{id}/stems/classify, reset the poll
        "Assign roles manually" → enable the role editors + confirm button with
        unassigned rows defaulted to role 'other' (server's known-role vocabulary —
        the confirm 400 "Unknown stem role" branch means don't invent role strings).

Task 10 — worker: structure failure writes arrangement_status='failed'   # E5.1
  MODIFY components/worker/app/structure_actor.py Phase B except (147-161):
    - AFTER marking the structure job failed, ALSO (same or fresh short tx, best-effort
      try/except that never masks the original raise):
        row = s.get(Analysis, aid)
        fj = copy of row.final_json; find phases[] entry with phase == 7;
        if its data.arrangement_status == 'pending':
            data.arrangement_status = 'failed'
            data.arrangement_error = str(exc)[:500]
            row.final_json = fj          # REASSIGN — JSONB dirty-flag rule
    - Only write when currently 'pending' (idempotent; never clobber a completed rerun).
    - KEEP the raise (dramatiq retry may still succeed; its Phase C overwrites wholesale).
  TEST (components/worker/tests/, mirror existing structure-actor test setup): failure path
    leaves analysis.final_json phase7.arrangement_status == 'failed'; success path unchanged
    (golden snapshots must stay green).

Task 11 — worker: triage terminal failures write the degradation notice   # E5.3
  MODIFY components/worker/app/triage_actor.py:
    - LlmError branch (131-133) AND parse/validation branch (136-141): replace bare
      `return` with the LlmBudgetExceeded pattern (119-130):
        write_degradation_notice(aid, reason="triage_failed", detail=<short reason>)
        run_rule_engine_for_analysis(aid)
        return
    - CHECK degraded.py:35 signature + existing reason strings first; if reasons are an
      enum/closed set, add "triage_failed" wherever the set is declared AND confirm the
      frontend degradation-notice rendering shows an unknown reason gracefully (it renders
      the notice text — verify, don't assume).
    - Result: VerdictEndpoints' existing DegradationNotice guard stops all future enqueues.
  MODIFY tasks_dramatiq.py classify_stems (Phase B, 522-538):                # E3.1 worker half
    - WRAP resolve+classify in try/except Exception: log, then build `updated` with
      detected_role='other', confidence=0.0, evidence='classification unavailable' for ALL
      entries and fall through to Phase C's write (classified flips true; review UI
      degrades to manual assignment). Do not raise after writing.
  TESTS: triage LlmError → degradation_notice set + routing_plan still NULL + rule engine
    invoked; classify hard-failure → every entry has detected_role='other'.

Task 12 — bff (OPTIONAL hardening, skip if gates are at risk):
  MODIFY Endpoints/VerdictEndpoints.cs lazy-fire block (61-76): IMemoryCache throttle —
    key $"triage:{analysisRow.Id}", absolute expiry 10 min, skip enqueue on hit. Guards the
    crash-before-write loop the notice can't catch. Per-instance cache is fine (spend
    throttle, not correctness).
```

### Integration points

```yaml
DATABASE:
  - EF migration (Task 1): add nullable uuid column refresh_tokens.replaced_by_id.
    No Alembic change — the worker never reads refresh_tokens.
  - No new columns for cluster 2: analyses.degradation_notice + routing_plan and
    song_versions.stem_paths_raw already exist on both ORMs.
FRONTEND:
  - New file src/api/poll-helpers.ts (+ test). No new routes, no new deps.
CONFIG: none. Grace window is a constant (60 s) by design — do not make it configurable.
```

---

## Validation Loop

### Level 1 — build/lint/type

```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build
cd components/bff && dotnet build
ruff check components/worker/
```

### Level 2 — unit tests

```bash
cd components/frontend-spectr-v2 && npx vitest run          # incl. new poll-helpers, fetcher, XHR tests
cd components/bff && dotnet test                            # incl. new grace + logout tests
pytest -q components/worker/tests/                          # incl. structure/triage/classify failure tests
pytest -q components/analysis/tests/                        # golden snapshots must stay byte-identical
```

### Level 3 — DB migration + integration

```bash
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
./scripts/start-spectr.ps1     # per docs/STARTUP.md — verify per section 5 before testing
```

Manual verification (each maps to a finding):

1. **E2.1** — sign in, duplicate the tab, hard-refresh both simultaneously (or restore a
   2-tab session): both stay signed in.
2. **E2.2** — sign in, wait >15 min (or shrink the access-token lifetime in dev config),
   Sign out, then reopen the app: NOT signed back in; `refresh_tokens` row shows revoked_at.
3. **E2.3** — same stale-token state: profile display-name save succeeds first try.
4. **E3.9** — start a large upload with a near-expiry token: completes without manual retry.
5. **F8** — dev sign-in button lands on /library on the first click.
6. **E1.1** — block cookies (or delete spectr_device mid-poll): funnel shows the "lost"
   state with Start over, network tab shows polling STOPPED.
7. **E3.1** — stop the worker, stage stems with review ON: after ~4 min the review step
   offers Retry / Assign manually; assigning manually + confirm dispatches analysis
   (restart worker first).
8. **E5.1** — kill the worker mid-structure-job (or force an exception): report shows
   "Arrangement analysis failed"; polling stopped.
9. **E5.3** — force a triage LLM failure (bogus model name in dev): degradation notice
   renders; repeated report reloads enqueue NO new run_triage (check queue depth /
   worker log).
10. **E5.6/E5.11** — open a results URL for a deleted job: error renders and network tab
    shows no further /jobs polling.

---

## Error handling patterns

- **Grace path** returns the same 401 as any invalid token when grace conditions fail — no
  new error codes, no oracle about why.
- **Worker write-backs are best-effort**: every new failure write sits in its own
  try/except and must never mask the original exception or undo prior writes (matches the
  existing "best-effort progress" pattern in structure_actor:135-144).
- **Frontend terminal states render copy, not raw codes** — but do NOT touch the
  error-envelope parsing (`extractApiError`, `safeParseError`): that's wave 2 (E2.4/E3.7).

## Anti-patterns to avoid

- Don't move tokens into localStorage/sessionStorage or broadcast them cross-tab — the
  server grace is the cross-tab mechanism.
- Don't rotate or re-append the cookie on a grace hit.
- Don't give grace to rows revoked by logout/password-reset (no successor = no grace).
- Don't write bespoke per-hook poll logic — every changed site uses `terminalPoll` (the
  anon hook's null-streak variant is the one documented exception, kept inside
  useAnonAnalysis.ts).
- Don't hand-roll `final_json` JSON surgery beyond the single phase-7 status field; never
  mutate JSONB in place (reassign).
- Don't opportunistically fix adjacent audit findings (envelope shapes, silent mutations,
  coach caps) — wave 2.
- Don't `git commit` with failing gates; don't mock-to-pass worker tests (CLAUDE.md).

---

## Confidence score: 8/10

Grounded: every touched line was read this session; three intake assumptions were corrected
against the code (logout already cookie-driven; triage guard exists; classify degrades
per-stem). Residual risk: the BFF integration-test harness for auth endpoints may need
scaffolding if none exists for cookie flows (budget a fake-clock or injectable now for the
grace-window tests), and the UnifiedUploadDialog stalled-state wiring touches a large
component — keep that diff surgical.
