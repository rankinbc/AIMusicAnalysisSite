name: "Listen V3 · PRP-7 — In-App Notifications: unified center, per-event + rolling digest"
description: |
  Final slice. Implements the INotificationSink seam the prior PRPs already call into, a unified Notification table,
  and the in-app notification center. High-signal events (new comment, new suggestion, suggestion accepted / preset
  adopted, @mention) are per-event rows; noisy events (bookmarks) collapse into a rolling daily DIGEST via a
  partial-unique upsert (the codebase's existing idempotency pattern) — so NO scheduler is needed. In-app only
  (no email, D7.2); anon recipients are a no-op (D4.5). Small. No new worker actor.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Implement the seam the other PRPs already declared — don't change their call sites' shape.

---

> **Seam reconciliation (2026-06-26 — READ BEFORE BUILDING):** this PRP is NOT-STARTED, but the upstream `INotificationSink` seam already SHIPPED with a different shape than the `Notify(...)`/`NotifyDigest(...)` pseudo-code below. Build against the **as-built seam** (`Services/INotificationSink.cs`):
> - `Task NotifyAsync(ActorRef recipient, string eventType, IReadOnlyDictionary<string, object?> data, CancellationToken ct = default)`
> - `Task NotifyDigestAsync(ActorRef recipient, string digestType, CancellationToken ct = default)`
> Key drifts from the inline sketch:
> 1. **Async `Task`**, method names are `NotifyAsync` / `NotifyDigestAsync` (not `void Notify` / `NotifyDigest`).
> 2. **Recipient is `ActorRef`** (User|Anon, see `Services/ActorRef.cs`), NOT `Guid? recipientUserId`. Anon no-op (D4.5) = check `recipient.Type == ActorType.Anon`.
> 3. **Payload is `IReadOnlyDictionary<string, object?> data`**, NOT positional `(refType, refId, actor)`. The real impl **unpacks** the dict (e.g. `data["commentId"]`, `data["versionId"]`) into the table columns.
> 4. `NotifyDigestAsync` takes only `(recipient, digestType)` — **no `versionId`/`actor`**; build the `digest_key` inside the service.
> - **Real call sites** already feeding the no-op sink (`FeedbackEndpoints.cs`): `NotifyAsync(ActorRef.User(oid), "comment_created", {…}, ct)` (:152), `"suggestion_created"` (:220), `NotifyAsync(ActorRef.User(pu), "suggestion_accepted", {…})` (:333).
> - **Bookmark digest is NOT wired:** `BookmarkEndpoints` makes no `NotifyDigestAsync` call. PRP-7 must add the `bookmark_digest` call site (or scope it explicitly).

## Goal
- **`notifications`** — `{ recipient_user_id, type, ref_type, ref_id, actor_ref, count, read, digest_key, created_at }`.
- **`INotificationSink`** (real impl replacing the no-op seam from PRP-3/4/6) — `Notify(...)` (per-event) +
  `NotifyDigest(...)` (rolling upsert keyed by `digest_key`). Anon recipient (no user id) → no-op (D4.5).
- **Per-event** (D7.3): `comment_created`, `suggestion_created`, `suggestion_accepted` (= preset adopted, notify the
  proposer, D4.5), `mention` (parse `@handle` in comment bodies). **Digest** (D7.3): `bookmark_digest` — one rolling
  row per (recipient, version, day) with a `count`, via `INSERT … ON CONFLICT (digest_key) DO UPDATE count+1, read=false`.
- **In-app center** — `GET /me/notifications`, unread-count, mark-read / read-all. Polled by the frontend (SSE push deferred).

## Why
- Closes the loop the other slices opened: they emit events; this delivers them. D7.1–D7.3 + the D4.5 adoption-notify.
- The rolling-digest upsert means **no beat/scheduler dependency** (the `maintenance` queue is still empty) — bookmarks
  collapse at write time, not via a periodic job. In-app-only keeps email/push (which would need the scheduler) out of scope.

## What
A user sees a bell with an unread count and a list of notifications; high-signal items are individual, bookmarks are
summarized ("3 people bookmarked Aurora v3 today"). Technical: 1 table, the sink implementation + wiring the existing
call sites, `NotificationEndpoints.cs`, frontend hooks. No worker actor.

### Success Criteria
- [ ] `notifications` table via EF migration (+ raw SQL partial-unique on `digest_key`); Python mirror.
- [ ] `INotificationSink` implemented; the PRP-3 call sites (comment/suggestion/accept) + PRP-6 (bookmark) now produce rows;
      anon recipients are a no-op (D4.5).
- [ ] `@mention` parsing on comment create → `mention` notifications to resolved handles.
- [ ] Bookmarks collapse into one rolling daily `bookmark_digest` row per (recipient, version) with an incrementing `count`.
- [ ] `GET /me/notifications` (paged) + unread-count + mark-read + read-all, all recipient-scoped (IDOR-safe).
- [ ] All validation gates pass.

## All Needed Context
```yaml
# DECISIONS
- file: _bmad-output/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: D7.1 (unified Notification), D7.2 (in-app only, anon best-effort/none), D7.3 (per-event vs digest), D4.5 (adoption-notify).

# THE SEAM ALREADY DECLARED (implement, don't reshape)
- file: PRPs/listen-v3-view-feedback-suggestions.md
  why: PRP-3 declared "INotificationSink no-op" + the call sites: comment-created/suggestion-created/suggestion-accepted (notify proposer, skip anon). @mention parsing lands on comment-create here.
- file: PRPs/listen-v3-bookmarking.md
  why: PRP-6 bookmark-create → NotifyDigest(bookmark_digest, version). 
- file: PRPs/listen-v3-rack-preset-foundation.md
  why: "preset adopted" == suggestion_accepted forking a RackPreset (D4.5) — the proposer is notified.

# EXISTING PATTERNS TO REUSE
- file: components/bff/src/Spectr.Data/Entities/CreditLedgerEntry.cs
  why: the partial-unique idempotency_key pattern (+ raw SQL in migration) — mirror for notifications.digest_key.
- file: components/bff/src/Spectr.Data/Entities/WebhookEvent.cs
  why: INSERT … ON CONFLICT DO NOTHING/UPDATE idempotency precedent (the digest upsert).
- file: components/bff/src/Spectr.Bff/Endpoints/BookmarkEndpoints.cs
  why: /me/* endpoint + IDOR-by-user_id pattern to mirror for /me/notifications.
- file: components/bff/src/Spectr.Bff/Endpoints/JobEndpoints.cs
  why: if you add an SSE unread-push later, the SSE pattern is here — but PRP-7 ships POLLING (TanStack Query), SSE deferred.
- file: components/bff/src/Spectr.Data/Entities/User.cs
  why: handle (citext, unique) — @mention resolves a handle to a user id.
- file: components/shared/aimusic_shared/models.py
  why: mirror Notification AFTER the migration (EF-first).
- file: components/frontend-spectr-v2/src/api/fetcher.ts
  why: hooks via fetcher (no axios); poll unread-count via TanStack Query refetchInterval.
```

### Desired tree
```bash
components/bff/src/
  Spectr.Data/Entities/Notification.cs                 # NEW
  Spectr.Data/Migrations/<ts>_AddNotifications.cs       # table + partial-unique digest_key (raw SQL) + indexes
  Spectr.Bff/Services/INotificationSink.cs + NotificationService.cs   # implement the seam (replace the no-op)
  Spectr.Bff/Services/MentionParser.cs                 # @handle extraction -> user ids
  Spectr.Bff/Endpoints/NotificationEndpoints.cs        # /me/notifications (list/unread-count/read/read-all)
  Spectr.Bff/DTOs/NotificationDtos.cs
components/shared/aimusic_shared/models.py
components/frontend-spectr-v2/src/features/...
  useNotifications.ts                                   # list + unread-count (polled) + mark-read/read-all
```

### Known Gotchas
```text
# CRITICAL (digest upsert, no scheduler): noisy events DON'T create a row each — NotifyDigest UPSERTs by digest_key =
#   "bookmark:{versionId}:{yyyy-MM-dd}" via INSERT … ON CONFLICT (digest_key) DO UPDATE SET count=count+1, read=false,
#   updated_at=now(). Partial-unique index on digest_key WHERE digest_key IS NOT NULL (raw SQL in Up()/Down(), like credit_ledger.idempotency_key).
# CRITICAL (anon = no-op, D4.5): Notify/NotifyDigest take a recipient_user_id; if the recipient is anonymous (e.g. a
#   suggestion proposer with no account), the sink returns without inserting. No async path to anon.
# CRITICAL (same-tx emit): per-event Notify is called inside the source action's SaveChanges (PRP-3/6) so a notification
#   never exists for a rolled-back action. The sink enqueues the entity onto the same DbContext; the caller's SaveChanges persists it.
# GOTCHA (mention resolve): parse @handle tokens (citext unique on users.handle); ignore unknown handles; don't notify
#   the author about their own mention; cap mentions-per-comment (e.g. 10) to avoid abuse.
# GOTCHA (IDOR): /me/notifications strictly WHERE recipient_user_id == me. mark-read verifies ownership.
# GOTCHA (EF-first, AsNoTracking trap): as prior PRPs.
# SCOPE: in-app only (no email/push — would need the empty maintenance queue + a scheduler, deferred D7.2). POLLING, not SSE.
#   Reactions (live, in-Room) are NOT notified (covered by the session/recap); only bookmarks are digested.
```

## Implementation Blueprint
```csharp
// Notification.cs -> notifications
//   id (uuid PK), recipient_user_id (uuid FK users),
//   type (varchar32 CHECK comment_created|suggestion_created|suggestion_accepted|preset_adopted|mention|bookmark_digest),
//   ref_type (varchar24?), ref_id (uuid?), actor_ref (jsonb? — ActorRef for display),
//   count (int default 1), read (bool default false), digest_key (varchar128?),
//   created_at, updated_at.  Index (recipient_user_id, read, created_at); partial-unique(digest_key) WHERE digest_key IS NOT NULL (raw SQL).

interface INotificationSink {   // AS-BUILT (Services/INotificationSink.cs) — supersedes the older Notify/NotifyDigest sketch
  Task NotifyAsync(ActorRef recipient, string eventType, IReadOnlyDictionary<string, object?> data, CancellationToken ct = default);  // per-event; recipient.Type==Anon => no-op. Unpack data[] into columns.
  Task NotifyDigestAsync(ActorRef recipient, string digestType, CancellationToken ct = default);            // upsert by digest_key (built inside service)
}
```
```text
# wiring (call sites already exist as no-ops in PRP-3/6 — make them real):
PRP-3 comment-create   -> Notify(owner, 'comment_created', 'comment', commentId, actor)
                          + MentionParser(body) -> for each user: Notify(user, 'mention', 'comment', commentId, actor)
PRP-3 suggestion-create-> Notify(owner, 'suggestion_created', 'suggestion', sId, actor)
PRP-3 suggestion-accept-> Notify(proposerUserId, 'suggestion_accepted', 'rack_preset', presetId, ownerActor)   // D4.5; no-op if proposer anon
PRP-6 bookmark-create  -> NotifyDigest(owner, 'bookmark_digest', versionId, actor)

GET  /api/me/notifications            -> NotificationDto[] (paged, recipient=me, newest first)
GET  /api/me/notifications/unread-count-> { count }      (polled)
POST /api/me/notifications/{id}/read   -> mark one (own) read
POST /api/me/notifications/read-all     -> mark all read
```

### Tasks
```yaml
Task 1 — ENTITY: Notification.cs.
Task 2 — CONTEXT: DbSet + CHECK + index + partial-unique(digest_key) [raw SQL in migration].
Task 3 — MIGRATION: ef migrations add AddNotifications; hand-edit partial-unique; run update.
Task 4 — MIRROR: shared/models.py.
Task 5 — SERVICE: INotificationSink + NotificationService (per-event insert + digest upsert; anon no-op) + MentionParser. Register in DI (replace the no-op).
Task 6 — WIRE: ensure PRP-3 comment/suggestion/accept + PRP-6 bookmark call the real sink (same tx).
Task 7 — DTOs + ENDPOINTS: NotificationEndpoints (/me/notifications …); register in Program.cs.
Task 8 — FRONTEND: useNotifications (list + polled unread-count + mark-read/read-all); a bell/center is layout (page thread) — hooks+types here.
Task 9 — TESTS + GATES.
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
- Per-event: accepting a suggestion notifies the proposer (expected); proposer anon → no row (failure/no-op, D4.5).
- Digest: 3 bookmarks on one version same day → ONE bookmark_digest row, count=3 (edge — the upsert); next day → a 2nd row.
- Mention: "@maek nice" → a mention notification to maek; unknown @handle ignored; self-mention skipped (edge).
- Center: /me/notifications returns only my rows; marking another user's notification read → 403 (failure/IDOR).
- Same-tx: a comment-create that throws leaves NO notification (rolled back) (failure).
### Level 3
```bash
docker compose -f docker/docker-compose.yml up -d
cd components/bff/src/Spectr.Bff && dotnet run &
# reviewer comments + @mentions owner -> owner bell shows comment_created + mention; reviewer suggests -> suggestion_created;
# owner accepts -> reviewer gets suggestion_accepted; two anon bookmarks -> owner sees one "2 bookmarks" digest.
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] Migration applies/reverts; partial-unique digest_key; Python mirror imports.
- [ ] Sink real (replaces no-op); per-event rows for comment/suggestion/accept/mention; anon recipient no-op.
- [ ] Bookmarks collapse into rolling daily digest with count; no scheduler used.
- [ ] /me/notifications IDOR-safe; unread-count polled; mark-read/read-all work.
- [ ] In-app only (no email/push); reactions not notified; all gates green.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
- ⚠ **G1 — anon `@mention` is a spam-notification vector.** Anon comment authors (D4.4) can mint unbounded `mention`
  notifications to named users. RESOLVE: gate mention-notifications behind the anon comment rate limit (PRP-3 G2); consider
  suppressing mentions authored by anon entirely until that rate limit exists. The 10/comment cap alone is insufficient if
  comment creation itself is unbounded.

## Anti-Patterns to Avoid
- Don't add a scheduler/beat — digest collapses at write time via ON CONFLICT.
- Don't notify anon recipients async (D4.5) — sink no-ops on null recipient.
- Don't create a row per bookmark — upsert the daily digest.
- Don't build email/push now — in-app only (D7.2).
- Don't reshape the PRP-3/6 call sites — implement the sink they already declared.
- Don't model in Python first; don't AsNoTracking write lookups; IDOR-scope /me/notifications.
