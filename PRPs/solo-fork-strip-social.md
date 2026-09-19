# Solo fork — strip all user-to-user surface (design spec)

_Date: 2026-09-19 · Branch: `solo` (from `master` @ `2e62ca4`) · Worktree: `../spectr-solo`_
_Status: DESIGN — awaiting review. The task-by-task implementation plan is a separate document written after this is approved._

## 1. Goal

SPECTR ships publicly as **a personal tool**: a producer registers, uploads
tracks, gets the analysis + AI coach, keeps a private versioned library, and
auditions fixes in the Listen rack. Nothing in the product may show, imply, or
let a visitor infer that other users exist — or how few there are.

**The test for every judgment call:** _could a visitor learn anything about
another account, or about how busy the site is, from this surface?_ If yes, it
goes. Words like "public", "shared", "listeners", "followers", "community",
"people" do not appear in the product.

### Decisions already made (by Brian, 2026-09-19)

| # | Decision |
|---|---|
| D1 | **Hard strip on a permanent fork.** Code is deleted and tables dropped, not flagged off. |
| D2 | **All sharing is removed** — both share systems, including the read-only report link and its viral CTA. Growth relies on the anonymous `/analyze` funnel. |
| D3 | **`solo` becomes the main development line and the deploy branch.** `master` is frozen as the archive of the social build. Bringing social back later is a deliberate port from `master`. |

### Non-goals

- No re-baselining of EF migrations. No refactors unrelated to the strip.
- The anonymous `/analyze` funnel, billing, admin endpoints (key-gated, 404
  when unconfigured), the demo-song seeder, coach, specialists, stems, .als,
  reference tracks, rack presets/drafts, session notes, compare, game plan
  (owner-side) all stay and must behave identically.
- The legacy `components/api` is frozen and undeployed — untouched.

## 2. Why this is needed (what leaks today)

All IDs are UUIDs and no page prints a user count, but a visitor can still
infer community size:

| Leak | Surface |
|---|---|
| Handle enumeration + follower/following counts + prefix search over all users | `GET /api/u/{handle}`, `GET /api/u/?q=`, `/u/$handle` |
| Feed with "Profiles to discover" (recent public sharers); an empty feed is itself the tell | `/feed` topnav tab, `GET /api/me/feed` |
| Global queue depth: "N jobs waiting" / "N jobs queued" | `WorkerHealthBanner`, `ProgressStoryline`, **anonymous** `GET /api/health/worker` |
| Live Room: "LIVE ROOM · N listening", roster, chat, DJ/VJ grants, Invite, Work/View/Room switcher, "◬ Open in Room" | `/listen-rack`, `VersionRowMenu` |
| Two share systems: anon comments, @mentions, "Join SPECTR & follow @x", unauthenticated audio | `/r/$token`, `/v/$token`, `/invite/$token`, "★ Publish" (`SongHeader`), `SharePublishDialog`, `VersionShareDialog` |
| Notification bell — and it is **actively wrong**: the email send-ledger rows (`digest_key = "analysis_complete:{jobId}"`) render through the digest branch as _"1 person bookmarked your track today"_ | `NotificationCenter`, `notification-text.ts` |
| "Listener comments", bookmark signal ("N bookmarks · names"), room-reaction lane | Results → Notes tab |
| Visibility badge/menu/filter pills (Private / Shared / Public "Listed + discoverable") | Library cards, `SongEditDialog` |
| "Handle is already taken." existence oracle; `handle` claim in the JWT | `PATCH /api/auth/me`, profile Settings |
| "Too many analyses **from this network**" | 2 rate-limit messages |
| `app.MapOpenApi()` unconditional (own comment: "Lock down before public exposure") — would enumerate every endpoint if ever routed | `Program.cs` |

Already safe (verified): rooms are dormant (`room_hosting_enabled=false`);
emails and coach/specialist prompts contain no social text; `/metrics`,
Grafana, workerdash are not publicly routed; landing/pricing/auth copy has no
social proof; the anon funnel and per-user demo song reveal nothing.

## 3. Approach

**Outside-in by layer, every gate green after each phase:**

1. Frontend (consumers first)
2. BFF endpoints/services/DTOs
3. Worker + shared SQLAlchemy mirror
4. Database — one EF migration, done **last**, once nothing references the tables
5. Infra / CI / docs
6. Guard tests + live verification

Rejected: per-feature vertical slices (rooms, sharing and feedback share
`AccessService`, `ActorRef`, `track_comments` — the slices are not
independent); DB-first compiler-driven deletion (everything red for the whole
effort).

Rule for shared files: delete social-only files whole; in mixed files remove
the social branch and **simplify what remains** (no dead `mode === 'work'`
conditionals, no always-true capability flags left behind).

> The inventory below was taken on a checkout 24 commits behind `master`.
> File lists are reliable; **line numbers are not**. Phase 0 of the plan
> re-greps on `solo` before anything is deleted.

## 4. Frontend (`components/frontend-spectr-v2/src`)

### 4.1 Delete whole

- **Routes:** `_public/r.$token.tsx`, `_public/r.module.css`, `_public/v.$token.tsx`,
  `_public/u.$handle.tsx`, `_app/feed.tsx`, `_app/invite.$token.tsx`
  (then regenerate `routeTree.gen.ts`).
- **Feature folders:** `features/feed/`, `features/profiles/`,
  `features/mentions/`, `features/notifications/`.
- **`features/listen/` (room + share + feedback):** `useRoomStream.ts`,
  `useRoomActions.ts`, `useRoomSession.ts`, `VersionShareDialog.tsx`,
  `useVersionShare.ts`, `useInvites.ts`, `useVersionAccess.ts`,
  `useComments.ts`, `comment-tree.ts`, `useAnonFeedback.ts`,
  `AnonReviewerSurface.tsx`, `ProducerCta.tsx`, `useSuggestions.ts`,
  `SuggestionCard.tsx` (+css), `suggestion-helpers.ts`, `useBookmarks.ts`,
  `bookmarks-helpers.ts`, `BookmarksRail.tsx` (+css), `useBookmarkSignal.ts`.
- **`features/listen-rack/`:** `useRoomOrchestration.ts`,
  `useMockRoomOrchestration.ts`, `roomStateReducer.ts`, `roomUiState.ts`,
  `transportSync.ts`, `sessionEvents.ts` (already dead), `suggest-draft.ts`,
  `SuggestModeChip.tsx`, `access.ts`, `capabilities.ts`, `identity.ts`,
  `rail.tsx` (dead except two types — move `ReportRef` / `StatsSource` to
  `listen-rack/types.ts` first).
- **Components:** `components/SharePublishDialog.tsx`.
- **Tests** co-located with all of the above (~30 files; the implementation
  plan enumerates them per task).

### 4.2 Surgery in mixed files

| File | Change |
|---|---|
| `features/listen-rack/ListenRackPage.tsx` | Remove mode switcher, Invite button, `Pop` presence component, live-room header block, host transport emit, listener follow / tap-to-join, mock ambient reactions, `grantControl`, `reactHandler`, `VersionShareDialog` mount, and the `mode/modes/identity/access/roomControl/roomLive/onStartRoom/isStartingRoom/onGrant` props. Rack is always editable (`rackReadOnly` concept deleted, not hard-coded). No audio/DSP code changes. |
| `features/listen-rack/SessionSidebarV2.tsx` | Becomes a Notes-only card (Chat + Room tabs, roster chips, reaction groups removed). Rename if it reads better. |
| `features/listen-rack/data.ts`, `viz.tsx`, `VisualsTabV2.tsx`, `StageCardV2.tsx` | Remove `ROOM_LISTENERS` / `ROOM_REACTIONS` / reaction vocab fixtures, the "Listeners" stage + `ListenersStage`, `ReactionFeedItem` / `PresencePopItem` types, presence-pop overlay slot. |
| `features/listen-rack/*.css` | Remove `presencePop` / `ringPulse` keyframes and `.lr-people/.lr-pchip/.lr-react/.lr-msg/.lr-cin` rules. |
| `routes/_app/listen-rack.$versionId.tsx` | Remove both orchestrations, `VITE_ROOM_LIVE_SSE`, and the guest `useAuthedVersionView` fallback → owner-only. |
| `routes/_app.tsx` | Remove the **Feed** topnav tab and `<NotificationBell>`. |
| `lib/shortcuts.ts` | Remove the `nav-feed` ⌘K command. |
| `features/song/SongConsole.tsx`, `SongHeader.tsx` | Remove "★ Publish" + `SharePublishDialog` state/mount + `onPublish` prop. |
| `features/song/VersionRowMenu.tsx` | Remove "◬ Open in Room". |
| `features/results/NotesTab.tsx`, `feedback-timeline-model.ts`, `ReportView.tsx` | Keep "Your notes" and the notes lane only. Remove Listener comments, bookmark signal, bookmarks lane, room-reaction lane, the tab badge that shares the comments cache. Rewrite the empty-state copy (no "shared listens", no "gather feedback"). Rename tab "Notes" if it is currently "Notes/Feedback". |
| `features/library/library-helpers.ts`, `SongsLibrarySection.tsx`, `components/SongEditDialog.tsx`, `library.module.css`, `styles/tokens.css` | Remove visibility: `VIS_META`, badge, PATCH menu/submenu, shared/public filter pills, the edit-dialog select, the visibility color tokens. |
| `routes/_app/profile.tsx` | Remove the `@handle` header chip and the Handle settings field + `normalizeHandleInput`. Own stats / display name / danger zone stay. |
| `routes/_public/register.tsx`, `lib/attribution.ts` | Keep attribution for the anon funnel; remove the `share_{token}` source. |
| `routes/trust.privacy.tsx`, `routes/_public.tsx` | Rewrite sharing copy → "Nothing you upload is visible to anyone else. There are no public pages, links, or profiles." Update meta description. |
| `features/health/WorkerHealthBanner.tsx`, `AppWorkerHealthNotice.tsx`, `features/results/ProgressStoryline.tsx` | Drop the queue-depth fragment; banner/progress copy states only worker availability. |
| `api/types.ts`, `api/hooks.ts` | Remove share/access/invite/view/actor/comment/suggestion/bookmark/room DTO blocks and the share + bookmark hooks; remove `handle` from `AuthedUser`, `handle/bio/avatarHue/bannerHue/publicLink` from `MeProfileDto`, `visibility` from `SongDto`/`PatchSongRequest`, `createdInSessionId/viaGrantId` from `RackPresetDto`, `shareToken` from `JobResultsDto`, `queueDepth` from the worker-health type. |
| `features/listen/README.md`, `features/listen-rack/PORTING_NOTES.md` | Rewrite to describe the engine + rack only. |
| Tests needing edits | `carryOver.test.tsx`, `rack-draft-feedback.test.tsx`, `listen-rack-version-gate.test.tsx`, `mutation-error-meta.test.tsx`, `feedback-timeline-model.test.ts`, `library-helpers.test.ts`, `SongsLibrarySection.test.tsx`, `trust.test.tsx`, `attribution.test.ts`, `kitchen-sink-axe.test.tsx`, `song-console.test.tsx`; delete `rail-honesty.test.tsx` (tests dead code). |

## 5. BFF (`components/bff`)

### 5.1 Delete whole

Endpoints: `RoomEndpoints`, `ShareEndpoints`, `OgShareEndpoints`,
`VersionShareEndpoints`, `VersionViewEndpoints`, `ProfileEndpoints`,
`FollowEndpoints`, `FeedEndpoints`, `FeedbackEndpoints`, `BookmarkEndpoints`,
`NotificationEndpoints`.
Services: `RoomBus`, `AccessService`, `SessionTokenResolver`,
`ShareTokenResolver`, `ResourceTokenAuth`, `AnonIdentity` (+ `UseAnonIdentity`
middleware + `AnonOptions`), `ActorRef`, `ActorProjection`, `MentionParser`,
`ShareReportProjection`, `INotificationSink` + `TableNotificationSink`,
`IGamePlanSink` (its only callers are Feedback + Room), `Auth/HandleSeeder`.
DTOs: `RoomDtos`, `ShareDtos`, `VersionShareDtos`, `FeedbackDtos`,
`BookmarkDtos`. `DramatiqTasks.SynthesizeRecap`.
`Program.cs`: the matching DI registrations and `Map*Endpoints()` calls.
Tests: `RoomEndpointsTests`, `VersionShareEndpointsTests`,
`FeedbackEndpointsTests`, `FollowEndpointsTests`, `FeedEndpointsTests`,
`ProfileEndpointsTests`, `OgShareShellTests`, `ShareReportProjectionTests`,
`NotificationEndpointsTests`, `BookmarkVersionEndpointsTests`.

`IRateLimiter` and `IPresetGenerator` stay (non-social callers). Verified on
`solo`: the anon funnel's `DeviceService` references `AnonIdentity` only in
comments (it is the separate `spectr_device` cookie), so `AnonIdentity`, its
middleware and `AnonOptions` are deletable. The **`Anon:SigningKey` config key
stays** — `DeviceService` signs with it. Fix the two stale comments in
`DeviceService.cs`.

### 5.2 Surgery

| File | Change |
|---|---|
| `VersionEndpoints.cs` (audio) | Non-owner path via `AccessService.CanView` → plain owner check (`?t=` JWT flow unchanged). |
| `VersionEndpoints.cs`, `AnonAnalysisEndpoints.cs` | "from this network" → neutral wording ("Too many analyses — slow down." / "…create an account for more."). |
| `AuthEndpoints.cs`, `JwtTokenService.cs`, `DTOs/AuthDtos.cs` | Remove `handle` from `AuthedUser`, the JWT claim, `PatchMeRequest`, the uniqueness check + `NormalizeHandle`; registration no longer seeds a handle. |
| `MeEndpoints.cs`, `DTOs/MeDtos.cs` | Remove `Handle/Bio/AvatarHue/BannerHue/Accent/PublicLink` from `MeProfileDto` + the PATCH request. `GET/PATCH /api/me/profile` **stay** — `VerifyEmailBanner` and the profile Settings tab consume the remaining fields. |
| `AccountEndpoints.cs` | Data export: drop removed user columns. Account deletion: drop the `invites` / `control_grants` PII scrubs. |
| `SongEndpoints.cs` | Remove `visibility` validation + DTO field. |
| Rack preset endpoints/DTOs | Remove `CreatedInSessionId`, `ViaGrantId`, `FromSuggestionId`. |
| `HealthEndpoints.cs` | `GET /api/health/worker` returns `{ healthy, lastHeartbeatAgeSeconds }` only. `/metrics` keeps `spectr_queue_depth` (internal scrape only; Caddy never routes it). |
| `Program.cs` | `MapOpenApi()` inside `if (app.Environment.IsDevelopment())`. |
| `SpinePrimitivesTests`, `AbuseContainmentTests`, `RackPresetEndpointsTests`, auth/me tests | Prune social cases; update for removed fields. |

## 6. Worker + shared

- Delete `worker/app/recap_actor.py`, its import/registration in
  `dramatiq_app.py`, its tests; update `tests/test_actor_queues.py` roster.
- `worker/app/account_deletion_actor.py`: remove every statement naming a
  dropped table/column.
- `shared/aimusic_shared/models.py`: delete `ShareSetting`, `Invite`,
  `ListeningSession`, `ControlGrant`, `TrackComment`, `ReviewerSuggestion`,
  `TrackBookmark`, `FollowRelation`; keep `Notification` (email ledger); remove
  the columns listed in §7 from `User`, `Song`, `Analysis`, `RackPreset`; trim
  `__all__`.
- **Gate before §7:** `grep` worker, shared, BFF hosted services and workerdash
  for every dropped table and column name → zero hits.

## 7. Database — one migration, `RemoveSocial`

Added on top of the existing chain (`dotnet ef migrations add RemoveSocial`
after the entity/config deletions; hand-review the scaffold). Existing DBs
migrate forward; historical migrations stay as-is.

- **Drop tables:** `listening_sessions`, `control_grants`, `invites`,
  `share_settings`, `follow_relations`, `suggestions`, `track_comments`,
  `track_bookmarks`.
- **Drop columns:** `analyses.share_token / share_enabled_at / share_show_verdicts`
  (+ unique index); `songs.visibility` (+ CHECK); `rack_presets.created_in_session_id
  / via_grant_id / from_suggestion_id` (+ FKs); `users.handle` (+ citext unique
  index), `bio`, `public_link`, `avatar_hue`, `banner_hue`, `accent`.
  Verified on `solo`: no self-facing UI reads any of the six (the account-menu
  avatar derives from the email; `profile.tsx` renders only `displayName`,
  `@handle`, email, own stats). `display_name` stays.
- **Delete flag rows** (raw SQL appended to `Up()`): `room_hosting_enabled`,
  `room_host_min_tier`.
- **Keep:** `notifications` — it is the lifecycle-email send ledger
  (`LifecycleEmailScheduler`, `RetentionSweepScheduler`, dunning). Add a
  one-line comment on the entity saying so; it has no read API any more.
- `AppDbContext`: remove the DbSets + model config for the dropped entities.
- **Local dev DB:** migrated in place **after** a `pg_dump` to
  `output/db-backups/2026-09-19_pre-solo-strip/`. Other worktrees share this
  DB and lose the social tables locally — acceptable now that `master` is frozen.
- Prod has never been deployed (Azure Task 7 pending) → no production data concern.

## 8. Infra, CI, docs

- `infra/Caddyfile`: remove the `@share_bots` `/r/*` block.
- `.github/workflows/ci.yml` on `solo`: deploy job `if:` → `refs/heads/solo`.
- **One commit on `master`** (needs Brian's explicit go-ahead at execution
  time): disable its deploy job, so a stray push to `master` can never deploy
  the social build over the solo site.
- `PRPs/azure-deploy-spectr.md`, `docs/azure-deploy-remaining-work.md`,
  `docs/launch-checklist.md`: deploy branch = `solo`; remove the "share links
  must work" constraint, the `/r/<token>` crawler check, and the share step of
  the Task 10 walkthrough.
- `CLAUDE.md`: key routes, frontend purpose line, stems/other sections that
  mention sharing or rooms; note `solo` is the main line.
- `README.md`, `docs/project-overview.md`, `docs/architecture-*.md`,
  `docs/data-models.md`, `docs/api-contracts-bff.md`: remove rooms/sharing/feed.
- PRPs: move the social vision + Epic 11 + story 7.x/11.x documents to
  `PRPs/archive/2026-09-19_social-epic/` (history, not deleted).
- **Deferred, outward-facing (ask Brian when the fork is ready to ship):**
  switch the GitHub default branch to `solo` — the repo is public and
  `master`'s README advertises share links and rooms.

## 9. Guard tests (so social cannot creep back)

- **BFF `NoSocialSurfaceTests`:** enumerate `EndpointDataSource`; assert no
  route pattern matches a removed prefix (`/api/u`, `/api/sessions`,
  `/api/share`, `/api/v/`, `/r/`, `/api/me/feed`, `/api/me/notifications`,
  `/api/me/bookmarks`, `…/share`, `…/invites`, `…/access`, `…/view`,
  `…/sessions`, `…/comments`, `…/suggestions`); assert the set of
  `AllowAnonymous` endpoints **equals an explicit allowlist** (auth, anon
  funnel, billing plans + the two webhooks, public site shells, `/healthz`,
  `/metrics`, `/api/health/worker`, admin group, dev-only routes).
- **BFF:** worker-health response has no `queueDepth`; `AuthedUser` JSON has no
  `handle`; a JWT minted at login has no `handle` claim.
- **Frontend `no-social-surface.test.ts`:** the generated route tree's path
  list equals an allowlist; a scan of non-test `src/**/*.{ts,tsx}` for a short
  banned-phrase list chosen to have zero false positives on `solo`
  (`followers`, `people bookmarked`, `· listening`, `Open in Room`,
  `★ Publish`, `Profiles to discover`, `jobs waiting`, `jobs queued`,
  `from this network`, `/feed`, `/u/`).
- **Worker:** `test_actor_queues.py` asserts `synthesize_recap` is not registered.

## 10. Definition of done

1. All CLAUDE.md gates green on `solo`: `dotnet build && dotnet test`;
   `npx tsc -b`, `npm run lint`, `npm run build`, `npx vitest run`;
   worker/analysis/shared pytest; `ruff` + `mypy`.
2. Migration applies cleanly to a copy of the current dev DB and to an empty DB.
3. Live walkthrough (stack per `docs/STARTUP.md`): anon `/analyze` → register →
   upload → full analysis → results (all tabs) → coach chat → specialist →
   Listen rack (rack, visuals, stems, presets, notes) → compare → profile →
   account export. No console errors, no 404s from removed hooks.
4. `curl` each removed SPA route (`/feed`, `/u/x`, `/r/x`, `/v/x`, `/invite/x`)
   → not-found page; each removed API prefix → 404; `GET /api/health/worker`
   has no depth; `/openapi/v1.json` → 404 outside Development.
5. `git grep -i -E "follow|roster|listening_session|share_token|visibility"`
   over `components/{bff,frontend-spectr-v2,worker,shared}` shows only
   migration history and unrelated audio terms — reviewed by hand.

## 11. Risks

| Risk | Mitigation |
|---|---|
| `ListenRackPage.tsx` surgery breaks playback/rack (945 lines, ~250 removed) | Do it as its own task; keep `carryOver` / `rack-draft-feedback` / version-gate tests green; live-verify the rack before moving on. |
| Removing `handle` touches auth (JWT, register, `/me`) | Own task with the auth test suite as the gate; no schema drop until §7. |
| Hidden consumer of a dropped table (retention sweep, workerdash, exports) | The §6 grep gate is a hard precondition for the migration. |
| EF scaffold mishandles hand-written SQL (partial indexes, polymorphic CHECKs) | Hand-review `Up()`/`Down()`; apply to a DB copy first. |
| Deleting `AnonOptions` breaks `Anon:SigningKey` binding for `DeviceService` | `DeviceService` does not reference `AnonOptions`; the anon-funnel tests (`AnonAnalysis*`, device-claim) are the gate for that task. |
| Fork drift from `master` | By decision D3 there is no ongoing merge; `master` is frozen. |

## Appendix — inventory sources

Three read-only sweeps on 2026-09-19 (frontend, BFF, worker/infra/docs) plus
direct verification on `solo`. Notable corrections found while verifying:
`master` moved the song page to `features/song/SongConsole.tsx` (Publish lives
in `SongHeader.tsx`; "Open in Room" in `VersionRowMenu.tsx`);
`IGamePlanSink` has only social callers; the `notifications` "system" rows are
an email send-ledger, not in-app notifications.
