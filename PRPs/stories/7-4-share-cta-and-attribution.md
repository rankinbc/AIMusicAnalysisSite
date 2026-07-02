# Story 7.4: Share CTA & Attribution

Status: review

## Story

As the operator,
I want every share view to carry a measured path into the free analyzer,
So that the k-factor loop closes.

## Acceptance Criteria

1. **Given** the ShareCTA (FR24, UX-DR35), **When** viewed on mobile, **Then** "Analyze your own track free →" is sticky with a ≥40 px target.
2. **Given** a recipient clicks through, **When** they analyze/sign up, **Then** share→visit→analysis→signup attribution records via Epic 6 instrumentation.
3. **Given** share-page audio (AR21), **When** playback is offered, **Then** presigned GETs are scoped to the share token's validity.

## Dev Agent Record

### Completion Notes List

- **AC1** — `/r/$token`: "Analyze your own track free →" CTA, 44 px min-height (≥40 px target); ≤640 px it pins to the bottom (fixed, safe-area padded, gradient scrim, page bottom-padding keeps content clear). Desktop: inline card at the page end.
- **AC2 (partial by dependency)** — the click carries `?via=share_{token}` to `/register` AND stashes `spectr_attribution` in localStorage so the funnel survives navigation. The EVENT RECORDING (share→visit→analysis→signup) is owned by Epic 6 story 6.5 (funnel instrumentation), which is backlog — when 6.5 lands it reads the same `via` param + stash. Deferral documented here per the release plan (Epic 6 is post-launch scope).
- **AC3 (deferred by dependency)** — share audio today streams through the BFF with the share token AS the access grant (`/api/share/{token}/audio`, revocation kills it instantly — the scoping property holds). The literal presigned-GET mechanics arrive with story 3.3 (signed playback), which also swaps the Listen page; noted there.

### File List

- `src/routes/_public/r.$token.tsx` (CTA + attribution carry)
- `src/routes/_public/r.module.css` (sticky mobile CTA styles)

### Change Log

- 2026-07-02: implemented on `social/epic-7-11`; gates green (build/tsc/eslint/lint:css/vitest 623/623). Status → review. Epic 7 fully in review.
