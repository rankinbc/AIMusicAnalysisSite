# Story 11.12: Fork-to-Suggest & Suggestion Audition

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Propose-side completion of 11.2 (accept-side) + the 11.2 deferred audition. Reopens Epic 11. -->

## Story

As a producer reviewing someone else's track in View mode,
I want to fork the read-only rack into an editable draft, shape a fix I can hear, and submit it as a suggestion,
So that the owner receives a concrete, audition-able rack chain instead of a text comment — and can adopt it as a preset in one click (11.2 accept-side, already shipped).

## Acceptance Criteria

1. **Given** View mode with `access.gates.canSuggest`, **Then** a real "Fork to suggest" affordance exists at BOTH existing seams — the read-only rack badge (`ListenRackPage.tsx:876`, currently static "READ-ONLY · FORK TO SUGGEST" text) and the comments-panel teaser (`rail.tsx:748`, currently a dead promise) — and **Given** `canSuggest` is false, **Then** neither affordance renders (badge falls back to plain "READ-ONLY").
2. **Given** I engage fork, **Then** the rack becomes locally editable AND audible (knob moves apply to the live graph so I hear my draft), a visible suggest-mode chip renders with Submit + Discard, and NO server write happens until Submit. Mode stays `view`; `capabilities.ts` is untouched (fork is page-local state that bypasses the `pointerEvents:none` overlay, not a capability change).
3. **Given** Submit, **Then** the draft chain posts via the existing `useCreateSuggestion(versionId)` (`POST /versions/{id}/suggestions`, `{ chain }` — never a new endpoint), the new card appears in the "Suggested fixes" section (query invalidation is already wired in the hook), the rack restores to the exact pre-fork chain, and a success toast fires.
4. **Given** Discard — or leaving fork mode by mode-switch or unmount — **Then** the pre-fork chain is fully restored (order, per-module params/enabled, masterBypass; pitch mode untouched) with no residue on the live graph.
5. **Given** a `SuggestionCard` rendered where the page audio graph is available, **Then** an Audition button non-destructively previews the proposed chain on the live graph via the existing `auditionSuggestion` and a Revert restores the pre-audition chain. No status write (there is no audition endpoint; the `'auditioned'` status value stays server-side unused — do not invent one).
6. **Given** the anon share page `/v/{token}`, **Then** the "suggestions open" pill no longer advertises a capability that page has no UI for (honest-UI rule from 12-5): drop the `canSuggest` pill from `AnonGatePills`. Anon suggest UI is explicitly OUT OF SCOPE (see Dev Notes) — the backend route stays.
7. **Given** fork mode with playback paused, **Then** the suggest-mode chip nudges "press play to hear your draft" (copy swaps once playing) — a reviewer should never suggest a chain they haven't heard.
8. **Given** fork mode, **Then** an A/B toggle lets the reviewer flip between the pre-fork chain and their draft (apply `forkSnapshot` / re-apply a held draft clone). This is original-vs-draft — NOT `masterBypass` (that's dry-vs-rack, a different comparison). While in "A" (original), rack edits are blocked or auto-flip back to "B" — no editing the original by accident.
9. **Given** a `SuggestionCard`, **Then** an expandable "moves" section renders the chain as human-readable mix moves via a pure `chainToMoves(chain): string[]` helper (e.g. "cut 2.1 dB @ 120 Hz", "comp 3:1 @ -18 dB", "width 115%") — drift-tolerant like `chainSummary` (returns [] on malformed chain). This is the owner's "what do I do in my DAW" answer; real preset export stays backlog.
10. **Given** the suite runs, **Then** new tests cover: fork-affordance gating (AC1), snapshot/restore round-trip (AC4, pure helper test), submit payload shape (AC3), audition apply/revert (AC5), the AnonGatePills change (AC6), A/B flip-and-edit guard (AC8), and `chainToMoves` formatting incl. malformed input (AC9). All four frontend gates green (`tsc --noEmit`, `lint --max-warnings 0`, `build`, `vitest run`).

## Context — what already exists (reuse, do not rebuild)

> ⚠️ **Verify before building** (11.2 lesson): grep the real render path first. Everything below was verified against code 2026-07-14.

**Backend — COMPLETE, zero changes needed:**
- `FeedbackEndpoints.cs:268` `PostSuggestionAuthed` → `InsertSuggestion` (`:172`): validates `access.Gates.CanSuggest` (403 `suggest_forbidden`), requires `chain` to be a JSON object (400), stamps actor, optional `commentId` bidirectional link, live-Room session provenance (D4.3). Anon variant `PostSuggestionAnon` (`:418`) is rate-limited and token-scoped.
- Accept-side (11.2, shipped): `AcceptSuggestion` (`:309`) forks a `RackPreset` named "From {proposer}" with credit chain; `SuggestionCard` Accept/Reject buttons live.

**Frontend hooks — COMPLETE, zero UI callers (this story wires them):**
- `features/listen/useSuggestions.ts` — `useCreateSuggestion(versionId)` (`:27`), `usePostAnonSuggestion(token)` (`:59`, stays unused — AC6), `auditionSuggestion(graph, sg)` (`:68`, wraps `applyChainToGraph`).
- `CreateSuggestionRequest` (`api/types.ts:513`): `{ commentId?, chain, fromDisplayName?, sessionId? }`. Authed submit sends `{ chain }` only — server resolves the actor; `sessionId` is the Room grantee path, not this story.

**Page plumbing (all anchors verified):**
- `rs = useRackState(...)` at `ListenRackPage.tsx:242`; full `RackState` surface at `rackState.ts:28-51` (`mod`, `order`, `masterBypass`, `setParam`, `setEnabled`, `setEqBands`, `setOrder`, `setMasterBypass`, `applyRackMod`, `reset`).
- `currentChain` memo at `ListenRackPage.tsx:251-254` — `{ order: rs.order, modules: rs.mod, masterBypass: rs.masterBypass }`. Same shape preset-save posts (`useSaveRackPreset`, `useRackPresets.ts:97`) and the server stores. **This is the submit payload — no new serializer.**
- Full `AudioGraphHandle` at `ListenRackPage.tsx:190` (`const graph = useAudioGraph(audioRef)`). NOT currently passed to the rail — `RightRail` props (`rail.tsx:764-782`) receive `rs` only; `CommentsPanel` (`rail.tsx:614-620`) receives neither.
- Read-only gate is ONLY the `pointerEvents:'none'` wrapper at `ListenRackPage.tsx:869-879`; `InlineRack` has no per-knob disabled prop. Fork = conditionally lift that wrapper.
- Chain apply/restore primitives: `applyChainToGraph(graph, chain)` (`chainApply.ts:37`), `snapshotChainFromGraph` (`chainApply.ts:61`), `overlayChain(live, carried)` (`fixToRackPatch.ts:80`, 12-4's overlay). 12-4's carry seam (`ListenRackPage.tsx:338-365`) shows the applyRackMod + setMasterBypass idiom.

## Tasks / Subtasks

- [x] **Task 1: Fork-mode state machine on ListenRackPage (AC: 2, 4)**
  - [x] 1.1 Add page-local fork state: `forkSnapshot: Chain | null` (null = not forked). Entering fork captures `currentChain` **deep-cloned** (`structuredClone` — `rs.mod` is mutated in place by `applyRackMod`-style merges; a shallow ref would alias the live state and make restore a no-op).
  - [x] 1.2 While forked in View mode, render `InlineRack` WITHOUT the `pointerEvents:none` wrapper (`:869-879`) so edits hit `rs` → live graph. Everything else about View stays (mode, rail tabs, capabilities).
  - [x] 1.3 Restore helper (pure, testable — put in `fixToRackPatch.ts` or a new `suggest-draft.ts` next to it): given `rs` + snapshot, reapply `order` (`rs.setOrder`), full module map (`rs.applyRackMod` with the snapshot's modules — includes disabled ones, unlike `overlayChain`; verify `applyRackMod` merge semantics restore `enabled:false` states, else use `setParam`/`setEnabled` per module), `masterBypass` (`rs.setMasterBypass`). Pitch mode never touched (12-4 rule).
  - [x] 1.4 Exit paths all restore: Discard button, mode switch away from `view` (effect on mode change), component unmount is acceptable-lossy (graph dies with the page) but clear the state.
- [x] **Task 2: Affordances (AC: 1)**
  - [x] 2.1 Read-only badge (`ListenRackPage.tsx:876`): when `cap.canSuggest && mode === 'view'`, the "FORK TO SUGGEST" fragment becomes a button engaging fork. Without `canSuggest`, plain "READ-ONLY".
  - [x] 2.2 Rail teaser (`rail.tsx:748`): replace the dead sentence with an actionable "Fork the rack & suggest a chain" button. `CommentsPanel` doesn't hold page state — thread an `onForkToSuggest?: () => void` callback down `RightRail` → `CommentsPanel` (same pattern as existing `onSeek`). Hidden when callback undefined or `!gates.canSuggest`.
  - [x] 2.3 Suggest-mode chip (near the carried-fixes chip idiom from 12-4 in `TrackHeader` or adjacent): "SUGGESTING — edit the rack, then Submit" + Submit + Discard buttons.
  - [x] 2.4 Play nudge (AC: 7): when forked and `!playing`, chip copy reads "press play to hear your draft"; swaps to the normal copy on play. Reuse the page's existing `playing` state — no new listeners.
  - [x] 2.5 A/B toggle (AC: 8): chip gains an A/B button. State: `abSide: 'draft' | 'original'`. Flipping to A clones the current draft (`structuredClone(currentChain)`) into a `draftHold` ref, restores `forkSnapshot`; flipping back re-applies `draftHold`. Any rack edit while on A auto-flips to B first (or block edits — pick one, test it). Submit always posts the DRAFT, regardless of which side is audible — flip to B on Submit if needed.
- [x] **Task 3: Submit (AC: 3)**
  - [x] 3.1 Wire `useCreateSuggestion(versionId)` on the page (page owns versionId + chain; the mutation's `onSuccess` already invalidates `['versions',v,'suggestions']`). Submit posts `{ chain: <deep-cloned currentChain at submit time> }`.
  - [x] 3.2 On success: restore pre-fork chain (Task 1.3), exit fork, `toast.success('Suggestion sent to the owner')` (Sonner, existing pattern). On error: stay in fork (don't lose the reviewer's work), `toast.error` with the envelope message (`suggest_forbidden` → "Suggestions aren't allowed here").
- [x] **Task 4: Audition on SuggestionCard (AC: 5)** — the 11.2 deferral, wiring plan already in `PRPs/deferred-work.md:95`
  - [x] 4.1 Thread `onAudition?: (sg: SuggestionDto) => void` + `auditioning: boolean` (or auditioned-suggestion-id) from `ListenRackPage` → `RightRail` → `CommentsPanel` → `SuggestionCard`. Page implements it: snapshot current chain (same deep-clone helper), `auditionSuggestion(graph, sg)`, Revert restores. One audition at a time; auditioning a second suggestion reverts the first snapshot chain, then snapshots ONCE (keep the ORIGINAL pre-audition snapshot — never snapshot an already-auditioned state).
  - [x] 4.2 Button renders only when the callback is provided (card is also used in contexts without a graph). Type note: `auditionSuggestion` demands the full `AudioGraphHandle` — the page has it (`:190`); do NOT try to pass `rs.graph` (the 5-method `RackGraphBindings` slice fails the type).
  - [x] 4.3 Audition + fork interplay: engaging audition while forked is disallowed (disable button with title "Finish your suggestion first") — two overlapping snapshots corrupt restore.
  - [x] 4.4 No status write. `'auditioned'` stays a dormant enum value.
- [x] **Task 5: Anon pill honesty (AC: 6)**
  - [x] 5.1 `AnonReviewerSurface.tsx:13`: remove the `canSuggest` pill (and the `!gates.canSuggest` term in the "listen only" fallback at `:15`). Update `anon-reviewer-surface.test.tsx` accordingly.
- [x] **Task 5b: Readable move list (AC: 9)**
  - [x] 5b.1 Pure `chainToMoves(chain: unknown): string[]` in `features/listen/suggestion-helpers.ts` (sibling of `chainSummary`, same drift-tolerant narrowing idiom — `asChain`-style guard, [] on malformed). Format per module type from `ModuleState` params: EQ per active band ("cut 2.1 dB @ 120 Hz" / "boost …"), comp ("comp 3:1 @ -18 dB"), sat ("saturation 20%"), width ("width 115%"). Skip disabled modules and no-op params (0 dB band = omit). Round display values; keep the raw chain untouched.
  - [x] 5b.2 `SuggestionCard`: collapsed by default, "show moves" expander under the chain chips rendering the list. No graph needed — pure render, works everywhere the card mounts.
- [x] **Task 6: Tests (AC: 10)**
  - [x] 6.1 Pure: snapshot/restore round-trip (fork → mutate modules/order/bypass → restore → deep-equal original); disabled-module restore case (the `overlayChain` skip-disabled trap); `chainToMoves` formatting + malformed-chain [] + disabled-module skip.
  - [x] 6.2 Render: fork affordances gated on `canSuggest` (both seams); suggest-mode chip Submit/Discard + paused-nudge copy; A/B flip guard (edit on A auto-flips or blocks; Submit posts draft from either side); SuggestionCard Audition button present with callback + hidden without + disabled-while-forked; moves expander.
  - [x] 6.3 Submit: mock fetcher, assert `POST /versions/{id}/suggestions` body is `{ chain: {order, modules, masterBypass} }`; error path keeps fork mode.
  - [x] 6.4 Existing suites stay green — `carryOver.test.tsx` and `CommentsPanel.test.tsx` touch the same files; run them first after wiring props.
- [x] **Task 7: Gates + docs**
  - [x] 7.1 All four frontend gates. No BFF/worker changes expected → no dotnet/pytest reruns needed unless files touched.
  - [x] 7.2 Strike the audition entry from `PRPs/deferred-work.md` (11.2 section, line ~95) — done by this story. Add any new deferrals (anon suggest UI) there under this story's heading.

## Dev Notes

- **No backend changes.** The server already validates gates, chain shape, comment link, provenance. If you think you need a new endpoint, re-read `FeedbackEndpoints.cs:172-266`.
- **Scope decision — anon suggest UI is OUT.** `/v/{token}` has no audio graph and no rack (plain `<audio>`, `v.$token.tsx:155`); building fork-to-suggest there means mounting a rack from scratch for anons. Not worth it now; the authed View mode is the flow. AC6 makes the anon page honest instead. `usePostAnonSuggestion` + the anon POST route stay for a future story.
- **Deep-clone discipline is the whole game.** `rs.mod` is a live mutable map; every snapshot (fork entry, audition entry, submit payload) must be `structuredClone`d or JSON-cloned at capture time. The known failure mode: shallow snapshot → edit knobs → "restore" restores the edited object → reviewer's draft silently becomes the owner-visible rack state.
- **Draft strategy: edit the live rack, restore on exit** — NOT a second `useRackState` instance. A parallel instance would need its own graph bindings (the audible preview is the point) and duplicates the meter/rAF machinery. The snapshot/restore approach reuses everything and matches how 12-4's carry-over + PlanPanel's `useFixOverlay` (`rail.tsx:546-553`) already treat `rs` as the single source.
- **Restore must handle disabled modules.** `overlayChain` (`fixToRackPatch.ts:80`) deliberately skips disabled modules — correct for carry-over, WRONG for restore. Write the restore against the full snapshot (see Task 1.3).
- **View-mode owner nuance:** the owner in View mode also has `gates.canSuggest` (MOCK_ACCESS all-true; real access may too). Suggesting on your own track is harmless (you'd see your own card + could accept it) — do not special-case; server permits it.
- **Access reality check:** `useRoomOrchestration.ts:70` falls back to `MOCK_ACCESS` when the real `GET /access` response is absent, so in dev everything is grant-all. Gate rendering on the resolved `access`/`cap` objects (as the code already does) and the wiring is correct whenever real access lands.
- **12-4 interplay:** carried-fix overlay (`?fixPreset=`) applies on the owner's Work-mode entry. Fork-to-suggest is View mode; they shouldn't co-occur, but the fork snapshot is taken from whatever the rack currently holds — which is correct by definition (restore returns to what the reviewer saw).
- **Headless-only verification** (standing rule): vitest + tsc + lint + build; if the Playwright smoke is extended (optional — fork→submit→card appears is a nice add), `--headed=false` only, against the compose stack + venv worker (`%TEMP%\spectr-lock-venv`, `LLM_FAKE=1`). Visual feel goes on the at-home checklist.
- **File size guardrail:** `ListenRackPage.tsx` and `rail.tsx` are both already large; put pure helpers (snapshot/restore, clone) in a separate module, not inline.
- **Explicitly deferred (record in `deferred-work.md` under this story):** suggestion diff view (needs the forked-from base chain stored — payload/design question, not code); sessionStorage draft persistence (interacts badly with the restore state machine); DAW preset export (.adv/.als — real project, `preset_compiler.py` is the eventual bridge; `chainToMoves` is the v1 stand-in); anon suggest UI on `/v/{token}`; per-reviewer suggestion caps (deliberately skipped — low user count, revisit at scale).

### Project Structure Notes

- New pure helpers → `components/frontend-spectr-v2/src/features/listen-rack/suggest-draft.ts` (+ `__tests__/suggest-draft.test.ts`) — sibling of `fixToRackPatch.ts`, same idiom.
- Component edits: `ListenRackPage.tsx`, `rail.tsx` (RightRail props + CommentsPanel teaser), `features/listen/SuggestionCard.tsx` (+ its test), `features/listen/AnonReviewerSurface.tsx` (+ test).
- No new routes, no new endpoints, no migrations.

### References

- AC source: this story (net-new, propose-side of `PRPs/epics.md` Story 11.2; epics.md Story 11.12 added with this file).
- Prior art: `PRPs/stories/11-2-reviewer-rack-suggestions-and-accept-to-preset.md` (accept-side + why audition was deferred), `PRPs/stories/12-4-fix-rack-to-listen-carry-over.md` (chain-apply state-machine patterns, deep-clone + one-shot lessons), `PRPs/deferred-work.md:93-95` (audition wiring plan).
- Anchors: `FeedbackEndpoints.cs:172/268/309/418`, `useSuggestions.ts:27/59/68`, `api/types.ts:500-520`, `ListenRackPage.tsx:190/242/251/338-365/869-879`, `rackState.ts:28-51`, `rail.tsx:614-620/748/764-782`, `chainApply.ts:37/61`, `fixToRackPatch.ts:80`, `capabilities.ts:69-76`, `AnonReviewerSurface.tsx:9-20`, `useRackPresets.ts:97`.

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-story workflow)

### Debug Log References

- Verify-before-build confirmed the story's anchors: `useCreateSuggestion`/`usePostAnonSuggestion` had zero UI callers; the rail teaser (`rail.tsx:748`) and the read-only badge "FORK TO SUGGEST" fragment (`ListenRackPage.tsx:876`) were both inert text.
- `recallPreset` turned out to be the correct restore primitive (pushFullRack + full module-map replace, clones its input) — the same path the 12-4 draft restore uses — so `restoreRack` wraps it instead of a hand-rolled per-module reapply. Disabled modules restore correctly (test-pinned).

### Completion Notes List

- **DEVIATION (AC5): audition does NOT use `auditionSuggestion(graph, sg)`.** That helper applied the chain to the graph only — the rack knob UI would keep showing stale values, and the next knob move would push those stale values back into the graph (silent desync). Audition instead goes through the new `applySuggestionChain(rs, base, chain)` (suggest-draft.ts): merges the possibly-partial chain onto the pre-audition snapshot and applies via `rs.recallPreset`, keeping React state and the audio graph in lockstep. The now-orphaned `auditionSuggestion` was deleted (12-5 dead-code rule) with a pointer comment left in `useSuggestions.ts`. AC5's substance (non-destructive preview + Revert, no status write) is fully met.
- Fork state machine: `forkSnapshotRef` (deep clone at fork entry) + `draftHoldRef` (deep clone parked while A/B'ing the original) + `abSide`. Edits on the A side are BLOCKED (read-only overlay with "ORIGINAL (A) — FLIP BACK TO EDIT" badge) — the AC8 "block or auto-flip" choice; blocking is simpler and test-pinned. Submit always posts the draft (pulls `draftHoldRef` when on A).
- Engaging fork auto-reverts any active audition first, so the fork snapshot captures the reviewer's real baseline — the overlapping-snapshot corruption the story warned about is structurally impossible (fork reverts audition; audition is disabled while forked).
- Submit error path keeps the fork open (draft survives a failed POST); success restores the pre-fork chain, exits fork, toasts. Mode-switch away from `view` restores + exits via effect.
- `chainToMoves` formats EQ (per-band cut/boost/shelf/pass), comp, limiter, trim, ms (width/mono-below/full-mono), sat, gate specifically; creative modules render "<Module> on". Disabled modules, no-op params (0 dB bands, gain 0, ratio ≤ 1), and `pitch` are skipped. Drift ids (moduled but unordered) append after the ordered ones.
- Anon `/v/{token}`: `canSuggest` pill removed; a suggest-only grant now honestly renders "listen only".
- Gates: `tsc --noEmit` clean, `lint --max-warnings 0` clean, `build` ✓, vitest **772/772** (baseline 748 + 24 new/extended). No BFF/worker files touched — dotnet/pytest not re-run per story scope.

### File List

- `components/frontend-spectr-v2/src/features/listen-rack/suggest-draft.ts` (A — snapshotRack/restoreRack/chainFromSnapshot/applySuggestionChain)
- `components/frontend-spectr-v2/src/features/listen-rack/__tests__/suggest-draft.test.ts` (A — 8 tests)
- `components/frontend-spectr-v2/src/features/listen-rack/SuggestModeChip.tsx` (A)
- `components/frontend-spectr-v2/src/features/listen-rack/__tests__/SuggestModeChip.test.tsx` (A — 4 tests)
- `components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx` (M — fork/A-B/audition state machine, badge button, chip, rail seams)
- `components/frontend-spectr-v2/src/features/listen-rack/rail.tsx` (M — RightRail/CommentsPanel fork + audition seams; teaser → real button)
- `components/frontend-spectr-v2/src/features/listen-rack/__tests__/CommentsPanel.test.tsx` (M — fork-button gating test)
- `components/frontend-spectr-v2/src/features/listen/SuggestionCard.tsx` (M — Audition/Revert seam, moves expander)
- `components/frontend-spectr-v2/src/features/listen/__tests__/SuggestionCard.test.tsx` (M — 5 new tests)
- `components/frontend-spectr-v2/src/features/listen/suggestion-helpers.ts` (M — chainToMoves)
- `components/frontend-spectr-v2/src/features/listen/__tests__/suggestion-helpers.test.ts` (M — 4 new tests)
- `components/frontend-spectr-v2/src/features/listen/useSuggestions.ts` (M — auditionSuggestion retired)
- `components/frontend-spectr-v2/src/features/listen/__tests__/useSuggestions.test.tsx` (A — submit payload contract, 2 tests)
- `components/frontend-spectr-v2/src/features/listen/AnonReviewerSurface.tsx` (M — canSuggest pill removed)
- `components/frontend-spectr-v2/src/features/listen/__tests__/anon-reviewer-surface.test.tsx` (M — matrix updated + AC6 test)
- `PRPs/deferred-work.md` (M — 11.2 audition struck; 11.12 deferrals added)
- `PRPs/sprint-status.yaml` (M — status flips)
- `PRPs/epics.md` (M — Story 11.12 section, from create-story)
- `PRPs/stories/11-12-fork-to-suggest-and-suggestion-audition.md` (M — this file)

### Change Log

- 2026-07-14 — Story 11.12 implemented: fork-to-suggest in View mode (snapshot/restore state machine, A/B original-vs-draft with blocked-original editing, play nudge, submit via existing `useCreateSuggestion`), Audition/Revert on SuggestionCard via new rs-based `applySuggestionChain` (deviation: graph-only `auditionSuggestion` retired — desynced knob UI), `chainToMoves` readable move list with expander, anon suggest pill removed. Gates green (tsc/lint/build/vitest 772). Status → review.
