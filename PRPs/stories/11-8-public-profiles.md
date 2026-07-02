# Story 11.8: Public Profiles

Status: review

## Story

As a producer,
I want a public page at my handle,
So that others can see who I am and what I've shared.

## Acceptance Criteria

1. **Given** a user has a handle, **When** anyone visits `/u/{handle}`, **Then** they see display_name, bio, public_link, hue theming, and that user's public/shared versions.
2. **Given** the visitor is the owner, **Then** an "Edit profile" affordance links to the existing `/profile`.
3. **Given** a handle that doesn't exist, **Then** a 404 page renders.
4. **Given** a private user, **Then** only public-visibility content is exposed (owner-safe subset via `AccessService`).
5. **Given** the public profile endpoint, **Then** it is unauthenticated and rate-limited; a static-render test covers populated + empty profiles.

## Dev Agent Record

### Completion Notes List

- **Backend** — `Endpoints/ProfileEndpoints.cs`: `GET /api/u/{handle}` (AllowAnonymous, ip-rate-limited 60/min via the shared `IRateLimiter`). Projects handle/displayName/bio/publicLink/avatarHue/bannerHue/accent + up to 50 PUBLIC-visibility versions (join ShareSettings `visibility == 'public'` — unlisted/private structurally excluded, AC4; the per-version payload is name/number/token only, owner-safe by construction). citext handle ⇒ case-insensitive.
- **Frontend** — `/_public/u.$handle.tsx` route + pure `PublicProfileView`: hue-themed banner/avatar (oklch from stored hues), bio + nofollow public link, public tracks list linking to `/v/{token}`, owner-only "Edit profile" → `/profile` (owner matched via `/auth/me` handle when a session exists), friendly 404 state.
- **Tests** — BFF: unknown-handle 404, public-only projection incl. unlisted exclusion + case-insensitive handle (Postgres-gated). Frontend: 4 static-render tests (populated fields + track links, hue theming, owner-gated edit affordance, empty profile).
- All user profile FIELDS pre-existed (users table already had bio/public_link/hues/accent from the profile page work); this story added the public read surface only — no migration.

### File List

- `components/bff/src/Spectr.Bff/Endpoints/ProfileEndpoints.cs` (new) + Program.cs mapping
- `components/bff/tests/Spectr.Bff.Tests/ProfileEndpointsTests.cs` (new, 2 tests)
- `src/features/profiles/PublicProfileView.tsx` + `__tests__/public-profile-view.test.tsx` (new, 4 tests)
- `src/routes/_public/u.$handle.tsx` (new)

### Change Log

- 2026-07-02: implemented on `social/epic-7-11`; gates green (BFF profile tests 2/2, frontend build/tsc/eslint/vitest 634/634). Status → review.
