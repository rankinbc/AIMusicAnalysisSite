# Story 11.4: Anonymous Reviewer Surface on Share Token

Status: review

## Story

As a producer who received a share link,
I want to view and give feedback without an account,
So that getting ears on a track has zero friction.

## Acceptance Criteria

1. **Given** a valid share token, **When** an anon visitor opens `/v/{token}`, **Then** they see the owner-safe version (never `.als`/raw stems) plus comments/suggestions/bookmarks in their token-scoped anon variants.
2. **Given** the token's `ShareSetting` grants canComment/canSuggest/canBookmark, **Then** those actions are enabled; otherwise hidden (resolved by `AccessService`).
3. **Given** an anon write, **Then** it carries the durable signed-cookie anon `ActorRef` and is rate-limited; the route uses the opaque ResourceToken, never JWT `?t=`.
4. **Given** a revoked or expired token, **Then** the page renders a revoked state.
5. **Given** the page renders, **Then** a static-render test covers the anon gating matrix.

## Pre-existing surface (verified)

Backend fully existed: `/api/v/{token}` (view + Range audio + anon bookmark) in `VersionViewEndpoints`, token-scoped anon comments list/post + suggestion post in `FeedbackEndpoints` (all via `ResolveAnonAsync` → `AccessService`, durable signed-cookie anonId from `UseAnonIdentity`). Frontend `/v/$token` was a thin entry (audio + gate pills + revoked state) with NO feedback UI.

## What this story ADDED

- **AC1/AC2 frontend** — `/v/$token` rebuilt: token-scoped comments thread (threaded two-level render, timestamp anchors seek the player, status badges) + post form (optional display name, pin-to-playhead) shown ONLY when `gates.canComment`; "Bookmark this moment" button only when `gates.canBookmark`; gate pills mirror (never re-implement) the server-resolved `AccessDto.gates`. Suggestions remain surfaced as a gate pill — chain suggestions need the rack surface (listen-rack anon mode), out of this page's scope.
- **AC3 rate limiting (backend gap)** — `IRateLimiter` existed but was UNWIRED on the anon write routes. `PostCommentAnon` + `PostSuggestionAnon` now check the dual-arm (actorKey + ip) sliding window — 10 writes/min → 429 `rate_limited` envelope with retryAfterSeconds.
- **AC5** — `anon-reviewer-surface.test.tsx`: 7 static-render tests — full gating matrix (each single gate, all, none→"listen only") + threaded list (anchors, nesting, status badges, empty state).
- New: `features/listen/useAnonFeedback.ts` (useAnonComments/usePostAnonComment/useAnonBookmark), `features/listen/AnonReviewerSurface.tsx` (pure AnonGatePills + AnonCommentList).

## Dev Agent Record

- 2026-07-02: implemented on `social/epic-7-11`. Gates: frontend build/tsc/eslint/vitest 630/630; BFF 237/237 (Stripe webhook excluded per direction; one intermittent parallel-run flake noted — passes on rerun, tracked informally). Status → review.
