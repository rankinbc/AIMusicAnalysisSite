# SPECTR Full App Audit — 2026-07-10

Five parallel deep scans: upload/analysis flow, dead UI, feature gaps, fixes-to-Listen carry-over, Coach Mix. Consolidated and ranked. All paths relative to repo root unless noted.

---

## 1. Upload / analysis failures (user-reported)

### P0-1. Email-verify gate blocks every analysis after the first (PRIME SUSPECT)
- `components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs:1181-1194` — non-pro tier + `EmailVerifiedAt == null` + any prior non-failed job → `403 email_verification_required`. Unconditional; NOT disabled by `RateLimits:Enabled=false`.
- Dev never sends verification email (`RESEND_API_KEY` empty → send_email actor no-ops), no dev seed auto-verifies. Gate can never be satisfied locally.
- Error UX: UnifiedUploadDialog only special-cases `entitlement_exhausted`; the 403 renders as generic toast "HTTP 403" (`fetcher.ts:118`). Retry hits the same gate.
- **Fix:** Development auto-verify on register (or log verify link to BFF console), + map `email_verification_required` to a clear toast with verify/resend affordance.

### P0-2. Dead worker looks like eternal "Analysis in progress"
- `scripts/start-spectr.ps1:311-315` warns-only on missing Python deps, still opens a worker window that instantly errors. Orphaned `multiprocessing-fork` heartbeat hazard documented at `:143-150`.
- Stuck `pending` job only failed after `PendingGraceMinutes` = 240 min (`StaleJobReaper.cs:67-87`, `appsettings.json:32`). Results page spinner is indistinguishable from healthy progress (`songs.$songId.results.$jobId.tsx:89-100`).
- **Fix:** launcher fails loudly on import failure; dev PendingGraceMinutes ~5 min; progress page elapsed-time + "worker may be down" hint.

### P1-3. Presigned upload hard-fails (500) if S3 env set but MinIO down
- Fallback only triggers on HTTP 501 (`useMixUpload.ts:149`). `IsConfigured` = ServiceUrl non-empty (`S3StorageOptions.cs:31`); `.env.example:40` ships `Storage__S3__ServiceUrl=http://localhost:9000` but `start-spectr.ps1:207` never starts MinIO → connection-refused 500 → no fallback.
- **Fix:** broaden client fallback to connection/5xx on init, or reachability-probe in `IsConfigured`.

### P1-4. Disposable-email cap fires even with rate limits off
- `VersionEndpoints.cs:1119-1142` — disposable arm (cap=1) not gated by `limitsOn`; mislabeled `entitlement_exhausted` → opens UpgradeSheet.
- **Fix:** gate behind `limitsOn` or exempt Development.

### P1-5. Environment: stack cold at audit time
- Docker Desktop not running; no `.env` anywhere (only `.env.example` files); no repo venv; ports 5000/5174/5432/6379/9000 all closed.
- **Fix:** create root `.env` from example (WITHOUT S3 vars unless MinIO used — see P1-3); document boot order; consider start-spectr preflight checks.

### Ruled out
- Queue topology correct (dev worker consumes all 4 queues; actor-name dispatch works from both lanes).
- Rate limits off in Development (`appsettings.Development.json:16-18`) except the two gates above.
- Storage roots match by default (BFF `../../../../data` == worker `parents[3]/data`); only breaks if `components/worker/.env` sets compose `STORAGE_LOCAL_ROOT=/data` on native Windows.

---

## 2. Fixes → Listen carry-over (user-reported; confirmed broken)

Two disjoint mechanisms; the visible button is the broken one.

### P0-6. "Open in Listen rack" carries NOTHING
- `FixRackPanel.tsx:48-50` navigates with only `versionId`. Generated chain never stored/passed; `ListenRackPage.tsx` never calls `useFixRack`. User lands on default/autosaved rack. In-file comment claims handoff that was never wired.

### The path that works (PLAN tab) is hidden and fragile
- P1-7. PLAN rail tab only exists in `work` mode (`access.ts:76-92`); view/room modes = carried fixes unreachable.
- P1-8. Unmapped fix types (`multiband_compressor`, `sidechain`) silently dropped by `isApplyable` filter (`listenFixes.ts:38`, `fixToRackPatch.ts:29-59`) → empty PLAN despite committed fixes.
- P1-9. `composeRack` rebuilds from `MODULE_DEFAULTS` (`fixToRackPatch.ts:69-79`) — wipes manual knob moves AND kicks user out of pitch mode.
- P2-10. Draft-restore race: async `useRackDraft` recall (`ListenRackPage.tsx:255-266`) can clobber an applied fix while checkbox stays on (two persistence systems fight: `listenApplied:*` vs server draft).
- P2-11. Toggling before first play is inaudible (graph nodes null → `setEffectParams` no-ops) with no cue.
- P2-12. EQ slot algorithms diverge: backend nearest-frequency (`preset_compiler.py:56-84`) vs frontend sequential slots (`fixToRackPatch.ts:88-94`).
- No integration test covers Results→Listen handoff at all.

### Recommended redesign (agent sketch)
1. One carrier: zod-validated URL search param on `/listen-rack/$versionId` (`?preset=<id>` — save generated chain as server preset, or Listen fetches fix-rack itself).
2. One-shot apply after graph-ready via pending-params ref; carry-over wins over draft autosave.
3. Visible "Fix applied: X ✕ / Reset" chip in every mode.
4. `composeRack` overlays onto live rack, never touches pitch.
5. Unmapped ops render as disabled "not applicable" rows, never dropped.
6. Single shared EQ-slot algorithm.
7. Integration test asserting carried fix reaches `rs.mod` + real graph.

---

## 3. Coach Mix (user-requested review)

### P0-13. The Coach Mix "brain" was never built — 1 of 15 tasks done
- Design: `docs/superpowers/specs/2026-06-28-coach-mix-arbiter-design.md` (IDENTIFY→SOLVE→4-pass Arbiter→MasteringEngineer LLM→GUARD→compile, change_log/arbiter_notes/degraded).
- Reality: `components/worker/app/coach_mix/` has only `types.py` + `interactions.py` (orphaned, zero importers — dead code). Actor still calls old mechanical `solve()` (`fix_rack_actor.py:23,56`), 1-arg signature (no user/tier for budgets), preset named "Fix rack — {song}" not "Coach Mix", no `coach_meta` column, `FixRackDto` lacks changeLog/arbiterNotes/degraded (`RackPresetDtos.cs:26`).
- FixRackPanel "Why these settings" block = hardcoded "soon" placeholder (`FixRackPanel.tsx:125-134`).
- **Decision needed:** finish the arbiter plan (`docs/superpowers/plans/2026-06-28-coach-mix-arbiter.md`, L) or relabel honestly + remove placeholder (S).
- Note: deterministic path works offline with no API key — the shipped mechanical solver is robust.

### AI Coach chat findings
- P1-14. Unlock pills dead-toast: "Stems upload coming with Phase E", "Upgrade flow coming with Epic 2" — STALE, Epic 2 shipped; `CoachGateInline` already routes to /pricing, inconsistent (`CoachChat.tsx:246-257`, `coach-chat-helpers.ts:23-28`).
- P1-15. Anonymous/device users can't use coach at all: schema supports device conversations (`ux_conversations_analysis_device`) but endpoints `.RequireAuthorization()` and never set device_id (`CoachConversationEndpoints.cs:46-47,312-318`).
- P1-16. Cap counts refused/Stop turns (usage event written pre-worker in same tx, `CoachConversationEndpoints.cs:176-191`) — user can burn 3 free follow-ups on zero value.
- P2-17. Dev default `LLM_FAKE=1` → chat streams canned "[FAKE]" replies out-of-box; `LLM_FAKE=0` + no key = every reply errors (no key-less real path except dev CLI escape hatch).
- P2-18. Known flake `Concurrent_Posts_Converge` (CoachConversationEndpointsTests.cs:373) is a TEST-DOUBLE bug: `RecordingJobQueue.Calls` is unsynchronized `List<>` under 3 concurrent Adds. Fix: `ConcurrentQueue` (AccountGdprTests already does this). Production enqueue is correct. Real (separate) prod races: cap TOCTOU + coach_actor pending-guard check-then-act.

---

## 4. Dead / fake UI (broken-app impression)

- P0-19. Global search box + ⌘K badge on EVERY page — completely unwired (no onChange, no keyboard handler anywhere) (`_app.tsx:117-118`).
- P0-20. Disabled "Listen" nav tab on every page, tooltip-only explanation (`_app.tsx:93-101`).
- P1-21. ReferenceTab FABRICATES percentile from score (`score*0.95` clamp 5-95) rendered as real genre comparison (`ReferenceTab.tsx:43-48`).
- P1-22. SpectrumTab hardcoded "genre median" ticks + hot-band warnings computed vs fake medians (`SpectrumTab.tsx:23-37,65`) — currently orphaned (see 24) but a landmine.
- P1-23. ProjectUnlock tells user to re-upload with .als but has NO button (`ProjectUnlock.tsx:9-21`).
- P2-24. Orphaned components: `AnalysisTab`/`SpectrumTab`/`ArrangementTab` imported nowhere — live tabs are AI Coach/Findings/Project/Reference/Track Info/Debug (`ReportView.tsx:31-43`, `ResultsTabs.tsx:37-59`). Delete or re-wire. Also dead: `VerdictCard.tsx`/`VerdictsPanel`, `NotImplemented.cs`.
- P2-25. Debug tab (raw JSON internals) always visible to end users (`ResultsTabs.tsx:58`).
- P2-26. Dead "Note this moment…" input on Listen rail Notes tab — no handler at all (`rail.tsx:532-536`).
- P2-27. Profile Email "Edit" button permanently disabled, no explanation (`profile.tsx:399,342`).
- P2-28. Param-less `/listen-rack` demo route renders fully mock page (fixtures, fake reactions) — unlinked but reachable by URL.
- P2-29. Room reaction buttons silent no-op when `onReact` unthreaded (`rail.tsx:372`).
- Stale CLAUDE.md: DeltaCard is NOT a placeholder anymore (real CompareDialog); tab list stale; "Listen page 8 preview tools" describes retired `features/listen/` page.

---

## 5. Backlog / structural gaps (from sprint + docs mining)

User-visible:
- MiniPlayer never built; library card/row fidelity partial (story 5-1 backlog).
- Free-retry after partial failure not wired — DegradationBanner shows but promised free re-run missing (5-7, AR16); .als subprocess isolation missing (AR33).
- A11y/keyboard/kitchen-sink absent: no axe-core, no ⌘U, only ⌘K (dead anyway) (5-10).
- Story 5-6 (TrackChip attribution) still in `review`, not merged; only 2 rules emit track_names.
- Share page waveform peaks endpoint permanent 404 stub (`ShareEndpoints.cs:222-231`).
- Billing cadence toggle fires real Stripe proration with NO confirm dialog (`billing.tsx`).
- Listen DSP deliberate partials: Saturator/Limiter/preset-save deferred; pitch+tempo coupled (labeled).
- Reduced-motion ignored on Listen canvases; coach optimistic bubble not rolled back on failure; listen social panels swallow mutation failures (bookmark note-edit = delete-then-recreate, data loss risk).

Backend risk:
- `rerun_phase` + reference enqueue have NO abuse arms (documented gap, runbook:281).
- Coach cap TOCTOU + coach_actor idempotency window (double LLM spend on redelivery).
- BFF integration tests silently no-op without Postgres (false-green CI).
- Worker suite ~12 order-dependent failures (db_sync pollution).
- Deferred structure detection leaves reports/{jobId}.json stale; skips S3 + anon jobs.
- Rule-engine placeholder thresholds unvalidated (rule_engine.py:631,643,1044,1162).
- LRA/momentary not conformance-proven — keep unmarketed.
- Reconciliation detect-only; reaper doesn't refund credits (manual admin refund).
- Legacy /stems + /als AsNoTracking-join footgun class (~10 sites in VersionEndpoints.cs).
- IFileStorage hardcoded LocalDisk — legacy proxy uploads write container FS in prod; S3-backed IFileStorage is a 10.x follow-up.

Launch checklist (docs/launch-checklist.md): ~40 items ALL unexecuted — require live VPS (first deploy, DNS/email, Stripe matrix, restore drill, alerting, security checks). Blocking for launch, not for local polish.

---

## 6. Suggested fix batches

**Batch A — "make it work locally" (S, unblocks user):**
A1 dev auto-verify + 403 surfacing (P0-1); A2 worker fail-loud + dev reaper 5min + progress-page hint (P0-2); A3 broaden presigned fallback (P1-3); A4 gate disposable arm in dev (P1-4); A5 root .env + boot docs (P1-5).

**Batch B — "fixes carry to Listen" (M):**
B1 wire FixRackPanel handoff via preset/URL param + one-shot apply (P0-6); B2 visible applied-fix chip all modes (P1-7); B3 never-drop-unmapped rows (P1-8); B4 composeRack overlays live rack + preserve pitch (P1-9); B5 integration test.

**Batch C — "stop looking broken" (S/M):**
C1 wire or remove global search (P0-19); C2 Listen nav tab → hide or route to library picker (P0-20); C3 unlock chips → route to real upload dialog + /pricing, kill stale toasts (P1-14); C4 label or remove fabricated percentile (P1-21); C5 ProjectUnlock CTA (P1-23); C6 hide Debug tab behind dev flag (P2-25); C7 remove dead note input, Email Edit row, orphaned components (P2-24/26/27); C8 remove FixRackPanel "soon" placeholder or wire change_log (ties to Coach Mix decision).

**Batch D — Coach Mix decision (user call):** finish arbiter plan (L) vs. honest relabel + cleanup (S). Either way: fix flaky test double (S), decide anon-coach story, stop counting refusals against cap.

**Batch E — merge story 5-6** (in review) + sprint-status refresh.
