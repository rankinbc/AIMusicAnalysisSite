name: "Listen V3 · PRP-6 — Bookmarking: version target, timestamp, anon fallback & author signal"
description: |
  Small additive slice. Extends the existing track_bookmarks to bookmark a VERSION (not just an analysis share),
  optionally at a timestamp + with a note, with anonymous bookmarking support and the author-facing aggregate signal
  (count by default, named identity only on opt-in, anon always anonymous — D5.4). Owns the SECOND 3-way polymorphic
  CHECK migration (track_bookmarks; PRP-3 did track_comments). Reuses the anon-actor helper (PRP-3) + the bookmarking
  gate (PRP-2). No new worker actor.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Additive — don't break the existing analysis-share bookmark path.

---

## Goal
- **Extend `track_bookmarks`**: add `target_version_id` (+ 3-way polymorphic CHECK), `t_seconds`, `note`,
  `identity_visible` (D5.4 opt-in), and make it **anon-capable** (nullable `user_id` + `bookmarker_display_name` +
  `bookmarker_ip_hash`, mirroring the track_comments anon triple).
- **Anon fallback (D4.4):** an anon viewer on a shared version can bookmark — a server row is created (anonymously,
  via ip_hash) so it counts toward the author's signal, while the anon's own "my bookmarks" retrieval is browser-local
  (no durable account library).
- **Author signal (D5.4):** `GET /versions/{id}/bookmarks/signal` → aggregate count + the subset of named bookmarkers
  who opted into visibility; anon always counted anonymously.
- Gated by `bookmarking_allowed` / `AccessService.gates.canBookmark` (PRP-2). No new worker actor.

## Why
- Completes the View capability set (comments ✓ PRP-3, suggestions ✓ PRP-3, **bookmarking** here). D5.4 + D4.4.
- Owns the one remaining polymorphic-CHECK migration (track_bookmarks) so it's done once, additively.

## What
A viewer (named or anon) bookmarks a version, optionally at a moment, optionally with a note; named viewers may opt to
let the author see they bookmarked; the author sees an aggregate count + opted-in identities. Technical: extend 1 table,
extend BookmarkEndpoints + 2 new routes, Python mirror, frontend hooks. No new actor.

### Success Criteria
- [ ] `track_bookmarks` extended (target_version_id, t_seconds, note, identity_visible, nullable user_id + anon triple);
      3-way polymorphic CHECK via raw SQL; existing share-token bookmarks still work; Python mirror updated.
- [ ] Authed bookmark a version (+ optional t + note + identity_visible) via extended `POST /me/bookmarks`; dedup preserved.
- [ ] Anon bookmark on a shared version via `POST /v/{token}/bookmark` (gated canBookmark; ip_hash; resolves version from token).
- [ ] `GET /versions/{id}/bookmarks/signal` (owner) returns { count, identified: ActorRef[] } — count includes anon
      anonymously; only identity_visible=true named bookmarkers are identified.
- [ ] All routes gated via AccessService (canBookmark to create; owner for signal). All validation gates pass.

## All Needed Context
```yaml
# DECISIONS + RECONCILIATION
- file: docs/archive/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: D5.4 (aggregate count default, identity opt-in, anon anonymous), D4.4 (full anon; anon bookmark needs local fallback).
- file: docs/archive/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: Bookmark row = EXTEND track_bookmarks; PRP-6 owns the bookmark re-target + 2nd 3-way CHECK; reuse anon pattern (Δ4).

# EXISTING SURFACE TO EXTEND
- file: components/bff/src/Spectr.Data/Entities/TrackComment.cs
  why: track_bookmarks lives here (~43-60): user_id (currently required), polymorphic target + CHECK, created_at. EXTEND it. The track_comments anon triple (same file) is the pattern for anon bookmarks.
- file: components/bff/src/Spectr.Bff/Endpoints/BookmarkEndpoints.cs
  why: existing POST/GET/DELETE /me/bookmarks + XOR target validation (~84-90) + dedup. EXTEND for version target; keep share_token path.
- file: components/bff/src/Spectr.Bff/Endpoints/VersionViewEndpoints.cs   (PRP-2)
  why: the anon /v/{token} surface — add POST /v/{token}/bookmark here.
- file: components/bff/src/Spectr.Bff/Services/AnonActor.cs   (PRP-3)
  why: reuse the display-name-trim + SHA256(ip)+salt helper for anon bookmarks.
- file: components/bff/src/Spectr.Bff/Services/AccessService.cs   (PRP-2)
  why: gates.canBookmark (create) + owner (signal).
- file: components/bff/src/Spectr.Data/AppDbContext.cs
  why: the track_bookmarks polymorphic CHECK config (~116-119) — migrate to 3-way here; add indexes.
- file: components/shared/aimusic_shared/models.py
  why: mirror the extended TrackBookmark AFTER the migration (EF-first).
- file: components/frontend-spectr-v2/src/api/types.ts
  why: existing bookmark DTOs; extend + add BookmarkSignalDto. Frontend anon "my bookmarks" = localStorage fallback.
```

### Desired tree
```bash
components/bff/src/
  Spectr.Data/Entities/TrackComment.cs        # CHANGE (TrackBookmark): + target_version_id, t_seconds, note, identity_visible, nullable user_id + anon triple
  Spectr.Data/Migrations/<ts>_AddVersionBookmarks.cs   # cols + 3-way CHECK (raw SQL) + indexes
  Spectr.Bff/Endpoints/BookmarkEndpoints.cs   # EXTEND /me/bookmarks; + GET /versions/{id}/bookmarks/signal
  Spectr.Bff/Endpoints/VersionViewEndpoints.cs # + POST /v/{token}/bookmark (anon)
  Spectr.Bff/DTOs/BookmarkDtos.cs             # extend BookmarkDto/CreateBookmarkRequest; + BookmarkSignalDto
components/shared/aimusic_shared/models.py
components/frontend-spectr-v2/src/features/listen/
  useBookmarks.ts                              # bookmark/list/delete/toggle-identity + anon localStorage fallback
  useBookmarkSignal.ts                         # author aggregate
```

### Known Gotchas
```text
# CRITICAL (2nd CHECK swap): migrate track_bookmarks polymorphic CHECK from 2-way to 3-way (exactly one of
#   {target_share_token, target_published_track, target_version_id}) via raw SQL in Up()/Down(). Existing rows have
#   target_share_token set => still valid. (PRP-3 did the same to track_comments.)
# CRITICAL (nullable user_id): track_bookmarks.user_id becomes nullable for anon rows. Authed rows keep user_id (CASCADE
#   on user delete as today); anon rows use bookmarker_ip_hash. GET /me/bookmarks filters user_id == me (anon rows never appear there).
# ANON MODEL (D5.4 + D4.4): an anon bookmark creates a server row (anonymous, ip_hash) so it COUNTS toward the author
#   signal — but the anon's personal "my bookmarks" view is browser-local (no durable account library). Dedup anon by (ip_hash, target_version_id, t_seconds).
# SIGNAL (D5.4): default = count only. identity_visible=true (named bookmarkers, opt-in) surfaces their ActorRef.
#   Anon NEVER identified. Owner-only endpoint.
# GOTCHA (EF-first, AsNoTracking trap, gate via AccessService): as in prior PRPs.
# SCOPE: no notifications here (PRP-7 may digest bookmark events). No worker actor.
```

## Implementation Blueprint
```csharp
// TrackBookmark (EXTEND) -> track_bookmarks
//   user_id (uuid? NOW NULLABLE FK users),
//   + bookmarker_display_name (varchar120?), + bookmarker_ip_hash (bytea?),   // anon triple
//   + target_version_id (uuid? FK song_versions),
//   + t_seconds (double?), + note (varchar280?), + identity_visible (bool default false),
//   3-way polymorphic CHECK (raw SQL).  Index (target_version_id).
```
```text
POST /api/me/bookmarks            gate canBookmark   body { targetVersionId?, targetShareToken?, t?, note?, identityVisible? }  (authed; dedup)
POST /api/v/{token}/bookmark      gate canBookmark   body { t?, note? }   (anon; AnonActor.capture(ip); resolves version from token; dedup by ip_hash)
GET  /api/me/bookmarks            authed             -> BookmarkDto[]  (extended with version targets + t + note)
DELETE /api/me/bookmarks/{id}     authed (own)
GET  /api/versions/{id}/bookmarks/signal   owner     -> { count, identified: ActorRef[] }   // count incl. anon anonymously; identified = identity_visible named only
```

### Tasks
```yaml
Task 1 — ENTITY: extend TrackBookmark (cols + nullable user_id + anon triple).
Task 2 — CONTEXT: OnModelCreating — 3-way CHECK swap (raw SQL), index (target_version_id), FK song_versions.
Task 3 — MIGRATION: ef migrations add AddVersionBookmarks; hand-edit CHECK swap; run update.
Task 4 — MIRROR: shared/models.py.
Task 5 — DTOs + ENDPOINTS: extend BookmarkEndpoints (+ signal), add anon POST to VersionViewEndpoints; gate via AccessService; reuse AnonActor.
Task 6 — FRONTEND: useBookmarks (+ anon localStorage fallback) + useBookmarkSignal.
Task 7 — TESTS + GATES.
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
- Authed bookmark a version with t+note (expected); dedup returns existing on repeat (edge); blocked when bookmarking_allowed=false → 403 (failure).
- Anon bookmark via /v/{token}: creates anonymous row counted in signal; dedup by ip_hash (edge).
- Signal: count includes anon anonymously; only identity_visible named bookmarkers identified; non-owner → 403 (failure, D5.4).
- **Existing /me/bookmarks share_token path still works** (additive CHECK migration).
- CHECK: two targets set → DB rejects (failure).
### Level 3
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
# named viewer bookmarks a version at 1:24 with a note + opts in -> author signal shows count=1 + their handle;
# anon (via /v/{token}) bookmarks -> count=2, still one identified.
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] Migration applies/reverts; 3-way CHECK; share-token bookmarks still resolve; Python mirror imports.
- [ ] Version bookmark (+t+note+identity) authed; anon bookmark via /v/{token}; both gated by canBookmark.
- [ ] Signal: count default (anon anonymous), identity opt-in only; owner-gated.
- [ ] Frontend gates green; anon "my bookmarks" localStorage fallback works.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
- ⚠ **G1 — anon bookmark dedup "by ip_hash" is unstable.** `ip_hash` uses a process-scoped salt that resets on restart and
  collides behind NAT, so dedup + the "anon counted once" signal break on every deploy. RESOLVE: dedup (and count) on the
  **durable anon token from PRP-2 G2**, not `ip_hash`. Until PRP-2 G2 lands, anon bookmark counting is best-effort — say so.

## Anti-Patterns to Avoid
- Don't break /me/bookmarks share_token path — additive 3-way CHECK only.
- Don't identify anon bookmarkers or non-opted-in named ones in the signal (D5.4).
- Don't store anon "my bookmarks" server-side as a retrievable library — server row is for the count; retrieval is browser-local (D4.4).
- Don't model in Python first; don't AsNoTracking write lookups; gate via AccessService.
- Don't add a worker actor.
