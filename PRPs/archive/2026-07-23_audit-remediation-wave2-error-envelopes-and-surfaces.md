# PRP — Audit Remediation Wave 2: Error-Envelope Unification + Missing Surfaces

**Source:** wave-2 scope carved out of the 2026-07 audit pair; wave 1 (auth/session + poll
terminals) shipped — see `PRPs/archive/2026-07-23_audit-remediation-wave1-auth-and-poll-terminals.md`.
**Closes:** E2.4 · E3.7 (envelope unification) · E3.2 (duplicate-song-name 500 — live-verified
2026-07-23) · NEW: degradation-notice has no UI surface · NEW: abandoned staged-stems leak
(the CLAUDE.md "Bulk stem upload" known follow-up).
**Finding evidence:** `docs/edge-case-report.md` (E-numbers, file:line per finding). Read E2.4,
E3.2, E3.7 and the "Recurring root shapes" paragraph (line 337) before starting.

**Out of scope (do NOT fix opportunistically):** silent-mutation toasts (E6.x/E7.x/E8.x — wave 3),
findings/severity unification (F1/F2), room findings (E6.8–E6.14 — listening-room roadmap),
full conversion of every legacy BFF error site to the envelope (bounded inventory below — a
mechanical follow-on once the client parses all shapes), E3.3 dialog-close abort semantics
(the stems sweep here covers the *storage* consequence only), E1.4 sign-in claim path.

---

## Goal

One PR-sized change set across `frontend-spectr-v2` + `bff` + `worker`:

1. **One error parser, every shape** — a single frontend parser understands all three server
   error shapes (AR38 envelope `{error:{code,message,details}}`, legacy `{error:"text"}`,
   RFC7807 ValidationProblem `{title,errors:{...}}`), so every surface shows the server's
   wording when one exists — no more raw "HTTP 409" / "HTTP 400" / "[object Object]".
2. **Typed envelopes where a machine code matters** — register 409 (`email_taken`), login 401
   (`invalid_credentials`), duplicate-song 409 (`song_name_conflict`).
3. **Duplicate-song-name 500 fixed** — uploading `mix.wav` twice with "New song" auto-suffixes
   the derived name (`mix`, `mix (2)`, …); the residual race lands as a typed 409, never a 500
   after a 250 MB transfer.
4. **Degradation notice becomes visible** — a report whose verdicts response carries
   `degradation` renders a "rule-based findings only" banner with per-reason copy.
5. **Abandoned staged stems get swept** — a new nightly `run_sweep` phase deletes orphaned
   `audio/stems/{versionId}/` + `stems/{jobId}/` staging objects and clears
   `song_versions.stem_paths_raw` on versions abandoned before confirm.

## Why

- E2.4/E3.7 are one of the five recurring root shapes the audit called out: "the two
  error-envelope shapes with clients that each parse only one" — one parser closes a whole
  finding family and future-proofs every `err.message` toast in the app (60+ render sites).
- E3.2 is a 🔴-High near-miss on the audit's riskiest-paths list: a full upload ends in an
  unhandled 500 on the second-most-natural user action (re-uploading the same file).
- The degradation notice is *written* by the worker (wave 1 added `triage_failed`) and *read*
  by a poll-stop — but no human ever sees why their coach went quiet. FR16/UX-DR17 intended a
  banner; the DTO comment (`VerdictDtos.cs:70`) even promises one.
- Paid users' abandoned stems staging leaks **forever** (retention only purges versions in the
  free/lapsed windows); this is the CLAUDE.md declared follow-up.

## What (user-visible behavior)

- Registering a taken email shows "Email already registered." (and the body carries
  `code: "email_taken"`); wrong password on login shows "Wrong email or password."
- Every upload/staging failure toast shows the server's message ("File exceeds 250 MB limit.",
  "'kick.wav': only .wav / .flac stems are supported.", …) instead of "Upload failed (400)";
  an envelope body through the XHR path never renders "[object Object]".
- Password-too-short on register shows "At least 8 characters required." instead of "HTTP 400".
- Uploading the same file twice as a new song silently creates "mix (2)" — no 500, no lost
  transfer. If the rare race 409 fires, the toast explains and suggests picking the existing song.
- A degraded report shows a banner above the tabs: e.g. "AI specialists are unavailable —
  showing rule-based findings only." with reason-specific copy.
- (Invisible but real) staged-stems garbage older than 24 h is deleted nightly.

### Success Criteria

- [ ] All 5 goals demonstrably done via the manual verifications in Final Validation
- [ ] ONE exported parser (`parseErrorBody`/`parseErrorText`) — zero remaining local
      `safeParseError` copies; `extractApiError`/`extractApiMessage` delegate to it
- [ ] No behavior change for any existing `code`-keyed branch (`entitlement_exhausted`,
      `email_verification_required`, `coach_cap_reached`, `retry_already_used`, …)
- [ ] All validation gates green (frontend ×4, `dotnet build && dotnet test`, worker pytest —
      modulo the 5 known pre-existing worker failures listed in gotchas)

---

## All Needed Context

### Documentation & references

```yaml
- file: docs/edge-case-report.md
  why: E2.4 (register 409 legacy shape → "HTTP 409"), E3.2 (dup-name 500 — both dispatch
       sites named), E3.7 (both parse directions broken); line 337 root-shape rationale
- file: docs/api-contracts-bff.md
  why: lines 13-16 — the AR38 convention AND the documented "Some older validation branches
       still return plain {error:'text'} 400s" caveat this wave narrows
- file: PRPs/archive/2026-07-23_audit-remediation-wave1-auth-and-poll-terminals.md
  why: structural template; its Task 6 built the XHR 401-retry this wave's parser change
       must NOT disturb; its gotchas carry forward
- file: CLAUDE.md
  why: v2 stack rules, validation gates, "Bulk stem upload" follow-ups list (staged-stems
       cleanup — update that line when done), worker actor rules (sync def, maintenance queue)

# ── frontend: the parsers and their call sites ──
- file: components/frontend-spectr-v2/src/api/error-utils.ts
  why: THE canonical parser to extend. extractApiError (15-21) and extractApiMessage (7-13)
       read ONLY body.error.message on an OBJECT error — legacy string shape falls through {}
- file: components/frontend-spectr-v2/src/api/fetcher.ts
  why: line 200 — ApiError message = extractApiError(body).message, "HTTP {status}" fallback
       (line 12). Extending the parser automatically fixes EVERY err.message render.
       Lines 188-197: traceId stash reads the envelope's details.traceId — leave intact.
- file: components/frontend-spectr-v2/src/hooks/useFileUpload.ts
  why: local safeParseError (107-114) returns `o.error ?? o.title` — when o.error is the
       envelope OBJECT it flows into the toast as "[object Object]" (E3.7b). Call site: 78.
- file: components/frontend-spectr-v2/src/hooks/useStemStaging.ts
  why: identical safeParseError copy (86-93), call site 59
- file: components/frontend-spectr-v2/src/features/anon-analyze/useAnonAnalysis.ts
  why: inline envelope-only parse at 58-62 (upload XHR) — delegate to the shared parser
- file: components/frontend-spectr-v2/src/features/results/coach-stream-frames.ts
  why: extractErrorCode (88-97) / extractErrorMessage (101-110) — envelope-only; delegate
       extractErrorMessage's body to the shared parser, KEEP extractErrorCode strict
       (its test asserts `{error:'string'}` → null code — coach codes must stay envelope-only)
- file: components/frontend-spectr-v2/src/routes/pricing.tsx
  why: inline envelope parse 74-83 (unauthenticated fetch, not fetcher) — optional delegate
- file: components/frontend-spectr-v2/src/components/__tests__/upload-dialog-entitlement.test.tsx
  why: existing extractApiError test file — extend with the new shapes there or in a new
       src/api/__tests__/error-utils.test.ts (fetcher-error-message.test.ts is the sibling)
- file: components/frontend-spectr-v2/src/components/UnifiedUploadDialog.tsx
  why: runUpload catch 601-630 (code-keyed branches: entitlement 604, verify-gate 614 —
       insertion point for song_name_conflict copy); createSong.mutateAsync at 410 (typed
       new-song name → POST /songs 409); handleConfirm catch 649-652

# ── frontend: degradation surface ──
- file: components/frontend-spectr-v2/src/api/types.ts
  why: DegradationReason (1351-1357, already includes 'triage_failed'), DegradationNoticeDto
       (1359-1364, camelCase wire), VerdictsListResponse.degradation (1375)
- file: components/frontend-spectr-v2/src/api/hooks.ts
  why: useVerdicts 576-599 — line 593 is the ONLY current consumer of `degradation`
       (poll stop). Nothing renders it.
- file: components/frontend-spectr-v2/src/features/results/ReportView.tsx
  why: verdictsData already in scope (line 89); DegradationBanner rendered at 296-305 —
       insert the new notice component directly after it, before ResultsTabs (307)
- file: components/frontend-spectr-v2/src/features/results/DegradationBanner.tsx
  why: the PHASE-failure banner (failedPhases-driven, free-retry affordance) — anatomy/test
       pattern to mirror, NOT to extend (decision + rationale in Discovered facts #6)
- file: components/frontend-spectr-v2/src/features/results/__tests__/DegradationBanner.test.tsx
  why: render-test pattern for the new component's tests

# ── bff ──
- file: components/bff/src/Spectr.Bff/Endpoints/ErrorEnvelope.cs
  why: the Build(status, code, message, details) helper every conversion uses
- file: components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs
  why: register 409 legacy shape (175); register password ValidationProblem (166-171);
       login empty-body 401 (315-318); login 400 legacy (305); banned 403 is ALREADY
       envelope (322) — the in-file precedent
- file: components/bff/src/Spectr.Bff/Endpoints/SongEndpoints.cs
  why: Create catch → legacy 409 (109-116); Rename same (212-214); IsUniqueViolation
       helper (499-500: Npgsql PostgresException SqlState 23505) — the pattern to share
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs
  why: UploadVersion SaveChangesAsync with NO unique-violation catch (327) — E3.2 site 1;
       ResolveOrCreateSongAsync auto-name branch (1006-1018) — where auto-suffix goes;
       StageStems key layout audio/stems/{versionId}/{stemId}{ext} (751-754) + UpdatedAt
       stamp (758); StageStemKeys presigned layout stems/{jobId}/ (791) + stamp (832);
       ConfirmStems writes StemPaths + re-serializes raw (964-968); GetStems reads raw (921)
- file: components/bff/src/Spectr.Bff/Endpoints/UploadEndpoints.cs
  why: Complete → ResolveOrCreateSongAsync (203-205) + SaveChangesAsync with no catch
       (209) — E3.2 site 2
- file: components/bff/src/Spectr.Bff/Program.cs
  why: 484-509 — unhandled-exception handler already emits the envelope (internal_error +
       details.traceId); nothing to change, but it is the 500 shape the parser must keep
- file: components/bff/src/Spectr.Data/AppDbContext.cs
  why: 121-123 — uq_songs_user_name UNIQUE (user_id, name), UNFILTERED (soft-deleted songs
       still hold their names — the suffix probe must consider them)
- file: components/bff/tests/Spectr.Bff.Tests/UploadDeferralTests.cs
  why: WebApplicationFactory + RecordingJobQueue harness for /versions/ + /uploads/complete
       integration tests — mirror for the dup-name tests
- file: components/bff/tests/Spectr.Bff.Tests/AuthEndpointsTests.cs
  why: register/login test patterns; NO existing test asserts the legacy 409 shape (verified
       by grep this session) — conversion is assertion-safe

# ── worker ──
- file: components/worker/app/retention_actor.py
  why: run_sweep phase structure (373-460); _purge_unclaimed_anonymous (179-304) is the
       lock-rows-then-delete-objects-after-commit pattern to copy; _version_keys (97-122)
       ALREADY includes stem_paths_raw keys (both entry-dict and legacy-string shapes) —
       reuse its raw-parsing approach; sweep_retention actor decl (463-472): maintenance
       queue, max_retries=0, 30-min time limit
- file: components/worker/tests/test_retention_sweep.py
  why: sqlite-in-memory + monkeypatched SessionFactory/LOCAL_ROOT fixture (32-46) and
       seed helper (49-85) — extend this file for the new phase's tests
- file: components/worker/.env.example
  why: retention env-var documentation block (line ~25) — add the new staging window var
```

### Discovered facts that CHANGE the intake's assumptions (trust these)

1. **The XHR hooks already ride the 401-refresh contract** (wave 1 Task 6 landed:
   `getFreshAccessToken` preflight + one 401 retry in both `useFileUpload.ts` and
   `useStemStaging.ts`). Wave 2's only XHR change is swapping their `safeParseError` for the
   shared parser — do not touch the retry scaffolding.
2. **There is a THIRD shape neither finding lists: RFC7807 ValidationProblem.**
   `Results.ValidationProblem` at `SongEndpoints.cs:89-91` (empty song name) and
   `AuthEndpoints.cs:166-171` (password < 8 / > 256) returns
   `{title:"One or more validation errors occurred.", errors:{field:["msg"]}}`.
   `extractApiError` returns `{}` → register-with-short-password renders "HTTP 400" today.
   The parser must flatten `errors` (first message) before falling back to `detail`/`title`.
3. **Full server-side conversion is NOT one PR.** Verified counts: ~120 legacy
   `{error:"text"}` sites across 18 endpoint files (VersionEndpoints ~34, UploadEndpoints 13,
   ReferenceEndpoints 14, RoomEndpoints 11, RackPresetEndpoints 6, FeedbackEndpoints 6,
   VersionShareEndpoints 6, SongEndpoints 4, CompareEndpoints 3, AuthEndpoints 3,
   VerdictEndpoints 3, plus Bookmark/FixRack/ReportPhase/Share/EmailWebhook/Job/
   Infrastructure-NotImplemented) vs 140 envelope sites in 20 files. Wave 2 scope =
   client-first parsing + FIVE targeted server conversions where a machine code matters
   (register 409, login 401, SongEndpoints ×2 409, the two new E3.2 catches). The rest render
   correctly through the new parser and convert in a mechanical follow-on.
4. **E3.2 confirmed at both sites**, plus a subtlety: `uq_songs_user_name` is UNFILTERED
   (`AppDbContext.cs:122`), so a soft-deleted song still owns its name — the auto-suffix
   probe must scan ALL of the user's songs, not just live ones (EF query without any
   deleted filter does this naturally, but do NOT add a `DeletedAt == null` filter).
   Also: when no `song_id` is sent, the song name is ALWAYS filename-derived — the dialog
   only pre-creates a song via `POST /songs` when the user TYPED a name
   (`UnifiedUploadDialog.tsx:408-418`), and that path already 409s (legacy shape, becomes
   typed here). So auto-suffix is safe: it only ever renames a name the user never chose.
5. **`degradation` is parsed, transported, typed — and rendered nowhere.** Only consumer is
   the `useVerdicts` poll-stop (`hooks.ts:593`). BFF side is complete
   (`VerdictEndpoints.cs:121`, `VerdictDtos.cs:72-85`, snake_case→camelCase handled); the
   worker writes all four reasons (`triage_actor.py:132,142,153`, `verdict_actor.py:245`,
   `identifiers.py:200`). This is purely a frontend rendering task.
6. **Extend-vs-sibling decision: SIBLING.** `DegradationBanner` is phase-failure semantics
   (derives from `final_json.phases[]`, offers the entitlement-free retry — retry would be
   WRONG for budget/breaker reasons, and its data source is `fj`, not the verdicts query).
   Create `LlmDegradationNotice` next to it; both may render simultaneously (phase failure
   AND budget exhaustion are independent).
7. **The retention sweep already deletes `stem_paths_raw` keys** (`_version_keys`,
   `retention_actor.py:114-118`) — but only when the VERSION ages into the free/lapsed
   windows. Protected (paid/credit) users' abandoned staging leaks forever. The new phase
   closes that hole and also clears the dead `stem_paths_raw` JSON so `GET .../stems` stops
   reporting phantom staged rows.
8. **`VerdictEndpoints.cs:186`** emits a hybrid `{error:"text", status:"exists"}` — the
   parser's legacy-string branch handles it; no server change needed (the frontend keys on
   the 409 status there, not the body).
9. **Login's 401 has an EMPTY body** (`Results.Unauthorized()`, `AuthEndpoints.cs:315-318`)
   — no parser can help; converting it to an envelope (`invalid_credentials`) is the fix, and
   `login.tsx:41`/`:56` then show the server copy with zero frontend change.

### Known gotchas

```
# CRITICAL — do not break existing code-keyed branches: extractApiError must still return
#   { code, message } for envelope bodies EXACTLY as before (entitlement_exhausted at
#   UnifiedUploadDialog:604 + ReportView:234, email_verification_required in verify-email.ts,
#   coach_cap_reached in CoachChat, retry codes in DegradationBanner + results route,
#   stripe_not_configured in pricing.tsx). Legacy/problem shapes must yield code: undefined.
# CRITICAL — coach-stream-frames extractErrorCode must STAY envelope-only: its test
#   (CoachChat.parseFrame.test.ts:78) asserts {error:'string'} → null. Only the MESSAGE
#   extraction may go through the shared parser.
# CRITICAL — fetcher.ts traceId stash (188-197) reads error.details.traceId straight off the
#   body — keep it independent of the parser refactor.
# CRITICAL — XHR paths do not ride fetcher (wave-1 lesson). The XHR hooks throw plain
#   Error(msg), NOT ApiError — so any code-keyed handling for XHR failures cannot use
#   extractApiError(err.body). The song_name_conflict copy branch in UnifiedUploadDialog
#   therefore keys on the createSong (fetcher) path via ApiError, and on the XHR path the
#   server MESSAGE simply flows through the toast. Do not try to attach codes to XHR errors
#   in this wave (that is a bigger refactor — note it, skip it).
# TanStack structural sharing (burned wave 1): an unchanged-data poll tick does NOT
#   re-render. The degradation banner reads query DATA (a real field flip null→object),
#   which re-renders fine — but do NOT derive any banner state from query internals/counts.
# dotnet build fails if the BFF exe is running (Windows file lock on
#   bin/Debug/net10.0/Spectr.Bff.exe) — Stop-Process the running BFF first.
# Worker suite has 5 known pre-existing failures unrelated to this work:
#   test_coach_stream_gateway ×3, test_budget_flag_override, test_local_root. Green =
#   everything else passes and the new tests pass.
# ValidationProblem's `errors` values are string[] keyed by field — flatten to the FIRST
#   message of the FIRST key (stable order not guaranteed; any message beats "HTTP 400").
# EF: ResolveOrCreateSongAsync only STAGES the Song (caller SaveChanges) — the unique
#   violation surfaces at the CALLER's SaveChangesAsync (VersionEndpoints:327 /
#   UploadEndpoints:209), so the catch goes there, not inside the helper.
# The proxy upload writes the audio object BEFORE the version SaveChanges
#   (VersionEndpoints:315-322); on the race-409 the object is orphaned with NO DB row —
#   best-effort storage delete inside the catch (IFileStorage has a delete; see the
#   version-delete path ~:376-381 for the call shape), never let cleanup mask the 409.
#   /uploads/complete: do NOT delete the object there (parts are the user's only copy and
#   a retry mints a new key; retention's zero-row orphans are acceptable, matches 12.3 note).
# sqlite test mirror (worker): raw-SQL JSONB comes back as TEXT, timestamps as str —
#   use the existing _as_json/_as_dt helpers; the fixture creates missing BFF-owned tables
#   by hand (test_retention_sweep.py:36-40 precedent if analysis_jobs needs seeding —
#   aimusic_shared.models has AnalysisJob, so Base.metadata covers it).
# Dramatiq actors are sync def; worker DB access via db_sync SessionFactory only.
# Trust pages (trust.results-forever.tsx / trust.privacy.tsx) publish retention numbers —
#   the staged-stems window is internal hygiene of UNCONFIRMED uploads, not published
#   retention; no trust-page change needed (keep the sweep comment saying so).
# TS strict + verbatimModuleSyntax: `import type` for type-only imports; CSS Modules only.
# vitest: tests live next to sources / __tests__; jsdom; follow existing files' shape.
```

---

## Implementation Blueprint

Order: parser first (everything else's messages ride it), then BFF typed codes, then E3.2,
then the two independent surfaces (banner, sweep). Tasks 1–2 frontend parser; 3–5 BFF + copy;
6 banner; 7 sweep; 8 docs.

```yaml
Task 1 — frontend: one parser for all three shapes:
  MODIFY src/api/error-utils.ts:
    - ADD the canonical implementation:
        export interface ParsedApiError { code?: string; message?: string }
        export function parseErrorBody(body: unknown): ParsedApiError
          # 1. envelope: body.error is object → { code: error.code (string|undef),
          #              message: error.message (string|undef) }
          # 2. legacy:   body.error is string → { message: body.error }
          # 3. problem:  body.title is string → message = first string of the first
          #              body.errors[field] array ?? body.detail ?? body.title
          # 4. else → {}
        export function parseErrorText(text: string): ParsedApiError
          # JSON.parse try/catch → parseErrorBody; catch → {}
    - REWRITE extractApiError(body) = parseErrorBody(body)  (keep the export name —
      17 call sites import it) and extractApiMessage(body) = parseErrorBody(body).message.
    - KEEP the file's doc comment honest: it now parses all three shapes.
  CREATE src/api/__tests__/error-utils.test.ts (mirror fetcher-error-message.test.ts style):
    - envelope with code+message → both; envelope without code → message only
    - legacy {error:"A song with that name already exists."} → message, code undefined
    - hybrid {error:"text", status:"exists"} → message
    - ValidationProblem {title, errors:{password:["At least 8 characters required."]}}
      → message "At least 8 characters required."; {title only} → title
    - non-object / null / undefined / {msg:'nope'} → {}
    - parseErrorText: valid JSON envelope; plain-text body → {}; empty string → {}
  VERIFY: existing tests upload-dialog-entitlement.test.tsx and
    fetcher-error-message.test.ts still pass UNCHANGED (they pin envelope behavior).

Task 2 — frontend: retire every local parser copy:
  MODIFY src/hooks/useFileUpload.ts:
    - DELETE local safeParseError (107-114); line 78 becomes
      parseErrorText(xhr.responseText).message ?? `Upload failed (${xhr.status})`
      (import { parseErrorText } from '../api/error-utils').
  MODIFY src/hooks/useStemStaging.ts: same change (delete 86-93, rewrite line 59).
  MODIFY src/features/anon-analyze/useAnonAnalysis.ts (58-62):
    - REPLACE the inline try/JSON.parse with
      message = parseErrorText(xhr.responseText).message ?? 'Upload failed. Try again.'
  MODIFY src/features/results/coach-stream-frames.ts:
    - extractErrorMessage body → return parseErrorBody(body).message ?? null
      (envelope-only today; coach endpoints are envelope-always, this is future-proofing).
    - extractErrorCode: DO NOT TOUCH (test pins strictness).
  OPTIONAL (skip if diff budget tight): pricing.tsx 74-83 → parseErrorBody(body); behavior
    identical for its envelope bodies.
  TESTS: extend src/hooks/__tests__/useFileUpload.retry.test.ts (mock XHR precedent exists)
    with one case: 400 + envelope body → error state carries error.message (NOT
    "[object Object]"); one case: 400 + legacy body → the legacy text.

Task 3 — bff: typed envelopes for the three code-worthy auth/song sites:
  MODIFY Endpoints/AuthEndpoints.cs:
    - 175: Results.Conflict(new { error = ... }) →
      ErrorEnvelope.Build(409, "email_taken", "Email already registered.")
    - 315-318 (both `return Results.Unauthorized();` — bad credentials AND inactive):
      → ErrorEnvelope.Build(401, "invalid_credentials", "Wrong email or password.")
      (inactive intentionally indistinguishable — no oracle).
    - 305: → ErrorEnvelope.Build(400, "invalid_request", "Email and password required.")
    - LEAVE the register ValidationProblem branches (166-171) — parser now renders them.
  MODIFY Endpoints/SongEndpoints.cs:
    - 115 and 214: → ErrorEnvelope.Build(409, "song_name_conflict",
      "A song with that name already exists.")
  TESTS (extend AuthEndpointsTests.cs + SongMetadataEndpointsTests.cs patterns):
    - register duplicate email → 409 AND body.error.code == "email_taken"
    - login wrong password → 401 AND body.error.code == "invalid_credentials"
    - song create duplicate name → 409 AND body.error.code == "song_name_conflict"
  NOTE: verified this session — no existing BFF test asserts the old shapes.

Task 4 — bff: E3.2 — auto-suffix + defensive typed catch:
  CREATE Endpoints/DbViolations.cs:
    - internal static class DbViolations { internal static bool IsUniqueViolation(
        DbUpdateException ex) => ex.InnerException is Npgsql.PostgresException pg
        && pg.SqlState == "23505"; }
      (copy of SongEndpoints.cs:499-500; leave the two existing private copies alone).
  MODIFY Endpoints/VersionEndpoints.cs ResolveOrCreateSongAsync (auto-create branch 1006-1018):
    - AFTER computing `stem` (truncated to 200): probe the user's existing names —
        var taken = await db.Songs.Where(s => s.UserId == userId && s.Name.StartsWith(stem))
                       .Select(s => s.Name).ToListAsync(ct);   // NO DeletedAt filter (fact 4)
        var name = stem; for (var n = 2; taken.Contains(name); n++)
          { var suffix = $" ({n})"; var maxBase = 200 - suffix.Length;
            name = (stem.Length > maxBase ? stem[..maxBase] : stem) + suffix; }
      Use `name` for the new Song. (Case-sensitive Contains matches the index's exact-match
      semantics — "Mix" vs "mix" are distinct rows, correctly.)
  MODIFY Endpoints/VersionEndpoints.cs UploadVersion:
    - WRAP the SaveChangesAsync at 327 (and ONLY that one) in
      try { ... } catch (DbUpdateException ex) when (DbViolations.IsUniqueViolation(ex)) {
        best-effort: try { await storage delete of `key` } catch {}   # orphan cleanup
        return ErrorEnvelope.Build(409, "song_name_conflict",
          "A song with that name already exists. Pick it from the song list or rename."); }
  MODIFY Endpoints/UploadEndpoints.cs Complete:
    - Same catch around SaveChangesAsync at 209 — same envelope, NO object delete (gotcha).
  TESTS (mirror UploadDeferralTests harness — WebApplicationFactory + RecordingJobQueue,
  Postgres-gated like its siblings):
    - upload mix.wav twice with no song_id → 200 twice; second song named "mix (2)";
      third upload → "mix (3)".
    - name-cap: 200-char filename stem twice → second name still ≤200 chars, suffixed.
    - forced collision (create song "clash" explicitly, then upload clash.wav... auto-suffix
      dodges it → assert "clash (2)", NOT 409 — the 409 path is race-only and is covered by
      the unit shape of the catch, not an integration race test).

Task 5 — frontend: duplicate-name copy:
  MODIFY src/components/UnifiedUploadDialog.tsx runUpload catch (after the verify-gate
  branch at 614-620):
    - if (err instanceof ApiError && extractApiError(err.body).code === 'song_name_conflict') {
        setPhase('form'); setStatus(''); setBusy(false);
        toast.error('A song with that name already exists — pick it from the song list or type a different name.');
        return; }
      (Reachable via the typed-name createSong path (fetcher → ApiError) and the presigned
      /uploads/complete path; the legacy XHR proxy path surfaces the server message text —
      see the XHR gotcha.)
  NO change needed in register.tsx / login.tsx / InlineRegisterCard — they render
  err.message (register.tsx:59, login.tsx:41, AnalyzePage.tsx:358), which now carries the
  server copy via the parser + Task 3.

Task 6 — frontend: degradation notice banner:
  CREATE src/features/results/LlmDegradationNotice.tsx (+ LlmDegradationNotice.module.css,
  mirror DegradationBanner.module.css anatomy — dot + message, role="status",
  data-testid="llm-degradation-notice"):
    - props: { notice: DegradationNoticeDto }
    - copy map (exhaustive switch over DegradationReason + default):
        tier_budget:    "Your plan's AI specialist budget is used up for this month —
                         showing rule-based findings only. Upgrading restores AI verdicts."
        global_budget:  "AI analysis is over capacity right now — showing rule-based
                         findings only. AI verdicts return automatically."
        circuit_breaker:"The AI provider is having trouble — showing rule-based findings
                         only. AI verdicts return automatically once it recovers."
        triage_failed:  "Specialist routing failed for this analysis — showing rule-based
                         findings only."
        default:        "AI specialists are unavailable — showing rule-based findings only."
      No retry affordance (deliberate — see Discovered fact 6). Do not render notice.detail
      (operator string, not user copy).
  MODIFY src/features/results/ReportView.tsx:
    - CHANGE line 89 destructure to also use the response:
      `const { data: verdictsData } = useVerdicts(...)` is already there — just render
      `{verdictsData?.degradation && <LlmDegradationNotice notice={verdictsData.degradation} />}`
      immediately after the DegradationBanner block (after line 305, before ResultsTabs).
  CREATE src/features/results/__tests__/LlmDegradationNotice.test.tsx
  (mirror DegradationBanner.test.tsx):
    - one render per reason asserting its distinguishing copy substring
    - unknown reason string (cast) → default copy, no crash
    - role="status" present (a11y — keep the axe suite pattern in report-axe.test.tsx in
      mind; add the component there if trivial).

Task 7 — worker: abandoned staged-stems sweep (maintenance):
  DECISION (intake asked to pick one): worker sweep, NOT BFF-side dialog-cancel cleanup —
  E3.3 documents that dialog close paths don't reliably fire handlers, and browser-close/
  crash/network-death never would. The sweep rides the existing nightly sweep_retention
  dispatch — no new actor, no new enqueue site, no schema change.
  MODIFY components/worker/app/retention_actor.py:
    - ADD def _staging_hours() -> int: return int(os.environ.get(
        "RETENTION_STAGED_STEMS_HOURS", "24"))
    - ADD def _purge_abandoned_stem_staging(now: datetime) -> int:
        # Own try/except wrapper (log warning, return count) — never poisons the sweep.
        # Batches of 500, mirror _purge_unclaimed_anonymous's shape (199-283):
        cutoff = now - timedelta(hours=_staging_hours())
        with SessionFactory.begin() as s:
            select id, stem_paths_raw FROM song_versions
            WHERE stem_paths_raw IS NOT NULL AND stem_paths IS NULL
              AND updated_at < :cutoff
              AND NOT EXISTS (SELECT 1 FROM analysis_jobs j WHERE j.version_id =
                  song_versions.id AND j.status IN
                  ('pending','processing','awaiting_stem_mapping'))
            LIMIT 500  (+ FOR UPDATE SKIP LOCKED on postgresql — same dialect guard
                        as line 214)
            # inside the tx: parse keys from stem_paths_raw. VERIFIED wire shape: the BFF
            # persists snake_case entries with the storage key under "path"
            # (StemRawEntry, VersionEndpoints.cs:678-687 — [JsonPropertyName("path")]).
            # Read e.get("path") for dict entries + tolerate legacy plain-string
            # entries — exactly what _version_keys (114-118) already does; collect;
            UPDATE song_versions SET stem_paths_raw = NULL WHERE id = :vid
              AND stem_paths IS NULL   # re-check guards a mid-sweep confirm race
        # AFTER commit: object_store.delete_object(key, LOCAL_ROOT) per key, fail-soft
        # with logger.warning per failed key (anon-purge policy: row already cleared,
        # a leaked object is an operator log line).
        # Comment: NOT a published trust-page number — internal hygiene of unconfirmed
        # staging uploads (see the trust-page gotcha at lines 57-61).
    - WIRE into run_sweep: stats["staged_stems_purged"] = _purge_abandoned_stem_staging(now)
      next to the anon call (451-453); add to the final log line.
  Fixture JSON for tests must use the verified wire shape, e.g.
  `[{"id":"abc","original_filename":"kick.wav","path":"audio/stems/<vid>/abc.wav",
  "detected_role":null,"confidence":0,"evidence":null,"confirmed_role":null}]`.
  MODIFY components/worker/.env.example: document RETENTION_STAGED_STEMS_HOURS=24.
  TESTS (extend tests/test_retention_sweep.py — fixture 32-46 already gives sqlite +
  tmp_path LOCAL_ROOT; AnalysisJob is in aimusic_shared Base):
    - abandoned (raw set, stem_paths NULL, updated_at 25h ago, no job) → files deleted,
      stem_paths_raw NULL, stat counted
    - confirmed (stem_paths non-NULL) → untouched
    - fresh (updated_at 1h ago) → untouched
    - active job (pending analysis_jobs row for the version) → untouched
    - legacy plain-string raw list → tolerated, deleted
    - delete failure (chmod/monkeypatch object_store.delete_object to raise) → row still
      cleared, warning logged, sweep continues (assert no raise)

Task 8 — docs housekeeping (same PR):
  MODIFY docs/api-contracts-bff.md conventions (lines 13-16): note the new codes
  (email_taken, invalid_credentials, song_name_conflict) and that the v2 client now parses
  envelope + legacy + problem shapes (legacy branches still exist server-side — see the
  remaining-inventory note).
  MODIFY CLAUDE.md "Bulk stem upload" follow-ups line: staging-dir cleanup is DONE (sweep);
  remaining follow-ups (endpoint integration tests, legacy /stems AsNoTracking bug) stay.
```

### Integration points

```yaml
DATABASE: none — no EF migration, no Alembic. (Auto-suffix + catches are query-level;
  the sweep uses existing columns.)
CONFIG: RETENTION_STAGED_STEMS_HOURS (worker env, default 24) — .env.example only.
FRONTEND: two new files (LlmDegradationNotice.tsx/.module.css) + one test file + parser
  test file. No new routes, no new deps.
BFF: one new file (Endpoints/DbViolations.cs). No new packages.
```

---

## Validation Loop

### Level 1 — build/lint/type

```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build
cd components/bff && dotnet build        # stop any running BFF first (file lock)
ruff check components/worker/
```

### Level 2 — unit tests

```bash
cd components/frontend-spectr-v2 && npx vitest run   # incl. error-utils, XHR-parse, LlmDegradationNotice
cd components/bff && dotnet test                     # incl. email_taken / invalid_credentials /
                                                     # song_name_conflict / auto-suffix tests
pytest -q components/worker/tests/                   # incl. staged-stems sweep tests
                                                     # (5 known pre-existing failures excluded:
                                                     # test_coach_stream_gateway ×3,
                                                     # test_budget_flag_override, test_local_root)
```

### Level 3 — integration

```bash
./scripts/start-spectr.ps1     # per docs/STARTUP.md — verify section 5 before testing
```

Manual verification (each maps to a finding):

1. **E2.4** — register with an existing email: form shows "Email already registered."
   (network tab: 409 body `{error:{code:"email_taken",…}}`). Wrong password on login:
   "Wrong email or password." Register with a 4-char password: "At least 8 characters
   required." (still the ValidationProblem shape — parsed).
2. **E3.7a (legacy→fetcher)** — from the song page, add a tag twice: toast shows
   "Tag already exists." not "HTTP 409". (Any legacy-shape endpoint works as the probe.)
3. **E3.7b (envelope→XHR)** — stop Postgres (or otherwise force a 500) and upload a mix via
   the proxy path: toast shows the internal_error envelope's message, never
   "[object Object]"; restore and upload a .txt renamed .wav stems file: the per-file
   server message renders.
4. **E3.2** — upload `mix.wav` with "➕ New song…" and no typed name, twice: second upload
   succeeds and the library shows "mix" and "mix (2)"; NO 500 in the BFF log. Type an
   explicit duplicate name in the dialog: toast suggests picking the existing song.
5. **Degradation banner** — force a triage failure (bogus model name in worker dev config,
   the wave-1 E5.3 repro): open the report → banner "Specialist routing failed…" renders
   above the tabs; verdicts area still lists rule-engine findings; poll stays stopped.
6. **Stems sweep** — stage stems in the unified dialog with review ON, close the dialog at
   the review step; set `RETENTION_STAGED_STEMS_HOURS=0`, run
   `python -c "from app.retention_actor import run_sweep; print(run_sweep())"` from
   components/worker: `staged_stems_purged >= 1`, the `data/audio/stems/{versionId}/` files
   are gone, `song_versions.stem_paths_raw` is NULL, and `GET /api/versions/{id}/stems`
   returns zero stems. Re-run → 0 (idempotent).

---

## Error handling patterns

- **Parser is total**: never throws, never returns a non-string message; all fallbacks stay
  at the call sites (`?? 'Upload failed (…)'` etc.) so copy ownership doesn't move.
- **Server conversions change shape, not status**: every converted site keeps its HTTP status.
- **Worker sweep phases are self-contained**: each new phase try/excepts, logs, and returns —
  a staging-purge failure must never skip the retention or anon phases (existing policy).
- **Race-409 catch never masks the DbUpdateException path for OTHER unique indexes**: the
  `when (IsUniqueViolation)` filter plus the fact that `uq_song_versions_song_number` can
  also trip there (E4.3, out of scope) — keep the 409 message song-name-specific but accept
  that the catch is index-agnostic; do NOT try to parse the constraint name in this wave.

## Anti-patterns to avoid

- Don't convert the ~120 remaining legacy BFF sites "while you're in there" — the inventory
  is documented; it's a follow-on.
- Don't invent a fourth parser or leave any local `safeParseError` alive.
- Don't move XHR errors onto ApiError/code-keyed handling in this wave (plain Error stays).
- Don't give the LLM degradation banner a retry button or render `detail` to users.
- Don't extend DegradationBanner — sibling component (fact 6).
- Don't add a `DeletedAt` filter to the suffix probe (soft-deleted songs hold names).
- Don't make the sweep delete objects inside the row transaction (lock-across-network-I/O —
  the anon-purge comment at retention_actor.py:284-287 is the law).
- Don't touch `useVerdicts` poll logic, the wave-1 poll helper, or the XHR 401-retry.
- Don't `git commit` with failing gates; don't mock-to-pass worker tests (CLAUDE.md).

---

## Confidence score: 8/10

Grounded: every cited line was read this session; four intake assumptions were corrected
against the code (XHR hooks already have 401-retry — parser-only change; a third error shape
(ValidationProblem) exists and matters; full server conversion is ~120 sites — bounded out;
retention already covers staged keys for free/lapsed users — the gap is protected users).
A fifth assumption was verified rather than corrected: `stem_paths_raw` entries persist the
storage key under snake_case `"path"` (`StemRawEntry` JsonPropertyName,
`VersionEndpoints.cs:678-687`), matching `_version_keys`' existing read.
Residual risks: (1) the auto-suffix `StartsWith` probe's translation to SQL under Npgsql
should be sanity-checked in the integration test (collation/case behavior); (2) the
`/versions/` proxy-path orphan-object cleanup depends on the IFileStorage delete signature —
verify at the version-delete call site (~`VersionEndpoints.cs:376-381`) before wiring;
(3) worker sqlite tests need `analysis_jobs` present via `Base.metadata` — if the shared
model diverges, hand-create the table like the fixture already does for
`subscriptions`/`credit_ledger`; (4) the copy strings for the degradation banner are drafts —
tweak freely, but keep one distinguishing substring per reason for the tests.
