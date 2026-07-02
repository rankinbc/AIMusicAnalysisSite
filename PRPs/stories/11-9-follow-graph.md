# Story 11.9: Follow Graph

Status: review

## Story

As a producer,
I want to follow other producers,
So that I keep up with people whose work I rate.

## Acceptance Criteria

1. **Given** another user's profile, **When** I click Follow, **Then** a `FollowRelation(follower, followee)` row is created idempotently (unique `(follower_id, followee_id)` index; no duplicates).
2. **Given** I unfollow, **Then** the relation is removed and counts update.
3. **Given** any profile, **Then** follower/following counts render.
4. **Given** my own profile, **Then** the Follow button is hidden (no self-follow).
5. **Given** follow writes, **Then** they are auth-required and rate-limited, and the Python model is mirrored.

## Dev Agent Record

### Completion Notes List

- **Schema** — `FollowRelation` entity + migration `AddFollowRelations`: unique `(follower_id, followee_id)` (idempotency, AC1), followee index (count/feed reads), CHECK `follower_id <> followee_id` (storage-level self-follow guard), both FKs cascade. Python mirror in `aimusic_shared.models` (AC5).
- **API** — `FollowEndpoints`: `GET /api/u/{handle}/follow` (public — counts + isFollowing + isSelf), `PUT` (auth + 30/min rate limit via shared `IRateLimiter`; duplicate insert absorbed by the unique index = idempotent 204; self-follow → 400 `self_follow`), `DELETE` (idempotent 204).
- **UI** — `PublicProfileView` grows a `FollowSurface`: follower/following counts inline under the handle (AC3), Follow/Following✓ toggle gated on `canFollow` (authed AND not self — AC4); route container wires `useFollowState/useFollow/useUnfollow` with query invalidation.
- **Tests** — BFF: idempotent double-follow (1 row), counts, unfollow twice, self-follow 400, unauthed write 401, public counts read (Postgres-gated, 2 tests). Frontend: follow counts render, button state toggle, canFollow gating (1 test, 3 assertions blocks). Shared: suite green after mirror.

### File List

- `Spectr.Data/Entities/FollowRelation.cs` + AppDbContext config + migration `AddFollowRelations`
- `Spectr.Bff/Endpoints/FollowEndpoints.cs` + Program.cs mapping
- `aimusic_shared/models.py` (FollowRelation mirror)
- `src/features/profiles/useFollow.ts` (new), `PublicProfileView.tsx` (FollowSurface), `u.$handle.tsx` (wiring)
- Tests: `FollowEndpointsTests.cs`, `public-profile-view.test.tsx` (extended)

### Change Log

- 2026-07-02: implemented on `social/epic-7-11`; gates green (BFF follow 2/2, frontend 635/635, shared 27, ruff clean). Status → review.
