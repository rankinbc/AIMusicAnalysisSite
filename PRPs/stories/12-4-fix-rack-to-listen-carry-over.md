# Story 12.4: Fix Rack → Listen Carry-Over (Reliable Handoff)

Status: done

## Story

As a producer,
I want "Open in Listen rack" to actually carry my generated fixes,
so that what I previewed on the report is what I hear on Listen.

## Background (audit evidence — P0)

- `FixRackPanel.tsx:48-50` `openInListen` navigates with ONLY `versionId` — the solved chain the panel is literally rendering (`rack.chain`, byte-identical to the Listen rack per the file's own header comment) is discarded. The panel's header comment PROMISES the handoff; the handler doesn't do it.
- The generated rack IS already persisted server-side: `FixRackEndpoints.GetFixRack` reads the newest `RackPresets` row with `Source == "analysis"` for the version — but `FixRackDto(Name, Chain, CreatedAt)` surfaces NO id, and `RackPresetEndpoints.ListPresets` filters to `Source == "user"` only, so the analysis preset is unreachable from the Listen page. The carrier we need mostly exists.
- The "working path" (PLAN rail tab, work-mode only): `ReportView.tsx:184-187` writes committed+applyable fixes to localStorage (`writeListenFixes`); `PlanPanel` (rail.tsx:543-599) reads them; `useFixOverlay.recompute` (useFixOverlay.ts:34-37) calls `applyRackMod(composeRack(ops))`. Two defects: (a) `buildListenFixes` (listenFixes.ts:33-48) filters `isApplyable` — fixes whose ops are ALL unmapped (multiband_compressor, sidechain) vanish silently; (b) `composeRack` (fixToRackPatch.ts:76-96) rebuilds from `freshDefaults()` — wipes manual knob moves and resets `mod.pitch`, spuriously toggling the pitch BufferSource lane (pitch-enter/exit effect keys on `rs.mod.pitch.enabled`, ListenRackPage.tsx:481-528).
- Listen route has NO `validateSearch` today (`listen-rack.$versionId.tsx:69-71` is bare).
- 12-7's smoke deliberately stops at Listen reachability via the library Play button; its comment marks the handoff as this story's test.

## Acceptance Criteria

1. **Given** a generated fix rack, **When** I click "Open in Listen rack" (`FixRackPanel.tsx`), **Then** the chain arrives on `/listen-rack/$versionId` via a validated URL search param (preset id — fetched server-side) — survives refresh and back.
2. **Given** the Listen page loads with a carried chain, **Then** it applies once after the audio graph is ready (pending-params ref; carry-over wins over draft autosave restore).
3. **Given** carried fixes are active, **Then** a visible chip ("Fixes applied: N — reset") renders in every mode, not only the work-mode PLAN tab.
4. **Given** `composeRack`, **Then** it overlays onto the live rack state (manual knob moves preserved, pitch mode never reset) instead of rebuilding from defaults.
5. **Given** a fix with unmapped ops (`multiband_compressor`, `sidechain`), **Then** it renders as a disabled "not applicable in the rack" row — never silently dropped.
6. **Given** the flow, **Then** an integration test drives Results → navigate → Listen and asserts the carried fix reaches the rack state through the real graph handle.

## Tasks / Subtasks

- [x] Task 1: Surface the analysis preset id (BFF) (AC: 1)
  - [x] `FixRackDto` gains `PresetId` (Guid): `record FixRackDto(Guid PresetId, string Name, JsonElement Chain, DateTimeOffset CreatedAt)` — `GetFixRack` already has the row.
  - [x] New endpoint `GET /versions/{versionId:guid}/rack/presets/{presetId:guid}` in `RackPresetEndpoints.cs` — owner-gated (same tracked-lookup join as siblings), returns `RackPresetDto` for ANY source (`user`/`coach`/`analysis`), 404 unknown/foreign. Do NOT widen `ListPresets` (its user-only filter is a deliberate 11-2 decision).
  - [x] BFF tests: fetch-by-id happy path (analysis source), foreign-user 404, unknown id 404. `[SkippableFact]` + `TestDb.RequireAsync` (12-7 pattern).
- [x] Task 2: Carry param on the sender (AC: 1)
  - [x] Frontend `FixRackDto` type gains `presetId`; `FixRackPanel.openInListen` → `navigate({ to: '/listen-rack/$versionId', params: { versionId }, search: { fixPreset: rack.presetId } })`.
  - [x] Disabled state unchanged (`!versionId`); if `presetId` missing (stale cache), fall back to plain navigate (never block).
- [x] Task 3: Receive + one-shot apply on Listen (AC: 1, 2)
  - [x] `listen-rack.$versionId.tsx`: add `validateSearch` narrowing `{ fixPreset?: string }` (uuid-shape check, else drop — results-route hand-rolled idiom). Pass `fixPreset` into `ListenRackPage` as a new optional prop.
  - [x] `ListenRackPage`: fetch the preset via the new by-id endpoint (TanStack Query, enabled when `fixPreset && realAudio`); validate with existing `asChain` (`useRackPresets.ts:38-48`).
  - [x] One-shot apply via ref flag (mirror `draftRestored` pattern, ListenRackPage.tsx:254): when chain resolves, `rs.applyRackMod(composeRack from carried chain overlaid on live mod)` — see Task 4 — and `rs.setMasterBypass(chain.masterBypass)`. Applying into React state is sufficient for "after graph ready": live pushes no-op until `ensureContext()` and first-play `togglePlay` does `pushFullRack` from `rsRef` (ListenRackPage.tsx:610-614) — document this in code.
  - [x] Carry-over wins over draft restore: when `fixPreset` param present, SKIP the draft-restore effect body and still `setDraftRestored(true)` (arms autosave so the carried chain persists as the new draft). Deterministic, no race.
  - [x] Do NOT clear the param after apply (AC1 "survives refresh and back" — refresh re-applies, idempotent). The chip's reset action clears it (Task 5).
  - [x] Read-only modes (`cap.rackReadOnly` — View/Room guest): do not apply; chip not shown. Owner navigating from their own report is always work/view-capable.
- [x] Task 4: composeRack overlay (AC: 4)
  - [x] `composeRack(appliedOps, base?: Record<string, ModuleState>)` — optional base (default `freshDefaults()`, backward compatible); deep-clone base, never touch `base.pitch`, EQ band allocation works against base's bands.
  - [x] `useFixOverlay.recompute` passes a clone of live `rs.mod` as base (rs already in scope via caller).
  - [x] Carried-preset apply path (Task 3): the carried chain is a full `Chain` (not ops) — merge it module-by-module onto live mod PRESERVING `pitch` (helper `overlayChain(live, carried)` in `fixToRackPatch.ts` or `chain.ts`; same pitch rule).
  - [x] Note: worker `preset_compiler.py` mirror governs op→module MAPPING only — unchanged here; no worker edit. State this in completion notes.
  - [x] Unit tests in `fixToRackPatch.test.ts`: base overlay preserves a manually-tweaked module param; `pitch` never modified even when base has pitch enabled; default-arg behavior byte-identical to today (existing tests keep passing).
- [x] Task 5: "Fixes applied" chip in every mode (AC: 3)
  - [x] Chip in `TrackHeader` (ListenRackPage.tsx:56-92, rendered unconditionally at ~L660 — the only all-modes surface). `data-testid="fixes-applied-chip"`. Text `Fixes applied: N — reset` using global `.pill` utility.
  - [x] N = carried-chain enabled-module count (preset path) or applied-fix count (`useFixOverlay` path). Page-level state fed by both apply paths.
  - [x] Reset: `rs.reset()` (or re-apply draft-free defaults), clear `fixPreset` via `navigate({ search: (prev) => ({ ...prev, fixPreset: undefined }), replace: true })`, clear the fix-overlay applied set (localStorage state via `useFixOverlay`'s clear), hide chip.
  - [x] Vitest static render: chip visible in all three `ModeId`s given applied state; hidden when N=0.
- [x] Task 6: Never silently drop unmapped fixes (AC: 5)
  - [x] `buildListenFixes` (listenFixes.ts): include committed fixes whose ops are not applyable, flagged `notApplicable: true` (type gains the field), instead of filtering them out.
  - [x] `PlanPanel` (rail.tsx): `notApplicable` rows render disabled with copy "not applicable in the rack" (checkbox disabled, muted). `useFixOverlay` ignores them.
  - [x] Unit tests: `buildListenFixes` keeps a sidechain-only fix flagged; PlanPanel renders it disabled (extend `rail.plan.test.tsx`).
- [x] Task 7: Integration test (AC: 6)
  - [x] Vitest integration: real `useRackState` wired to a FAKE `RackGraphBindings` (5-method interface, rackBindings.ts:21-27) recording `pushFullRack` — mount the carry-apply hook/component with a carried chain and assert the chain reaches (a) `rs.mod` and (b) the recorded graph push on first-play sync. ("Through the real graph handle" = real rackState + real bindings interface, fake node layer.)
  - [x] Playwright (only if cheap): extend `smoke-first-run.spec.ts` — on the report, if the fix-rack generates under LLM_FAKE (deterministic solver — verify: POST fix-rack, poll GET; if 204-forever on fake data, SKIP this leg and leave the vitest integration as AC6), click "Open in Listen rack", assert `fixes-applied-chip` visible on `listen-rack-page`. At-home visual list gets: chip in all 3 modes visually + audible result.
- [x] Task 8: Validation gates (all)
  - [x] BFF: `dotnet build && dotnet test` (stack up — 360+ expected).
  - [x] Frontend: `npx vite build`, `npx tsc -b`, `npm run lint` + `lint:css`, `npx vitest run`.
  - [x] Playwright smoke headless (`npx playwright test --reporter=line`) — must stay green even if Task 7's optional leg is skipped.
  - [x] No worker/python changes expected; if any, ruff + pytest.

## Dev Notes

### Verified code anchors (all against master @ 903423d)

- Sender: `FixRackPanel.tsx:48-50` (`openInListen`), rack from `useFixRack(jobId)` → `['fix-rack', jobId]` (hooks.ts:606); chain narrowed by `readFixChain` (`results/fix-rack-helpers.ts:17`) to `{ order, modules, masterBypass? }`.
- BFF: `FixRackEndpoints.cs:47-77` `GetFixRack` reads newest `RackPresets` row `Source=="analysis"`; `RackPresetDtos.cs` — `FixRackDto` has NO id today. `RackPresetEndpoints.cs:66-70` `ListPresets` user-only (comment L58-59: analysis rows "surface via their own audition flow" — the by-id endpoint IS that flow, don't widen the list).
- 11-2 precedent: `FeedbackEndpoints.cs:309-348` `AcceptSuggestion` forks a suggestion chain into `RackPreset(Source="user")` — pattern for owner-gated preset access + DTO reuse.
- Receiver: `listen-rack.$versionId.tsx:30-71` (no validateSearch; props spread at 61-65; `ListenRackPageProps` at ListenRackPage.tsx:136-156). Draft restore: ListenRackPage.tsx:250-267 (`draftRestored` gate; autosave 267 armed by it). Graph: `useAudioGraph` frozen identity; pushes no-op until `ensureContext()` (rackBindings.ts:77-82); first-play sync `togglePlay` L610-614. Pitch hazard: `rs.mod.pitch` + pitch effect L481-528. All-modes header: `TrackHeader` L56-92 rendered at ~L660. Capabilities: `resolveCapabilities` → `cap.rackReadOnly` (L636-637).
- Overlay path: `useFixOverlay.ts:34-37` (`applyRackMod(composeRack(ops))`), `applyRackMod` rackState.ts:106-109 (replaces WHOLE mod map — overlay must merge before calling), `composeRack` fixToRackPatch.ts:76-96 (`freshDefaults()` bug), mapping table fixToRackPatch.ts:29-59 (peaking/shelves/pass→eq bands; limiter/comp/trim/ms; DEFAULT→leftover). `isApplyable` L64-67. `buildListenFixes` listenFixes.ts:33-48 (the silent drop).
- validateSearch idioms: hand-rolled `_app` sibling `songs.$songId.results.$jobId.tsx:16-35` (+ `navigate({ search: (prev)=>..., replace: true })` for param clear); zod+sanitize `register.tsx:15-37`. Chain validator to reuse: `asChain` useRackPresets.ts:38-48.
- Preset recall path (for reference, NOT the carry mechanism — it replaces the whole mod): `onRecallRackPreset` ListenRackPage.tsx:277-291.
- Tests to extend: `fixToRackPatch.test.ts` (composeRack), `useFixOverlay.test.tsx` (renderHook + `applyRackMod = vi.fn()`), `rail.plan.test.tsx` (fake `rs` cast pattern + `writeListenFixes` seeding), `RackPresetEndpointsTests.cs`. NO ListenRackPage render test exists (Web Audio) — don't try to mount the whole page in jsdom; test the apply seam.
- 12-7 smoke: final leg L107-114 + `data-testid="listen-rack-page"` (ListenRackPage.tsx:655).

### Design decisions

- **Carrier = preset id in URL search param (`?fixPreset=<uuid>`)**, not an inlined chain: the chain already lives server-side as the analysis `RackPreset`; a uuid param survives refresh/back cheaply, can't hit URL length limits, and can't be tampered into an arbitrary chain payload. Server round-trip validates ownership.
- **Param NOT cleared on apply** — AC1 requires refresh/back survival. The chip's reset clears it. One-shot-per-mount ref prevents double-apply within a mount.
- **Carried chain applies as an OVERLAY onto live mod (pitch preserved)**, not `recallPreset` (which swaps the whole map). Fresh page load → live mod is defaults anyway → identical result; but back-navigation with tweaks keeps the tweaks.
- **Draft-restore skip (not race)**: presence of `fixPreset` disables the draft-restore effect body and arms autosave — carried chain deterministically becomes the new draft.
- **AC6 primary = vitest integration with real rackState + fake bindings**; Playwright leg is conditional on the solver producing a rack under LLM_FAKE (verify at dev time; don't build a flaky e2e).

### Constraints & gotchas

- NO visible windows (standing rule): Playwright headless only; services as background processes; worker venv `%TEMP%\spectr-lock-venv`, `LLM_FAKE=1`.
- `verbatimModuleSyntax`: `import type` for types. CSS Modules + global `.pill` — no inline styles unless dynamic.
- `useAudioGraph` handle identity is frozen (`useMemo` `[]`) — safe as effect dep; `graph.context` getter exists if readiness must be checked, but React-state apply + first-play sync is the established pattern.
- `pushFullRack` before `ensureContext()` no-ops silently BY DESIGN — do not "fix".
- Worker `preset_compiler.py` mirrors the op→module mapping — mapping unchanged in this story; compose/overlay behavior is frontend-only.
- BFF exe file-lock on Windows: stop running BFF before `dotnet build`. Known BFF flakes: CoachStream, DispatchReference/CoachProMonthlyCap pairs, Concurrent_Posts_Converge (12-6 fixes it — rerun, don't diagnose).
- New BFF tests: `[SkippableFact]` + `await TestDb.RequireAsync(_factory)` (12-7 machinery); NEVER an early-return gate.
- `queryClient` invalidation: fix-rack query key is `['fix-rack', jobId]`; presets `['versions', v, 'rack', 'presets']` — by-id fetch should use its own key `['versions', v, 'rack', 'presets', presetId]`.

### Previous story intelligence (12-7)

- Playwright smoke exists + passing headless (16-26 s); registration retry pattern; diagnostics redact query strings — if extending the smoke, keep `?fixPreset` OUT of logged URLs (already redacted by the split).
- `AuthContext`/fetcher refresh unified single-flight — token rotation can re-mount `<audio>` on Listen (`?t=` in src memo); position tracking already handles it; carried-chain state lives in React, unaffected.
- Review lesson: sweep greps miss sibling patterns — when touching `listenFixes`/`useFixOverlay`, grep ALL call sites (`readListenFixes`, `writeListenFixes`, `isApplyable`) before changing shapes.

### Project Structure Notes

- Frontend edits under `features/listen-rack/`, `features/results/`, `routes/_app/`; BFF edits in `Endpoints/{FixRackEndpoints,RackPresetEndpoints}.cs` + `DTOs/RackPresetDtos.cs` + tests. No schema/migration (no new columns). No new top-level folders.

### References

- [Source: PRPs/epics.md — Epic 12, Story 12.4]
- [Source: output/audit/2026-07-10_full-app-audit/findings.md — P0-6, P1-7/8/9, Batch B]
- [Source: PRPs/stories/12-7-test-integrity-smoke-e2e-and-fail-loud-suites.md — smoke harness + test-gate machinery]
- [Source: components/frontend-spectr-v2/src/features/listen-rack/{fixToRackPatch,useFixOverlay,rail,ListenRackPage}.tsx — verified anchors above]
- [Source: components/bff/src/Spectr.Bff/Endpoints/{FixRackEndpoints,RackPresetEndpoints,FeedbackEndpoints}.cs]

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), dev-story workflow, 2026-07-13.

### Debug Log References

- listen-rack vitest slice: 124/124 after RTL cleanup fix (no auto-cleanup configured in this suite — accumulated renders broke multi-render tests; explicit `afterEach(cleanup)`).

### Completion Notes List

- **AC1**: `FixRackDto` gains `PresetId` (BFF had the row id all along); new `GET /versions/{v}/rack/presets/{presetId}` serves ANY source by id (owner-gated) — the "own audition flow" the ListPresets comment reserved. `ListPresets` untouched (user-only stays). Sender: `FixRackPanel.openInListen` passes `search: { fixPreset }` (falls back to plain navigate if the cached DTO predates the field). Route `validateSearch` narrows to uuid shape; server round-trip re-validates ownership.
- **AC2**: one-shot ref + `carryAllowed` gate (realAudio + not `rackReadOnly`). When a carry is inbound the draft GET is disabled and the restore effect short-circuits (`setDraftRestored(true)`) — carry deterministically wins, autosave then persists the carried chain as the new draft. Apply = `overlayChain(live, carried)` into `applyRackMod`; audible on first play via the existing `togglePlay` full sync (documented in code — no new graph-ready machinery).
- **AC3**: chip in `TrackHeader` (the only all-modes surface), `data-testid="fixes-applied-chip"`, N = carried chain's enabled-module count. Reset: `rs.reset()` + clear `?fixPreset` (`navigate replace`) + clear plan-tab applied ids. Param intentionally NOT cleared on apply (AC1 refresh/back survival).
- **AC4**: `composeRack(appliedOps, liveBase?)` — optional base, `pitch` never written (both in composeRack and the new `overlayChain`). `useFixOverlay` now captures the live mod as the fix-free BASELINE at first apply and restores it when everything unchecks — manual tweaks survive the whole overlay lifecycle. Worker `preset_compiler.py` untouched: the mirror covers op→module MAPPING only, which did not change.
- **AC5**: `buildListenFixes` keeps committed-but-unmappable fixes flagged `notApplicable`; `PlanPanel` renders them disabled with "not applicable in the rack — take it back to your DAW". Old persisted rows without the flag remain applyable (back-compat default).
- **AC6**: vitest integration (`__tests__/carryOver.test.tsx`) — REAL `useRackState` wired to a fake `RackGraphBindings` (the exact interface the audio graph satisfies): carried chain → `overlayChain` → `applyRackMod` → asserts React mod state, manual-tweak preservation, AND the push reaching the graph bindings. Chip render asserted in all 3 modes. **Optional Playwright leg SKIPPED as story-permitted**: whether the solver emits a non-empty rack for the 5 s synthetic tone under LLM_FAKE is unverifiable cheaply; the live-chip e2e goes to the at-home visual list.
- TrackHeader exported for the render test (module-private before).

### File List

- components/bff/src/Spectr.Bff/DTOs/RackPresetDtos.cs (modified — FixRackDto.PresetId)
- components/bff/src/Spectr.Bff/Endpoints/FixRackEndpoints.cs (modified — select Id, return PresetId)
- components/bff/src/Spectr.Bff/Endpoints/RackPresetEndpoints.cs (modified — GET /presets/{presetId})
- components/bff/tests/Spectr.Bff.Tests/RackPresetEndpointsTests.cs (modified — 3 by-id tests)
- components/frontend-spectr-v2/src/api/types.ts (modified — FixRackDto.presetId)
- components/frontend-spectr-v2/src/features/results/FixRackPanel.tsx (modified — carry search param)
- components/frontend-spectr-v2/src/routes/_app/listen-rack.$versionId.tsx (modified — validateSearch + prop)
- components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx (modified — carry apply, draft skip, chip, TrackHeader export)
- components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.ts (modified — composeRack base + overlayChain)
- components/frontend-spectr-v2/src/features/listen-rack/useFixOverlay.ts (modified — live baseline capture/restore)
- components/frontend-spectr-v2/src/features/listen-rack/listenFixes.ts (modified — notApplicable flag)
- components/frontend-spectr-v2/src/features/listen-rack/rail.tsx (modified — disabled NA rows + getLiveMod)
- components/frontend-spectr-v2/src/features/listen-rack/useRackPresets.ts (modified — useRackPreset by-id)
- components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.test.ts (modified)
- components/frontend-spectr-v2/src/features/listen-rack/useFixOverlay.test.tsx (modified)
- components/frontend-spectr-v2/src/features/listen-rack/listenFixes.test.ts (modified)
- components/frontend-spectr-v2/src/features/listen-rack/rail.plan.test.tsx (modified)
- components/frontend-spectr-v2/src/features/listen-rack/__tests__/carryOver.test.tsx (new)
- PRPs/sprint-status.yaml (status flips)
- PRPs/stories/12-4-fix-rack-to-listen-carry-over.md (this file)

## Senior Review Record (bmad-code-review, 2026-07-13)

Three-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) of `master..story/12-4-fix-rack-carry-over` (PR #42). Auditor: AC1–AC5 Met, AC6 Partial (route wiring untested). Patches applied on the story branch:

- **P1 (all 3 layers, HIGH — draft loss)**: autosave was armed the moment a carry was inbound, BEFORE the preset resolved — a slow/failed/malformed carry let the debounced autosave persist the DEFAULT chain over the user's saved draft. Reworked to a `carryPhase` state machine (`pending → applied|failed`): the draft machinery WAITS for settlement; a failed carry falls back to the normal draft restore (draft never sacrificed); failures surface a toast (no more silent consumption).
- **P2 (HIGH — re-entry dead)**: the one-shot ref never reset, so back-nav restoring `?fixPreset` or re-clicking "Open in Listen rack" on the mounted route applied nothing. One-shot now keys on the preset id (`appliedPresetRef`) and re-arms when the param value changes. Carry eligibility is LATCHED at arrival (`carryArmedRef`) so a mid-flight mode switch / SSE rack-revoke can't strand the page with neither draft nor carry.
- **P3 (MED — PlanPanel desync)**: chip reset wrote localStorage behind `useFixOverlay`'s back — mounted checkboxes stayed checked and the next toggle re-applied "reset" fixes from stale state. New `clearFixOverlay(versionId)` seam (window event) — the hook clears applied ids + baseline in lockstep.
- **P4 (MED — overlay semantics)**: a compiled analysis chain enumerates EVERY module; spreading disabled entries wiped manual tweaks, making "overlay" vacuous. `overlayChain` now merges only ENABLED carried modules. Chip N counts enabled non-pitch modules (was: including pitch, which is never applied). An all-disabled/malformed chain now applies NOTHING (previously could silently masterBypass-mute the rack with no chip).
- **P5 (MED)**: `composeRack` EQ slot allocation crashes/no-ops when a drifted live base lacks `eq.bands` — falls back to default slots.
- **P6 (MED)**: stale applied-ids referencing now-`notApplicable` fixes no longer flow into recompute (`byId` excludes NA fixes).
- **P7**: `FixRackDto.presetId` typed optional (the code's stale-cache guard now matches the type); foreign-user 404 BFF test re-seeded with the ANALYSIS-source row (the IDOR-relevant combination); reset preserves future search params (delete-key reducer, not `search: {}`); carryOver test cleanup + fake graph typed without `as never`; new `listenRackSearch.test.ts` covers the route's uuid narrowing (shrinks the AC6 wiring gap).
- **Accepted (documented)**: carried `chain.order` intentionally NOT applied (overlay preserves live insert order; server-compiled order is a preset-recall concern); mid-overlay manual tweaks revert on final uncheck (baseline-restore semantics, strictly better than the pre-story defaults-wipe); mode-flip AFTER arrival honors the arrival-time carry decision; chip stays scoped to carried fixes (AC3 letter — plan-overlay chip is a follow-on polish); `useNavigate` in the page body (page is always router-mounted).

Gates after patches: BFF full suite green (see below), vitest 754/754 (+6 review tests), tsc/lint clean, smoke re-run PASSED headless.

## Change Log

- 2026-07-13: Story created (create-story workflow) — dual-scout code recon; carrier design settled on server-side preset id (analysis RackPreset already persisted, id just not surfaced).
