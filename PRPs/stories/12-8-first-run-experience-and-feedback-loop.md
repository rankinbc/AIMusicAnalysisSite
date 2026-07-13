# Story 12.8: First-Run Experience & Feedback Loop

Status: done

## Story

As a new user,
I want value before my first upload finishes and a way to report problems,
so that the first session builds trust instead of testing patience.

## Background (scouted 2026-07-13 @ 1b30e47)

- Library/report/audio queries are STRICTLY user-scoped (`SongEndpoints.cs:44,60,130`, `VersionEndpoints.cs:268`) — a shared read-only demo would need query surgery everywhere. Copy-per-user seed rows at registration is the zero-query-change fit. `HandleSeeder` (`Auth/HandleSeeder.cs`) is the house "seeder called from Register" pattern; Register already runs best-effort post-commit blocks (device claim, L205-253) that never fail registration.
- `SongVersion.FilePath` is required and the Play path streams a REAL object (`GET /versions/{id}/audio` → 404 if missing → toast'd broken-play). The demo needs a real audio object; per-user rows can share ONE canonical storage key (ownership checks ride the version row, not the blob).
- Full-shape seed reports exist: `schemas/samples/sample1_*.json` (~30 KB, has `mix_score`/`grade`) and `output/analysis/2026-06-25_latest-final-json/final_json.condensed.json`.
- No correlation id reaches the client on the happy path — 10.3's correlation is log/Sentry-only (`Program.cs:514-534`); the ONLY client-readable trace id is `details.traceId` on the unhandled-500 envelope (`Program.cs:487-508`). Reliable prefill = jobId/URL from the route; traceId opportunistically from a caught `internal_error`.
- App shell has an account menu (`_app.tsx:128-184`, Profile/Usage/Billing/Sign out) and no footer. No mailto pattern or support-email config exists anywhere.
- `ProgressStoryline.tsx:165` carries the ready slot: `{/* Story 12-8 (AC3) will add the "How analysis works" link here. */}`. Phase truth: 7 base phases, 8 with ALS (`tasks_dramatiq.py:228`); "phase 9" exists only in the inspector's conceptual stage map.
- `PRPs/deferred-work.md` exists (through 11.x) — Epic 10/12 deferrals uncaptured. CLAUDE.md still carries 5 stale claims (bff "default queue" output, worker "two actors on default queue", frontend "Coach Mix" tab label, "7-phase" ambiguity, thin version-routes summary).

## Acceptance Criteria (with decisions)

1. A new account's library contains a clearly-labeled demo song with a COMPLETE seeded report visible in seconds. **Design: copy-per-user rows** (Song "Demo: Sample Report" + Description explaining it, SongVersion pointing at ONE shared canonical audio key, complete AnalysisJob + Analysis with a bundled sample final_json). **Honesty rule**: the label/description must say the report is SAMPLE data (the audio is a generated tone; the report showcases the UI, it is not an analysis of that tone). Seeding is best-effort (own try/catch + tx — never fails registration) via a `DemoSeeder` service (HandleSeeder pattern). The canonical audio object is generated server-side (tiny PCM writer) and written through `IFileStorage` if absent — no binary committed.
2. A "Report a problem" item in the account menu opens a prefilled `mailto:` carrying: app version/page URL, current jobId when on a results route, and the last captured `internal_error` traceId when one exists. Support address from `VITE_SUPPORT_EMAIL` (documented in `.env.example`-equivalent; sensible default).
3. The ProgressStoryline slot gains a "How analysis works" inline expandable (native `<details>`) explaining the 7 phases (+ "an 8th when you attach your Ableton project") in one line each — copy keys off the existing BASE_PHASES display names; no new route, no backend.
4. Docs truth: the 5 scouted stale CLAUDE.md claims corrected; `PRPs/deferred-work.md` gains an Epic 10–12 section consolidating the scouted deferrals (12-2/12-3 at-home items, 12-5 orphan/percentile notes, 12-6 coaching-layer wiring + refused-turn backfill + expression-index, 12-7 envelope-migration + Playwright-in-CI, 4-6 tver-bypass sunset + async export, 3-3 `?t=` retirement + stem-preview retry, 10-3 items) — one line each with source. Correct the 12-6 ledger state (decision made, shipped).

## Tasks / Subtasks

- [x] Task 1: DemoSeeder (AC: 1)
  - [x] `Services/DemoSeeder.cs`: generates/ensures the canonical demo WAV via `IFileStorage` (`audio/demo/source.wav`, ~5 s stereo PCM sine written by a small helper — mirror playwright's gen-wav math), loads the bundled sample final_json (embed `schemas/samples/sample1_*.json` content as a BFF content file copied to output), writes Song/SongVersion/AnalysisJob/Analysis rows for the user. Idempotent per user (skip if a demo-named song exists).
  - [x] Call from `Register` after the user commit, best-effort try/catch (device-claim precedent). NOT in dev-login.
  - [x] BFF tests: register → library list contains the demo song with grade/mix_score summary; demo audio streams 200 (Range) for the owner; second registration seeds its own copy; seeder failure does not fail registration (fake storage that throws).
- [x] Task 2: Report a problem (AC: 2)
  - [x] `lib/report-problem.ts`: pure builder `buildProblemReportMailto({ email, url, jobId?, traceId? })` → mailto URL (subject + body, encoded). Unit tests.
  - [x] `fetcher.ts`: stash the most recent `internal_error` traceId (module state, `getLastTraceId()`).
  - [x] Account menu item "Report a problem" (after Billing) → `window.location.href = mailto`. jobId parsed from `location.pathname` results-route match. `VITE_SUPPORT_EMAIL` w/ fallback.
- [x] Task 3: How analysis works (AC: 3)
  - [x] Fill the `ProgressStoryline.tsx:165` slot: `<details>` + per-phase one-liners (reuse BASE_PHASES names); static-render test (expands, lists 7 phases + ALS note).
- [x] Task 4: Docs truth + ledger (AC: 4)
  - [x] CLAUDE.md: fix bff Outputs queue claim, worker Purpose (four queues, actor roster), frontend Coach Mix → Fix Rack, "7-phase (8 with ALS)" phrasing at both sites, version-routes summary line.
  - [x] `PRPs/deferred-work.md`: new "Epic 10–12 (2026-07-13 consolidation)" section, one-liners with sources; mark 12-6 items shipped/decided.
- [x] Task 5: Validation gates (all)
  - [x] BFF build + test (stack up); frontend build/tsc/lint/lint:css/vitest; Playwright smoke headless (MUST stay green — registration now seeds; the smoke's fresh account will carry the demo song: update the library-empty-state expectation!).
  - [x] Worker untouched.

## Dev Notes

### Critical smoke interaction

The 12-7 smoke asserts `Your library starts here` (first-run empty state) after registration. Task 1 makes a fresh library NON-empty (demo song present). The smoke must change to assert the demo card instead (`Demo: Sample Report` visible) before clicking "+ New song" (header button still present). Update `smoke-first-run.spec.ts` accordingly IN THE SAME COMMIT as the seeder.

### Verified code anchors

- Register: `AuthEndpoints.cs:127-279` (user commit at :193; device-claim best-effort block :205-253; `HandleSeeder` DI precedent).
- Entities: Song (no IsDemo flag — use Name+Description), SongVersion.FilePath required, AnalysisJob complete-shape, Analysis.FinalJson jsonb; summary read via `SongEndpoints.ToSummaryDto` (`:477-497`) + `FinalJsonMetrics.Read` (needs `mix_score`+`grade` in the json).
- Sample payload: `schemas/samples/sample1_*.json` (verify exact filename at dev time; ~30 KB, carries mix_score/grade).
- Audio serving: `VersionEndpoints.cs:255-277` (owner join, 404 on missing, `MediaDelivery.ServeAsync`); `IFileStorage` local root resolution gotchas in CLAUDE.md.
- Account menu: `_app.tsx:128-184`; nav right `:107-118`.
- traceId: only `Program.cs:487-508` envelope; `ErrorEnvelope.Build` does NOT carry one.
- Storyline slot: `ProgressStoryline.tsx:165`; BASE_PHASES `:17-25`; phase math `tasks_dramatiq.py:228` (7 base / 8 with ALS).
- Ledger: `PRPs/deferred-work.md` (existing, through 11.x).

### Constraints & gotchas

- NO visible windows; headless Playwright; venv worker (untouched); services as background processes.
- Seeder must never fail registration and never run twice for one user (idempotency by demo song name or a deterministic seed check).
- Storage in dev = LocalDisk under repo `data/` — the seeder's WAV write lands there; tests run against the real local storage root (clean up or use unique keys per test? The canonical key is intentionally SHARED — tests must not delete it while other tests stream it; idempotent ensure-write is enough).
- Embedded sample json: prefer a `Content` item copied to output over an inline string; keep the file at its schemas/ home and reference via csproj link (no duplication).
- `mailto:` length limits (~2000 chars safe) — keep the body terse.
- New BFF tests: `[SkippableFact]` + `TestDb.RequireAsync`.
- 12-7 smoke registration retry generates fresh emails per attempt — seeding per registration means retried registrations seed too (each its own user — fine).

### Previous story intelligence

- 12-5/12-6 already fixed most CLAUDE.md staleness — only the 5 scouted claims remain.
- House test patterns: renderToStaticMarkup; content-keyed row selection; scope-write seeding.
- gen-wav PCM math reference: `playwright/fixtures/gen-wav.mjs`.

### Project Structure Notes

- BFF: 1 new service + Register wire + tests; frontend: 1 lib + menu item + storyline details + smoke update; docs: CLAUDE.md + deferred-work.md. No schema change (demo rows use existing tables). No worker change.

### References

- [Source: PRPs/epics.md — Epic 12, Story 12.8]
- [Source: scouted design inputs 2026-07-13 — seeding options, correlation-id reality, phase truth]
- [Source: PRPs/deferred-work.md — existing ledger to extend]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), dev-story workflow, 2026-07-13.

### Debug Log References

- All sample fixtures grade F — kept AS the demo (a rough mix showcases what SPECTR finds; an A-grade report has nothing to explore). Label copy leans in: "deliberately rough demo mix".

### Completion Notes List

- **AC1**: `DemoSeeder` (HandleSeeder pattern): idempotent per user (by demo song name), best-effort (own try/catch — throwing storage proven not to fail registration), rows = Song "Demo: Sample Report" (Description carries the honesty copy: sample data, not an analysis of the tone) + SongVersion → shared canonical key `audio/demo/source.wav` (tone generated in C#, ensured through `IFileStorage` once, no binary in git) + complete AnalysisJob + Analysis with `schemas/samples/sample1_8aeef3b4.json` (csproj Content link — file stays at its schemas/ home). Wired into Register after the device-claim block. 3 BFF tests: seeded library + streaming audio, idempotency, seeder-failure-doesn't-fail-registration.
- **AC2**: `lib/report-problem.ts` pure mailto builder (+2 tests, +jobId route parser); fetcher stashes the last `internal_error` traceId (`getLastTraceId`); account-menu item builds the prefill from URL + jobId + traceId; `VITE_SUPPORT_EMAIL` with fallback.
- **AC3**: ProgressStoryline's 12-2 slot filled with a native `<details>` — 7 phase one-liners keyed to BASE_PHASES + the .als 8th-phase note; static-render test.
- **AC4**: CLAUDE.md — bff Outputs queue claim, worker Purpose (4 queues + actor roster), Coach Mix→Fix Rack tab mention, "7-phase" → "7 base / 8 with .als" (both sites). `PRPs/deferred-work.md` gains the Epics 10–12 consolidation section (10 grouped entries with sources) + a status-corrections note superseding the shipped 12-6 items.
- **Smoke updated in the same change**: fresh library is no longer empty — the `Your library starts here` assert is replaced by a `Demo: Sample Report` visibility assert (12-7's harness keeps guarding the shell).

### File List

- components/bff/src/Spectr.Bff/Services/DemoSeeder.cs (new)
- components/bff/src/Spectr.Bff/Program.cs (modified — DI)
- components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs (modified — Register wire)
- components/bff/src/Spectr.Bff/Spectr.Bff.csproj (modified — sample json Content link)
- components/bff/tests/Spectr.Bff.Tests/DemoSeederTests.cs (new — 3 tests)
- components/frontend-spectr-v2/src/lib/report-problem.ts (new)
- components/frontend-spectr-v2/src/lib/__tests__/report-problem.test.ts (new)
- components/frontend-spectr-v2/src/api/fetcher.ts (modified — lastTraceId capture)
- components/frontend-spectr-v2/src/routes/_app.tsx (modified — Report a problem menu item)
- components/frontend-spectr-v2/src/features/results/ProgressStoryline.tsx (modified — how-analysis-works details)
- components/frontend-spectr-v2/src/features/results/ProgressStoryline.module.css (modified)
- components/frontend-spectr-v2/src/features/results/__tests__/ProgressStoryline.how.test.tsx (new)
- components/frontend-spectr-v2/playwright/smoke-first-run.spec.ts (modified — demo-card assert replaces empty-state)
- CLAUDE.md (modified — truth fixes)
- PRPs/deferred-work.md (modified — Epics 10–12 consolidation)
- PRPs/sprint-status.yaml (status flips)
- PRPs/stories/12-8-first-run-experience-and-feedback-loop.md (this file)

Review patches (senior review, same day):

- components/worker/app/retention_actor.py (modified — SHARED_STORAGE_KEYS exclusion)
- components/worker/app/account_deletion_actor.py (modified — same exclusion)
- components/worker/tests/test_retention_sweep.py (modified — exclusion test)
- components/bff/src/Spectr.Bff/Services/DemoSeeder.cs (modified — P2/P3/P10 hardening)
- components/bff/src/Spectr.Bff/Endpoints/AuthEndpoints.cs (modified — CancellationToken.None)
- components/bff/tests/Spectr.Bff.Tests/DemoSeederTests.cs (modified — Range 206 assert)
- components/frontend-spectr-v2/src/lib/report-problem.ts (modified — CRLF/app-line/strict uuid)
- components/frontend-spectr-v2/src/lib/__tests__/report-problem.test.ts (modified)
- components/frontend-spectr-v2/src/api/fetcher.ts (modified — traceId TTL + clear)
- components/frontend-spectr-v2/src/features/results/ProgressStoryline.tsx (modified — PHASE_EXPLAINERS map)
- components/frontend-spectr-v2/src/features/results/__tests__/ProgressStoryline.test.tsx (modified — scoped alias assert)
- components/frontend-spectr-v2/.env.example (new)

## Senior Review Record

### Review Date / Model

2026-07-13, Claude Fable 5 — 3-layer adversarial review (Blind Hunter diff-only / Edge Case Hunter diff+repo / Acceptance Auditor diff+spec) on master..story/12-8-first-run (PR #45).

### Findings & Resolutions (all patched on the story branch)

- **P1 CRITICAL — shared demo blob purged by retention sweep AND GDPR delete**: every seeded SongVersion points at the ONE canonical `audio/demo/source.wav`; `retention_actor._version_keys` and `account_deletion_actor._collect_storage_keys` would delete it when the first demo-owning account expired/deleted, breaking the demo for every other user (self-heals only on the NEXT registration). Fix: `SHARED_STORAGE_KEYS` frozenset in `retention_actor.py`, filtered from both collectors; test `test_version_keys_excludes_shared_demo_key`.
- **P2 HIGH — seeder catch left a poisoned ChangeTracker**: SaveChangesAsync failure kept 4 tracked demo entities in the scoped DbContext shared with the rest of Register — the refresh-token SaveChanges would retry the failed inserts and fail registration (the exact thing the try/catch exists to prevent). Fix: `db.ChangeTracker.Clear()` in the catch.
- **P3 — EnsureDemoAudio TOCTOU + torn-write risk** (the observed suite flake): exists-check then write, no size validation. Fix: JSON precondition checked FIRST (cheap), size-validated rewrite (`44 + 882000` bytes), IOException race tolerated only when the other writer's object exists.
- **P4 — Register passed the request `ct` to SeedAsync**: a client disconnect mid-seed = OCE swallowed = permanently demo-less account (no re-seed path). Fix: `CancellationToken.None` at the call site.
- **P5 — mailto contract**: CRLF line joins (RFC 6068; bare `\n` renders run-on in Outlook), `app: spectr-v2 (mode)` line, strict UUID regex in `jobIdFromPath` (was `[0-9a-f-]{36}`), `.env.example` documenting `VITE_SUPPORT_EMAIL` (personal-email fallback accepted for private beta).
- **P6 — lastTraceId hygiene**: 30-min TTL + cleared on `setAccessToken(null)` so a stale/other-session trace never rides a report.
- **P7 — explainer copy drift risk**: hardcoded `<li>` list replaced by `PHASE_EXPLAINERS: Record<(typeof BASE_PHASES)[number], string>` rendered from BASE_PHASES — a phase rename now breaks the build, not the copy. (Surfaced a latent test bug: the alias no-duplicate test matched the whole HTML including the explainer; scoped to the phase `<ol>`.)
- **P8 — CLAUDE.md**: 5th stale claim fixed (thin songs/versions route summary → full sub-resource surface) + new self-contradiction removed (`maintenance` queue "provisioned-but-empty until Epic 3/4" vs the actor roster — it carries `sweep_retention`/`send_email`/`delete_account_data`).
- **P9 — test gaps**: DemoSeederTests now asserts Range → 206 with exact byte count (Listen scrubbing contract); smoke's contradictory doubled comment cleaned.
- **P10 — hardening**: sample final_json cached in a static + parse-validated (corrupt asset → skip, never seed garbage).

### Gates after patches

- BFF: build 0 errors; `dotnet test` (SPECTR_REQUIRE_DB=1) **368/368 passed** — pre-patch flake (P3) gone.
- Frontend: tsc clean, lint clean, build clean, vitest **748/748**.
- Worker: ruff clean, venv pytest **590 passed, 3 xfailed**.
- Playwright smoke (headless, patched BFF + LLM_FAKE worker): see Change Log entry.

**Outcome: APPROVED** — all findings patched and verified on branch.

## Change Log

- 2026-07-13: Story created (create-story workflow) — copy-per-user seed decision (user-scoped queries make shared-demo infeasible); honesty rule for sample-data labeling; mailto prefill limited to what the client can actually read (jobId + opportunistic traceId).
- 2026-07-13: Senior review — 10 findings (1 critical: shared demo blob vs retention/GDPR purge) all patched; gates re-run green; smoke re-verified against the patched BFF.
