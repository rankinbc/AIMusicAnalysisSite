name: "Listen V3 · PRP-4 — Room Sessions: Live Presence, Reactions, Chat, Control Handoff & Recap"
description: |
  The Room mode: several people listen live to a version together — host-driven transport + visuals, presence,
  reactions, chat, and independent rack/visuals control handoff — then an auto-recap that can seed a View thread.
  Built as a GENERALIZATION of the existing coach-stream real-time pattern (Redis pub/sub channel + SSE relay +
  15s heartbeat + disconnect detection + DB durable archive). ZERO new infra (no WebSocket/SignalR). Reuses
  PRP-2 host/join gates and PRP-3 Suggestion (grantee-save). Largest slice; first new dramatiq actor (synthesize_recap).

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Generalize the coach-stream pattern — don't invent transport.

---

## Goal
- **`listening_sessions`** — `{ song_version_id, host_id, status (live|ended), started_at, ended_at?, events_json, recap_json }`.
  JSON-first (D3.2): the durable event archive (events_json) is written at END from the live Redis buffer; recap_json is derived.
- **`control_grants`** — `{ session_id, scope (rack|visuals), grantee(actorRef), granted_by, granted_at, revoked_at }` —
  the provenance backbone (D3.5/D4.6). Becomes the FK target for `rack_presets.via_grant_id` and `created_in_session_id`.
- **Real-time stack** (mirrors coach stream): per-session Redis pub/sub channel `room:{id}` for fan-out + a Redis LIST
  `room:{id}:log` as the live append buffer; one SSE relay endpoint per participant; REST POST actions
  (react/chat/transport/grant) append+publish. High-frequency events never hit Postgres mid-session.
- **`synthesize_recap` dramatiq actor** (analysis-paid) — the single FINALIZE path: idempotently CAS-flushes the Redis
  log → `events_json` (if still `live`), then computes recap_json (hottest moments = reaction-density peaks, histogram,
  peak concurrency, attendance). Triggered by clean `/end`, the delayed last-leaver finalize, or lazy-on-read (G1). Host
  opt-in publishes hottest moments as `Comment`s on the version's View thread (D3.3, reuses PRP-3).
- **Grantee-save reuses PRP-3** — saving the live shared chain creates a `Suggestion` with `created_in_session_id` set (D4.3).

## Why
- **It IS Room mode.** Decisions D3.1–D3.5 (session lifecycle, JSON-first, recap, control-grant provenance) + the
  Room half of D4 (presence/chat/reactions, the cross-author flagship case). The UI thread's room mock is waiting for this layer.
- **Proves the convergence + provenance claims.** Grantee-save → the *same* `Suggestion` path as View (D4.3); a preset
  saved live carries `created_in_session_id` + `via_grant_id` → the cross-author credit chain (the flagship example) lights up.
- **Lowest-risk path to real-time.** The coach stream already ships Redis-pubsub-over-SSE with heartbeat + disconnect +
  idle-fallback; Room is the same shape with a fan-out channel. No new transport tech to learn or operate.

## What
A host starts a Room on a version; invited/permitted listeners join a synced live stage; everyone reacts/chats; the
host grants rack/visuals control independently; on end an auto-recap can seed View comments. Technical: 2 new tables
(+ FK backfill onto rack_presets/suggestions), Redis pub/sub + SSE relay endpoints, REST action endpoints, the
synthesize_recap actor, Python mirror, frontend stream + action hooks replacing the listen-rack mock.

### Success Criteria
- [ ] `listening_sessions` + `control_grants` via EF migration; FKs added for `rack_presets.created_in_session_id`/
      `via_grant_id` and `suggestions.created_in_session_id`; Python mirror updated.
- [ ] `GET /api/sessions/{id}/stream` SSE relays the `room:{id}` Redis channel with 15s heartbeat + disconnect→leave
      (mirrors CoachConversationEndpoints SSE). Authed via Bearer (fetch-SSE); anon via PRP-0 ResourceTokenAuth (opaque
      session/share token in path/header — NOT the JWT `?t=` hook).
- [ ] REST actions (react/chat/status/transport/visuals/rack/grant/revoke) append to `room:{id}:log` + PUBLISH to `room:{id}`;
      authority enforced per event (transport+grant = host; visuals/rack = current scope-holder; react/chat/status = any permitted incl. anon).
- [ ] `control_grants` enforces ONE active holder per (session, scope) via partial-unique index; granting auto-revokes the prior (seams §2).
- [ ] Wire `SessionEvent` union matches `LISTEN_V3_ROOM_UI_SEAMS.md §1` exactly; every `actor` is an `ActorRef` (§0).
- [ ] ONE shared rack chain per session: a `rack` event from the controller updates `room:{id}:chain` and every client
      applies it (everyone hears the same processing). A LATE JOINER receives a `sync` frame (chain/transport/visuals/roster
      + `snapshotSeq`) before deltas via subscribe→buffer→snapshot→flush (G3); chain reconstructs from the log on cache miss
      (G2). Grantee-save snapshots `room:{id}:chain` (or the reconstruction) into the `Suggestion`.
- [ ] FINALIZE flushes the Redis log → `events_json` (idempotent CAS) via clean `/end`, last-leaver delayed finalize, OR
      lazy-on-read; the winner enqueues `synthesize_recap`. No periodic sweep (G1).
- [ ] `synthesize_recap` writes `recap_json`; `POST /sessions/{id}/recap/publish` (host) creates `Comment`s from hottest moments (PRP-3).
- [ ] Grantee-save creates a `Suggestion` with `created_in_session_id` set (reuses PRP-3, proves D4.3).
- [ ] All gates via PRP-2 AccessService (roomHostable to start, roomJoinable to join). All validation gates pass.

## All Needed Context

### Documentation & References
```yaml
# DECISIONS + CONTRACT
- file: _bmad-output/brainstorming/brainstorming-session-2026-06-25-listen-modes-datamodel.md
  why: D3.1-D3.5 (session, events_json JSON-first, recap auto+opt-in-publish, chat retained, control-grant provenance),
       D4.1-D4.6 (actorRef, contextual roles, D4.3 grantee-save=Suggestion, D4.5 credit, D4.6 provenance), the flagship cross-author case.
- file: _bmad-output/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: Δ3.2 JSON-first (mirror analyses.final_json), Δ5 (Room hosting is billable/gateable via tier+flags), build discipline.
- file: PRPs/design_handoffs/design_handoff_listen_rack/LISTEN_V3_UI_CONTRACT.md
  why: ActorRef + the Room mode availability comes from AccessDto.roomHostable/roomJoinable.
- file: PRPs/design_handoffs/design_handoff_listen_rack/LISTEN_V3_ROOM_UI_SEAMS.md
  why: ⭐ the UI→backend reciprocal — the SessionEvent discriminated union the page consumes (each variant maps 1:1 to a
       real page seam: spawnPresence L190, spawnReaction L196, grantControl L151, setInterval mock L208 to delete),
       the ControlGrant shape (id === via_grant_id), and the recap→CommentDto round-trip. MATCH this union exactly.

# THE PATTERN TO GENERALIZE (this is the whole architecture — read it closely)
- file: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs
  why: the SSE-over-Redis-pubsub template. SSE headers + WriteSseFrame()/WriteSseComment() (~645-674), 15s heartbeat
       (~364), redis.GetSubscriber().SubscribeAsync(channel) (~410-437), client-disconnect→cancel-flag (~466-475),
       30s idle fallback (~523-542). Room = this, with channel room:{sessionId} and many subscribers.
- file: components/bff/src/Spectr.Bff/Program.cs
  why: IConnectionMultiplexer singleton (~88-96); JwtBearer ?t= hook (~50-72) whitelisted to /api/versions/.../audio.
       Room stream join = fetch-SSE w/ Bearer (authed, like CoachChat) OR PRP-0 ResourceTokenAuth (anon, opaque session/share
       token in path/header). Do NOT route the opaque token through the ?t= hook — PRP-0 hard rule (opaque tokens ≠ JWT).
- file: components/bff/src/Spectr.Bff/Services/IJobQueue.cs
  why: Redis MULTI/EXEC pattern (~66-69) + how to enqueue a dramatiq actor (used to enqueue synthesize_recap).
- file: components/bff/src/Spectr.Bff/Services/DramatiqQueues.cs
  why: queue constants; synthesize_recap goes on analysis-paid (the 5 aux actors' queue — CLAUDE.md worker section).
- file: components/frontend-spectr-v2/src/features/results/CoachChat.tsx
  why: the client SSE consumer (~350-432): fetch + Accept: text/event-stream + Bearer header + manual frame parse +
       AbortController cleanup. The room stream hook mirrors this (no native EventSource needed for authed users).

# WHAT THE REAL-TIME LAYER REPLACES (the mock)
- file: components/frontend-spectr-v2/src/features/listen-rack/data.ts
  why: RoomListener (~365-381), RoomReaction (~383-400), REACTION_EMOJI — the shapes to feed from the stream.
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx
  why: pops/feed/myStatus/rackController/visualController state + setInterval mock (~109-250) — replace with stream-driven state.

# DEPENDENCIES + EF / WORKER PATTERNS
- file: PRPs/listen-v3-version-sharing-permissions.md
  why: AccessService.roomHostable/roomJoinable + session_host_policy/session_join_policy + room_hosting_enabled/room_host_min_tier flags.
- file: PRPs/listen-v3-view-feedback-suggestions.md
  why: Suggestion (grantee-save sets created_in_session_id) + Comment (recap publish creates these).
- file: components/worker/app/coach_actor.py
  why: @dramatiq.actor decorator pattern (~242-250) — copy for recap_actor.py.
- file: components/worker/app/dramatiq_app.py
  why: actor module import/registration (~42-53) — add `from . import recap_actor`.
- file: components/shared/aimusic_shared/models.py
  why: mirror listening_sessions + control_grants AFTER migration (EF-first, models.py:1-6).
```

### Desired tree (files added)
```bash
components/bff/src/
  Spectr.Data/Entities/ListeningSession.cs        # NEW
  Spectr.Data/Entities/ControlGrant.cs            # NEW
  Spectr.Data/Entities/{RackPreset,Suggestion}.cs # CHANGE: add FK constraints for created_in_session_id/via_grant_id
  Spectr.Data/Migrations/<ts>_AddRoomSessions.cs  # tables + FKs
  Spectr.Bff/Services/RoomBus.cs                  # Redis pub/sub + live-log helpers (publish/subscribe/append/flush) — wraps IConnectionMultiplexer
  Spectr.Bff/Services/AccessService.cs            # CHANGE: add session-role resolution (host/controller) if not already
  Spectr.Bff/Endpoints/RoomEndpoints.cs           # NEW: start/stream/react/chat/transport/grant/revoke/status/end/recap-publish/list
  Spectr.Bff/DTOs/RoomDtos.cs                     # NEW
components/worker/app/recap_actor.py              # NEW: synthesize_recap on analysis-paid
components/worker/app/dramatiq_app.py             # CHANGE: import recap_actor
components/shared/aimusic_shared/models.py        # mirror
components/frontend-spectr-v2/src/features/listen/
  useRoomSession.ts                               # start/join/end
  useRoomStream.ts                                # fetch-SSE consumer (mirror CoachChat) -> presence/feed/transport/controllers
  useRoomActions.ts                               # react/chat/transport/grant/revoke/status
```

### The real-time architecture (the centerpiece)
```text
DURABILITY MODEL (JSON-first, write-frequency-aware):
  • room:{id}:log is the session's WRITE-AHEAD LOG / single source of truth; everything else below is a derived cache.
  • SESSION START writes the seq=1 BASE atomically (the POST /sessions endpoint, NOT left implicit): INCR seq(=1) + RPUSH a
    full-chain base event (the host's starting chain / neutral default) so chain reconstruction ALWAYS has a base — even if the host never touches the rack.
  • During a live session, high-frequency events (reaction|chat|transport|presence|status) flow through:
      - seq+append ATOMICALLY via a Lua script (or MULTI/EXEC): INCR room:{sessionId}:seq THEN RPUSH room:{sessionId}:log <evt{seq}>
        in ONE round-trip — so a crash can't burn a seq without a matching log entry (no phantom-seq gap). [durable record FIRST]
      - PUBLISH room:{sessionId}            (Redis pub/sub -> fan-out to all SSE relays)       [real-time AFTER the log — best-effort live]
    They do NOT touch Postgres mid-session (avoids JSONB-array write contention; same philosophy as the dramatiq Redis queue).
  • control_grants are the EXCEPTION: written to Postgres immediately (low frequency; must be durable NOW because a
    preset saved live references via_grant_id as an FK). Also published for the live controller chip.
  • CURRENT-STATE keys (back the hydrate `sync` frame + Suggestion-save) — Redis, last-write-wins DERIVED CACHES of the log:
      room:{id}:chain (the shared Chain, updated on each `rack` event), room:{id}:transport, room:{id}:visuals,
      room:{id}:present (roster). Read on SSE connect to build the `sync` snapshot; `room:{id}:chain` is what a
      grantee-save snapshots into the `Suggestion` (D4.3) — so the saved chain == exactly what the room is hearing.
      EVICTION-SAFE (G2): these are caches — on a miss, reconstruct the chain by folding the `rack` deltas from
      room:{id}:log over the seq=1 base. The shared Redis is also the dramatiq broker, so it already runs `noeviction`
      (document the invariant); the reconstruct path means a config slip degrades to a slower hydrate, never a wrong chain.
  • FINALIZE (idempotent, G1) — the synthesize_recap ACTOR is the SOLE flusher (the BFF never flushes/DELs inline → no
    DEL-before-actor-reads race). The actor: LRANGE room:{id}:log -> CAS
      UPDATE listening_sessions SET status='ended', events_json=:log, ended_at=now() WHERE id=:id AND status='live'
    only the winner (rowcount=1) then DELs the Redis keys + computes recap_json; losers no-op. Three triggers all just ENQUEUE the actor:
      (1) POST /sessions/{id}/end (host, clean) -> enqueue immediate;
      (2) LAST-LEAVER: when presence hits empty the disconnecting relay enqueues a DELAYED finalize (≈2–5min, via IJobQueue's
          new eta/.DQ path — Task 8a) that re-checks presence and no-ops if anyone rejoined;
      (3) LAZY-ON-READ (BACKSTOP, since a delayed msg is best-effort): GET /sessions/{id} on a presence-empty live session enqueues immediate.
    Safety valve: if the log exceeds ~5k entries, the actor may checkpoint to events_json (append-merge, never truncating the log).
  • synthesize_recap actor: read events_json -> compute recap_json -> write recap_json. Shape (seams §3):
      recap_json = { hottestMoments: { t, reactionCount, topEmoji }[], reactionHistogram, peakConcurrency, attendance: ActorRef[] }
    where hottestMoments are reaction-density peaks bucketed by playhead `t`. POST /recap/publish then maps the
    host-selected moments to CommentDto rows on the version: { targetVersionId, t: moment.t, author: <host ActorRef>,
    body: "{topEmoji} {reactionCount} reactions here", status: 'open' } — which the View Comments panel already renders (PRP-3). Round-trip closed.
  • ABANDONED sessions (host vanishes without /end): handled by the FINALIZE last-leaver + lazy-on-read triggers above —
    NO periodic maintenance sweep needed (the last-leaver delayed message IS the sweep, event-driven off the final disconnect).

PRESENCE = SSE connection lifecycle (like coach's disconnect→cancel-flag):
  • On SSE connect: add actor to room:{id}:present (Redis SET/HASH, TTL-refreshed by heartbeat) + PUBLISH join.
  • On SSE disconnect (ct cancelled): remove + PUBLISH leave. Presence list derives from the SET.

SESSIONEVENT — the wire union (MUST match LISTEN_V3_ROOM_UI_SEAMS.md §1; each variant maps 1:1 to a page seam).
Every variant carries `seq` (monotonic) + `at` (wall clock) on the wire; `actor` is **always an `ActorRef`** (§0 — never a bare handle):
  | type        | payload                                           | emitted by (authority)        | persisted? |
  |-------------|---------------------------------------------------|-------------------------------|------------|
  | presence    | { actor, state: 'join'\|'leave' }                 | SSE connect/disconnect        | derived (attendance) |
  | reaction    | { id, actor, emoji, t }   t = **playhead sec**    | any permitted (incl. anon)    | YES (feed projection + recap anchor) |
  | status      | { actor, status }  (active emoji; persists)       | any permitted                 | last-write (not a timeline event) |
  | chat        | { id, actor, body, t }    t = playhead sec        | any permitted (per gates)     | YES (D3.4 retained) |
  | grant       | { grant: ControlGrant }                           | host only                     | YES (control_grants row) |
  | transport   | { playing, position }                             | **host only** (host-driven)   | no (live sync only) |
  | visuals     | { patch: Partial<viz>, stages?, director? }       | **visuals-controller** (host or grantee) | no (live sync) |
  | rack        | { effectId, params } (a setEffectParams patch)    | **rack-controller** (host or grantee)    | no live; snapshot on Suggestion-save |
- `reaction.t`/`chat.t` = **playhead seconds** — the timeline anchor that makes recap → timestamped comment lossless. Persist `t` on both.
- Reaction emoji are validated server-side against the fixed vocabulary (`data.ts → REACTION_GROUPS` / `REACTION_EMOJI`).
- `status` is a participant's *active* emoji (last-write-wins presence state) — distinct from a one-shot `reaction` (decision D1 in the seams doc). Keep two types.
- `transport` is **host-only**; `visuals`/`rack` are driven by **whoever currently holds that scope's grant** (host by default). This is why grants gate writes, not just presentation.
- `rack` broadcast (CONFIRMED model): there is **ONE shared rack chain per session**, driven by the current rack-controller;
  every client plays the version **file locally** (synced position) and applies the controller's param changes so **everyone hears
  the same processing** (each client applies via PRP-1 `applyChainToGraph`/`setEffectParams`). Sync is best-effort, not
  sample-accurate — correct for listen-together, no host-audio-streaming/WebRTC needed.
- ⭐ **Hydrate-on-join (the snapshot, not just deltas):** a late joiner needs the *current* shared state, not the delta tail.
  On SSE connect the relay first emits ONE `sync` frame with the full current room state, THEN streams deltas:
  `sync = { chain: Chain, transport: { playing, position }, visuals: { patch, stages, director }, roster: ActorRef[], feed: reaction[] }`.

ALTERNATIVE CONSIDERED (note, not chosen): WebSocket/SignalR. Rejected for this slice — no bidirectional infra exists
  today, and SSE+Redis already satisfies presence/reactions/chat/transport/visuals/rack/grants. Revisit only if sub-100ms or
  typing-indicator-grade interactivity is required later.
```

### Data models (C#)
```csharp
// ListeningSession.cs -> listening_sessions
//   id (uuid PK), song_version_id (uuid FK song_versions), host_id (uuid FK users),
//   status (varchar8 CHECK live|ended, default 'live'), started_at, ended_at (timestamptz?),
//   events_json (jsonb?  written at end), recap_json (jsonb?  derived).  Index (song_version_id),(host_id),(status).
// ControlGrant.cs -> control_grants
//   id (uuid PK), session_id (uuid FK listening_sessions), scope (varchar8 CHECK rack|visuals),
//   grantee_user_id (uuid? FK users), grantee_display_name (varchar120?), grantee_ip_hash (bytea?),   // anon-capable actorRef
//   granted_by (uuid FK users), granted_at, revoked_at (timestamptz?).  Index (session_id).
//   ⭐ ONE ACTIVE HOLDER PER SCOPE (seams §2 / decision D3): partial-unique index
//     (session_id, scope) WHERE revoked_at IS NULL  [raw SQL in Up()/Down()]. Granting a scope that's already held
//     auto-sets revoked_at on the prior active grant in the SAME tx, then inserts the new one. The "controlled by"
//     chip + PeoplePanel holder chips render the single active grantee per scope.
// RackPreset.cs / Suggestion.cs (CHANGE): add FK constraints now that targets exist —
//   rack_presets.created_in_session_id -> listening_sessions(id), rack_presets.via_grant_id -> control_grants(id),
//   suggestions.created_in_session_id -> listening_sessions(id). (Columns already exist as nullable uuids from PRP-1/3.)
```

### Endpoints + authority
```text
POST /api/versions/{id}/sessions        gate roomHostable  -> create ListeningSession(host=actor, status=live); SEED the live log
                                         atomically: INCR room:{id}:seq(=1) + RPUSH a full-chain BASE event (host's starting chain / neutral default); 201
GET  /api/sessions/{id}/stream          gate roomJoinable  -> SSE relay of room:{id} (Bearer fetch-SSE; anon via version share token)
POST /api/sessions/{id}/react           gate canView+join  body { emoji, t?, text? }   append+publish        (anon ok, D4.4)
POST /api/sessions/{id}/chat            gate canView+join  body { body }                append+publish        (anon ok if gates)
POST /api/sessions/{id}/status          gate join          body { emoji }               presence status update
POST /api/sessions/{id}/transport       gate role==host             body { playing, position }   publish (host-driven sync)
POST /api/sessions/{id}/visuals         gate holds(visuals)         body { patch, stages?, director? }  publish (the show)
POST /api/sessions/{id}/rack            gate holds(rack)            body { effectId, params }    publish (shared chain; clients applyChainToGraph)
POST /api/sessions/{id}/grant           gate role==host    body { scope, grantee }  -> revoke prior active (session,scope) + insert + publish
POST /api/sessions/{id}/revoke          gate role==host    body { scope }           -> set revoked_at on active grant + publish
POST /api/sessions/{id}/end             gate role==host    -> enqueue synthesize_recap (the actor CAS-flushes log->events_json + recaps; G1)
GET  /api/sessions/{id}                 gate canView       -> session (+ recap_json post-end)
POST /api/sessions/{id}/recap/publish   gate role==host    body { momentIds[] } -> create Comment rows (PRP-3) from hottest moments
GET  /api/versions/{id}/sessions        gate canView       -> session history
# GRANTEE-SAVE: no new endpoint — POST /api/versions/{id}/suggestions (PRP-3) with session context sets BOTH
#   created_in_session_id AND via_grant_id (the active rack grant) on the Suggestion. Both copy onto the adopted
#   preset on accept (D4.5 credit chain). The saved chain == room:{id}:chain (exactly what the room was hearing).
# Session role (host|rack-controller|visuals-controller|listener) = host_id + active control_grants; resolve in AccessService.
```

### Tasks (in order)
```yaml
Task 1 — ENTITIES: ListeningSession.cs, ControlGrant.cs; add FK constraints to RackPreset/Suggestion (created_in_session_id, via_grant_id).
Task 2 — CONTEXT: DbSets + OnModelCreating (CHECKs, FKs, indexes).
Task 3 — MIGRATION: ef migrations add AddRoomSessions; verify FKs to the now-existing tables; run update.
Task 4 — MIRROR: shared/models.py (listening_sessions + control_grants + the new FKs).
Task 5 — ROOMBUS: RoomBus.cs — AppendLog = ATOMIC seq+RPUSH via a Lua script (returns (seq, evt)); SeedBase(sessionId, chain)
         (the seq=1 base at session start); Publish/SubscribeAsync; Presence add/remove/list + PresenceEmpty; current-state
         setters (SetChain on `rack` / SetTransport / SetVisuals); Snapshot(sessionId)->{chain,transport,visuals,roster,feed,
         snapshotSeq} with chain RECONSTRUCTED from the log (fold `rack` deltas over the seq=1 base) on cache miss; FlushLog.
         All over the singleton IConnectionMultiplexer. Mirror coach subscribe/heartbeat.
Task 6 — ACCESS: extend AccessService with session-role resolution (host/controller) for transport/grant gating.
Task 7 — DTOs + ENDPOINTS: RoomDtos.cs + RoomEndpoints.cs (above); register in Program.cs. Stream auth: fetch-SSE+Bearer (authed) / PRP-0 ResourceTokenAuth (anon opaque token) — do NOT extend the ?t= whitelist for opaque tokens (PRP-0 hard rule).
Task 8 — WORKER: recap_actor.py — synthesize_recap on analysis-paid is the SOLE flusher: LRANGE room:{id}:log -> CAS-flush to
         events_json (idempotent; no-op if already ended) -> DEL keys -> compute recap_json. Triggered by all 3 finalize paths
         (clean /end immediate, last-leaver delayed ≈2–5min re-checking presence, lazy-on-read immediate). Register in dramatiq_app.py; queue const if missing.
Task 8a — BFF INFRA: extend IJobQueue.EnqueueAsync with an optional delay — write options.eta = epoch-ms + target
         dramatiq:<queue>.DQ instead of the immediate list. The worker's RedisBroker already ships dramatiq's default-on
         DelayedMessageMiddleware (NO worker change, NO new infra). Consumed by the last-leaver delayed finalize (G1, decision B/b1). ~20–30 lines.
Task 9 — FRONTEND: useRoomSession + useRoomStream (fetch-SSE, mirror CoachChat) + useRoomActions; replace listen-rack mock state.
Task 10 — TESTS + GATES.
```

### Pseudocode (the SSE relay — generalizes coach)
```text
GET /api/sessions/{id}/stream:   // anon joins via PRP-0 ResourceTokenAuth (opaque session/share token in path/header) — NEVER ?t=
  access = AccessService.Resolve(sessionVersionId, actor); if !access.roomJoinable -> 403
  set SSE headers (text/event-stream, no-cache, X-Accel-Buffering:no)   // as coach
  // ORDER MATTERS (G3 race): subscribe FIRST, buffer inbound, THEN snapshot, THEN flush, THEN stream live.
  sub = redis.GetSubscriber(); buf = []; await sub.SubscribeAsync($"room:{id}", (chan,msg) => buf.Add(msg))
  snap = RoomBus.Snapshot(id)   // {chain,transport,visuals,roster,feed, snapshotSeq=GET room:{id}:seq}; chain reconstructs from log on cache miss (G2)
  WriteSseFrame(resp, 'sync', snap); FlushAsync
  flush buf -> WriteSseFrame(resp,'event',msg) for each WHERE msg.seq > snap.snapshotSeq   // drop deltas already in the snapshot
  RoomBus.PresenceAdd(id, actor); RoomBus.Publish(id, { type:'presence', actor, state:'join' })
  loop until ct cancelled:
     drain queued messages (seq-ordered) -> WriteSseFrame(resp, 'event', msg, id=msg.seq); FlushAsync
     every 15s with no traffic -> WriteSseComment(resp, "heartbeat")   // as coach
  finally: RoomBus.PresenceRemove(id, actor); RoomBus.Publish(id, { type:'leave', actor }); sub.Unsubscribe
           if RoomBus.PresenceEmpty(id): enqueue synthesize_recap(id) DELAYED ≈2–5min   // G1 last-leaver finalize (re-checks presence)

POST /api/sessions/{id}/react  (body {emoji,t,text}):
  gate canView+join AND session is LIVE (reject a write to an ended session — late-write guard);
  (seq, evt) = RoomBus.AppendLog(id, {type:'reaction', actor, t, payload:{emoji,text}})   // Lua: INCR seq + RPUSH atomically
  RoomBus.Publish(id, evt); 202
```

### Integration Points
```yaml
DATABASE: migration AddRoomSessions (listening_sessions, control_grants, + 3 FK constraints); mirror in shared/models.py
REDIS: channel room:{id}; list room:{id}:log; set room:{id}:present — via the existing singleton IConnectionMultiplexer
QUEUE: synthesize_recap on analysis-paid (BFF enqueues on /end via IJobQueue)
ROUTES: Program.cs api.MapRoomEndpoints(); register RoomBus in DI; stream auth via fetch-SSE+Bearer (authed) / ResourceTokenAuth (anon) — NOT the ?t= whitelist (PRP-0 hard rule)
FRONTEND: useRoomStream mirrors CoachChat fetch-SSE; replaces ROOM_LISTENERS/ROOM_REACTIONS/pops/feed/controllers mock
REUSE: Suggestion (PRP-3) for grantee-save; Comment (PRP-3) for recap publish; AccessService (PRP-2) for all gates
```

## Validation Loop
### Level 1
```bash
cd components/bff && dotnet format && dotnet build
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
ruff check components/worker/ components/shared/ && mypy components/worker/app/ components/shared/aimusic_shared/ --ignore-missing-imports
```
### Level 2
```bash
cd components/bff && dotnet test
cd components/frontend-spectr-v2 && npx vitest run
pytest -q components/worker/tests/ components/shared/tests/
```
Author (expected / edge / failure):
- Start session: roomHostable host starts (expected); non-host-tier blocked when room_hosting_enabled=false (failure, Δ5).
- Stream relay: a published reaction reaches a subscribed client frame (expected); disconnect publishes leave (edge).
- Authority: non-host POST /transport or /grant → 403 (failure); host grants rack to listener → control_grants row + chip event (expected).
- End: flush writes events_json, enqueues synthesize_recap; recap_json populated (expected); abandoned session swept (edge — note if deferred).
- Grantee-save: a save while holding rack control creates a Suggestion with created_in_session_id (expected — proves D4.3 + cross-author flagship).
- Recap publish: host publishes 2 hottest moments → 2 Comments on the version (expected).
### Level 3
```bash
docker compose -f docker/docker-compose.yml up -d   # Redis + Postgres
cd components/bff/src/Spectr.Bff && dotnet run &
cd components/worker && python -m dramatiq app.dramatiq_app &
# Two browsers: host starts Room; listener joins (synced); both see reactions/chat live; host grants rack to listener;
# listener tweaks + saves -> Suggestion appears for host; host ends -> recap; host publishes hottest moments -> View comments.
cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff
```

## Final Validation Checklist
- [ ] Migration applies/reverts; the 3 FK constraints bind; Python mirror imports.
- [ ] SSE relay mirrors coach (heartbeat, disconnect→leave); Redis channel fan-out works to multiple subscribers.
- [ ] Durability model correct: no per-reaction Postgres writes; the synthesize_recap ACTOR (sole flusher) CAS-flushes events_json on any of the 3 triggers; recap_json derived by the same actor.
- [ ] Authority enforced (host-only transport/grant/end; anon react/chat per gates); all via AccessService.
- [ ] Grantee-save → Suggestion(created_in_session_id) (D4.3); preset adopted later carries via_grant_id (flagship credit chain).
- [ ] synthesize_recap on analysis-paid; recap publish creates Comments (PRP-3).
- [ ] All gates green; frontend mock replaced by stream-driven state.

---

## Known Gaps / Must-Resolve (adversarial review 2026-06-25)
> **RESOLVED 2026-06-25 — unifying principle:** the Redis LIST `room:{id}:log` is the session's **write-ahead log / single
> source of truth**; `room:{id}:chain|transport|visuals|present` are **derived caches**; `events_json` is the log flushed to
> Postgres. Every event carries a monotonic `seq` from `INCR room:{id}:seq`. G1/G2/G3 all fall out of this one principle.
- ✅ **G1 — `events_json` durability (was: clean-`/end`-only → crash/abandon loss). RESOLVED: event-driven idempotent
  finalize, no periodic scheduler.** The `synthesize_recap` ACTOR is the SOLE flusher (LRANGE log → CAS `UPDATE … SET
  status='ended', events_json=… WHERE id=… AND status='live'` → winner DELs keys + recaps); the BFF never flushes inline
  (avoids the DEL-before-read contradiction the review caught). Three triggers all just ENQUEUE it: (1) clean `/end`
  (immediate); (2) **last-leaver** — presence-empty relay enqueues a **DELAYED** finalize (≈2–5min) via **IJobQueue's new
  `eta`/`.DQ` path (Task 8a)** — the review confirmed `IJobQueue` only does immediate enqueue today, but delayed is ~30 lines
  + the worker's default `DelayedMessageMiddleware`, no new infra (decision B/b1) — re-checks presence, no-ops if anyone
  rejoined; (3) **lazy-on-read BACKSTOP** — `GET /sessions/{id}` on a presence-empty `live` session enqueues immediate (covers
  a lost delayed message, since delayed msgs are best-effort). Safety valve: log > ~5k → actor checkpoints to `events_json`
  (append-merge, never truncating the log). **Replaces the deferred abandoned-session sweep — the last-leaver path IS the sweep.**
- ✅ **G2 — `room:{id}:chain` eviction (was: silent break of "saved == what the room heard"). RESOLVED two ways:** (1)
  **invariant** — this Redis is also the dramatiq broker, so the instance already runs `noeviction` (the queue would corrupt
  otherwise); document it. (2) **correctness independent of the key** — the log's **first entry (`seq=1`) is a full-chain
  base snapshot**; later `rack` entries are patches; `chain = fold(patches over base)`. `room:{id}:chain` is a cache —
  grantee-save + the hydrate `sync` frame try the key and **reconstruct from `room:{id}:log` on miss**. A config slip degrades
  to a slower hydrate, never a wrong chain.
- ✅ **G3 — hydrate-vs-delta race. RESOLVED with `seq` mechanics:** relay does **subscribe → buffer → snapshot (reads state
  keys + `snapshotSeq = GET room:{id}:seq`) → flush buffered where `seq > snapshotSeq` → stream live**. Cheap because **state
  events (chain/transport/visuals) are last-write-wins idempotent** (safe to re-apply, so the boundary needn't be exact)
  while **feed events (reaction/chat) are dedup'd by `seq > snapshotSeq` + event `id`**. Client applies in `seq` order; on
  `seq > last+1` it re-hydrates (SSE `id:` field = `seq` for free resume).
- ⚠ **G4 — draft vs session shared-chain boundary.** State explicitly: the session shared chain is separate from any user
  `RackDraft`; Room edits never mutate a personal draft; session end auto-saves nothing (only an explicit grantee-save →
  Suggestion). (Pairs with PRP-1 G4.)
- ✅ **G5 — Room hosting metering (was: unmetered). DEFERRED (product decision 2026-06-25):** at launch
  `room_hosting_enabled=false` (PRP-2 seed) — Room hosting is OFF for the general user base (everyone gets Work/View); the
  admin hosts the only Room(s) by flipping the flag operationally. With hosting effectively admin-only, there's no
  third-party cost to meter yet. Revisit (emit a `usage_event` on session start/duration + gate by entitlement) BEFORE
  enabling `room_hosting_enabled` for users.

## Anti-Patterns to Avoid
- Don't introduce WebSocket/SignalR — generalize the coach SSE+Redis pattern.
- Don't write every reaction to Postgres — Redis live buffer, flush events_json at /end (control_grants are the only mid-session Postgres writes).
- Don't model a row-per-event table — JSON-first (D3.2); presence/attendance derive from events_json.
- Don't let non-hosts drive transport/grants — gate via AccessService session-role.
- Don't build a second suggestion path for grantee-save — reuse PRP-3's Suggestion with created_in_session_id (D4.3).
- Don't model in Python first; don't AsNoTracking write lookups; synthesize_recap is a sync dramatiq `def`.
- Don't put synthesize_recap on `default` (no default queue — analysis-paid).
- Don't route the session/share token through the JWT `?t=` hook — anon stream join resolves the opaque token via PRP-0 ResourceTokenAuth / fetch-SSE.
- Don't treat `room:{id}:chain` (or any current-state key) as authoritative — the `room:{id}:log` WAL is the source of truth; caches reconstruct from it.
- Don't accept react/chat/rack/grant/grantee-save against an ENDED session — guard every action on status=live; a late write after finalize+DEL would otherwise snapshot an empty/base-only chain into a Suggestion.
- Don't let the BFF flush/DEL the log inline — the synthesize_recap actor is the sole flusher (else it reads an empty log after the BFF DELs).
- Don't INCR seq separately from the RPUSH — do them atomically (Lua/MULTI) or a crash burns a seq with no log entry (phantom-seq gap).
