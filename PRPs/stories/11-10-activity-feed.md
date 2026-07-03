# Story 11.10: Activity Feed

Status: review

## Story

As a producer,
I want a feed of recent activity from people I follow,
So that the app gives me a reason to come back.

## Acceptance Criteria

1. **Given** I follow users, **When** I open the feed, **Then** I see their recent public version-shares and published room recaps in reverse-chron.
2. **Given** I follow no one, **Then** an empty state suggests profiles to discover.
3. **Given** a feed item, **Then** it deep-links to the version/profile/recap.
4. **Given** the feed query, **Then** it is recipient-scoped, paged, and reuses visibility gating (never leaks private content).
5. **Given** the feed renders, **Then** a static-render test covers populated + empty feed.

## Tasks / Subtasks

- [x] Task 1 — Make "published recap" queryable (AC: 1) — **schema gap, must land first**
  - [x] Add `RecapPublishedAt` (`recap_published_at`, `DateTimeOffset?`) to `Spectr.Data/Entities/ListeningSession.cs` + EF migration `AddRecapPublishedAt`
  - [x] Set it in `RoomEndpoints.PublishRecap` — via `ExecuteUpdateAsync` guarded `RecapPublishedAt == null` (the handler loads the session `AsNoTracking`, so a tracked-property write would silently no-op; first publish stamps, re-publish never reorders)
  - [x] Mirror the column on `ListeningSession` in `components/shared/aimusic_shared/models.py`; shared tests green
- [x] Task 2 — BFF feed endpoint (AC: 1, 2, 4)
  - [x] New `Spectr.Bff/Endpoints/FeedEndpoints.cs`: `GET /api/me/feed?page=&limit=` `.RequireAuthorization()`; registered in `Program.cs` next to MapFollowEndpoints
  - [x] Followees subquery + Source A (public shares, exact ProfileEndpoints gate) + Source B (recaps, `RecapPublishedAt != null` AND same public gate on the version)
  - [x] Paging: NotificationEndpoints pattern (page/limit, 30/50, Take(take+1) probe); per-source pull `skip+take+1` then in-memory merge-sort desc
  - [x] DTOs: `FeedItemDto(Kind, Handle, DisplayName, SongName, VersionNumber, ShareToken, OccurredAt)`, `FeedSuggestionDto(Handle, DisplayName)`, `FeedPageDto(Items, Page, Limit, HasMore, Suggestions)`
  - [x] Suggestions: page 0 + empty items → up to 5 distinct recent public sharers (excl. self + followed, handle non-null, active)
  - [x] Recipient scoping via `currentUser.UserId()`; no rate limiter (authed read, /me/notifications posture)
- [x] Task 3 — Frontend feed page (AC: 1, 2, 3)
  - [x] `src/features/feed/useFeed.ts` — DTOs + `useFeed(page)`, key `['me','feed',page]`
  - [x] `src/features/feed/FeedView.tsx` — pure `FeedItemRow`/`FeedList`/`FeedEmptyState`; wording in `feed-text.ts` (react-refresh convention)
  - [x] Deep links: card → `/v/{token}` (both kinds; recap gets a "recap" pill), handle + suggestions → `/u/{handle}`
  - [x] `src/routes/_app/feed.tsx` container (page state + More…); Feed nav tab in `_app.tsx`
  - [x] Styling: global `.card`/`.pill`/`.btn` + `feed.module.css`; `relativeTime` adapted into `feed-text.ts`
- [x] Task 4 — Tests (AC: 5 + endpoint coverage)
  - [x] BFF `FeedEndpointsTests.cs` — 4 Postgres-gated tests: followed-public-only + reverse-chron; recap publish/visibility gating matrix; empty-feed suggestions + 401; paging hasMore + no-suggestions-past-page-0
  - [x] Frontend `feed-view.test.tsx` — 7 static-render tests (wording, deep-links, recap pill, More…, empty state ± suggestions)
  - [x] Shared: mirror green (27 passed)
- [x] Task 5 — Gates + status
  - [x] All gates green (see Change Log)
  - [x] Sprint-status + Dev Agent Record updated

## Dev Notes

### Critical schema gap (discovered in recon — do Task 1 first)

**"Published room recap" has NO backing state today.** `POST /api/rooms/{id}/recap/publish` (`RoomEndpoints.cs:513-554`) only materializes selected hottest-moments as `TrackComment` rows — it sets no flag. The recap itself lives at `listening_sessions.recap_json` (written by worker `recap_actor.py::synthesize_recap` via raw `UPDATE ... SET recap_json=...`). `recap_json != null` ≠ published (recap is auto-synthesized on room end). Hence the new `recap_published_at` timestamp = the feed's publish signal AND its sort key.

### Visibility model (AC4 — copy, don't invent)

- Public gate for a version = `share_settings.visibility == 'public' && share_token != null`. This is exactly what `ProfileEndpoints.cs:54-61` uses for the public-profile track list. `ShareSetting` PK = `song_version_id` (1:1; absence of row == private). Order by `enabled_at DESC` (= "when sharing was enabled" = the share event time, projected as `SharedAt`).
- Do NOT use `Song.Visibility` (coarser legacy per-song column) and do NOT touch the analysis-scoped share path (`analyses.share_token` / ShareEndpoints) — parallel system, different tokens.
- `AccessService.ResolveAsync` gates a single version per call (60s cached) — wrong shape for a feed list query; replicating the ShareSetting where-clause (as ProfileEndpoints already does) IS the sanctioned reuse.

### Entities / queries cheat sheet

- `FollowRelation` (`follow_relations`): `Id`, `FollowerId`, `FolloweeId`, `CreatedAt`; unique pair, followee index exists for exactly this read path. Followees of me: `db.FollowRelations.Where(f => f.FollowerId == me).Select(f => f.FolloweeId)`.
- `ListeningSession` (`listening_sessions`): `Id`, `SongVersionId`, `HostId`, `Status` ('live'/'ended'), `EventsJson`, `RecapJson` (jsonb, null while live). No title field — feed recap items render as "{handle} published a room recap on {SongName} v{n}".
- Paged pattern to copy verbatim: `NotificationEndpoints.cs:47-70` — `Math.Clamp(limit ?? 30, 1, 50)`, `skip = page * take`, `Take(take + 1)`, `hasMore = rows.Count > take`, `.AsNoTracking()` on all reads.
- Auth: handler param `ClaimsPrincipal currentUser` → `currentUser.UserId()` (`Auth/ClaimsPrincipalExtensions.cs`).

### Frontend conventions (from 11.7/11.8/11.9)

- Container/presentational split is the testability contract: route container owns hooks (`useQuery` + fetcher + navigation), presentational components take plain props and are tested with `renderToStaticMarkup` string assertions (`public-profile-view.test.tsx`, `notification-center.test.tsx`). Vitest default env is **node** — RTL/jsdom will not work outside `src/features/listen-rack/**`.
- `fetcher` from `src/api/fetcher.ts`; `params: { page }` serializes to querystring. DTO interfaces live at the top of the hook file (dominant recent pattern — do not add to `api/types.ts`).
- Prefix query invalidation: `['me', 'feed']` covers all pages (mirrors `['me','notifications']`).
- Deep-link targets that exist: `/v/{token}` (public version share — plain `<a href>`), `/u/{handle}` (public profile — plain `<a href>`), `/listen-rack/$versionId` (authed, via router Link). Use `/v/{token}` for BOTH share and recap items — a recap-specific route does not exist and is out of scope; recap's published comments live on the shared version page.
- `routeTree.gen.ts` is generated — never hand-edit; run `npx vite build` before `npx tsc -b` so the new route registers.
- No generic VersionCard/LibraryCard exists — feed rows are `.card` + module css, closest prior art `ActivityRow` in `src/routes/_app/profile.tsx:573-587` (icon + text + `relativeTime`). Note `useMeActivity` (`/me/activity`) is SELF-activity only — different endpoint, don't confuse or reuse its hook.

### Testing standards

- BFF: xUnit + `WebApplicationFactory<Program>` real-HTTP; **Postgres-gated skip** (`TestDb.Reachable` early-return) — compose Postgres must be up for the tests to actually run; helpers `TestAuth.RegisterAsync` (fresh user + bearer), `TestSeed` (Song+SongVersion), set handles via a service scope (see `FollowEndpointsTests.cs:25-29`).
- Frontend: fixture-factory + `expect(html).toContain(...)`; carry rendering contracts on `data-*` attributes (e.g. `data-kind="share|recap"`, `data-testid="empty-feed"`).

### Project Structure Notes

- BFF: one endpoint group per file under `Spectr.Bff/Endpoints/`; DTO records co-located in the endpoints file (Follow/Profile/Notification precedent). Migration in `Spectr.Data/Migrations/` via `dotnet ef migrations add AddRecapPublishedAt --project src/Spectr.Data --startup-project src/Spectr.Bff`.
- Frontend: new feature folder `src/features/feed/`; route file `src/routes/_app/feed.tsx`. CSS Modules + global utilities; no Tailwind, no inline styles unless dynamic.
- Python mirror is mandatory for any schema change (`aimusic_shared/models.py`) — EF is canonical, SQLAlchemy mirrors (project rule; 11.6/11.9 precedent).

### Previous story intelligence (11.9 + 11.8)

- 11.9 shipped `FollowRelation` with the followee index specifically anticipating this feed read — use it, don't add new indexes without checking the migration.
- 11.9's idempotency pattern (unique-index + catch `DbUpdateException`) and rate-limit wiring are NOT needed here (read-only endpoint), but the counts queries in `FollowEndpoints.cs:37-42` show the DbSet naming.
- 11.8's `ProfileEndpoints` shows the exact public-versions join to lift, the `PublicVersionDto` shape (`SongName, VersionNumber, ShareToken, SharedAt`) worth keeping field-compatible, and the anon rate-limit pattern (not needed on this authed route).
- Known flake: one intermittent BFF parallel-run test failure exists repo-wide; rerun before diagnosing.

### References

- [Source: PRPs/epics.md#Story 11.10 (L1404-1416)] — AC source
- [Source: components/bff/src/Spectr.Bff/Endpoints/ProfileEndpoints.cs L54-61] — public-share gate to reuse
- [Source: components/bff/src/Spectr.Bff/Endpoints/NotificationEndpoints.cs L47-70] — paging pattern
- [Source: components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs L513-554] — PublishRecap (add timestamp here)
- [Source: components/bff/src/Spectr.Data/Entities/{FollowRelation,ShareSetting,ListeningSession}.cs] — schema
- [Source: components/frontend-spectr-v2/src/features/notifications/*] — paged list + container/presentational prior art
- [Source: PRPs/stories/11-9-follow-graph.md#Dev Agent Record] — previous story learnings

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Full BFF suite run hit the known intermittent parallel-run flake (`CoachStreamEndpointTests.Stream_Live_Subscribe_Forwards_Published_Frames`); passes 6/6 isolated — pre-existing, unrelated.

### Completion Notes List

- **Schema** — `listening_sessions.recap_published_at` (`DateTimeOffset?`, migration `AddRecapPublishedAt`) closes the "published recap has no backing state" gap. Stamped in `PublishRecap` via `ExecuteUpdateAsync(... where RecapPublishedAt == null)` — the handler reads the session `AsNoTracking`, so the guarded set-based update is both correct and first-publish-idempotent. Python mirror added.
- **API** — `FeedEndpoints`: `GET /api/me/feed?page&limit` (auth). Union of followees' public version-shares (ShareSetting gate lifted verbatim from ProfileEndpoints — `visibility='public' AND share_token IS NOT NULL`, ordered `enabled_at`) and published recaps (`recap_published_at != null` AND the same public gate on the underlying version, so private/unlisted recaps never leak — AC4). Per-source pull of `skip+take+1` + in-memory merge-sort desc; NotificationEndpoints paging contract (30 default/50 max, `Take(take+1)` hasMore probe). Page-0-empty responses carry ≤5 discovery suggestions (distinct recent public sharers, excl. self/followed — AC2); suggestions are null on later pages.
- **UI** — `/feed` authed route + Feed nav tab. `useFeed(page)` hook; pure `FeedItemRow`/`FeedList`/`FeedEmptyState` (container/presentational split per notifications precedent); share vs recap wording + glyph in `feed-text.ts`; deep links: card → `/v/{token}`, handle/suggestions → `/u/{handle}` (AC3).
- **Tests** — BFF 4 (visibility matrix incl. unpublished-recap + private-version-recap exclusion, reverse-chron, suggestions, 401, paging); frontend 7 static-render; totals: BFF 256 (1 known flake, passes isolated), frontend 642, shared 27, worker 534, ruff clean.

### File List

- `components/bff/src/Spectr.Data/Entities/ListeningSession.cs` (RecapPublishedAt)
- `components/bff/src/Spectr.Data/Migrations/20260703123127_AddRecapPublishedAt.cs` + `.Designer.cs` + snapshot
- `components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs` (PublishRecap stamps recap_published_at)
- `components/bff/src/Spectr.Bff/Endpoints/FeedEndpoints.cs` (new)
- `components/bff/src/Spectr.Bff/Program.cs` (MapFeedEndpoints)
- `components/bff/tests/Spectr.Bff.Tests/FeedEndpointsTests.cs` (new)
- `components/shared/aimusic_shared/models.py` (ListeningSession.recap_published_at mirror)
- `components/frontend-spectr-v2/src/features/feed/{useFeed.ts,feed-text.ts,FeedView.tsx,feed.module.css}` (new)
- `components/frontend-spectr-v2/src/features/feed/__tests__/feed-view.test.tsx` (new)
- `components/frontend-spectr-v2/src/routes/_app/feed.tsx` (new)
- `components/frontend-spectr-v2/src/routes/_app.tsx` (Feed nav tab)
- `components/frontend-spectr-v2/src/routeTree.gen.ts` (regenerated)

### Change Log

- 2026-07-03: implemented on `social/11-10-activity-feed`. Gates: BFF build 0 warn + tests (feed 4/4; full 255/256 w/ known CoachStream flake, passes isolated); frontend vite build + tsc -b + lint + lint:css + vitest 642/642; ruff clean; shared 27; worker 534 + 3 xfail. Status → review.
