name: "Listen V3 · PRP-3 — View Feedback Layer: Threaded Comments + Suggestion Convergence"
description: |
  The View mode data layer. Extends the existing track_comments into version-scoped, threaded, status-bearing
  comments, and introduces the Suggestion — the SINGLE convergence point for every non-owner chain proposal
  (async View reviewer AND, later, live Room grantee — decision D4.3). Accept = fork-to-preset, reusing PRP-1's
  apply loop; cherry-pick is client-side only (no per-param merge records). Depends on PRP-1 (RackPreset + apply
  loop) and PRP-2 (AccessService gates). This is the slice that finally migrates the track_comments polymorphic
  CHECK — done once, here.

## Purpose
View mode is "play a track, leave feedback." Its whole right rail is the comment + suggestion surface. Today
`track_comments` exists but is analysis/share-token-scoped, flat, status-less, and has no concept of a proposed
rack chain. This PRP makes comments version-scoped + threaded + author-moderated, and adds `Suggestion` so a
reviewer (or anon viewer) can propose a full rack chain that the owner can audition and adopt.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Reuse, don't reinvent (apply loop, anon pattern, AccessService).

---

## Goal
- **Extend `track_comments`** (additive migration, finally touching the polymorphic CHECK — once): add
  `target_version_id`, `parent_id` (threading), `status` (open|resolved|pinned|hidden), `suggestion_id`. Keep the
  existing `target_share_token` path working.
- **New `suggestions` table** — `{ song_version_id, from_actor(user|anon), chain_json, comment_id?, created_in_session_id?, status }`.
  The proposed chain lives **on the suggestion** (D4.3: the proposer keeps no library copy); a real `RackPreset`
  only materializes on accept.
- **Accept = fork-to-preset** — load the suggestion's `chain` into the owner's draft → owner edits → save as the
  owner's `RackPreset` with `from_suggestion_id` provenance (credit chain to the proposer, D4.5). Adds
  `from_suggestion_id` (nullable FK) to `rack_presets`.
- **Endpoints** — version comments (list/post/patch-status/delete) + suggestions (list/create/accept/reject), all
  gated through `AccessService` (PRP-2). Anonymous participation per gates (D4.4).

## Why
- **It IS View mode.** Decisions D2.1 (threaded comments), D2.2/D2.3 (suggestion + fork-to-preset), D4.3 (the
  unified non-owner-proposal path). The UI thread is already mocking against these shapes (see
  `design_handoffs/.../LISTEN_V3_UI_CONTRACT.md`).
- **One CHECK migration.** PRP-2 deliberately left `track_comments` untouched; this slice owns the re-target so
  the polymorphic CHECK is migrated exactly once.
- **Proves the convergence claim.** The same `Suggestion` + accept path is reused verbatim by Room grantee-saves
  in PRP-4 (just with `created_in_session_id` set) — building it cleanly here is what makes that free.

## What
Reviewers/viewers leave timestamped + general comments in threads; the version owner resolves/pins/hides them;
a viewer proposes a rack chain; the owner auditions (client-side apply) and accepts (forks into their library).
Technical: 1 extended table + 1 new table (+ 1 column on rack_presets), Python mirror, `FeedbackEndpoints.cs`,
frontend hooks. No new worker actors (all synchronous CRUD).

### Success Criteria
- [ ] `track_comments` extended (target_version_id, parent_id, status, suggestion_id); polymorphic CHECK now
      "exactly one of {target_share_token, target_published_track, target_version_id}" via raw SQL; existing
      share-token comments still resolve.
- [ ] `suggestions` table created; `rack_presets.from_suggestion_id` added (nullable FK). Python mirror updated.
- [ ] Comments: list (threaded) / post (anon per gates) / patch-status (owner-only) / soft-delete (author or owner).
- [ ] Suggestions: create (gated by `gates.canSuggest`) / accept (owner-only → forks a `RackPreset`, status=accepted)
      / reject (owner-only). Audition is client-side via the PRP-1 apply loop (no endpoint).
- [ ] Every endpoint authorizes through `AccessService.ResolveAsync` (canView/canComment/canSuggest/owner).
- [ ] All validation gates pass; existing `ShareEndpoints` comment tests still green.

## All Needed Context

### Documentation & References
```yaml
# DECISIONS + CONTRACT
- file: _bmad-output/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: D2.1 (threaded, version-scoped, status), D2.2/D2.3 (suggestion + fork-to-preset, cherry-pick UI-only),
       D4.3 (unified non-owner path, no library copy), D4.4 (full anon), D4.5 (credit + notify), X.1 (no coach in View).
- file: PRPs/design_handoffs/design_handoff_listen_rack/LISTEN_V3_UI_CONTRACT.md
  why: CommentDto / SuggestionDto / ActorRef the UI mocks against. NOTE: correct SuggestionDto to carry `chain: Chain` (not `rackPreset`).
- file: _bmad-output/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: Δ2 (chain currency), Δ4 (reuse anon + verdict_user_state patterns — but see modeling note: comment status is a COLUMN, not a per-user overlay).

# DEPENDENCIES (this PRP builds on)
- file: PRPs/listen-v3-rack-preset-foundation.md
  why: RackPreset + Chain shape + applyChainToGraph/snapshotChainFromGraph (audition + accept reuse these). NOTE rack_presets has NO user_id (version-scoped, PRP-1) — the accepted fork is owned via the owner's version; from_suggestion_id added here; source stays 'user' (the `reviewer` source value was dropped — credit lives on from_suggestion_id).
- file: PRPs/listen-v3-version-sharing-permissions.md
  why: AccessService.ResolveAsync(versionId, actor) -> AccessDto{ canView, gates{canComment,canSuggest}, role }. Every endpoint gates through it.

# EXISTING SURFACE TO EXTEND / MIRROR
- file: components/bff/src/Spectr.Data/Entities/TrackComment.cs
  why: current track_comments (+ track_bookmarks) — anon triple (author_user_id nullable + author_display_name + author_ip_hash), polymorphic CHECK, timestamp_seconds, deleted_at. EXTEND this entity.
- file: components/bff/src/Spectr.Bff/Endpoints/ShareEndpoints.cs
  why: existing /share/{token}/comments GET+POST (anon author capture: display name trim + SHA256(ip)+process salt). Reuse that anon-capture helper. DO NOT break these endpoints.
- file: components/bff/src/Spectr.Data/AppDbContext.cs
  why: where the polymorphic CHECK is configured (~112-119) — change it here; add suggestions config + indexes.
- file: components/bff/src/Spectr.Bff/Endpoints/VersionEndpoints.cs
  why: TRACKED ownership lookup pattern (AsNoTracking trap) + ErrorEnvelope.Build 403 gate pattern.
- file: components/shared/aimusic_shared/models.py
  why: mirror the extended TrackComment + new Suggestion + the rack_presets column AFTER the EF migration (models.py:1-6, EF-first).
- file: components/frontend-spectr-v2/src/routes/_public/r.$token.tsx
  why: existing anon comment hooks (useShareComments/usePostShareComment) — pattern for the new version comment hooks (authed + anon).
```

### Desired tree (files added/changed)
```bash
components/bff/src/
  Spectr.Data/Entities/TrackComment.cs          # CHANGE: + TargetVersionId, ParentId, Status, SuggestionId
  Spectr.Data/Entities/Suggestion.cs            # NEW
  Spectr.Data/Entities/RackPreset.cs            # CHANGE: + FromSuggestionId (nullable FK suggestions)
  Spectr.Data/Migrations/<ts>_AddViewFeedback.cs  # cols + new table + raw-SQL CHECK swap + indexes
  Spectr.Bff/Endpoints/FeedbackEndpoints.cs     # NEW: version comments + suggestions resource group
  Spectr.Bff/DTOs/FeedbackDtos.cs               # NEW: CommentDto, PostCommentRequest, PatchCommentStatusRequest, SuggestionDto, CreateSuggestionRequest
  Spectr.Bff/Services/AnonActor.cs              # NEW (or extract from ShareEndpoints): display-name trim + SHA256(ip)+salt helper (shared by share + version comments)
components/shared/aimusic_shared/models.py       # mirror changes
components/frontend-spectr-v2/src/features/listen/
  useComments.ts                                 # list/post/patchStatus/delete (authed + anon)
  useSuggestions.ts                              # list/create/accept/reject (+ client-side audition via applyChainToGraph)
```

### Known Gotchas & Library Quirks
```text
# CRITICAL (the CHECK swap): EF can't express the 3-way XOR fluently. In the migration Up(): DROP the existing
#   2-way CHECK on track_comments, ADD a 3-way "exactly one of {target_share_token, target_published_track,
#   target_version_id} IS NOT NULL". Provide the exact inverse in Down(). Existing rows have target_share_token set => still valid.
# CRITICAL (additive): existing /share/{token}/comments must keep working (target_share_token path). New version
#   comments use target_version_id. Same table, different target column.
# CRITICAL (EF-first + AsNoTracking trap + tracked ownership): as in PRP-1/2.
# CRITICAL (authority): gate EVERY endpoint via AccessService — canView to read, gates.canComment to post a comment,
#   gates.canSuggest to propose, role==owner to patch status / accept / reject. Never trust client.
# CRITICAL (X.1): no coach anything in View — this PRP adds no coach endpoints; coachAvailable stays owner-only.
# MODELING NOTE (don't over-model): comment.status + suggestion.status are AUTHOR-OWNED SINGLE VALUES (columns),
#   NOT verdict_user_state-style per-user overlays. A comment has one moderator (the version owner). Do not add a
#   per-(comment,user) table.
# MODELING NOTE (no phantom preset): the suggestion carries chain_json directly (D4.3 — proposer keeps no library
#   copy). A RackPreset is created ONLY on accept (owner's library, source='user', from_suggestion_id=<sugg>). The
#   credit chain (D4.5) is preset.from_suggestion_id -> suggestion.from_actor.
# GOTCHA (anon, D4.4): commentsPolicy resolves in AccessService.gates already; still capture anon author via the
#   shared AnonActor helper (display name trim 120 + SHA256(ip) + process salt). suggestionsAllowed likewise gates canSuggest.
# GOTCHA (threading): parent_id is a nullable self-FK; store arbitrary depth, the UI renders one level. Index (target_version_id), (parent_id).
# GOTCHA (bidirectional link): set suggestion.comment_id AND comment.suggestion_id in the SAME SaveChanges when a
#   suggestion attaches to a comment (both nullable FKs; no hard cycle).
# SEAM (notifications): comment-created / suggestion-created / suggestion-accepted should emit a notification event
#   (PRP-7 owns the Notification table). For now: call a no-op INotificationSink (or TODO marker) so PRP-7 wires in cleanly.
#   Anon proposers can't be notified async (D4.5) — fine.
# SCOPE: no Room (PRP-4), no bookmarks (PRP-6), no game plan (PRP-5). created_in_session_id is a nullable column
#   present-but-unused until PRP-4. No new dramatiq actor (all synchronous).
```

## Implementation Blueprint

### Data models (C#)
```csharp
// TrackComment.cs (EXTEND) -> track_comments
//   + target_version_id (uuid? FK song_versions), + parent_id (uuid? self-FK track_comments),
//   + status (varchar10 CHECK open|resolved|pinned|hidden, default 'open'),
//   + suggestion_id (uuid? FK suggestions).  Keep author triple + timestamp_seconds + deleted_at.
//   3-way polymorphic CHECK via raw SQL.  Indexes (target_version_id),(parent_id).

// Suggestion.cs (NEW) -> suggestions
//   id (uuid PK), song_version_id (uuid FK song_versions),
//   from_user_id (uuid? FK users), from_display_name (varchar120?), from_ip_hash (bytea?),   // ActorRef (anon-capable)
//   chain_json (jsonb),                            // the proposed Chain (D4.3 — lives here, not a RackPreset)
//   comment_id (uuid? FK track_comments),          // attached comment, if any
//   created_in_session_id (uuid? — no FK yet, PRP-4),  via_grant_id (uuid? — no FK yet, PRP-4),  // Room provenance (rides onto the adopted preset, D4.5)
//   status (varchar10 CHECK proposed|auditioned|accepted|rejected, default 'proposed'),
//   created_at, resolved_at (timestamptz?).  Index (song_version_id),(from_user_id).

// RackPreset.cs (EXTEND) -> rack_presets
//   + from_suggestion_id (uuid? FK suggestions)    // provenance when created by accepting a suggestion (D4.5 credit chain)
```

### DTOs (camelCase wire)
```csharp
record CommentDto(string Id, string TargetVersionId, string? ParentId, double? T, ActorRefDto Author,
                  string Body, string Status, string? SuggestionId, DateTime CreatedAt, DateTime? DeletedAt);
record PostCommentRequest(string? ParentId, double? T, string Body, string? AuthorDisplayName);   // displayName only used for anon
record PatchCommentStatusRequest(string Status);
record SuggestionDto(string Id, string SongVersionId, ActorRefDto FromActor, ChainDto Chain,
                     string? CommentId, string? CreatedInSessionId, string Status, DateTime CreatedAt);
record CreateSuggestionRequest(string? CommentId, ChainDto Chain);
record ActorRefDto(string Type, string? UserId, string? Handle, string? DisplayName, int? Hue);
```

### Tasks (in order)
```yaml
Task 1 — ENTITIES: EXTEND TrackComment.cs (4 cols); CREATE Suggestion.cs; EXTEND RackPreset.cs (from_suggestion_id).
Task 2 — CONTEXT: DbSet<Suggestion>; OnModelCreating — swap polymorphic CHECK (raw SQL), CHECK status enums,
         FKs (parent self-FK, suggestion<->comment, rack_presets.from_suggestion_id), indexes.
Task 3 — MIGRATION: ef migrations add AddViewFeedback; hand-edit Up()/Down() for the CHECK swap + any partial index. Run update.
Task 4 — MIRROR: shared/models.py — extend TrackComment, add Suggestion, add rack_presets column.
Task 5 — ANON HELPER: extract AnonActor.cs (display-name trim + SHA256(ip)+salt) from ShareEndpoints; reuse in both.
Task 6 — DTOs: FeedbackDtos.cs.
Task 7 — ENDPOINTS: FeedbackEndpoints.cs (below), register in Program.cs. Gate every route via AccessService.
Task 8 — FRONTEND: useComments.ts + useSuggestions.ts (audition = applyChainToGraph(graph, suggestion.chain)).
Task 9 — CONTRACT FIX: update LISTEN_V3_UI_CONTRACT.md SuggestionDto: `rackPreset` -> `chain: Chain`. (done in this thread)
Task 10 — TESTS + GATES.
```

### Endpoints + pseudocode
```text
GET   /api/versions/{id}/comments      gate: access.canView            -> threaded CommentDto[]
POST  /api/versions/{id}/comments      gate: access.gates.canComment   body PostCommentRequest
        author = actor.IsAuthed ? userRef : AnonActor.capture(displayName, remoteIp)   // D4.4
        insert TrackComment{ target_version_id=id, parent_id, t, author..., body, status='open' }; 201 CommentDto
PATCH /api/comments/{id}               gate: role==owner               body { status }    // resolve/pin/hide
DELETE /api/comments/{id}              gate: author==actor || role==owner -> soft-delete (deleted_at=now())

GET   /api/versions/{id}/suggestions   gate: access.canView            -> SuggestionDto[] (owner sees all; reviewers see own + accepted)
POST  /api/versions/{id}/suggestions   gate: access.gates.canSuggest   body CreateSuggestionRequest { commentId?, chain }
        s = insert Suggestion{ song_version_id=id, from=actorRef, chain_json=chain, comment_id, status='proposed' }
        if commentId: set comment.suggestion_id = s.id   (same SaveChanges)
        notify(owner, 'suggestion_created')  // INotificationSink no-op until PRP-7
        201 SuggestionDto
POST  /api/suggestions/{id}/accept     gate: role==owner               // fork-to-preset (D2.3)
        s = tracked load (ownership via s.song_version.song.user_id == actor)
        preset = insert RackPreset{ song_version_id=s.song_version_id, source='user',   // no user_id — owned via the version (PRP-1)
                                    chain_json=s.chain_json, from_suggestion_id=s.id, name="From @"+s.fromHandle,
                                    via_grant_id=s.via_grant_id, created_in_session_id=s.created_in_session_id }  // credit chain rides on (D4.5)
        s.status='accepted'; s.resolved_at=now(); SaveChanges
        notify(s.from_user_id, 'suggestion_accepted')  // best-effort; anon => skip (D4.5)
        200 RackPresetDto    // client then applyChainToGraph + lets owner tweak/save again if desired
POST  /api/suggestions/{id}/reject     gate: role==owner -> s.status='rejected'; 200
# AUDITION has NO endpoint: client calls applyChainToGraph(graph, suggestion.chain) — non-destructive preview.
```

### Integration Points
```yaml
DATABASE:
  - migration: "AddViewFeedback — extend track_comments (+3-way CHECK), new suggestions, rack_presets.from_suggestion_id"
  - mirror: shared/models.py (EF-first)
ROUTES: Program.cs -> api.MapFeedbackEndpoints();
SERVICES: reuse AccessService (PRP-2); add INotificationSink no-op interface (PRP-7 implements)
FRONTEND: hooks via fetcher.ts (authed) + anonFetcher (anon comment/suggest on /v/{token}); audition reuses PRP-1 applyChainToGraph
```

## Validation Loop
### Level 1
```bash
cd components/bff && dotnet format && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
ruff check components/shared/ && mypy components/shared/aimusic_shared/ --ignore-missing-imports
```
### Level 2
```bash
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run
pytest -q components/shared/tests/
```
Author (expected / edge / failure):
- Comment post: authed user posts (expected); anon posts when commentsPolicy='link' (edge); anon blocked when 'named' (failure, via gates).
- Threading: reply with parentId nests; list returns tree/flat-with-parent (expected).
- Status: only owner can PATCH resolve/pin/hide (failure when reviewer tries → 403).
- Suggestion accept: owner accept forks a RackPreset with from_suggestion_id + status=accepted (expected);
  non-owner accept → 403 (failure); reject sets status (edge).
- **Existing /share/{token}/comments still works** (additive CHECK migration didn't break share-token comments).
- CHECK: inserting a comment with two targets set → DB rejects (failure).
### Level 3
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
# unlisted version: reviewer posts timestamped comment + a suggestion; owner auditions (apply loop) then accepts -> appears in owner library.
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] Migration applies/reverts; 3-way CHECK correct; share-token comments still resolve; Python mirror imports.
- [ ] All endpoints gated by AccessService; owner-only actions enforced + tested.
- [ ] Suggestion carries chain; accept forks RackPreset(from_suggestion_id); audition is client-side apply.
- [ ] Anon comment/suggest works under 'link'/suggestionsAllowed; blocked under 'named'/disabled.
- [ ] Frontend tsc/lint/build/vitest green; hooks added; contract doc SuggestionDto corrected to `chain`.
- [ ] No coach in View; no Room/bookmark/game-plan scope crept in.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
- ⛔ **G1 — drain-to-GamePlan is a backward dependency vs build order.** PRP-5 wants accept-suggestion to insert a
  `game_plan_item` "same-tx," but PRP-5 is built AFTER this. RESOLVE: define the seam as `IGamePlanSink` (no-op until
  PRP-5 implements it), called in the same `SaveChanges` — exactly like the `INotificationSink` pattern. Accept must NOT
  depend on PRP-5 code directly.
- ⚠ **G2 — anon comment/suggestion creation has no rate limit.** Full anon participation + @mention notifications =
  spam vector. Specify a per-anon-token (PRP-2 G2) + per-IP rate limit on comment/suggestion create.
- ⚠ **G3 — "suggestion" is overloaded.** `compare_cache.suggestions` (JSONB), the new `Suggestion` entity, and
  `GamePlanItem(source=reviewer)` are three different things. Name the entity `ReviewerSuggestion` in code and document the
  disambiguation to avoid query/implementer confusion.

## Anti-Patterns to Avoid
- Don't break /share/{token}/comments — additive CHECK swap only.
- Don't model comment/suggestion status as a per-user overlay — it's an author-owned column.
- Don't mint a phantom reviewer RackPreset — the suggestion carries the chain; preset materializes on accept.
- Don't add per-param merge records — cherry-pick is client-side editing before save.
- Don't trust the client for authority — gate every route via AccessService.
- Don't model in Python first; don't AsNoTracking the write lookups.
- Don't add coach to View (X.1).
