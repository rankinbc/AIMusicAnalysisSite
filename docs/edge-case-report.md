# Edge-Case Report — SPECTR Unhandled Paths

**Hunt:** 2026-07-23 · edge-case-hunter (exhaustive path enumeration, 4 parallel code tracers) · code tracing of `components/frontend-spectr-v2/src` + `components/bff/src/Spectr.Bff` + worker actors
**Ground truth:** [user-journeys.md](./user-journeys.md) (8 journeys) · [api-contracts-bff.md](./api-contracts-bff.md) (branch conditions per endpoint)
**Scope:** paths with **missing/undefined handling only** — branches, boundaries, and states where nothing is defined. Paths handled *badly* are UX friction and live in [ux-friction-report.md](./ux-friction-report.md) (F1–F15); they are excluded here. Where an unhandled path overlaps a friction finding it is referenced, not re-derived.
**Also excluded (known local quirks, by design):** `POST /api/uploads/init → 501` presigned-disabled fallback; the anon 409 `anon_active_analysis` one-active-per-device rule.
**Confidence:** every finding is confirmed-in-code (file:line evidence) unless marked *probable*. Branches walked and found handled were silently discarded; the discard lists are in the per-journey tracer outputs.

---

## Journey 1 — Anonymous first analysis (the funnel)

### E1.1 — Anon job poll 404 wedges the funnel in a permanent fake "Analyzing your track" 🔴 High
- **Trigger:** (a) browser blocks/clears cookies — upload returns 200 + jobId but `spectr_device` never sticks, so every poll is cookie-less; (b) user registers in a second tab mid-analysis — the claim nulls `DeviceId` on the job (`AuthEndpoints.cs:233-236`) and clears the cookie (`:257-258`); (c) purge/row race.
- **Branch:** `GET /api/anon/jobs/{jobId}` → 404 (device-scope mismatch or row gone).
- **Currently:** `anonGet` maps 404 → `null` with no error signal (`useAnonAnalysis.ts:32`); `refetchInterval` keys only off `status`, so null data polls every 2 s forever (`useAnonAnalysis.ts:107-111`). Stage machine has no 404 branch: `jobId !== null` + `status === undefined` → `'processing'` (`AnalyzePage.tsx:186-192`) — indefinite "pending 0%" storyline; the only reset affordance requires a *successful* poll returning `failed` (`AnalyzePage.tsx:274-281`). In trigger (b) the in-flight claimed job is also invisible everywhere (song-less + anon endpoints 404).

### E1.2 — Results fetch failure at report stage → permanent "Loading your report…" 🟠 Medium
- **Trigger:** job row reads `complete` but `GET /api/anon/jobs/{jobId}/results` 404s (analysis row purged/absent) or 5xx/network-errors.
- **Branch:** anon results → 404 (api-contracts-bff.md, Anon funnel).
- **Currently:** 404 → `null` cached with `staleTime: Infinity`, never refetched (`useAnonAnalysis.ts:32,115-122`); non-404 errors are never read (`AnalyzePage.tsx:243` reads only `.data`). Either way the page renders "Loading your report…" forever (`AnalyzePage.tsx:292-294`) — no retry, no error branch, no reset.

### E1.3 — No client-side size check; the documented 400 oversize branch is unreachable 🟠 Medium
- **Trigger:** anon user picks a ≥250 MB file.
- **Branch:** contract says `POST /api/anon/analyses` → 400 `invalid_file` for oversize; in reality Kestrel `MaxRequestBodySize = 250 MB` (`Program.cs:100`) + `RequestSizeLimitAttribute` (`AnonAnalysisEndpoints.cs:34`) reject the body *before* the handler's own 400 branch (`:57-58`) can run — multipart overhead makes even a ~249.9 MB file exceed the limit.
- **Currently:** no `file.size` check in the drop zone (`AnalyzePage.tsx:32-79,230-239`); the file uploads until a body-less 413/mid-stream abort → "Upload failed. Try again." or "Network error during upload." (`useAnonAnalysis.ts:56-68`) — neither mentions size; user retries the doomed file. (*413-vs-abort browser behavior: probable.*)

### E1.4 — Existing-account users have no claim path; a signed-in user on the anon report gets a dead end 🔴 High
- **Trigger:** anon analysis completes; visitor already has a SPECTR account.
- **Branch:** device claim exists **only** in `POST /api/auth/register` (`AuthEndpoints.cs:196-254`); `Login` (`:291-330`) has no claim logic.
- **Currently:** the only unlock affordance is register-only (`AnalyzePage.tsx:323-381`, no "already have an account?" path). Registering with the existing email → raw "HTTP 409" (see E2.4). Signing in via nav instead: `locked` flips false (`AnalyzePage.tsx:288`) but data is still the REDUCED anon projection — `vmFromAnon` sets `allFindings: null` (`anon-report-vm.ts:30`), so `AnonReportView` renders neither the teaser, the findings, nor any CTA (`AnalyzePage.tsx:114-151`). Grade + one finding, no route to the full report, never claimed, purged at 72 h.

### E1.5 — Worker-offline state is hardcoded off in the anon funnel 🟡 Low
- **Trigger:** worker down while an anon job is pending.
- **Branch:** worker heartbeat stale (authed shell shows `AppWorkerHealthNotice`; `/analyze` uses `PublicChrome`, which has none).
- **Currently:** `ProgressStorylineView` receives `workerOffline={false}` as a literal (`AnalyzePage.tsx:271`) — the offline branch is unreachable in this funnel. Frozen "pending" with no signal until the `StaleJobReaper` grace fails the job (`StaleJobReaper.cs:95-116`).

## Journey 2 — Sign in / registration

### E2.1 — Concurrent refresh from two tabs: no rotation reuse-grace → losing tab bounced to /login 🔴 High
- **Trigger:** session-restore reopens ≥2 app tabs; each `AuthProvider` mount fires `POST /api/auth/refresh` with the same cookie within milliseconds.
- **Branch:** refresh rotation — `RotateAsync` revokes the old row immediately (`RefreshTokenService.cs:43-57`); `ResolveAsync` returns null for a revoked row, zero grace window (`:37`).
- **Currently:** the single-flight guard is per-tab module state only (`fetcher.ts:17,75-94`) — no cross-tab lock. The losing tab's 401 → `applyAuth(null)` (`AuthContext.tsx:74-87`) → redirect to `/login` (`routes/_app.tsx:32-40`), even though the browser now holds a valid rotated cookie (a reload signs straight back in). N−1 of N restored tabs appear logged out.

### E2.2 — Sign-out after 15-min idle silently fails server-side; the session resurrects 🔴 High
- **Trigger:** user idles >15 min (access token expired), clicks "Sign out".
- **Branch:** `POST /api/auth/logout` is `RequireAuthorization` (`AuthEndpoints.cs:22`) → 401 on the stale bearer.
- **Currently:** `fetcher` skips 401→refresh→retry for any `/auth/*` URL (`fetcher.ts:136`), so logout never retries. The handler never runs — refresh row not revoked, `spectr_refresh` cookie not cleared (`AuthEndpoints.cs:424-437` unreached). `AuthContext.logout` clears only in-memory state (`AuthContext.tsx:156-165`); the UI looks signed out but the next visit silent-refreshes back into the account. On a shared machine this is a real logout failure with zero feedback.

### E2.3 — The `/auth/` refresh-exclusion also breaks `/auth/me` PATCH and resend-verification after idle 🟠 Medium
- **Trigger:** same idle-token state; user edits display name/handle or clicks "Resend email".
- **Branch:** 401 on `PATCH /api/auth/me` / `POST /api/auth/resend-verification`.
- **Currently:** same `fetcher.ts:136` exclusion — no refresh-retry. Profile save shows "Could not save change." (`profile.tsx:303-309`) despite a valid refresh cookie; resend toasts raw "HTTP 401" (`verify-email.ts:53-56`). Keeps failing until an unrelated non-`/auth/` request refreshes the token.

### E2.4 — Register 409 (email taken) renders literally "HTTP 409" — legacy envelope, no machine code 🟠 Medium
- **Trigger:** registering an email that exists (high-frequency branch; also the anon funnel's claim card — the exact moment E1.4 needs a sign-in path).
- **Branch:** `POST /api/auth/register` → 409, but the BFF returns the legacy shape `{ "error": "Email already registered." }` (`AuthEndpoints.cs:173`), not the AR38 envelope — no `code` to key off, contradicting the contract's own convention.
- **Currently:** `extractApiError` only reads the object shape (`error-utils.ts:15-21`) → `ApiError` falls back to "HTTP 409" (`fetcher.ts:159`), shown raw on `/register` (`register.tsx:59`) and in `InlineRegisterCard` (`AnalyzePage.tsx:343`). Same gap: login 401's empty body → "HTTP 401" (`login.tsx:37`).

## Journey 3 — Upload a new song/version (registered)

### E3.1 — Review-ON stem classification has no failure or timeout state — review step polls forever, confirm permanently disabled 🔴 High
- **Trigger:** stems staged, classify 202-accepted, then the `classify_stems` actor crashes / worker down / message lost.
- **Branch:** `GET /api/versions/{id}/stems` — the contract defines only `classified=true` when done; a failed actor leaves `DetectedRole` null forever (`VersionEndpoints.cs:915-924`), so there is **no failure representation at all**.
- **Currently:** `useStemProposals` re-polls every 1.5 s unconditionally — no poll cap, no error branch (`hooks.ts:348-353`; contrast `useFixRack`'s 100-poll cap). "Classifying stems…" forever (`UnifiedUploadDialog.tsx:684`), "Confirm & analyze" disabled until `classified` (`:1116`). The version is left `analyze=false`, never analyzed. (Review-OFF is bounded at ~4 min, `UnifiedUploadDialog.tsx:102-112`, but offers no way to resume the stems flow after the timeout.)

### E3.2 — Auto-created song name collision → unhandled unique violation → 500 after a full upload 🔴 High
- **Trigger:** upload `final_mix.wav` with "➕ New song…" and no typed name while a song named `final_mix` already exists (e.g. re-uploading the same file).
- **Branch:** `uq_songs_user_name` unique index (`AppDbContext.cs:122-123`) vs. `ResolveOrCreateSongAsync` (`VersionEndpoints.cs:1006-1018`).
- **Currently:** `SongEndpoints.Create` catches the violation (409, `SongEndpoints.cs:109-116`), but `UploadVersion`'s `SaveChangesAsync` (`VersionEndpoints.cs:327`) and `/uploads/complete` (`UploadEndpoints.cs:203-209`) have no `IsUniqueViolation` catch — DbUpdateException → 500 `internal_error` after up to 250 MB transferred. Frontend shows the generic toast.

### E3.3 — Dialog closed (Esc/overlay) mid-orchestration: nothing aborts; the pipeline runs headless and can navigate the user minutes later 🟠 Medium
- **Trigger:** Escape/overlay-click during upload/classify (Cancel is disabled while busy, but Radix close paths are not blocked).
- **Branch:** orchestration interruption; `POST /uploads/abort` exists for cancellation.
- **Currently:** `onOpenChange` forwards the close unconditionally (`UnifiedUploadDialog.tsx:660-666`). No call site invokes `fileUpload.cancel()`; `/uploads/abort` fires only on a part-PUT failure (`useMixUpload.ts:118-124`), never on user cancel. The orphaned promise keeps uploading/dispatching and finally calls `finishNavigate` (`UnifiedUploadDialog.tsx:268-278`) — yanking the user to a results page they didn't ask for. Re-opening and re-uploading meanwhile mints a second version + second analysis (second entitlement).

### E3.4 — Any failure after the mix upload leaves a silent `analyze=false` orphan; every retry mints another one 🟠 Medium
- **Trigger:** mix uploads, then .als attach / stems stage / classify / dispatch fails — or browser refresh mid-orchestration (all dialog state is in-memory).
- **Branch:** unified flow's deferred-dispatch design (`analyze=false`, single downstream dispatch).
- **Currently:** the catch resets to the form and toasts "retry analysis from the song page" (`UnifiedUploadDialog.tsx:617-625`), but retry only remembers the created **song** (`:411-414`) and unconditionally re-uploads the mix (`:418-423`) — each retry (including the UpgradeSheet cap-resume, `:1152-1157`) creates another un-analyzed version. No UI surface marks "never analyzed" (indistinguishable from an unscored version, `songs.$songId.tsx:224-230`); recovery depends on knowing to press "↻ Reanalyze", which does not re-attach the failed .als/stems.

### E3.5 — Review-step confirm has none of the main path's dispatch-error handling; retry after ambiguous failure double-dispatches 🟠 Medium
- **Trigger:** `POST /stems/confirm` → 409 `entitlement_exhausted` / `insufficient_credits`, 403 `email_verification_required`, 429, 503 `entitlements_unavailable` from the review step.
- **Branch:** contract: "dispatch errors as above" on `/stems/confirm`; clients key off `code`.
- **Currently:** `runUpload`'s catch keys off codes (UpgradeSheet, verify-resend — `UnifiedUploadDialog.tsx:597-616`) but `handleConfirm`'s catch is only `toast.error(err.message)` (`:645-648`) — no code-keyed branch for any of the five. The BFF `ConfirmStems` also has **no idempotency guard** (`VersionEndpoints.cs:927-973`): if the first POST landed but the response was lost, a second click dispatches a second `analyze_audio_job` and consumes a second entitlement.

### E3.6 — A 0-byte stem is silently skipped server-side → client index-zip assigns roles to the wrong audio; trailing rows silently dropped 🟠 Medium
- **Trigger:** one 0-byte file among the picked stems (client checks extension only, `UnifiedUploadDialog.tsx:280-301`).
- **Branch:** `POST /stems/stage` — `if (file.Length == 0) continue;` (`VersionEndpoints.cs:740`) returns fewer entries than files sent, with no marker.
- **Currently:** rows map to staged entries **by index** (`staged.stems.slice(-stemRows.length)`, `serverId = stagedStems[i]?.id`, `UnifiedUploadDialog.tsx:571-572`). A skipped file shifts alignment: later rows get the wrong `serverId` (role choices apply to the wrong audio); the last row(s) get `undefined` and `buildConfirmPayload` silently filters them out (`stems-upload-helpers.ts:7-9`) — never confirmed, never analyzed, no warning.

### E3.7 — Error-envelope shape mismatch in both directions: `{error:"text"}` → "HTTP 400"; AR38 envelope via XHR → "[object Object]" 🟠 Medium
- **Trigger:** (a) any plain-shape validation branch via `fetcher` — >250 MB at `/uploads/init` (`UploadEndpoints.cs:92-93`), "Unknown stem role/id" at confirm (`VersionEndpoints.cs:946-949`), duplicate-song 409 (`SongEndpoints.cs:115`); (b) an AR38 envelope body through the legacy XHR proxy upload.
- **Branch:** contract Conventions — "Some older validation branches still return plain `{ "error": "text" }` 400s."
- **Currently:** (a) `extractApiError` reads only `body.error.message` (`error-utils.ts:15-21`) → fallback "HTTP 400" (`fetcher.ts:159`). (b) the XHR hooks' `safeParseError` returns `o.error ?? o.title` (`useFileUpload.ts:90-97`, same in `useStemStaging.ts:70-77`); when `error` is the envelope **object**, the toast reads "[object Object]". Neither direction handles the other shape. (Same root as E2.4.)

### E3.8 — No client-side size/empty pre-check on the mix — a >250 MB file uploads in full before the 400 🟡 Low
- **Trigger:** 251 MB WAV on the proxy-fallback path.
- **Branch:** `POST /api/versions/` "400 size/empty" (`VersionEndpoints.cs:301-304`).
- **Currently:** no `file.size` check anywhere in `UnifiedUploadDialog.tsx`; the XHR posts the whole body, the user watches a full progress bar, then gets the 400 (rendered per E3.7). `=250 MB` passes; `>250 MB` and 0-byte are pure server round-trips.

### E3.9 — XHR upload hooks have no 401 → silent-refresh → retry: token expiry kills the whole transfer 🟠 Medium
- **Trigger:** upload started in a >15-min-idle tab, or a slow 250 MB upload outliving the 15-min access token; also the cached `presignedAvailable=false` fast-path skips the `fetcher` call that would have refreshed (`useMixUpload.ts:135`).
- **Branch:** auth convention — 15-min access token, refresh on 401 (`fetcher.ts:136-145` — bypassed entirely by the XHR path).
- **Currently:** `useFileUpload` snapshots the token at `xhr.open` (`useFileUpload.ts:40-46`) and treats 401 as terminal — "Upload failed (401)" (`:55-67`); `useStemStaging` same. No refresh, no retry; the user re-uploads the whole file manually. Affects every authed upload (mix, stems, .als, reference).

## Journey 4 — Library → song → versions

### E4.1 — Deleting the current version leaves the song with zero `is_current` rows; the concurrent set-current race is uncaught 🟠 Medium
- **Trigger:** `DELETE /api/versions/{id}` on the `is_current=true` version.
- **Branch:** the partial unique index permits **zero** current rows; nothing transfers currency.
- **Currently:** `Delete` just removes the row (`VersionEndpoints.cs:360-384`) — no sibling promotion. Frontend fallbacks mask it (`library-helpers.ts:29-34`, `songs.$songId.tsx:93`) but the "current" chip silently disappears everywhere. Related (*probable*): `SetCurrent` (`VersionEndpoints.cs:133-157`) is demote-then-promote with no `DbUpdateException` catch — two tabs setting different versions current can trip the index → unhandled 500.

### E4.2 — Deleting a version with an in-flight job: job neither blocked nor cancelled; audio deleted under the worker; entitlement silently lost 🟠 Medium
- **Trigger:** `DELETE /api/versions/{id}` while its job is `pending`/`processing` (Delete has no job-state guard — `songs.$songId.tsx:264-271`).
- **Branch:** version delete vs. in-flight `analysis_jobs` (no FK/cascade; only `HardDelete` cleans jobs, `SongEndpoints.cs:301-303`).
- **Currently:** row + audio deleted (`VersionEndpoints.cs:376-381`) with no in-flight check. The worker fails on the missing version/file → job `failed` with a generic error; the credit reversal never fires (it is `invalid_file`-only, `JobEndpoints.cs:316-334`). An analysis slot is consumed with no output and no refund.

### E4.3 — Concurrent "+ Add version" from two tabs → version-number race → 500 after a full upload 🟠 Medium *(probable — race confirmed by code shape, not reproduced)*
- **Trigger:** two uploads to the same `song_id` interleave between `MaxAsync` and `SaveChanges`.
- **Branch:** `uq_song_versions_song_number` unique index (`AppDbContext.cs:124-126`) vs. read-then-insert `InsertVersionRowAsync` (`VersionEndpoints.cs:1027-1046`).
- **Currently:** neither `UploadVersion` nor `/uploads/complete` catches the DbUpdateException → 500 `internal_error` for the losing tab after the full transfer; the stored blob is orphaned (no compensating delete).

## Journey 5 — Results page (the core deliverable)

### E5.1 — Structure job failure is a black hole: `arrangement_status` stays `'pending'` forever, report polls indefinitely 🔴 High
- **Trigger:** the deferred allin1 structure job crashes (subprocess timeout/OOM) after the main analysis completed with `phase7.arrangement_status='pending'`.
- **Branch:** arrangement backfill — worker failure path of `detect_structure_job`.
- **Currently:** the worker marks its own job row failed but never writes back into `analyses.final_json` (`structure_actor.py:152-161`) — `arrangement_status` is `'pending'` forever; `max_retries=1` makes it permanent. The frontend polls `GET /jobs/{id}/results` every 8 s with **no poll cap and no terminal check** (`hooks.ts:525-543`; contrast verdicts' 25-poll cap, fix-rack's 100) — an open report tab polls indefinitely and no UI ever reports the failure.

### E5.2 — A failed specialist renders as "cached" and is permanently unrecoverable 🔴 High
- **Trigger:** specialist run fails; worker persists the fail-marker verdict (`headline='Specialist failed'`, `verdict_actor.py:89-124`); BFF reports the slug's status as `"failed"` (`VerdictEndpoints.cs:97-107`).
- **Branch:** verdicts contract — specialist statuses `idle/cached/failed`.
- **Currently:** the frontend has **no `failed` state**: `CoachTab` maps every non-`idle` status into `ranSlugs` (`CoachTab.tsx:60,69`); `SpecialistTeamModal`'s union is `'idle'|'running'|'cached'|'locked'` — failure renders as a disabled **"cached"** tile (`SpecialistTeamModal.tsx:9,36-41,97`). Dead-end: re-run 409s because the fail-marker counts as an existing verdict ("Dismiss it first", `VerdictEndpoints.cs:173-176`) and the dismiss UI was removed in story 12.5 (`hooks.ts:636-639`).

### E5.3 — A terminally-failing triage re-enqueues a fresh LLM call on every page view, forever 🔴 High
- **Trigger:** lazy-fired `run_triage` fails with a non-budget error (`LlmError`, unparseable routing plan).
- **Branch:** verdicts GET lazy-fires `run_triage`; degradation notice is written only for `LlmBudgetExceeded`.
- **Currently:** the actor logs and returns leaving `routing_plan=NULL`, `degradation_notice=NULL` (`triage_actor.py:131-141`). No terminal state exists: the frontend polls 25× then silently stops (`hooks.ts:577-583`) — empty roster, no error surface — and **every subsequent `GET /verdicts/` re-enqueues another `run_triage`** while the plan is null (`VerdictEndpoints.cs:61-76`): one queued LLM dispatch per page view, indefinitely, across sessions.

### E5.4 — Verdicts fetch failure renders as "No issues / clean mix" 🟠 Medium
- **Trigger:** `GET /reports/{jobId}/verdicts/` 404s (analysis row missing) or 500s; `retry: false` makes one failure final.
- **Branch:** verdicts GET 404.
- **Currently:** the error is never read — `ReportView` destructures only `data` (`ReportView.tsx:89-93`; same `CoachTab.tsx:54`). `verdicts` → `[]`, so SongHeader renders "No issues / clean mix" (`SongHeader.tsx:101-109`), the Findings tab shows the success empty-state (`FindingsTab.tsx:113-124`), CoachChat grounds on "0 verdicts" — a false clean bill of health with no error indicator.

### E5.5 — songId/jobId mismatch renders song B's report under song A's URL 🟠 Medium
- **Trigger:** URL edited/mis-linked: `/songs/A/results/{job-of-song-B}` (jobs are user-scoped, not song-scoped — `JobEndpoints.cs:361-376`).
- **Branch:** route load — no cross-check of `results.songId` vs the route param.
- **Currently:** the route passes the raw param through (`songs.$songId.results.$jobId.tsx:33,107`) and `ReportView` ignores `results.songId` (`ReportView.tsx:75-77`). Song B's report renders under song A; "← all versions" (`:273`), the "+ Add mix" chip (`:256-259`), and post-reanalyze navigation (`:228-231`) all target the **wrong song**.

### E5.6 — `awaiting_stem_mapping` is an undefined state: raw status string, no hints, no CTA, polls forever 🟠 Medium
- **Trigger:** results route open on a job in `awaiting_stem_mapping` (first-class status in the `JobStatusDto` contract). (*v2's dispatch-after-confirm may never mint it; legacy/v1 rows and the contract still allow it — probable in v2, defined-state gap regardless.*)
- **Branch:** job status poll — non-terminal status outside pending/processing/complete/failed.
- **Currently:** the route falls through to "Analysis in progress" (`songs.$songId.results.$jobId.tsx:41-42,155-160`); `ProgressStoryline` treats it as inactive (`active = pending||processing`, `ProgressStoryline.tsx:71`) — raw "Status: awaiting_stem_mapping", all phases unchecked, no hints, no stem-confirm CTA, and `useJob` polls every 2 s forever (`hooks.ts:496-500`). The 24 h auto-fail is v1/legacy Celery only.

### E5.7 — Fail-marker verdicts are counted as findings: badge says N, list shows N−1 🟠 Medium
- **Trigger:** an analysis whose verdicts include a fail-marker (worker doesn't set `kind`; ORM defaults `"fault"` — `verdict_actor.py:97-119`, `aimusic_shared/models.py:383`).
- **Branch:** fail-marker sentinel shape vs. findings counting.
- **Currently:** `faultCount` counts `kind==='fault'` without filtering fail-markers (`problems-helpers.ts:63-65`) → SongHeader vital and Findings badge count a *failed specialist run* as a finding (`ReportView.tsx:291,310`), while the list filters it out (`FindingsTab.tsx:93-96`). With only a fail-marker, `faults=1 && findings.length=0` skips the empty state (`FindingsTab.tsx:113`): filter bar "All 0" over "No findings match this filter."

### E5.8 — Coach SSE closing cleanly without a terminal frame leaves an unterminated partial answer 🟠 Medium
- **Trigger:** the stream closes (proxy/server drop, BFF request aborted) mid-token-relay without `done`/`refusal`/`error`.
- **Branch:** coach `messages/{id}/stream` — relay ends without a terminal frame.
- **Currently:** the read loop exits on reader `done` and there is **no code after the loop** — the partial turn is never finalized, status stays "Coach is responding…", no retry (`CoachChat.tsx:390-446`; the `finally` at 456-464 only clears `streaming`). A later send appends as if the truncated answer were complete. (Network-*thrown* errors are caught and toasted; the clean close is the hole.)

### E5.9 — `coach_reply` actor dying hard leaves a permanently empty Coach bubble, cap already charged 🟠 Medium
- **Trigger:** actor dies (process kill / half-dead fork) after rows persisted with the assistant row `status='pending'`; user later refreshes.
- **Branch:** conversation hydration — message `status` ∈ pending/streaming (`CoachConversationEndpoints.cs:160-175`).
- **Currently:** nothing terminalizes the row (worker error-write needs its own except path to run, `coach_actor.py:156-167`; the BFF 30 s idle fallback fires only for a **connected** stream, `CoachConversationEndpoints.cs:534-555`). Hydration maps pending → `finalized:false`, empty text (`CoachChat.tsx:197-213`), never re-opens the stream — a permanently empty bubble, no timeout, no retry, cap charged (`CoachConversationEndpoints.cs:183-191`).

### E5.10 — 4000-char coach limit has no client cap; the 400 strands the user bubble and loses the text 🟡 Low
- **Trigger:** message over the BFF's 4000-char limit → 400 `coach_message_invalid` (`CoachConversationEndpoints.cs:34,84-90`).
- **Branch:** coach POST 400 `coach_message_invalid`.
- **Currently:** no `maxLength`, no length check in `send()` (`CoachChat.tsx:273-278,572-590`). The 400 hits the generic path, which trims only the empty pending assistant bubble — the optimistic *user* bubble stays (`CoachChat.tsx:353-355,454-455`; the cap-reached branch removes both, `:332-338`), and the input was already cleared (`:288`) — recovery means re-typing 4000+ chars.

### E5.11 — Job 404 never stops the status poll: 404 re-fetched every 2 s forever 🟡 Low
- **Trigger:** results/progress page open for a jobId that 404s (hard-deleted via song permanent-delete, `SongEndpoints.cs:301-303`; mistyped/stale deep link; another user's job).
- **Branch:** `GET /api/jobs/{jobId}` 404.
- **Currently:** an error panel renders (handled), but `useJob`'s `refetchInterval` reads `data?.status` — undefined on error → keeps returning the interval (`hooks.ts:491-503`); `retry:false` doesn't stop interval refetches. No terminal state; 404-polls indefinitely. Same unbounded-on-error shape in `useStemProposals` (`hooks.ts:348-353`).

### E5.12 — Spectrogram/waveform: one failed image request permanently hides the Visuals section 🟡 Low
- **Trigger:** lazy-loaded `<img>` fires after the 15-min token baked into the src at render time expired (`loading="lazy"` + idle), or a transient 401 during rotation.
- **Branch:** image GET auth via `?t=` / token rotation mid-page.
- **Currently:** `withTok` bakes `getAccessToken()` into the src once (`TrackInfoTab.tsx:309`); `onError` permanently hides the image (`setSpecOk(false)`/`setWaveOk(false)`, `TrackInfoTab.tsx:307-346`) — no retry with a refreshed token, no placeholder; the section silently disappears for the session though the image exists.

### E5.13 — Corrupt `final_json` → unguarded parse → permanent 500 on every load of that report 🟡 Low
- **Trigger:** a corrupt/truncated `analyses.final_json` row (schema-drift territory).
- **Branch:** `GET /jobs/{jobId}/results` payload parse.
- **Currently:** `JsonDocument.Parse(row.FinalJson)` is unguarded (`JobEndpoints.cs:378`) → `JsonException` → 500 `internal_error` forever. Every other JSON parse in the same file and in Verdict/FixRack endpoints is try/caught with fallback; the report body itself is the only one that isn't.

### E5.14 — Malformed fix-rack chain renders a "ready" rack with 0 modules and a live Open button that applies nothing 🟡 Low
- **Trigger:** fix-rack GET 200 with a `chain` that is valid JSON but not `{order, modules}` (BFF validates parseability only, `FixRackEndpoints.cs:79-88`).
- **Branch:** Fix Rack GET 200 `FixRackDto`.
- **Currently:** `readFixChain` → `null`, `enabledModuleIds` → `[]`; the panel renders ready with "0 modules", an empty chain bar, and an enabled "Open in Listen rack" that applies nothing (`FixRackPanel.tsx:37,73-101`; `fix-rack-helpers.ts:17-33`). No malformed-chain error state — the comment at `FixRackPanel.tsx:72-73` assumes ≥1 module, which the shape guard's existence contradicts.

> Overlap noted, not re-derived: AI verdicts with `userState.applied=true` landing after the first `moves` seed never enter `committedIds` (the one-shot seed at `ReportView.tsx:115-123`) — this is the committed-state race already reported as friction **F3**; the silent 500 on `POST /api/verdicts/{id}/applied` is likewise **F3**.

## Journey 6 — Listen rack (+ rooms)

### E6.1 — Version 404 on `/listen-rack/{id}` falls back to a demo fixture presented as real 🔴 High
- **Trigger:** deleted/foreign/nonexistent versionId (stale deep link, old bookmark).
- **Branch:** `GET /api/versions/{id}` 404.
- **Currently:** no route-level 404 state — `useVersion` errors silently, `track` is undefined, and `ListenRackPage` falls back to the demo fixture (`listen-rack.$versionId.tsx:41-59`; `ListenRackPage.tsx:192` — `const track = trackProp ?? TRACK;`). The page renders the mock track's name/genre/notes as if real while the audio 404s into a retry loop and eventually toasts "Could not load audio."

### E6.2 — Unanalyzed version: Stats rail renders defaulted zeros as measurements 🔴 High
- **Trigger:** open the rack for a version with no completed analysis; look at Stats/metering.
- **Branch:** `song.latestResult` absent → no `finalJson`.
- **Currently:** `buildTrack` defaults every metric to 0 (`trackFromAnalysis.ts:62-77`) and `StatsPanel` renders them as facts: "Integrated 0.0 LUFS", "True peak 0.0 dBTP", "VS SPOTIFY −14 LUFS → +14.0 LU over" computed from the defaults (`rail.tsx:485-505`). No "not analyzed yet" state exists in the Stats/meters path.

### E6.3 — Stats rail always shows the song's *latest* analysis, not the version being listened to 🟠 Medium
- **Trigger:** listen to any older version of a multi-version song.
- **Branch:** version-being-listened ≠ version-of-latest-analysis — the route feeds `song?.latestResult?.jobId` (`listen-rack.$versionId.tsx:43-44`).
- **Currently:** listening to v2 shows v6's LUFS/BPM/sections/grade with no mismatch handling or labeling.

### E6.4 — The rack's Coach rail is entirely canned: fabricated measurements presented as real analysis 🔴 High
- **Trigger:** type anything into "Ask about your mix…" on a real version.
- **Branch:** J6 lists the Coach rail as live; there is no request branch at all.
- **Currently:** `coachReply()` returns hard-coded strings with fabricated numbers ("You're at −11.2 LUFS integrated…") for every track, plus the fixture "KNOWS THIS TRACK · 14/26 RUN" badge (`rail.tsx:296-346`). No endpoint is called; identical fake data regardless of the track or whether it was analyzed.

### E6.5 — "View Report →" is a dead control 🟠 Medium
- **Trigger:** click the rack header's documented back-link.
- **Currently:** no `onClick`/navigation at all (`ListenRackPage.tsx:117`). Silent no-op.

### E6.6 — Transient draft GET failure is indistinguishable from "no draft" → autosave overwrites the saved draft 🔴 High
- **Trigger:** `GET /rack/draft` fails transiently (500/network) while a saved draft exists.
- **Branch:** draft GET failure vs. legitimate 204 no-draft.
- **Currently:** on error `draftQuery.isFetched` is true with `data` undefined → chain null → `setDraftRestored(true)` → autosave arms (`ListenRackPage.tsx:338-352,356-357`); the next knob-touch PUTs the **default chain over the user's saved draft** 1.2 s later. `draftQuery.isError` is never consulted. (Distinct from the excluded F15 console-warning item.)

### E6.7 — Draft autosave, preset save, viz save, import save: all failures are silent 🟠 Medium
- **Trigger:** any `PUT /rack/draft`, `POST /rack/presets`, `/viz/presets` save fails (dead 401, version deleted, 500).
- **Currently:** `useUpsertRackDraft`/`useSaveRackPreset` have no `onError` (`useRackPresets.ts:97-104,125-130`); call sites add none (`ListenRackPage.tsx:537-543,560-566,592-595` — import toasts only success/parse). The user believes drafts/presets are saving.

### E6.8 — "Start live room" refusal is silent 🔴 High
- **Trigger:** `POST /versions/{id}/sessions` → 403 `room_not_hostable`.
- **Currently:** `startRoom` is `() => startMut.mutate()` with no `onError` (`useRoomOrchestration.ts:177`; `useRoomSession.ts:39-45`); `isStartingRoom` is returned but never consumed; the fetcher has no global error toast. The button appears to do nothing. (The button rendering at all pre-access-resolve is the known MOCK_ACCESS gap from the journeys doc — referenced, not re-derived.)

### E6.9 — Room SSE: 403 `not_joinable`, 409 `session_ended`, and network blips all collapse into a frozen room with no reconnect 🔴 High
- **Trigger:** participant stream refused or dropped.
- **Branch:** 403 vs 409 (`RoomEndpoints.cs:283-284`) vs blip.
- **Currently:** all three collapse to `status 'error'|'closed'` with **no reconnect logic and no Last-Event-ID replay** (`useRoomStream.ts:55-101` — single fetch; `id:` lines explicitly ignored at `:28`). The only rendering is the literal status word in the header: "LIVE ROOM · N listening · error" (`ListenRackPage.tsx:960-962`). No terminal "session has ended" UI; roster/feed freeze; a blip permanently kills the room until manual reload.

### E6.10 — Zombie sessions: no client-side end event; the next visitor joins a dead room 🟠 Medium
- **Trigger:** host closes the tab without `/end`; server finalizes ~3 min later (`RoomEndpoints.cs:25,236`) but no `ended` event type exists client-side.
- **Currently:** the reducer handles presence/reaction/chat/status/grant/transport only; anything else hits `default: return s` (`roomStateReducer.ts:93-134`). Participants see "· closed" indefinitely; the next visitor discovers the still-`live` session from history (`useRoomOrchestration.ts:80-83`) and connects to a dead room.

### E6.11 — Room transport/rack/visuals sync is wholly absent; the revoked-mid-drag 403 family is unreachable-and-unhandled by construction 🔴 High
- **Trigger:** host/controller manipulates transport, rack, or visuals in a live room; or a controller is revoked mid-interaction.
- **Branch:** `POST /sessions/{id}/transport|visuals|rack` (202; 403 `not_host`/`not_visuals_controller`/`not_rack_controller`).
- **Currently:** the three senders are **never called anywhere** (`useRoomActions.ts:43-44` — zero call sites); incoming `visuals`/`rack` deltas are explicitly dropped (`roomStateReducer.ts:129-131`); `state.transport` is folded but never read (page consumes only `feed`/`roster`, `ListenRackPage.tsx:929,961`). The advertised Room sync behavior and its whole error-branch family are unimplemented.

### E6.12 — "End room + publish recap": recap 409 `recap_not_ready` is silent 🟠 Medium
- **Currently:** `endRoom` chains `recapMut.mutate` inside `endMut.onSuccess` with no `onError` on either (`useRoomOrchestration.ts:145-150`; `useRoomSession.ts:47-70`). The room ends; the recap silently never publishes; no retry affordance.

### E6.13 — Room reaction/chat/status POST failures are unhandled promise rejections; the sender still sees their reaction "land" 🟠 Medium
- **Trigger:** 403 `chat_forbidden`, 429, or session just ended.
- **Currently:** `void actions.react(...)` discards the promise (`useRoomOrchestration.ts:157-159`) — rejection with zero UI; the local presence-pop fires anyway (`ListenRackPage.tsx:933-935`), so a refused reaction looks delivered.

### E6.14 — Live rooms' People and Chat panels are pure fixtures: real participants invisible, chat never transmitted 🔴 Critical
- **Trigger:** open the People or Chat rail tabs in a live room.
- **Branch:** live roster/chat should come from the SSE seam.
- **Currently:** `PeoplePanel` lists hard-coded `ROOM_LISTENERS`; real participants never appear; "+ DJ"/"+ Vis" grants target fixture actors (sent with `userId: null` — `rail.tsx:349-418`, `useRoomOrchestration.ts:130-137`); "↗ Invite" has no handler (`rail.tsx:360`). `ChatPanel.send()` appends locally under the hard-coded handle 'maek' and never calls `roomLive.sendChat` (zero call sites); fixture `SEED_CHAT` renders into real rooms (`rail.tsx:421-474`). The core Room loop — see, grant, chat with real participants — silently does not function.

## Journey 7 — Sharing & social

### E7.1 — The entire version-share/invite owner flow has no UI; invite links dead-end 🔴 High
- **Trigger:** owner wants to mint/rotate/revoke a `/v/{token}` link or invite a reviewer.
- **Branch:** `GET/PUT /versions/{id}/share`, `POST .../share/rotate`, invites CRUD + `POST /api/invites/{token}/accept`.
- **Currently:** `useVersionShare.ts:17-44` and all of `useInvites.ts` have **zero consumers**; no route can receive an invite-token URL, so an emailed invite (expired or not) dead-ends. The `/v/{token}` viewer exists, but the owner-side flow the journeys doc describes ("share dialogs mint version links") is unreachable; only the analysis-share `/r/{token}` dialog (`SharePublishDialog.tsx`) is wired.

### E7.2 — Suggestion accept/reject refusals are silent 🟠 Medium
- **Trigger:** `POST /suggestions/{id}/accept|reject` → 403 `not_owner`, or accept's fork-target version deleted → 404.
- **Currently:** no `onError` in `SuggestionCard` mutations (`SuggestionCard.tsx:99,107`) or hooks (`useSuggestions.ts:36-55`). The button un-busies; the card stays "proposed" with no explanation.

### E7.3 — Authed comments rail: post/moderate failures are silent 🟠 Medium
- **Trigger:** `POST /versions/{id}/comments`, `PATCH/DELETE /comments/{id}` → 403 `comment_forbidden` (access changed), 429.
- **Currently:** the rail's `submit` passes only `onSuccess` (`rail.tsx:657-660`); `patchMut`/`delMut` at `rail.tsx:698-701` have no error path; hooks add none (`useComments.ts:21-46`). The typed comment sits in the box with no feedback. (The anon `/v/{token}` composer *does* toast — `v.$token.tsx:108`.)

### E7.4 — Bookmark note edit is DELETE+POST with no rollback: a failed second step destroys the bookmark silently 🟠 Medium
- **Trigger:** edit a bookmark note; the recreate POST fails (network, version deleted).
- **Currently:** `deleteMut.mutate(b.id, { onSuccess: () => createMut.mutate(...) })` with no `onError` on either (`BookmarksRail.tsx:74-83`; `useBookmarks.ts:21-36`) — the DELETE landed, the POST didn't, the bookmark is gone with no error. All other bookmark failures (incl. 403 `bookmark_forbidden`) likewise silent.

### E7.5 — Follow/unfollow failures are silent 🟡 Low
- **Trigger:** `PUT/DELETE /u/{handle}/follow` → 429, or 400 `self_follow` via stale state.
- **Currently:** `useFollow`/`useUnfollow` have `onSuccess` only (`useFollow.ts:25-47`); call sites pass no handler (`u.$handle.tsx:69-70`, `v.$token.tsx:147-148`). The button un-pends still showing "+ Follow".

### E7.6 — Profile 429 renders the 404 copy ("No one lives here") for an existing profile 🟡 Low
- **Trigger:** `GET /api/u/{handle}` → 429 `rate_limited` (IP-rate-limited endpoint).
- **Currently:** no 429 branch — `if (error || !data)` renders "There's no profile at @handle" (`u.$handle.tsx:45-53`; `retry:false` at `:24`).

### E7.7 — Notification "More…" page-replaces instead of appending: page 0 vanishes, no way back 🟡 Low
- **Trigger:** click "More…" in the inbox.
- **Currently:** `useNotifications(page)` is a single-page query and `onMore` swaps `page` (`NotificationCenter.tsx:83,130`) — the exact failure mode the feed explicitly fixed with an infinite query (`useFeed.ts:6-7`).

## Journey 8 — Account, plan & caps

### E8.1 — `/billing` load failure → loading skeleton forever 🟠 Medium
- **Trigger:** `GET /api/billing/me` fails (502 Stripe outage, 500).
- **Currently:** `if (isLoading || !data)` renders "Loading…" with no error branch, no retry (`billing.tsx:49-58`).

### E8.2 — Credits ledger fetch error renders as "0 credits · You haven't bought any credits yet." 🟠 Medium
- **Trigger:** `GET /api/billing/credits` fails on `/usage`.
- **Currently:** `query.isError` never checked; empty pages → `balance: 0` presented as fact to a user who may hold credits (`usage.tsx:39-48,81-84`).

### E8.3 — Entitlements 503: the plan card and nav meter silently disappear 🟡 Low
- **Trigger:** `GET /api/me/entitlements` → 503 `entitlements_unavailable` (the contract's explicit branch).
- **Currently:** `if (!ent) return null;` (`UsageSummary.tsx:40-41`); nav meter unmounts (`_app.tsx:206`). Nothing distinguishes "service down" from "nothing to show".

### E8.4 — Credits buyers land on a subscription-only success page: told "your subscription is still being processed" 🔴 High
- **Trigger:** buy a credit pack via `/usage` (full-page Stripe redirect); return to the shared SuccessUrl while the webhook is delayed (shared URL acknowledged in-code, `billing.success.tsx:35`).
- **Branch:** post-checkout confirmation for a credits (non-subscription) purchase.
- **Currently:** the poll checks only `me.tier === 'pro'` (`billing.success.tsx:56`). A free-tier credits buyer never satisfies it → after 60 s: "Your subscription is still being processed" — wrong product, implied failure — even after the credits land. An already-pro credits buyer gets instant "You're on Pro." with no credit confirmation. No credits branch exists.

### E8.5 — Popup-checkout success predicate is instantly true for non-free users: "upgraded" fires ~5 s in regardless of payment 🟠 Medium
- **Trigger:** popup credits checkout (`useUpgradeCheckout`) by an already-pro/credits user (or free with analyses remaining), webhook delayed.
- **Currently:** the predicate `ent.tier !== 'free' || (ent.analysesRemaining ?? 1) > 0` (`useUpgradeCheckout.ts:54`) passes on the first poll — `onUpgraded` fires whether or not payment completed; the credits balance query is never invalidated in this path (`:56-57` invalidates only entitlements + auth).

### E8.6 — `/profile` Account card is hardcoded "Free plan" for every tier 🟠 Medium
- **Trigger:** a Pro or credits user opens `/profile`.
- **Currently:** the pill and the plan card are literal "Free plan" text with a fixed blurb; no tier is read anywhere in the component (`profile.tsx:143,243-248`). Every non-free tier is an undefined display state.

---

## Per-journey summary

| Journey | Findings | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| 1 — Anon funnel | 5 | — | 2 | 2 | 1 |
| 2 — Auth | 4 | — | 2 | 2 | — |
| 3 — Upload | 9 | — | 2 | 5 | 2 |
| 4 — Library/versions | 3 | — | — | 3 | — |
| 5 — Results | 14 | — | 3 | 6 | 5 |
| 6 — Listen rack + rooms | 14 | 1 | 6 | 7 | — |
| 7 — Sharing & social | 7 | — | 1 | 3 | 3 |
| 8 — Account & billing | 6 | — | 1 | 4 | 1 |
| **Total** | **62** | **1** | **17** | **32** | **12** |

Recurring root shapes (each explains several findings): TanStack Query `refetchInterval` callbacks that read `data?.status` and therefore never terminate on error/404 (E1.1, E3.1, E5.1, E5.6, E5.11); mutations with `onSuccess`-only options so every refusal is silent (E6.7, E6.8, E6.12, E7.2–E7.5); the two error-envelope shapes with clients that each parse only one (E2.4, E3.7); the XHR upload path living outside the fetcher's 401-refresh contract (E3.9, E2.2/E2.3's `/auth/` exclusion is the same family); and worker actors whose failure paths never write a terminal state readable by the UI (E3.1, E5.1, E5.2, E5.3, E5.9).

## The 10 riskiest paths

1. **E6.14 — Live-room People/Chat are fixtures; real chat is never transmitted.** The core Room loop silently doesn't function while looking like it does — fixture participants and seeded chat render into real sessions.
2. **E2.2 — Sign-out after idle silently fails; the session resurrects on the next visit.** A security expectation broken with zero feedback, worst on shared machines.
3. **E2.1 — Two-tab refresh rotation bounces valid sessions to /login.** Session-restore of multiple tabs is an everyday trigger; N−1 tabs appear logged out.
4. **E1.1 — Cookie-blocked (or second-tab-claimed) anon users wedge in a fake "Analyzing" spinner forever.** The funnel's whole audience segment with strict cookie settings silently gets a broken first impression.
5. **E1.4 — Existing-account holders cannot claim an anon report at all.** A conversion-moment dead end: sign in and you see *less* than the anon view; the report purges at 72 h.
6. **E6.6 — A transient draft-GET failure arms autosave over the user's saved rack draft.** Real data loss from an invisible error, 1.2 s after the next knob-touch.
7. **E5.3 — A terminally-failed triage re-enqueues an LLM call on every verdicts view, forever.** Unbounded LLM spend from a single bad analysis row, across sessions.
8. **E8.4 — Credits buyers are told their "subscription is still being processed."** Wrong product on the money-confirmation page; implies a failed purchase that actually succeeded.
9. **E3.1 — Stems-review classification failure = infinite "Classifying…", confirm disabled, version never analyzed.** No failure representation exists on either side of the wire.
10. **E5.2 — Failed specialists render as "cached" and can never be re-run.** Failure displayed as success, with the recovery path (dismiss) removed from the UI.

Near-misses for the list: E3.2 (name-collision 500 after a 250 MB upload), E6.1 (404 → demo fixture presented as real), E6.9 (one network blip permanently kills a room), E6.2/E6.4 (zeros and canned coach text presented as measurements).
