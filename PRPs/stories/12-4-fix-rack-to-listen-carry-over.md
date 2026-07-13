# Story 12.4: Fix Rack → Listen Carry-Over (Reliable Handoff)

Status: ready-for-dev

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

- [ ] Task 1: Surface the analysis preset id (BFF) (AC: 1)
  - [ ] `FixRackDto` gains `PresetId` (Guid): `record FixRackDto(Guid PresetId, string Name, JsonElement Chain, DateTimeOffset CreatedAt)` — `GetFixRack` already has the row.
  - [ ] New endpoint `GET /versions/{versionId:guid}/rack/presets/{presetId:guid}` in `RackPresetEndpoints.cs` — owner-gated (same tracked-lookup join as siblings), returns `RackPresetDto` for ANY source (`user`/`coach`/`analysis`), 404 unknown/foreign. Do NOT widen `ListPresets` (its user-only filter is a deliberate 11-2 decision).
  - [ ] BFF tests: fetch-by-id happy path (analysis source), foreign-user 404, unknown id 404. `[SkippableFact]` + `TestDb.RequireAsync` (12-7 pattern).
- [ ] Task 2: Carry param on the sender (AC: 1)
  - [ ] Frontend `FixRackDto` type gains `presetId`; `FixRackPanel.openInListen` → `navigate({ to: '/listen-rack/$versionId', params: { versionId }, search: { fixPreset: rack.presetId } })`.
  - [ ] Disabled state unchanged (`!versionId`); if `presetId` missing (stale cache), fall back to plain navigate (never block).
- [ ] Task 3: Receive + one-shot apply on Listen (AC: 1, 2)
  - [ ] `listen-rack.$versionId.tsx`: add `validateSearch` narrowing `{ fixPreset?: string }` (uuid-shape check, else drop — results-route hand-rolled idiom). Pass `fixPreset` into `ListenRackPage` as a new optional prop.
  - [ ] `ListenRackPage`: fetch the preset via the new by-id endpoint (TanStack Query, enabled when `fixPreset && realAudio`); validate with existing `asChain` (`useRackPresets.ts:38-48`).
  - [ ] One-shot apply via ref flag (mirror `draftRestored` pattern, ListenRackPage.tsx:254): when chain resolves, `rs.applyRackMod(composeRack from carried chain overlaid on live mod)` — see Task 4 — and `rs.setMasterBypass(chain.masterBypass)`. Applying into React state is sufficient for "after graph ready": live pushes no-op until `ensureContext()` and first-play `togglePlay` does `pushFullRack` from `rsRef` (ListenRackPage.tsx:610-614) — document this in code.
  - [ ] Carry-over wins over draft restore: when `fixPreset` param present, SKIP the draft-restore effect body and still `setDraftRestored(true)` (arms autosave so the carried chain persists as the new draft). Deterministic, no race.
  - [ ] Do NOT clear the param after apply (AC1 "survives refresh and back" — refresh re-applies, idempotent). The chip's reset action clears it (Task 5).
  - [ ] Read-only modes (`cap.rackReadOnly` — View/Room guest): do not apply; chip not shown. Owner navigating from their own report is always work/view-capable.
- [ ] Task 4: composeRack overlay (AC: 4)
  - [ ] `composeRack(appliedOps, base?: Record<string, ModuleState>)` — optional base (default `freshDefaults()`, backward compatible); deep-clone base, never touch `base.pitch`, EQ band allocation works against base's bands.
  - [ ] `useFixOverlay.recompute` passes a clone of live `rs.mod` as base (rs already in scope via caller).
  - [ ] Carried-preset apply path (Task 3): the carried chain is a full `Chain` (not ops) — merge it module-by-module onto live mod PRESERVING `pitch` (helper `overlayChain(live, carried)` in `fixToRackPatch.ts` or `chain.ts`; same pitch rule).
  - [ ] Note: worker `preset_compiler.py` mirror governs op→module MAPPING only — unchanged here; no worker edit. State this in completion notes.
  - [ ] Unit tests in `fixToRackPatch.test.ts`: base overlay preserves a manually-tweaked module param; `pitch` never modified even when base has pitch enabled; default-arg behavior byte-identical to today (existing tests keep passing).
- [ ] Task 5: "Fixes applied" chip in every mode (AC: 3)
  - [ ] Chip in `TrackHeader` (ListenRackPage.tsx:56-92, rendered unconditionally at ~L660 — the only all-modes surface). `data-testid="fixes-applied-chip"`. Text `Fixes applied: N — reset` using global `.pill` utility.
  - [ ] N = carried-chain enabled-module count (preset path) or applied-fix count (`useFixOverlay` path). Page-level state fed by both apply paths.
  - [ ] Reset: `rs.reset()` (or re-apply draft-free defaults), clear `fixPreset` via `navigate({ search: (prev) => ({ ...prev, fixPreset: undefined }), replace: true })`, clear the fix-overlay applied set (localStorage state via `useFixOverlay`'s clear), hide chip.
  - [ ] Vitest static render: chip visible in all three `ModeId`s given applied state; hidden when N=0.
- [ ] Task 6: Never silently drop unmapped fixes (AC: 5)
  - [ ] `buildListenFixes` (listenFixes.ts): include committed fixes whose ops are not applyable, flagged `notApplicable: true` (type gains the field), instead of filtering them out.
  - [ ] `PlanPanel` (rail.tsx): `notApplicable` rows render disabled with copy "not applicable in the rack" (checkbox disabled, muted). `useFixOverlay` ignores them.
  - [ ] Unit tests: `buildListenFixes` keeps a sidechain-only fix flagged; PlanPanel renders it disabled (extend `rail.plan.test.tsx`).
- [ ] Task 7: Integration test (AC: 6)
  - [ ] Vitest integration: real `useRackState` wired to a FAKE `RackGraphBindings` (5-method interface, rackBindings.ts:21-27) recording `pushFullRack` — mount the carry-apply hook/component with a carried chain and assert the chain reaches (a) `rs.mod` and (b) the recorded graph push on first-play sync. ("Through the real graph handle" = real rackState + real bindings interface, fake node layer.)
  - [ ] Playwright (only if cheap): extend `smoke-first-run.spec.ts` — on the report, if the fix-rack generates under LLM_FAKE (deterministic solver — verify: POST fix-rack, poll GET; if 204-forever on fake data, SKIP this leg and leave the vitest integration as AC6), click "Open in Listen rack", assert `fixes-applied-chip` visible on `listen-rack-page`. At-home visual list gets: chip in all 3 modes visually + audible result.
- [ ] Task 8: Validation gates (all)
  - [ ] BFF: `dotnet build && dotnet test` (stack up — 360+ expected).
  - [ ] Frontend: `npx vite build`, `npx tsc -b`, `npm run lint` + `lint:css`, `npx vitest run`.
  - [ ] Playwright smoke headless (`npx playwright test --reporter=line`) — must stay green even if Task 7's optional leg is skipped.
  - [ ] No worker/python changes expected; if any, ruff + pytest.

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

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-07-13: Story created (create-story workflow) — dual-scout code recon; carrier design settled on server-side preset id (analysis RackPreset already persisted, id just not surfaced).
