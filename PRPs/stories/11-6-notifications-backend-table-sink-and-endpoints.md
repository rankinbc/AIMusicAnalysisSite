# Story 11.6: Notifications Backend — Table, Sink & Endpoints

Status: review

## Story

As a user,
I want the system to record things that happen to my tracks,
So that feedback, suggestions, and adoptions don't get missed.

## Acceptance Criteria

1. **Given** the migration, **Then** a `notifications` table exists with a raw-SQL partial-unique on `digest_key` (mirror `CreditLedgerEntry`/`WebhookEvent`), and the Python model is mirrored in `aimusic_shared/models.py`.
2. **Given** the existing call sites (comment_created, suggestion_created, suggestion_accepted, mention), **Then** `NotifyAsync` now writes rows built to the AS-BUILT seam (`ActorRef` recipient, dict payload); anon recipients are a no-op (no orphan rows).
3. **Given** a bookmark create, **Then** a new digest call site collapses into one rolling `(recipient, version, day)` row with incrementing `count`.
4. **Given** a comment body with `@handle`, **Then** `MentionParser` resolves handles to user ids and produces `mention` rows.
5. **Given** `GET /me/notifications` (paged) + unread-count + mark-read + read-all, **Then** all are recipient-scoped (IDOR-safe), with integration coverage for digest-upsert idempotency.

## Decisions of record

- `NotifyDigestAsync` seam refined (the interface doc reserves this right): now `(ActorRef recipient, string digestType, Guid versionId, ct)` — the digest key needs the version. NoOp + all callers updated.
- Digest key: `"{recipientUserId}:{digestType}:{versionId}:{yyyy-MM-dd}"` (UTC day). Upsert = `INSERT … ON CONFLICT (digest_key) DO UPDATE SET count = count+1, read_at = NULL, updated_at = now()` via `ExecuteSqlInterpolatedAsync` (parameterizing interpolation — BillingEndpoints precedent). Re-unreads on new activity by design.
- Inbox ordering: `updated_at DESC` (initialized = created_at; digest bumps refresh it). Cursor-less page/limit paging (limit ≤ 50).
- Mentions: `@handle` regex over comment bodies, case-insensitive resolve against `users.handle`, self-mention and duplicate handles collapse; author never notified about their own comment (comment_created skips owner==author too).
- Sink stays best-effort AFTER the emitter's SaveChanges (as-built call sites) — a notification failure never rolls back the domain write; sink catches + logs.

## Tasks / Subtasks

- [x] Task 1: `Notification` entity + EF migration w/ raw-SQL partial unique + `aimusic_shared` mirror (AC1)
- [x] Task 2: `TableNotificationSink` (event rows; anon no-op) + digest upsert (AC2, AC3) + DI swap of `NoOpNotificationSink`
- [x] Task 3: `MentionParser` + wiring in `InsertComment` (AC4)
- [x] Task 4: bookmark-create digest call site (owner recipient, skip self) (AC3)
- [x] Task 5: `NotificationEndpoints` — GET /me/notifications, unread-count, {id}/read, read-all (AC5)
- [x] Task 6: tests — digest idempotency (Postgres-gated), IDOR scoping, mention parsing (unit), endpoints; gates green
- [x] Task 7: sprint-status + story close-out

## Dev Notes

- Emitters already in place (FeedbackEndpoints): comment_created (152), suggestion_created (220), suggestion_accepted (333). This story swaps DI (`Program.cs:153`) and everything lights up.
- EF partial-unique gotcha (CLAUDE.md): append raw `CREATE UNIQUE INDEX … WHERE digest_key IS NOT NULL` to the scaffolded migration's Up()/Down().
- `ActorRef.User(...)` recipients only get rows — `ActorType.Anon` recipients no-op (AC2), matching "no orphan rows".

## Dev Agent Record

- 2026-07-02: story created (from epics.md 11.6 AC); implementation on `release/phase-0-hygiene`.
- 2026-07-02: implemented. Files: `Spectr.Data/Entities/Notification.cs` + migration `20260702190631_AddNotifications` (raw-SQL partial unique `ux_notifications_digest_key`), `aimusic_shared.models.Notification` mirror, `Services/TableNotificationSink.cs` (DI-swapped in Program.cs), `Services/MentionParser.cs` (+ InsertComment wiring, owner/self skip), bookmark digest call site in `BookmarkEndpoints.Create`, `Endpoints/NotificationEndpoints.cs` (list/unread-count/read/read-all). Tests: 11 (7 mention-parser theories + sink event/anon-noop + digest idempotency w/ re-unread + IDOR scoping + comment→owner integration), Postgres-gated. Gates: BFF 232/232 (Stripe webhook excluded per 2026-07-02 direction — pre-existing env failure), shared 27, worker 534, ruff clean. Status → review.
- Note for 11.7: inbox contract is `GET /me/notifications?page&limit` → `{items, page, limit, hasMore}`, `GET /me/notifications/unread-count` → `{unread}`, `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all`. Digest rows have `digestKey != null` + `count`; deep-link context in `payload` (commentId/versionId/suggestionId).
