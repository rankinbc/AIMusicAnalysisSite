# Story 11.2: Reviewer Rack-Suggestions & Accept-to-Preset

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- First-sprint STRETCH — depends on 11.1 landing (suggestions render inline in comment threads). -->

## Story

As a track owner,
I want to see a reviewer's proposed rack-chain fix and adopt it in one click,
So that good suggestions become a usable preset with credit to the proposer.

## Acceptance Criteria

1. **Given** a version with suggestions, **Then** each `ReviewerSuggestion` shows its chain summary, status, and provenance (session/grant origin where present).
2. **Given** I am the owner, **When** I Accept a suggestion, **Then** the backend forks a `RackPreset` and the suggestion flips to accepted (reuse the `AcceptSuggestion` endpoint — never fork client-side).
3. **Given** a suggestion linked to a comment, **Then** it renders inline within that comment thread (11.1).
4. **Given** accept succeeds, **Then** the new preset appears in the rack preset list.
5. **Given** the suggestion card renders, **Then** a static-render test covers its states (open/accepted/rejected).

## Context — what already exists (reuse, do not rebuild)

> ⚠️ **Verify before building — the "unused / no component" claims below are grep-level, not
> render-truth.** Stories 5.6 and 11.1 both found the "missing" component already existed as a
> **mock or dead code** (the rail `CommentsPanel` rendered `MOCK_COMMENTS`; `VerdictCard` was
> unrendered in the redesign). **First grep for the real render path** (who actually renders
> this surface today) — you may be replacing a mock or wiring an existing seam, not building net-new.

Backend complete (`FeedbackEndpoints.cs` AcceptSuggestion forks to `RackPreset` with `from_suggestion_id` provenance; `ReviewerSuggestion.cs` carries `chain_json`, `status`, `comment_id`, `created_in_session_id`/`via_grant_id`). Frontend **hooks exist, unused**:
- `src/features/listen/useSuggestions.ts` — `useSuggestions(versionId)` (19), `useAcceptSuggestion(versionId)` (38), `useRejectSuggestion(versionId)` (50). (`usePostAnonSuggestion` is for 11.4.)
- Preset list: `src/features/listen-rack/useRackPresets.ts` — `useRackPresets(versionId)` (76).
- Type: `SuggestionDto` (`types.ts:498`).

## Tasks / Subtasks

- [x] **Task 1: SuggestionCard (AC: 1, 5)**
  - [x] 1.1 Created `src/features/listen/SuggestionCard.tsx` (+ `.module.css`) + pure `suggestion-helpers.ts`. (No separate `SuggestionList.tsx` — the standalone list is a small section in `CommentsPanel`; see Completion Notes.)
  - [x] 1.2 Chain summary via pure `chainSummary(unknown)` — renders the `Chain.order` as prettified module chips (the `Chain` shape is `{order, modules, masterBypass}`, NOT the `VerdictDspOp` shape, so the `FixStep` idiom doesn't transfer — a dedicated tolerant formatter was the right call). Status badge + room-provenance line (`createdInSessionId`; note the DTO has **no `via_grant_id`** field).
- [x] **Task 2: Owner accept/reject (AC: 2, 4)**
  - [x] 2.1 Owner Accept → `useAcceptSuggestion` (server forks the preset; the hook already invalidates `['versions',v,'suggestions']` + `['versions',v,'rack','presets']` so the new preset appears — AC4). Reject → `useRejectSuggestion`. No client-side forking.
  - [x] 2.2 Non-owners + terminal (accepted/rejected) suggestions are read-only, gated by pure `canActOnSuggestion(status, isOwner)`.
- [x] **Task 3: Inline in comment threads (AC: 3)**
  - [x] 3.1 `CommentsPanel` consumes `useSuggestions(vid)` + `partitionSuggestions`; the per-comment placeholder chip is replaced by an inline `<SuggestionCard>` (keyed by `commentId`); standalone suggestions render in a "Suggested fixes" section above the threads.
- [x] **Task 4: Tests (AC: 5)**
  - [x] 4.1 `suggestion-helpers.test.ts` (5 pure: chainSummary, partition, can-act gating) + `SuggestionCard.test.tsx` (5 render: summary/proposer/status, owner Accept/Reject, hidden for non-owner, hidden when terminal, room provenance).
- [x] **Task 5: Gates** — tsc/lint clean, build ✓, vitest 589 (+10).

## Dev Notes

- **Depends on 11.1** for the inline-in-thread mount (AC3). Sequence after 11.1 lands; if developed in parallel, stub the thread slot and integrate once `CommentsPanel` exists.
- Accept is a server fork — the only client responsibility is calling `useAcceptSuggestion` and invalidating queries. Provenance (credit chain) is already on the row; just surface it.
- Reuse the DSP-op rendering idiom from `src/features/results/VerdictCard.tsx` (`FixStep`) rather than inventing a new chain renderer.

### References
- AC source: `PRPs/epics.md` Story 11.2. Anchors: `useSuggestions.ts`, `useRackPresets.ts:76`, `SuggestionDto` (`types.ts:498`), `FeedbackEndpoints.cs` (AcceptSuggestion), `VerdictCard.tsx` (FixStep), `CommentsPanel.tsx` (11.1).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story workflow)

### Debug Log References

- Verify-before-build: the only existing suggestion render was the placeholder chip in the
  11.1 `CommentsPanel` (`rail.tsx`); `useSuggestions` data was unconsumed. Genuine net-new UI.
- `SuggestionDto.chain` is `unknown` on the wire (`Chain = {order, modules, masterBypass}`),
  and the DTO carries `createdInSessionId` but **no `via_grant_id`** (the story over-listed it).
- Audition (`auditionSuggestion(graph, sg)` exists) needs the live `AudioGraphHandle`, which the
  rail panel doesn't hold — out of the 5 ACs, deferred (see Completion Notes).

### Completion Notes List

- **No separate `SuggestionList`.** Standalone (comment-less) suggestions render as a compact
  "Suggested fixes" section inside `CommentsPanel`; comment-linked ones render inline in the
  thread. Splitting a second component added no value for a list of the same cards.
- **Chain summary, not `FixStep` reuse.** The proposed chain is a `Chain` (`order`/`modules`),
  a different shape from `VerdictDspOp`; rendered the prettified module order as chips via a
  pure, drift-tolerant `chainSummary(unknown)` (returns [] on a malformed chain).
- **AC4 is free.** `useAcceptSuggestion` already invalidates the rack-preset query key, so the
  forked preset appears with no extra wiring; the client never forks.
- **Audition deferred** (recorded in `deferred-work.md`): the non-destructive chain preview needs
  the live audio graph plumbed into the rail panel; not among the 5 ACs.
- Reused the 11.1 seeded-`QueryClientProvider` render-test pattern.

### File List

- `components/frontend-spectr-v2/src/features/listen/suggestion-helpers.ts` (A)
- `components/frontend-spectr-v2/src/features/listen/__tests__/suggestion-helpers.test.ts` (A)
- `components/frontend-spectr-v2/src/features/listen/SuggestionCard.tsx` (A)
- `components/frontend-spectr-v2/src/features/listen/SuggestionCard.module.css` (A)
- `components/frontend-spectr-v2/src/features/listen/__tests__/SuggestionCard.test.tsx` (A)
- `components/frontend-spectr-v2/src/features/listen-rack/rail.tsx` (M — CommentsPanel consumes useSuggestions; inline + standalone SuggestionCards)

### Change Log

- 2026-06-28 — Story 11.2 implemented: reviewer rack-suggestions surfaced in the comments panel
  (inline per-comment + standalone "Suggested fixes"), owner Accept→preset / Reject via the real
  PRP-3 hooks, pure `suggestion-helpers`. Audition deferred. Gates green. Status → review.

### File List

### Change Log

### Review Findings

_Code review 2026-06-28 (social stories 11.1/11.2/11.3, range 2beea4a..ed94cc3)._

- [ ] [Review][Patch] AC5 coverage gap — `SuggestionCard.test.tsx` renders only `proposed`/`accepted`; the `rejected` state (distinct `STATUS_LABEL.rejected` + opacity rule) has no render test, only a pure `canActOnSuggestion` test [SuggestionCard.test.tsx]

All other ACs verified met: the "reuse AcceptSuggestion — never fork client-side" constraint is obeyed; AC4 preset-appears is free via the hook's `['versions',v,'rack','presets']` invalidation; owner-only gating hides Accept/Reject from non-owners and on terminal states.
