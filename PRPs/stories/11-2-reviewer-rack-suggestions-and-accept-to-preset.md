# Story 11.2: Reviewer Rack-Suggestions & Accept-to-Preset

Status: ready-for-dev

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

- [ ] **Task 1: SuggestionCard + list (AC: 1, 5)**
  - [ ] 1.1 Create `src/features/listen/SuggestionList.tsx` + `SuggestionCard.tsx` (+ module css). Consume `useSuggestions(versionId)`.
  - [ ] 1.2 Each card renders the proposed chain as a readable op summary (reuse the existing DSP-op formatting from `VerdictCard`'s `FixStep`/`formatParam` pattern if extractable, else a small local formatter), the `status` badge, and a provenance line when `created_in_session_id`/`via_grant_id` are present ("proposed in a room").
- [ ] **Task 2: Owner accept/reject (AC: 2, 4)**
  - [ ] 2.1 Owner-only Accept → `useAcceptSuggestion` (server forks the preset); Reject → `useRejectSuggestion`. On accept success, invalidate both the suggestions query and `useRackPresets(versionId)` so the new preset shows (AC4). Do NOT build preset-forking client-side.
  - [ ] 2.2 Non-owners see read-only cards (no accept/reject).
- [ ] **Task 3: Inline in comment threads (AC: 3)**
  - [ ] 3.1 A suggestion with `comment_id` renders inside that comment's thread in `CommentsPanel` (11.1). Provide a `<SuggestionCard>` slot keyed by `comment_id`; standalone suggestions (no `comment_id`) render in the `SuggestionList` section.
- [ ] **Task 4: Tests (AC: 5)**
  - [ ] 4.1 `__tests__/SuggestionCard.test.tsx` — `renderToStaticMarkup` over fixtures covering open/accepted/rejected + a provenance variant; assert the chain summary + status badge + owner vs non-owner controls.
- [ ] **Task 5: Gates** — `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`.

## Dev Notes

- **Depends on 11.1** for the inline-in-thread mount (AC3). Sequence after 11.1 lands; if developed in parallel, stub the thread slot and integrate once `CommentsPanel` exists.
- Accept is a server fork — the only client responsibility is calling `useAcceptSuggestion` and invalidating queries. Provenance (credit chain) is already on the row; just surface it.
- Reuse the DSP-op rendering idiom from `src/features/results/VerdictCard.tsx` (`FixStep`) rather than inventing a new chain renderer.

### References
- AC source: `PRPs/epics.md` Story 11.2. Anchors: `useSuggestions.ts`, `useRackPresets.ts:76`, `SuggestionDto` (`types.ts:498`), `FeedbackEndpoints.cs` (AcceptSuggestion), `VerdictCard.tsx` (FixStep), `CommentsPanel.tsx` (11.1).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
