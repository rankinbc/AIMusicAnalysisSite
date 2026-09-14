name: "Listen V3 · PRP-2 — Version-Scoped Sharing, Permission Gates & Invites"
description: |
  The Δ1 slice: move the unit of sharing from the analysis to the VERSION, and replace the binary
  show-verdicts flag with a full capability-gate bundle (visibility + comments/suggestions/bookmarking/
  session policies), named Invites, and an AccessService that resolves which Listen MODES (Work/View/Room)
  and capabilities a given actor has on a given version. Strictly ADDITIVE — the existing analysis-scoped
  share path (`analyses.share_token`, ShareEndpoints `/share/{token}`) is left fully intact so current
  shared links keep resolving. Gates everything in View/Room (PRP-3, PRP-4).

## Purpose
V3 Listen operates on a version and adapts into Work/View/Room. What a viewer may do is set by the uploader
per the Modes/Feature specs. Today sharing is analysis-scoped and binary (token + showVerdicts). This PRP
introduces version-scoped visibility + the capability-gate bundle (D6.1/D6.2), the `Invite` entity (D6.3),
and the `AccessService` that turns (version, actor) into a concrete access decision — without disturbing the
existing analysis-share surface.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. **Additive, never big-bang** (don't break existing share links).

---

## Goal
- **`share_settings`** — a 1:1-with-version gate bundle: `visibility` (private|unlisted|public), a version-level
  `share_token`, `show_verdicts`, `comments_policy` (off|link|named), `suggestions_allowed`,
  `bookmarking_allowed`, `session_host_policy` (owner_only|invited), `session_join_policy` (invited|link|public).
- **`invites`** — named, tokenized invitations scoped to a version (and structurally ready for session scope in PRP-4):
  reviewer/listener/host roles, pending/accepted/revoked.
- **`AccessService`** (mirrors `EntitlementService`) — `ResolveAsync(versionId, actor)` → `AccessDto`:
  available modes, the actor's role, the effective gates, and Room hostable/joinable (resolved via tier +
  feature flags). This is the backend the Work/View/Room switcher reads.
- **BFF endpoints**: owner share-settings read/update + token rotate; version invites CRUD + accept;
  authed `GET /versions/{id}/access`; anonymous `GET /v/{token}` (+ `/audio`) View entry.
- **Feature flags** (seeded): `room_hosting_enabled`, `room_host_min_tier` — so `session_host_policy`
  resolves through the existing flag/tier machinery (Δ5), no hardcoded tiers.

## Why
- **Gates all social modes.** Decisions D6.1/D6.2/D6.3 + X.1 (coach author-only) + X.2 (Work strictly private):
  every capability the View/Room PRPs render is decided here. See the brainstorm + reconciliation docs.
- **It's the riskiest delta (Δ1).** Doing it additively now — a parallel version-share path beside the
  untouched analysis-share path — de-risks PRP-3/4 and avoids a destructive migration of `track_comments`/
  `track_bookmarks` (those re-targets happen in their own slices).

## What
Owner sets a version's visibility + gates and invites named reviewers; an authed actor's mode/capability
access is resolvable in one call; an anonymous link viewer can enter View within the owner's gates.
Technical: 2 EF tables (+ Python mirror), `AccessService`, `VersionShareEndpoints.cs` + public `VersionViewEndpoints.cs`,
a feature-flag seed migration, frontend types + hooks.

### Success Criteria
- [ ] `share_settings` (1:1 version) + `invites` tables via EF migration (+ raw SQL for any partial/unique index),
      mirrored in `shared/aimusic_shared/models.py`.
- [ ] `AccessService.ResolveAsync(versionId, actor)` returns correct modes/role/gates for: owner, invited reviewer,
      anon-with-link, and no-access — including X.1 (coach never granted to non-owner) and X.2 (Work owner-only).
- [ ] Owner endpoints update settings + lazily mint/rotate the version `share_token`; visibility=private mints no token.
- [ ] Invite create/list/revoke/accept works; accepting binds an `invited_user_id` (or a logged-in user via token).
- [ ] Anonymous `GET /v/{token}` resolves the version + effective anon gates and streams `/v/{token}/audio` (Range).
- [ ] **Existing analysis-share path is byte-for-byte untouched** (ShareEndpoints tests still green).
- [ ] Feature-flag seed migration is idempotent (`INSERT … ON CONFLICT DO NOTHING`); no hardcoded tier numbers in code.
- [ ] All validation gates pass.

## All Needed Context

### Documentation & References
```yaml
# DECISIONS + RECONCILIATION
- file: docs/archive/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: Domain 6 (D6.1 per-version visibility + song defaults, D6.2 gate bundle, D6.3 Invite), X.1 coach-author-only, X.2 Work-private, D4.4 full-anon.
- file: docs/archive/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: Δ1 (sharing scope migration is additive + riskiest), Δ4 (reuse anon pattern), Δ5 (session policy via tier+flags), build discipline.

# THE EXISTING SHARE SURFACE TO PARALLEL (do NOT modify these — mirror their shape)
- file: components/bff/src/Spectr.Bff/Endpoints/ShareEndpoints.cs
  why: analysis share owner POST/PATCH/DELETE /analyses/{id}/share; public AllowAnonymous GET /share/{token}(/audio,/peaks,/comments).
       GenerateToken() (~line 273): 24 random bytes -> base64 url-safe -> trim '=' (varchar36). REUSE this token recipe for the version token.
- file: components/bff/src/Spectr.Bff/Endpoints/BookmarkEndpoints.cs
  why: polymorphic XOR target validation (~84-90); /me/bookmarks. Do NOT change here (PRP-6 owns bookmark re-target).
- file: components/bff/src/Spectr.Bff/Services/EntitlementService.cs
  why: ForAsync(userId)->EntitlementsDto, 60s per-user + global flag cache, tier derivation (pro/credits/free). MIRROR this shape for AccessService.
- file: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs
  why: the tier/cap gate pattern (~116): resolve -> 403 ErrorEnvelope.Build(...) before side-effects. Same shape for room-host gate.
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs
  why: TRACKED version-ownership lookup (the AsNoTracking trap) + tier->queue dispatch (~925) + feature-flag read in an endpoint.
- file: components/bff/src/Spectr.Bff/Program.cs
  why: endpoint registration list (~225-240, api.MapXEndpoints()). Add MapVersionShareEndpoints + MapVersionViewEndpoints + register AccessService in DI.
- file: components/bff/src/Spectr.Data/Entities/Subscription.cs
  why: the 1:1-keyed table pattern (PK = user_id). share_settings mirrors it (PK = song_version_id).
- file: components/bff/src/Spectr.Data/Entities/TrackComment.cs
  why: the anon-actor triple (author_user_id nullable + author_display_name + author_ip_hash) + polymorphic CHECK pattern (for invites token + gate semantics).
- file: components/bff/src/Spectr.Data/AppDbContext.cs
  why: DbSet + OnModelCreating (CHECK constraints, unique indexes, now() defaults); where raw-SQL partial indexes go.
- file: components/shared/aimusic_shared/models.py
  why: lines 1-6 — EF-first; mirror share_settings + invites AFTER the migration.
- file: components/frontend-spectr-v2/src/routes/_public/r.$token.tsx
  why: existing anon share route + anonFetcher + useSharedAnalysis/useShareComments hooks — pattern for the new anon version-view hooks.
- file: components/frontend-spectr-v2/src/api/types.ts
  why: CreateShareResponse/PatchShareRequest/SharedAnalysisDto/EntitlementsDto — add ShareSettingsDto/AccessDto/InviteDto beside them.

# FEATURE-FLAG DISCIPLINE
- doc: CLAUDE.md "Feature flags are read by BOTH services with a 60s cache" + "Seed new flags via idempotent INSERT … ON CONFLICT"
  critical: never hardcode tier numbers; resolve room policy through feature_flags + EntitlementService tier.
```

### Desired tree (files added)
```bash
components/bff/src/
  Spectr.Data/Entities/ShareSetting.cs              # share_settings (PK song_version_id)
  Spectr.Data/Entities/Invite.cs                    # invites
  Spectr.Data/Migrations/<ts>_AddVersionSharing.cs  # tables + CHECKs + idempotent feature-flag seed
  Spectr.Bff/Services/AccessService.cs              # ResolveAsync(versionId, actor) -> AccessDto (mirror EntitlementService)
  Spectr.Bff/Endpoints/VersionShareEndpoints.cs     # owner: GET/PUT settings, POST rotate; invites CRUD + accept; GET access
  Spectr.Bff/Endpoints/VersionViewEndpoints.cs      # anon: GET /v/{token}, GET /v/{token}/audio
  Spectr.Bff/DTOs/ShareDtos.cs                       # ShareSettingsDto, UpdateShareSettingsRequest, AccessDto, InviteDto, CreateInviteRequest
components/shared/aimusic_shared/models.py           # +ShareSetting +Invite (mirror)
components/frontend-spectr-v2/src/features/listen/
  useVersionShare.ts                                 # useShareSettings/useUpdateShareSettings/useRotateToken
  useVersionAccess.ts                                # useVersionAccess(versionId) -> AccessDto (drives the Work/View/Room switcher availability)
  useInvites.ts                                       # list/create/revoke/accept
components/frontend-spectr-v2/src/routes/_public/v.$token.tsx  # anon View entry (mirror r.$token.tsx)
```

### Known Gotchas & Library Quirks
```text
# CRITICAL (additive): DO NOT touch analyses.share_token, ShareEndpoints.cs, or the polymorphic CHECK on
#   track_comments/track_bookmarks. Existing shared links MUST keep resolving. Version sharing is a NEW parallel path.
# CRITICAL (EF-first): C# entity -> ef migrations add -> THEN mirror in shared/models.py (models.py:1-6).
# CRITICAL (AsNoTracking trap): every owner-write + ownership check uses a TRACKED query (AsNoTracking anywhere -> SaveChanges no-ops).
# CRITICAL (X.1 coach-author-only / X.2 work-private): AccessService NEVER returns coach access for a non-owner,
#   and NEVER returns Work mode for a non-owner. Encode these as invariants with tests.
# CRITICAL (default private): absence of a share_settings row == private. Do NOT auto-migrate existing
#   analysis shares into version visibility (semantics differ). Existing versions stay private; old analysis links unaffected.
# GOTCHA (token recipe): reuse ShareEndpoints.GenerateToken() recipe verbatim (24 bytes b64 url-safe, trim '='), varchar(36) unique.
#   Mint lazily: only when visibility moves off 'private'. Rotating mints a new token and invalidates the old.
# GOTCHA (feature flags): seed room_hosting_enabled + room_host_min_tier via idempotent INSERT ... ON CONFLICT DO NOTHING
#   in the migration; read via EntitlementService.GetFlagsAsync() (60s cache). No hardcoded tiers in C#.
#   LAUNCH: room_hosting_enabled=false (Room hosting OFF for users — Work/View only; admin hosts the sole Room by flipping
#   the flag). RoomHostable resolves false for everyone until then — which is why PRP-4 G5 (hosting metering) can defer.
# GOTCHA (anon audio): /v/{token}/audio must be AllowAnonymous + Range-enabled, resolving token->share_settings->version->file_path,
#   exactly like /share/{token}/audio. The version token is the grant (no JWT). Tokens-in-URLs leak to logs (pre-public caveat, same as today).
# GOTCHA (full anon, D4.4): comments_policy='named' restricts to accounts; 'link' permits anon (display name + ip hash).
#   AccessService returns canComment/canSuggest/canBookmark already resolved for the actor (incl. anon).
# SCOPE: This PRP stores gates + resolves access. It does NOT build the comment/suggestion/room features
#   (PRP-3/4) and does NOT re-target track_comments/track_bookmarks (PRP-3/6). The settings UI is the page-impl thread; here = types + hooks.
```

## Implementation Blueprint

### Data models (C# — snake_case, PK conventions)
```csharp
// ShareSetting.cs -> table share_settings   (PK = song_version_id, 1:1 with version, mirrors Subscription)
//   song_version_id (uuid PK, FK song_versions),
//   visibility    (varchar12 CHECK in private|unlisted|public, default 'private'),
//   share_token   (varchar36, unique, nullable),  show_verdicts (bool default false),
//   comments_policy (varchar8 CHECK off|link|named, default 'link'),
//   suggestions_allowed (bool default true), bookmarking_allowed (bool default true),
//   session_host_policy (varchar12 CHECK owner_only|invited, default 'owner_only'),
//   session_join_policy (varchar8 CHECK invited|link|public, default 'link'),
//   enabled_at (timestamptz?), created_at, updated_at (now() defaults).
//   Index: unique(share_token) WHERE share_token IS NOT NULL  (raw SQL in Up()/Down()).

// Invite.cs -> table invites
//   id (uuid PK), scope (varchar8 CHECK version|session, default 'version'),
//   song_version_id (uuid? FK song_versions), session_id (uuid?  no FK yet — PRP-4),
//   invited_user_id (uuid? FK users), invited_email (varchar255?), invited_handle (varchar32?),
//   role (varchar16 CHECK reviewer|listener|host), token (varchar36 unique),
//   status (varchar10 CHECK pending|accepted|revoked, default 'pending'),
//   created_by (uuid FK users), created_at, accepted_at (timestamptz?).
//   Indexes: (song_version_id), (invited_user_id), unique(token).
```

### AccessDto (the resolution contract)
```csharp
record AccessDto(
  string Role,                 // owner | reviewer | invited | anon | none
  bool CanWork,                // owner only (X.2)
  bool CanView,                // visibility!=private AND permitted
  bool RoomHostable,           // owner||invited per session_host_policy AND room_hosting_enabled AND tier>=room_host_min_tier
  bool RoomJoinable,           // per session_join_policy + invite
  bool CoachAvailable,         // owner only (X.1) — never true for non-owner
  GatesDto Gates);            // canComment, canSuggest, canBookmark (already resolved incl. anon + comments_policy)
```

### Tasks (in order)
```yaml
Task 1 — ENTITIES: CREATE ShareSetting.cs (PK song_version_id, mirror Subscription.cs) + Invite.cs.
Task 2 — CONTEXT: ADD DbSets; OnModelCreating CHECK constraints + unique(token) + now() defaults; FK song_versions CASCADE.
Task 3 — MIGRATION: ef migrations add AddVersionSharing; append raw SQL for partial-unique share_token index;
         APPEND idempotent feature-flag seed: INSERT INTO feature_flags(name,value) VALUES ('room_hosting_enabled','false'),
         ('room_host_min_tier','"pro"') ON CONFLICT (name) DO NOTHING. Run database update to verify.
         LAUNCH POSTURE (product decision 2026-06-25): room_hosting_enabled=false — Room hosting is OFF for the general user
         base (everyone gets Work/View only); the admin hosts the sole Room(s) by flipping the flag operationally. This is
         what lets PRP-4 G5 (hosting metering) defer. min_tier='pro' is the default once hosting is later enabled.
Task 4 — MIRROR: add ShareSetting + Invite to shared/aimusic_shared/models.py.
Task 5 — SERVICE: CREATE AccessService.cs (DI-register in Program.cs like EntitlementService). Implement ResolveAsync
         per the resolution rules below; read flags via EntitlementService/GetFlagsAsync.
Task 6 — DTOs: CREATE ShareDtos.cs (records).
Task 7 — OWNER ENDPOINTS: CREATE VersionShareEndpoints.cs:
         GET/PUT /api/versions/{id}/share (read/upsert settings; PUT mints token when leaving private),
         POST /api/versions/{id}/share/rotate, invites: POST + GET /api/versions/{id}/invites, DELETE /api/invites/{id},
         POST /api/invites/{token}/accept, GET /api/versions/{id}/access. All owner-gated except access (any authed) + accept.
Task 8 — PUBLIC ENDPOINTS: CREATE VersionViewEndpoints.cs (AllowAnonymous):
         GET /api/v/{token} -> { version summary, current-analysis summary, anon Gates }, GET /api/v/{token}/audio (Range).
Task 9 — REGISTER in Program.cs (Map*Endpoints + AccessService DI).
Task 10 — FRONTEND: types (ShareSettingsDto/AccessDto/InviteDto) + hooks (useVersionShare/useVersionAccess/useInvites)
          + anon route _public/v.$token.tsx (mirror r.$token.tsx).
Task 11 — TESTS + GATES.
```

### Resolution rules (AccessService.ResolveAsync — pseudocode)
```text
load version (+ song.owner) tracked-or-not; settings = share_settings[versionId] (null => treat visibility=private)
role = owner if version.song.user_id == actor.userId
     else invited if invites has (version, actor.userId|email, status in {pending,accepted})
     else anon if actor is anonymous (came via /v/{token})
     else none
CanWork  = (role == owner)                                   # X.2
CanView  = (role==owner) || (visibility!=private && (visibility==public || role==invited || cameViaValidToken))
canComment = CanView && settings.comments_policy!='off' &&
             (settings.comments_policy=='link' ? true : role in {owner,invited})   # 'named' => account required (D4.4)
canSuggest = CanView && settings.suggestions_allowed && actorMayCreateDurableArtifact   # anon allowed (D4.4) but see PRP-3
canBookmark= CanView && settings.bookmarking_allowed
flags = GetFlagsAsync(); RoomHostable = (role==owner || (role==invited && host_policy=='invited'))
        && flags['room_hosting_enabled'] && tier >= flags['room_host_min_tier']
RoomJoinable = CanView && (join_policy=='public' || (join_policy=='link' && cameViaValidToken) || role==invited)
CoachAvailable = (role==owner)                                # X.1 — never for non-owner
return AccessDto{...}
```

### Integration Points
```yaml
DATABASE:
  - migration: "AddVersionSharing — share_settings(PK song_version_id) + invites; partial-unique share_token; feature-flag seed (idempotent)"
  - mirror: shared/aimusic_shared/models.py (EF-first)
DI:
  - Program.cs: builder.Services.AddScoped<AccessService>();  (mirror EntitlementService registration)
ROUTES:
  - Program.cs: api.MapVersionShareEndpoints(); api.MapVersionViewEndpoints();
FRONTEND:
  - hooks via fetcher.ts (authed) + anonFetcher (public /v/{token}); query keys ['versions',id,'share'|'access'|'invites'], ['v',token]
  - useVersionAccess(versionId) is what the (separate-thread) Work/View/Room switcher will read to enable/disable modes
FEATURE FLAGS:
  - room_hosting_enabled (bool), room_host_min_tier (tier string) — seeded; consumed by AccessService
```

## Validation Loop

### Level 1: Syntax & Style
```bash
cd components/bff && dotnet format && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
ruff check components/shared/ && mypy components/shared/aimusic_shared/ --ignore-missing-imports
```

### Level 2: Unit Tests
```bash
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run
pytest -q components/shared/tests/
```
Author (expected / edge / failure):
- AccessService: owner gets CanWork+CoachAvailable (expected); invited reviewer gets View+comment-per-policy but NOT Work/coach (edge → X.1/X.2 invariants); anon on a private version gets none (failure/403).
- comments_policy='named' → anon canComment=false; ='link' → anon canComment=true (edge, D4.4).
- RoomHostable false when room_hosting_enabled flag off OR tier below room_host_min_tier (edge, Δ5).
- PUT share leaving 'private' mints a token; staying 'private' mints none; rotate replaces token (expected).
- **Existing ShareEndpoints tests remain green** (additive guarantee — no regression).
- Invite accept binds invited_user_id and flips status (expected); revoked invite grants no access (failure).

### Level 3: Integration
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
# Owner: PUT visibility=unlisted -> token minted; POST invite; GET /versions/{id}/access shows modes.
# Anon: open /v/{token} -> View resolves within gates; /v/{token}/audio streams (Range).
# Confirm old /share/{analysisToken} still works unchanged.
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] Migration applies/reverts; CHECKs + partial-unique token index present; feature-flag seed idempotent; Python mirror imports.
- [ ] AccessService invariants proven (X.1 coach-owner-only, X.2 work-owner-only) by tests.
- [ ] Owner settings/rotate + invites CRUD/accept work; anon /v/{token}(+/audio) works.
- [ ] Existing analysis-share path untouched and green.
- [ ] No hardcoded tiers; room policy reads feature flags.
- [ ] Frontend tsc/lint/build/vitest green; types + hooks added; anon route renders.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
- ⛔ **G1 — anon audio/SSE auth via the share token is NOT the JWT `?t=` path.** `?t=` validates a *JWT* and is
  whitelisted to `/api/versions/.../audio` only (a deliberate prior security tightening). `/v/{token}` + `/v/{token}/audio`
  + (PRP-4) `/sessions/{id}/stream` use an **opaque share token**. RESOLVE: build a dedicated share-token-resolution
  middleware (opaque token → `share_settings` → version, AllowAnonymous), separate from JwtBearer. Do NOT widen the JWT
  `?t=` whitelist to accept opaque tokens.
- ⛔ **G2 — stable anonymous identity is undesigned.** The only mechanism (`ip_hash`, process-scoped salt) resets on
  restart and collides behind NAT, yet PRP-3/6 rely on clustering/dedup of an anon's artifacts. RESOLVE: on first
  `/v/{token}` entry, issue a signed durable anon token (httpOnly cookie or client-persisted); key all anon dedup/
  attribution on it, not `ip_hash`. Shared dependency for PRP-3 (comments) and PRP-6 (bookmarks).
- ⚠ **G3 — tokens-in-URLs leak (known debt) is amplified.** New version + session tokens land in URLs/logs. Document the
  exposure and plan the HMAC-signed short-lived URL mitigation (CLAUDE.md) before public.
- ⚠ **G4 — AccessService has no cache despite per-action hot-path calls.** Mirror EntitlementService's 60s cache: a
  per-(version,actor) short-TTL entry invalidated on `share_settings`/`invite` writes — else busy Rooms hammer the DB.

## Anti-Patterns to Avoid
- Don't modify analyses.share_token / ShareEndpoints / the comment+bookmark CHECK — additive only.
- Don't auto-publish existing versions — default private.
- Don't model in Python first (EF owns schema).
- Don't AsNoTracking the owner-write lookups.
- Don't grant coach or Work to non-owners (X.1/X.2) — encode as tested invariants.
- Don't hardcode tier numbers — resolve room policy via feature_flags + EntitlementService.
- Don't re-target track_comments/track_bookmarks here (PRP-3/PRP-6 own that).
- Don't invent a second token recipe — reuse ShareEndpoints.GenerateToken().
