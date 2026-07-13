# Story 12.6: Coach Mix Truthfulness & Coach Chat Polish

Status: done

## Story

As a user,
I want Coach Mix and the coach chat to be honest about their capabilities,
so that labels match what the system actually does.

## Product decision (RECORDED — closes epics.md AC1's open question)

**RELABEL, do not build the arbiter.** Decided 2026-07-10 (orchestrator recommendation, accepted by Brian). The arbiter plan (`docs/superpowers/plans/2026-06-28-coach-mix-arbiter.md`) stopped at 1/15 tasks; the design spec promised "a holistic mastering-engineer LLM on genuine judgment calls" — none exists. What ships is `solve()` = a deterministic mechanical compiler (`preset_compiler.py`: filter master/bus fixes → translate op→module → dedup by rank/strength → canonical order; no LLM, no judgment). The honest name is **"Fix Rack"** — matching BOTH the persisted preset name (`fix_rack_actor.py:74` `"Fix rack — {song}"`) and FixRackPanel's own idle copy ("Generate fix rack"). Only the CoachTab button, CoachMixModal, and RackSidebar still say "Coach Mix".

## Background (audit Batch D, scouted 2026-07-13 @ b30caa8)

- "Coach Mix" label surfaces: `CoachTab.tsx:181-185` (Generate/Regenerate button), `CoachMixModal.tsx:32,36` (aria-label + "Coach Mix · calculated rack"), `RackSidebar.tsx:57,72` ("Coach Mix" entry + "Compiling Coach Mix…").
- `change_log`/`leftover_advice` ARE computed by `compile_preset` (`preset_compiler.py:158`) but the actor DISCARDS both (`fix_rack_actor.py:57` keeps only chain; leftover count only logged). No column, no DTO field, no UI reach. The FixRackPanel placeholder (`FixRackPanel.tsx:133-142`, "Why these settings · what's left" + `soon` badge) promises that layer.
- `app/coach_mix/` (types.py `JudgmentCall`/`ArbiterResult`, interactions.py blend/clamp helpers): ZERO production importers; only `tests/coach_mix/test_interactions.py` consumes it — functions no production code calls.
- Flake: `CoachConversationEndpointsTests.cs:36` `RecordingJobQueue.Calls` is an unsynchronized `List<>`; `Concurrent_Posts_Converge...` (L361-416) does 3 concurrent POSTs then asserts `Calls.Count == 3` — torn adds flake it. Only THIS copy combines `List<>` + concurrency (others audited: UploadDeferral/DispatchQueueRouting use ConcurrentQueue; RoomEndpoints is sequential; CoachProMonthlyCap has no Calls).
- Cap counts refused/stopped turns (audit P1-16): PostMessage writes the user row + `coach_message` usage_event in ONE tx (L183-191) BEFORE enqueuing the worker; a later refusal (`assistant.Status="refused"`) or user SSE abort never un-counts. Free cap counts user rows (`CoachCapService.cs:70-71`); pro pool counts usage_events (`:96-99`). The codebase's canonical fix pattern: read-side exclusion, exactly like `EntitlementService.cs:82-95` excludes `invalid_file` analyses ("no second write path, no idempotency race").

## Acceptance Criteria (with decisions)

1. The RELABEL decision is recorded (above) and every user-visible label agrees: "Coach Mix" → **"Fix Rack"** across CoachTab button, CoachMixModal, RackSidebar. Persisted preset name already honest — unchanged.
2. The FixRackPanel "Why these settings — soon" placeholder is **REMOVED** (the AC's "or wire change_log" arm is DEFERRED: wiring needs a rack_presets column + python mirror + DTO + UI — a real follow-on story, logged for 12-8's deferred-work ledger; shipping the promise-free panel today is the honest state).
3. Orphaned `app/coach_mix/` package **DELETED** (+ its only consumer `tests/coach_mix/test_interactions.py`) per the relabel decision.
4. `RecordingJobQueue.Calls` in `CoachConversationEndpointsTests.cs` becomes a `ConcurrentQueue` — `Concurrent_Posts_Converge` flake killed (assert via `.Count` unchanged).
5. Refused turns do NOT count against the coach cap — read-side exclusion (the `invalid_file` pattern): free-tier count excludes user rows whose paired assistant row is `refused`; pro pool excludes `coach_message` usage_events whose `Reference` maps to a refused turn. **User-aborted (SSE-cancel) turns DO still count** — decision: an abort arrives mid-generation after real LLM spend; the refusal exclusion covers the "coach couldn't help" case, which is the honesty gap the audit named. Recorded here per the AC's "or the recorded product decision says why" arm.

## Tasks / Subtasks

- [x] Task 1: Relabel (AC: 1)
  - [x] `CoachTab.tsx:181-185`: `▣ Generate Fix Rack` / `↻ Regenerate Fix Rack` (busy "Compiling…" stays).
  - [x] `CoachMixModal.tsx`: aria-label `Fix Rack`, header `Fix Rack · calculated rack`. (Component/file names may stay — user-visible copy is the AC; note in completion if renamed.)
  - [x] `RackSidebar.tsx:57,72`: entry `Fix Rack`, busy `Compiling Fix Rack…`.
  - [x] Grep for any other user-visible "Coach Mix" strings (toasts, titles); comments may keep the historical name with a note.
- [x] Task 2: Remove the placeholder (AC: 2)
  - [x] Delete `FixRackPanel.tsx:133-142` coach block + orphaned `s.coach*`/`s.soon` CSS module classes; update the file-header comment (L12-13).
  - [x] Log the change_log/leftover_advice wiring as a deferred-work item (breadcrumb comment in `fix_rack_actor.py` where the values are discarded + story completion note for 12-8's ledger).
- [x] Task 3: Delete `app/coach_mix/` (AC: 3)
  - [x] `rm -r components/worker/app/coach_mix components/worker/tests/coach_mix`; grep worker+api for residual `coach_mix` imports (must be zero — plan/spec docs keep their references, they're historical).
  - [x] Worker gates: ruff + pytest.
- [x] Task 4: Flake fix (AC: 4)
  - [x] `CoachConversationEndpointsTests.cs:36`: `ConcurrentQueue<(string Task, object[] Args, string Queue)>` (copy `AccountGdprTests.cs:24` idiom); adjust `.Add(` → `.Enqueue(` and any index-based asserts to queue-safe reads.
  - [x] Run the converge test 5× (`dotnet test --filter Concurrent_Posts_Converge` loop) — 5/5 green.
- [x] Task 5: Refused turns don't count (AC: 5)
  - [x] `CoachCapService.cs` free count (L70-71): exclude user rows whose sibling assistant row (same conversation, the reply row created for that turn) has `Status == "refused"`. Join key: the assistant pending row is created in the same tx — verify the linkage (assistant row's preceding user row / a ReplyTo field?) and use the cheapest correct join; if no direct link exists, the turn pairing is by conversation + ordering — prefer adding the exclusion on the usage_event/reference path if cleaner. KEEP IT READ-SIDE.
  - [x] Pro pool (L96-99): exclude `coach_message` events whose `Reference` (user message id) pairs to a refused assistant row — mirror the `invalid_file` correlated-subquery shape (`EntitlementService.cs:82-95`).
  - [x] Tests: free tier — at cap with one turn's assistant row flipped `refused` in-DB (scope-write pattern, `CoachConversationEndpointsTests.cs:157-166`) → next POST succeeds (cap has headroom again); pro tier — refused-turn usage_event excluded from the pool count (`CoachProMonthlyCapTests` seed helpers). New tests `[SkippableFact]` + `TestDb.RequireAsync`.
  - [x] `CoachCapsDto` numbers must stay consistent with the 403 details (`used`/`limit`) — same exclusion applied everywhere the count is read.
- [x] Task 6: Validation gates (all)
  - [x] BFF: `dotnet build && dotnet test` (stack up).
  - [x] Frontend: `npx vite build`, `npx tsc -b`, lint + lint:css, `npx vitest run`.
  - [x] Worker: `uvx ruff@0.15.11 check components/worker/` + venv pytest.
  - [x] Playwright smoke headless (report page copy changed — smoke doesn't assert Coach Mix strings, must stay green).

## Dev Notes

### Verified code anchors

- Labels: `CoachTab.tsx:181-185`, `CoachMixModal.tsx:32,36`, `RackSidebar.tsx:57,72`. FixRackPanel renders `rack.name` + "Generate fix rack" already.
- Solver truth: `solve_lib/__init__.py:20-23`, `preset_compiler.py` (filter L124-138, translate L139-148, dedup L43-110, returns chain+leftover+change_log L158). Actor: `fix_rack_actor.py:35` (1-arg), `:57` (discards coaching), `:74` (name), `:81` (logs leftover count).
- Placeholder: `FixRackPanel.tsx:133-142` + header comment L12-13.
- coach_mix pkg: `app/coach_mix/{__init__,interactions,types}.py`; test `tests/coach_mix/test_interactions.py` (3 tests, no production consumer).
- Flake: `CoachConversationEndpointsTests.cs:34-56` (double), `:361-416` (converge test, `Task.WhenAll` of 3 POSTs, asserts count==3 at `:410`). ConcurrentQueue idiom: `AccountGdprTests.cs:24`, `EmailPipelineTests.cs:112`.
- Cap machinery: `CoachConversationEndpoints.cs` PostMessage — cap gate L116-129, user row L146-159, pending assistant row L160-175, usage_event L183-189 (`Reference = userRow.Id`), SaveChanges L191, enqueue L208-217. SSE cancel `:474-483`. `CoachMessage.Status` ∈ pending/complete/refused/error (`CoachMessage.cs:30`), `RefusalReason` `:45-46`. Worker terminalizes: `coach_actor.py:_mark_refused` L97-119.
- Cap counts: `CoachCapService.cs:68-71` (free: user-row count), `:96-99` (pro: usage_event count). Exclusion precedent: `EntitlementService.cs:82-95` (read-side correlated subquery on `e.Reference`, comment endorses the pattern).
- Cap tests: `CoachConversationEndpointsTests.cs:418-560` (403 at cap, details.used/limit), seed helpers L58-134; `CoachProMonthlyCapTests.cs` `SeedProAsync` L61-75.

### Design decisions

- Honest label = **"Fix Rack"** (aligns UI with the persisted name + panel copy — smallest truthful move; "calculated rack"/"Compiling" language stays because it is accurate).
- AC2 = REMOVE arm. Wiring change_log end-to-end needs: rack_presets `coach_json` column + Alembic-mirror + EF entity + FixRackDto fields + panel UI — a scoped follow-on ("fix-rack coaching layer"), logged for the 12-8 deferred-work ledger. A placeholder promising "soon" is the audit's exact complaint.
- AC5 refused-only exclusion, read-side (no decrement/second write path). Abort-still-counts decision recorded in AC5.
- Turn pairing for the exclusion: VERIFY the user↔assistant linkage at dev time (assistant row may not carry the user row id — if not, key the exclusion on the usage_event `Reference` → user row → next assistant row in conversation ordering, or add the simplest correct join; do NOT add columns without checking existing fields first).

### Constraints & gotchas

- NO visible windows; headless Playwright; venv worker; LLM_FAKE=1.
- 12-7 test rules: new BFF tests `[SkippableFact]` + `TestDb.RequireAsync`; never early-return gates.
- Known flakes (rerun before diagnosing): CoachStream, DispatchReference/CoachProMonthlyCap pairs. The converge test is the one THIS story fixes.
- Worker test isolation: never import `dramatiq_app` in tests.
- `docs/superpowers/` plan/spec files are historical records — do NOT edit them; the story file records the relabel decision.
- CoachMixModal/RackSidebar copy: check static-render tests referencing "Coach Mix" strings (grep tests) — update asserts with the copy.
- EF LINQ correlated subqueries: mirror the `invalid_file` shape exactly (translatable SQL); avoid client-side evaluation.

### Previous story intelligence (12-4/12-5/12-7)

- FixRackDto gained `presetId` (12-4); FixRackPanel navigate carries `?fixPreset` — don't disturb.
- 12-5 wired FixRackPanel siblings (dialogs on ReportView) — FixRackPanel itself untouched; its CSS module may hold the placeholder classes to delete.
- House test patterns: renderToStaticMarkup for static asserts; afterEach(cleanup) when multi-rendering; scope-write via `factory.Services.CreateScope()` for DB seeding.

### Project Structure Notes

- Frontend copy edits (3 files + CSS), worker deletions (1 pkg + 1 test dir) + 1 breadcrumb comment, BFF: 1 test-double fix + CoachCapService read-side change + tests. No schema change.

### References

- [Source: PRPs/epics.md — Epic 12, Story 12.6]
- [Source: output/audit/2026-07-10_full-app-audit/findings.md — Batch D, P0-13, P1-16]
- [Source: docs/superpowers/plans/2026-06-28-coach-mix-arbiter.md + specs/2026-06-28-coach-mix-arbiter-design.md — what was promised (historical)]
- [Source: components/bff/src/Spectr.Bff/Services/{CoachCapService,EntitlementService}.cs — cap counts + exclusion precedent]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), dev-story workflow, 2026-07-13.

### Debug Log References

- Gates: BFF 365/365 (+2 new AC5 tests, SPECTR_REQUIRE_DB armed); Concurrent_Posts_Converge 5/5 green post-fix; worker ruff clean + pytest 584 (587-3 deleted coach_mix); frontend build/tsc/lint/lint:css/vitest clean; smoke PASSED 23.1s headless.

### Completion Notes List

- **AC1**: "Coach Mix" → "Fix Rack" on every user-visible surface (CoachTab Generate/Regenerate button, CoachMixModal aria-label + header, RackSidebar entry + busy copy); comments relabeled with a "né Coach Mix" note where the history helps. Component/file names (CoachMixModal.tsx, coachMix* state) unchanged — rename-churn without user value; noted for reviewers.
- **AC2**: placeholder block + its CSS deleted from FixRackPanel; in-place comment explains the deferred coaching layer; breadcrumb added at the actor's discard site (`fix_rack_actor.py`). DEFERRED-WORK item for 12-8's ledger: "fix-rack coaching layer — persist/serve change_log + leftover_advice (rack_presets column + mirrors + DTO + panel UI)".
- **AC3**: `app/coach_mix/` + `tests/coach_mix/` deleted; zero residual imports (docs' references are historical plans, untouched).
- **AC4**: `RecordingJobQueue.Calls` → `ConcurrentQueue` (AccountGdprTests idiom); `Calls[0]` → `.Single()`; converge test run 5× (results below).
- **AC5**: implemented as MARKER-WRITE + READ-SIDE EXCLUSION (the `invalid_file` shape): no user↔assistant link column exists, so the worker (sole terminalizer, which already receives `user_message_id`) stamps the USER row's `RefusalReason` on refusal — in `_mark_refused` AND in `_mark_complete`'s refusal arm — and both cap counts exclude stamped turns (free: `RefusalReason == null` on user rows; pro: correlated subquery on the usage_event `Reference`). No schema change, no decrement, no second meter path. Pre-existing usage_events with synthetic References keep counting (subquery finds no stamped row).
- Two new BFF tests: free-tier refund (stamped turn returns headroom, `used` math exact) + pro-pool exclusion (direct `ResolveProPoolAsync` with a stamped-reference event).

### File List

- components/frontend-spectr-v2/src/features/results/CoachTab.tsx (modified — button labels)
- components/frontend-spectr-v2/src/features/results/CoachMixModal.tsx (modified — aria/header copy)
- components/frontend-spectr-v2/src/features/results/RackSidebar.tsx (modified — entry/busy copy)
- components/frontend-spectr-v2/src/features/results/CoachChat.tsx (modified — comment)
- components/frontend-spectr-v2/src/features/results/ReportView.tsx (modified — comments)
- components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx (modified — placeholder removed, comments)
- components/frontend-spectr-v2/src/features/results/FixRackPanel.module.css (modified — coach/soon classes removed)
- components/worker/app/coach_actor.py (modified — user-row refusal stamp in _mark_refused/_mark_complete + _stamp_user_row_refused)
- components/worker/app/fix_rack_actor.py (modified — deferred-work breadcrumb)
- components/worker/app/coach_mix/ (DELETED)
- components/worker/tests/coach_mix/ (DELETED)
- components/bff/src/Spectr.Bff/Services/CoachCapService.cs (modified — refused-turn exclusions, free + pro)
- components/bff/tests/Spectr.Bff.Tests/CoachConversationEndpointsTests.cs (modified — ConcurrentQueue + free refund test)
- components/bff/tests/Spectr.Bff.Tests/CoachProMonthlyCapTests.cs (modified — pro exclusion test)
- PRPs/sprint-status.yaml (status flips)
- PRPs/stories/12-6-coach-mix-truthfulness-and-coach-chat-polish.md (this file)

## Senior Review Record (bmad-code-review, 2026-07-13)

Three-layer adversarial review of `master..story/12-6-coach-mix-relabel` (PR #44). Auditor: **all 5 ACs Met**; Edge Case Hunter verified stamp-completeness, tx atomicity (stamp + terminalization commit/roll together; dramatiq redelivery safe), read-path consistency (all cap reads funnel through the two patched sites incl. EntitlementService's pool), ConcurrentQueue conversion, and that the frontend keys refusal UI on `status` — the user-row stamp is invisible. Patches applied:

- **P1 (extension, recorded decision)**: ERRORED turns don't bill either — a turn that dies on a worker/LLM error or a BFF enqueue failure is the system's fault. `_mark_error` now stamps the user row (`coach_error`, all 12 call sites pass `user_message_id`), and the BFF's enqueue-failure catch stamps `userRow.RefusalReason = "coach_error"` in the same SaveChanges. The recorded scope is now: refused → refunded; errored → refunded; user-aborted → still counts (real LLM spend; `_mark_complete_partial` deliberately unstamped).
- **P2**: the stamp is failure-isolated (inner try/except) — a stamp error can log-and-lose the refund but can never roll back the assistant-row terminalization (perpetual-pending hazard).
- **P3**: null refusal reason falls back to a generic `"refused"` marker (the exclusion keys on non-null).
- **P4**: worker-side write path now TESTED — `test_coach_refusal_stamp.py` (5 tests: stamps, fallback, idempotent, role/None guards, failure-swallow). Review had correctly flagged that both BFF tests hand-stamped rows, leaving the linchpin unproven.
- **P5**: free-tier test hardened — refused row selected by content (CreatedAt can tie), plus a 5th-POST 403 assert proving the cap still ENFORCES after the refund; `aimusic_shared` docstring + 2 CSS comments updated.
- **Accepted (documented)**: pro-pool correlated subquery uses the `Id.ToString() == Reference` shape — verbatim the `invalid_file` precedent; non-sargable cast acknowledged, tables are small pre-launch, expression-index follow-on if it ever shows in traces. NO backfill for pre-12.6 refused turns (self-healing for new traffic; ledger item for 12-8). 60s entitlements-cache window can briefly show a stale pool on the usage page after a refund (bounded, self-healing). Refused/errored turns still consume LLM *provider* budget — bounded by the 1.4 budget ceilings, not by per-user caps; honesty outranks the marginal spend. Component/file identifiers keep the CoachMix name (copy-deep relabel by design).

## Change Log

- 2026-07-13: Story created (create-story workflow) — relabel decision recorded; AC2 resolved to REMOVE with deferred wiring; AC5 abort-still-counts decision recorded.
