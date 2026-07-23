# PRP — Listen-Rack Live Room Completion (E6.8–E6.14)

**Confidence score: 8/10** — backend fully shipped and protocol-mapped below; the work
is frontend wiring against known seams + one small BFF addition. Deductions: transport
sync touches autoplay policy (browser-dependent), and the two-client live verification
has real coordination complexity.

## Goal

Make a real two-person live room work end to end on `/listen-rack/$versionId`: host
starts a room, an invited guest joins, both see the real roster, chat crosses the wire,
host transport drives guest playback, sends that fail say so, stream drops reconnect,
and ended rooms visibly end. Closes edge-case findings E6.8–E6.14 (E6.11 scoped to
transport sync; remote rack/visuals application stays deferred per Epic 11-5).

Also: refresh the stale room-adjacent docs (`PORTING_NOTES.md`, `features/listen/README.md`,
`PRPs/listen-smoke-script.md`) and the room section of `docs/api-contracts-bff.md`.

## Why

- The room is the product (2026-06 pivot): the backend (sessions, SSE relay, WAL,
  recap actor) shipped in PRP-4/Epic 11-5, but the visible room loop — see who's here,
  talk, listen together — silently does not function (E6.14, ranked #1 riskiest path).
- Every remaining finding is "silent failure" shaped: dead Start button (E6.8), frozen
  room on any network blip (E6.9), zombie sessions (E6.10), reactions that look
  delivered but weren't (E6.13).

## What

User-visible behavior after this PRP:

- People tab lists the real participants (handle + hue), live-updating on join/leave.
  Grant "+DJ"/"+Vis" targets real users. "↗ Invite" opens the existing share dialog.
- Chat sends over the wire under your real handle; incoming chat renders live; a failed
  send keeps your text in the box and tells you.
- Reactions only "pop" when the server accepted them; repeated failures toast once.
- Host play/pause/seek drives every listener's playback (±2 s snap); listeners see a
  "following host" state instead of dead transport controls.
- Stream drops show "reconnecting…" and recover by themselves; access loss and repeated
  failure get explicit states with a Retry.
- When the host ends the room (or it ends behind your back), you land in a visible
  "room ended" state — never a frozen roster.
- "Start live room" failures show real copy (e.g. hosting not enabled), and the button
  shows a pending state.
- The mock/demo route (`/listen-rack`, no versionId) renders byte-identically.

### Success Criteria

- [ ] E6.14: PeoplePanel renders `roomLive.state.roster` (never `ROOM_LISTENERS`) in
      live rooms; grants POST real `userId`s; ChatPanel sends via `roomLive.sendChat`;
      no `SEED_CHAT` / `'maek'` in live rooms; Invite opens `VersionShareDialog`.
- [ ] E6.8: 403 `room_not_hostable` → explicit toast copy; button consumes
      `isStartingRoom`.
- [ ] E6.9: transient stream failure auto-reconnects (capped backoff); 403 → visible
      "no access" state; exhausted retries → "Connection lost" + manual Retry; a
      reconnect resyncs cleanly from the fresh `sync` snapshot.
- [ ] E6.10: host `/end` pushes an `ended` event; all clients fold to a visible
      "room ended" state and close their streams (which lets finalize proceed).
- [ ] E6.11: host transport events emitted (throttled); listeners follow play/pause and
      snap >2 s drift; guest transport locked via `transportFollowsHost`; autoplay
      rejection shows a "tap to join playback" affordance.
- [ ] E6.12: end/recap failures toast; recap retry affordance (idempotent endpoint).
- [ ] E6.13: reaction/chat/status sends surface failure; no optimistic pop on reject;
      409 `session_ended` on any send folds the ended state.
- [ ] Demo route unchanged; all four frontend gates + `dotnet build && dotnet test` green.
- [ ] Two-client live verification (Level 3 below) passes.

## All Needed Context

### Files to read before implementing

```yaml
- file: components/frontend-spectr-v2/src/features/listen-rack/useRoomOrchestration.ts
  why: THE seam. RoomLiveSeam (lines 37-46), RoomOrchestration (48-52), session
       discovery via useSessionHistory filtered to status==='live' (79-87), stream
       wiring + meKeyRef (107-120), onGrant (125-143), endRoom chain (145-150),
       startRoom gate (returned object, 168-179).
- file: components/frontend-spectr-v2/src/features/listen-rack/roomStateReducer.ts
  why: Pure fold you will extend. RoomLiveState (16-24), actorKey (48-50),
       applySnapshot (70-82), applyEvent seq-drop + per-type handling (84-135).
- file: components/frontend-spectr-v2/src/features/listen-rack/roomStateReducer.test.ts
  why: Test style to mirror — inline SessionEvent literals, fixture ActorRefDto consts,
       snap()/grant() helpers.
- file: components/frontend-spectr-v2/src/features/listen/useRoomStream.ts
  why: Fetch-SSE reader you will add reconnect to. parseRoomFrame (21-36, exported,
       tested), status machine (45-104), abort cleanup.
- file: components/frontend-spectr-v2/src/features/listen/useRoomActions.ts
  why: All 8 senders (react/chat/status/transport/visuals/rack/grant/revoke), POST
       /sessions/{id}/<action>, promise-returning already.
- file: components/frontend-spectr-v2/src/features/listen/useRoomSession.ts
  why: useSessionHistory/useSession/useStartSession/useEndSession/usePublishRecap.
- file: components/frontend-spectr-v2/src/features/listen-rack/ListenRackPage.tsx
  why: Room header block (1003-1025), reactHandler + feedShown (975-985), spawnPresence
       (885-890), ambient sim guard (901-912), transport surface: audioRef/graph
       (219-220), playing/position/duration state (239-241), togglePlay (919-958),
       seek (960-967), <audio> at 1160, realAudio = versionId != null (218),
       VersionShareDialog mount (1154-1157), RightRail mount (1144-1150).
- file: components/frontend-spectr-v2/src/features/listen-rack/rail.tsx
  why: RightRail props (845-870), tab dispatch (886-892), PeoplePanel (391-460, renders
       ROOM_LISTENERS fixture, grant ActorRef without userId at 439), ChatPanel
       (468-480, local msgs + SEED_CHAT at 463-466), TAB_LABELS (841-843).
- file: components/frontend-spectr-v2/src/features/listen-rack/capabilities.ts
  why: Room branch (81-93): canControlTransport = isHost, transportFollowsHost =
       !isHost (computed but UNUSED — your transport lockout reads it), canGrantControl,
       canChat, canReact.
- file: components/frontend-spectr-v2/src/routes/_app/listen-rack.$versionId.tsx
  why: VITE_ROOM_LIVE_SSE gate (17, real is default), both-hooks pattern (64-67),
       props spread into ListenRackPage (117-124).
- file: components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs
  why: The whole protocol (see digest below). EndSession (498) is where the ended
       publish lands. RoomBus service: Services/RoomBus.cs (channel naming 50,
       AppendAndPublishAsync 76, WriteSseFrame usage).
- file: components/bff/tests/Spectr.Bff.Tests/RoomEndpointsTests.cs
  why: Test helpers (NewAuthedClient, CreateVersion, InsertLiveSession,
       RecordingRoomQueue) + SkippableFact/TestDb gating pattern.
- file: components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs
  why: The SSE-consumption test pattern (ParseSseFrames 140-156; live-subscribe with
       ResponseHeadersRead + poll PublishAsync receivers, 327-389) if you add a stream
       assertion; the ended-publish test can instead subscribe directly to the Redis
       channel and assert the payload.
- file: components/frontend-spectr-v2/src/api/mutation-error-toast.ts
  why: Wave-3 global error-toast mechanism — reuse for plain-copy mutation failures
       (meta: { errorToast }); use hook-level onError only when copy branches on code.
- file: components/frontend-spectr-v2/src/api/error-utils.ts
  why: extractApiError / extractApiMessage — parse the error envelope for codes like
       room_not_hostable / session_ended / chat_forbidden.
- file: components/frontend-spectr-v2/src/routes/_app/invite.$token.tsx
  why: The StrictMode mutateAsync-not-mutate lesson (comment in file) — applies to any
       fire-on-mount mutation you might add.
- file: docs/edge-case-report.md
  why: E6.8-E6.14 full texts (lines ~233-261).
```

### Protocol digest (verified against code 2026-07-23 — trust this over stale docs)

**Routes** (all under `/api`): `POST /versions/{vid}/sessions` (JWT, 403
`room_not_hostable`) → 201 `SessionDto`; `GET /versions/{vid}/sessions` (JWT, CanView)
→ `SessionDto[]` newest-first, status `'live'|'ended'`; `GET /sessions/{id}` (anon-capable,
CanView, **lazy finalize backstop when presence empty**) → `SessionDto` with recap;
`GET /sessions/{id}/stream` (anon-capable, RoomJoinable); POSTs on
`/sessions/{id}/`: `react` (202; 400 unknown emoji; 403 `not_joinable`; 409
`session_ended`), `chat` (202; also 403 `chat_forbidden` when `Gates.CanComment` false;
400 empty/`>2000` chars), `status` (202), `transport` (host-only, 403 `not_host`),
`grant` (200 `ControlGrantDto`; grantee needs `userId` OR `anonId`), `revoke` (204),
`end` (host, 202 — **only enqueues finalize**), `recap/publish` (200 `CommentDto[]`;
409 `recap_not_ready`; idempotent). **No rate limiting on room endpoints.**

**SSE wire**: fetch-based, `Authorization: Bearer` or `?token=` (share/session resource
tokens — never JWT `?t=`). One `event: sync` frame at connect (no `id:` line):
`{type:'sync', chain, transport:{playing,position}|null, visuals, roster:ActorRefDto[],
feed:[reaction events], snapshotSeq}`. Then `event: event` frames (with `id: <seq>`),
JSON `type` field discriminates: `presence` `{actor, state:'join'|'leave'}`, `reaction`
`{id, actor, emoji, t, text}`, `chat` `{id, actor, body, t}`, `status` `{actor, status}`,
`transport` `{actor, playing, position}`, `visuals`, `rack`, `grant` `{grant:
ControlGrantDto}` (revoke = same with `revokedAt` set). All carry `at` (unix **ms**) and
`seq`. Heartbeat = SSE comment `: heartbeat` every 15 s of silence. RelayLoop drops
`seq <= snapshotSeq`. Reconnect is safe by design: a fresh connect re-sends `sync` and
the reducer's `applySnapshot` fully resets state.

**ActorRefDto** (camelCase): `{type:'user'|'anon', userId, handle, displayName, hue}`.
Anon entries carry **no anonId on the wire** → the UI **cannot grant to anon
participants** (grant validation requires userId or anonId). Grant buttons render for
`type==='user'` roster entries only; document the limitation in code.

**Session end — the critical trap**: `/end` only enqueues `synthesize_recap`; the actor
**skips finalize while `room:{id}:present` is non-empty**, so with listeners connected
the DB session stays `'live'` after the host ends it, and finalize only happens after
everyone disconnects (last-leaver enqueues a 3-min delayed job; `GET /sessions/{id}`
is an immediate backstop when presence is empty). **No `ended` event exists on the wire
and the stream does not close.** ⇒ This PRP adds a transient `ended` publish in the
BFF `/end` handler (Task 4); clients fold it, show the ended state, and abort their
streams — which empties presence and unblocks finalize. Elegant side effect: closing
streams is what makes the backend's own finalize path work promptly.

**Feature flags** (60 s cache both sides): `room_hosting_enabled` seeded `'false'`,
`room_host_min_tier` seeded `'pro'`. Dev enable:
`UPDATE feature_flags SET value='true' WHERE name='room_hosting_enabled';` (wait ≤60 s
or restart BFF). Do NOT ship a migration changing prod defaults.

### Known gotchas

```text
# STRICTMODE: the stream effect is opened/aborted/reopened in dev. Reconnect timers and
#   watchdogs MUST be cleared in the effect cleanup or you get ghost reconnects. Any
#   fire-on-mount mutation → mutateAsync + local state (see invite.$token.tsx).
# AUTOPLAY: listener-side audio.play() called from a transport EVENT (not a user
#   gesture) can reject with NotAllowedError in Chrome/Safari if the guest never
#   interacted. Catch the rejection and render a "▶ Tap to join playback" button that
#   calls graph.ensureContext() + play() from the click.
# TWO useVersionAccess DEFINITIONS exist (features/listen/useVersionAccess.ts stale
#   30s; a local copy in useRoomOrchestration.ts staleTime 60s, same queryKey). Don't
#   add a third; if you touch access, use the orchestration's.
# FEED_CAP = 14 is shared by reactions AND chat (one feed). A reaction burst can push
#   chat lines out. Accept for v1; do not fork the feed model.
# Chat feed items are marked by emoji === '💬' today. Add an explicit kind field
#   (additive) instead of matching on the emoji.
# The ambient mock reaction sim (ListenRackPage 901-912) is ALREADY disabled when
#   roomLive is set — don't re-disable, don't break the demo route's sim.
# roomLive.state.transport folds on EVERY transport event including the host's own
#   echo. The host must ignore self-originated transport events (compare actorKey to
#   meKey) or their own seek will fight the follow effect.
# `at` is unix MS; event `t` fields are track-position SECONDS. Don't mix them.
# posRef.current is the page's live position (seconds) — reactHandler already uses it.
# The stream connects whenever a live sessionId resolves, in ANY mode (not just room
#   mode). This is deliberate (host must stay "present" while tweaking in Work mode —
#   disconnecting would let last-leaver finalize their own room). Do not gate the
#   stream on mode.
# Vite proxy: /api/* → :5000 (SSE streams through it fine — coach already does).
# Windows: stop the running BFF exe before dotnet build (file lock).
```

## Implementation Blueprint

Order matters: reducer → stream → seam → BFF ended → panels → sends → transport →
states → docs. Tasks 1–3 unblock everything; 5–9 are parallelizable after 4.

### Task 1 — roomStateReducer: `ended`, feed `kind`, exports

`features/listen-rack/roomStateReducer.ts`:
- Add `ended: boolean` to `RoomLiveState` (+ `initialRoomState`).
- In `applyEvent`, BEFORE the seq guard, special-case `e.type === 'ended'` (the event
  is transient and carries NO seq): return `{...s, ended: true}`.
- Feed items: add `kind: 'react' | 'chat'` when folding `reaction` vs `chat` events
  (extend `ReactionFeedItem` in `data.ts` additively: `kind?: 'react' | 'chat'` so the
  demo fixtures stay valid without edits).
- Extend the `SessionEvent` union in `api/types.ts` with
  `{ type: 'ended'; at: number }` (no seq, no actor).
- Tests (mirror existing literal style): ended fold (before + regardless of seq), ended
  survives later events (stays true), chat kind tagging, snapshot-reset-after-events
  (reconnect resync: applySnapshot on a dirtied state fully replaces roster/feed/seq).

### Task 2 — useRoomStream: reconnect + status taxonomy + watchdog

`features/listen/useRoomStream.ts`:
- Status union becomes: `'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
  | 'forbidden' | 'lost'`. (`'error'` retires; grep consumers — the room header prints
  the raw word, Task 9 restyles it.)
- Classify at connect: `res.status === 403 || 404` → terminal `'forbidden'` (no retry);
  other non-OK, fetch throw (non-abort), or unexpected reader end → transient.
- Transient → `'reconnecting'`, retry with capped backoff. Export a pure helper
  `nextRetryDelayMs(attempt: number): number | null` — e.g. [1000, 2000, 5000, 5000,
  5000] then `null` = give up → `'lost'`. Reset attempt counter on a successful `sync`.
- Watchdog: server heartbeats every 15 s; if NO bytes arrive for 45 s, treat as a
  transient drop (abort + reconnect). Keep the timer logic in a small pure/testable
  shape where possible; clear everything in the effect cleanup (StrictMode).
- Add an `onEnded?: () => void` handler OR simply dispatch the `ended` event through
  the normal `onEvent` path (preferred — the reducer handles it; the ORCHESTRATION
  aborts the stream when `state.ended` flips, see Task 3).
- A `retry()` handle for the manual Retry in the `'lost'` state: return
  `{ status, retry }` — this changes the hook's return type; update the one consumer
  (useRoomOrchestration) and its `RoomLiveSeam.streamStatus` passthrough.
- Tests: `nextRetryDelayMs` sequence; parseRoomFrame regressions stay green; a
  classification helper test (status code → terminal/transient) if extracted.

### Task 3 — useRoomOrchestration: promise senders, sendTransport, ended, start/end errors

`features/listen-rack/useRoomOrchestration.ts`:
- `RoomLiveSeam` changes:
  - Senders return promises: `sendReact/sendChat/sendStatus: (...) => Promise<void>`
    (drop the `void`-swallow; callers decide).
  - Add `sendTransport: (playing: boolean, position: number) => Promise<void>`
    (host-only caller; server 403s others anyway).
  - Add `retryStream: () => void` (from Task 2) and keep `streamStatus`.
  - `state.ended` now exists (Task 1).
- When `state.ended` flips true: abort/close the stream (set sessionId's stream off —
  cleanest: derive `effectiveSessionId = state.ended ? null : sessionId` for
  `useRoomStream`), and invalidate `['versions', versionId, 'sessions']` so the
  history query re-fetches and `liveSession` clears once finalized.
- Start errors (E6.8): `startRoom = () => startMut.mutate(undefined, { onError })` —
  click-driven, mutate-level callbacks are safe here (the StrictMode trap is
  fire-on-mount only). `onError`: `extractApiError` → code `room_not_hostable` →
  toast "Room hosting isn't enabled for your account."; anything else → toast
  "Couldn't start the room — try again." Deduped sonner id `'room-start'`.
- End/recap errors (E6.12): `endMut` onError → toast "Couldn't end the room."
  (id `'room-end'`); recap onError → `toast.error('Room ended — recap publish failed.',
  { action: { label: 'Retry', onClick: () => recapMut.mutate(...) } })` — endpoint is
  idempotent.
- On any sender rejection whose ApiError code is `session_ended`, fold ended locally
  (dispatch the same state flip) — a dead room discovered via POST, not just via event.

### Task 4 — BFF: transient `ended` publish + test + contract doc

`components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs` (EndSession, ~498):
- After enqueueing finalize, publish a transient event to the room channel:
  `{"type":"ended","at":<ms>}` — **publish only, NO WAL append, NO seq** (the WAL is
  about to be flushed/deleted; this is a terminal signal, durability comes from the DB
  status). Add a small `PublishTransientAsync(sessionId, json)` to `RoomBus` (reuse
  `ChannelFor` + `NowMs`; do NOT reuse `AppendAndPublishAsync`).
- Test in `RoomEndpointsTests.cs`: host `/end` → subscribe to `room:{id:N}` (raw
  `ISubscriber`) before the POST, assert one message with `"type":"ended"` arrives
  (poll-with-timeout like CoachStreamEndpointTests' receivers pattern). Keep
  `[SkippableFact]` + TestDb gating.
- `docs/api-contracts-bff.md` room section: document the SSE wire format (sync/event
  names, `id:` seq lines, heartbeat comment, the delta payload types incl. `ended`),
  the finalize semantics (presence-guard skip, 3-min last-leaver delay, lazy GET
  backstop), and correct the stale "JWT host" auth notes (routes are AllowAnonymous +
  internally gated).

### Task 5 — PeoplePanel: real roster + real grants + Invite

`features/listen-rack/rail.tsx` + `ListenRackPage.tsx`:
- `RightRail` gains `roster?: ActorRefDto[] | null` and `onInvite?: () => void`;
  page passes `roster={roomLive ? roomLive.state.roster : null}` and
  `onInvite={identity.isOwner ? () => setShareOpen(true) : undefined}` (the
  VersionShareDialog open-state already lives on the page — reuse it, do not mount a
  second dialog).
- `PeoplePanel`: when `roster != null` render it (handle = `handle ?? displayName ??
  'anon'`, hue from dto, `you` via same actorKey logic — export `actorKey` from
  roomStateReducer instead of duplicating); when `roster == null` (demo route) keep
  `ROOM_LISTENERS` byte-identical.
- Grant buttons: only for `type === 'user'` entries; build the full `ActorRef`
  including `userId` so `onGrant` → `grant` POST carries a valid grantee and
  `sameActor` matches the `grant` event's holder chip. Comment the anon limitation
  (no anonId on the wire — server privacy choice).
- "↗ Invite" (rail.tsx:402): `onClick={onInvite}`, hidden when `onInvite` undefined.
- Status emoji per participant: `statusByActor[actorKey(entry)]` — pass
  `statusByActor` from `roomLive.state` (demo route keeps fixture statuses).
- Tests: extend/create a rail room test (mirror `rail-honesty.test.tsx` style): real
  roster renders handles + no fixtures; anon entry has no grant buttons; user entry's
  +DJ calls onGrant with userId-bearing actor; Invite hidden for non-owner.

### Task 6 — ChatPanel: wire-driven in live rooms

`features/listen-rack/rail.tsx`:
- `ChatPanel` gains `live?: { send: (body: string, t: number) => Promise<void>;
  position: () => number } | null` (or thread the seam's sendChat + posRef getter via
  RightRail props — keep the prop surface minimal and mockable).
- Live mode: `stream` = feed only (kind-tagged from Task 1 — chat items where
  `kind === 'chat'`, reactions where `'react'`); NO local `msgs`, NO `SEED_CHAT`, no
  `'maek'`. Own messages arrive via server echo (`you` flag from meKey) — do not
  locally append (single source of truth, dedupe-free).
- `send()`: `await live.send(text, live.position())`; on success clear the input; on
  reject KEEP the input text and toast — code `chat_forbidden` → "Comments are off in
  this room."; `session_ended` → fold via Task 3's path (the orchestration handles it;
  here just toast "This room has ended."); else "Message didn't send." Deduped id
  `'room-chat'`.
- Demo route: `live == null` → existing local-msgs behavior byte-identical.
- Tests: live mode renders feed chat + no seeds; failed send keeps input text
  (mock rejected promise); demo mode unchanged snapshot.

### Task 7 — react/status send honesty (E6.13)

`features/listen-rack/ListenRackPage.tsx` (reactHandler, ~976):
- Await the sends: on fulfilled → `spawnPresence(...)` pop + `setMyStatus`; on reject →
  NO pop, revert `myStatus` if it was optimistically set, and a deduped toast
  (id `'room-send'`, copy "Reaction didn't send."). Fire react + status in parallel
  (`Promise.allSettled`) — pop if the react landed.
- Keep the mock branch (`spawnReaction`) untouched.
- Test: a pure helper is overkill here; cover via an orchestration-level test that a
  rejected sendReact does not add a presence pop — if that requires mounting too much,
  extract the decision into a tiny pure fn `reactOutcome(settled): {pop: boolean,
  toast: boolean}` and unit-test that.

### Task 8 — transport sync (E6.11)

Host emit — `ListenRackPage.tsx`:
- In `togglePlay` and `seek`, after the local action, when `roomLive && cap.canControlTransport`:
  `void roomLive.sendTransport(nextPlaying, nextPosition)` (fire-and-forget is fine
  here — the stream echo is the ack; a failed transport send self-heals on the next
  one). Throttle seek emissions (trailing ~300 ms) so scrubbing doesn't flood; emit
  play/pause immediately.
- Extract the throttle + "should emit" decision into
  `features/listen-rack/transportSync.ts` as pure helpers so they're unit-testable:
  `planTransportEmit(...)`, and the follow-side `planTransportFollow(local: {playing,
  position}, event: {playing, position, at}, nowMs): {play?: boolean; pause?: boolean;
  seekTo?: number}` — seekTo only when drift > 2 s, where expected =
  `position + (playing ? (nowMs - at)/1000 : 0)`.
- Ignore self-echo: skip follow when the transport event's actorKey === meKey. The
  reducer currently stores transport WITHOUT the actor — extend the stored shape to
  `{playing, position, at, actorKey}` (Task 1 addendum: fold `at` + actorKey; snapshot
  transport has no actor/at → treat as `at: nowAtSnapshot, actorKey: null`).

Listener follow — `ListenRackPage.tsx`:
- Effect on `roomLive?.state.transport` when `cap.transportFollowsHost`: apply
  `planTransportFollow` against the real `<audio>` (`audioRef.current`) — play via the
  same path `togglePlay` uses internally (needs `graph.ensureContext()`; refactor the
  play internals into a callable if needed rather than duplicating). Catch `play()`
  rejection (autoplay) → set a `needsGesture` state rendering a centered
  "▶ Tap to join playback" button; its click runs ensureContext + play (a real gesture).
- Join-mid-play: the `sync` snapshot's transport seeds the first follow (position snap
  even while paused-locally).
- Guest lockout: when `cap.transportFollowsHost && roomLive`, Transport's handlers
  no-op (or pass a `disabled`/`followsHost` prop if Transport supports it — check
  `Transport` component props before inventing) and the room header (Task 9) shows a
  small "FOLLOWING HOST" tag.
- Tests: `planTransportFollow` matrix (drift under/over 2 s, paused host, self-echo
  skip via actorKey, snapshot seed with null actorKey); throttle helper.

### Task 9 — room header states (reconnecting / lost / forbidden / ended)

`ListenRackPage.tsx` room header block (1003-1025):
- `streamStatus === 'open'` → current LIVE badge. `'connecting' | 'reconnecting'` →
  amber dot + "reconnecting…". `'lost'` → "Connection lost" + Retry button
  (`roomLive.retryStream`). `'forbidden'` → "You no longer have access to this room."
  (no retry). `state.ended` → replace the room chrome with an ended banner: "This room
  has ended." + (host, recap published) link "View recap in comments" + a button back
  to Work/View (`onModeChange?.('work')` for owner; guests → `'view'`).
- Roster/feed panels render normally under reconnecting (data is just stale); under
  `lost/forbidden/ended` the People/Chat tabs show the same state copy instead of a
  frozen roster (pass `streamStatus` + `ended` down via existing RightRail props —
  smallest honest surface, don't over-design).
- Test: header-state selection can be a pure fn `roomHeaderState(streamStatus, ended,
  isHost)` → unit-test the matrix; rendering covered by one light component test.

### Task 10 — docs tail

- `features/listen-rack/PORTING_NOTES.md`: rewrite header to describe the CURRENT
  architecture (real page; which pieces remain mock: coach panel copy, presence pops,
  meters noted in file header ListenRackPage.tsx:11-12) — it is cited as the wiring
  map; keep it truthful and short. Drop pre-cutover instructions.
- `features/listen/README.md`: describe what the folder IS now (shared engine +
  social hooks consumed by listen-rack + public routes); delete old-page prose.
- `PRPs/listen-smoke-script.md`: re-point at `/listen-rack/$versionId` and
  `window.__spectrRackGraph` (ListenRackPage.tsx:236); add a room smoke section
  referencing Level 3 below.

## Validation Loop

### Level 1 — static

```bash
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint
cd components/bff && dotnet build     # stop the running BFF exe first (Windows lock)
```

### Level 2 — unit

```bash
cd components/frontend-spectr-v2 && npx vitest run
# New tests expected: roomStateReducer (ended/kind/resync/transport-shape),
# nextRetryDelayMs, transportSync helpers, rail room panels (roster/grants/chat),
# header-state matrix. All 946 existing tests stay green — especially
# roomStateReducer.test.ts and useRoomStream.test.ts (extend, never replace).
cd components/bff && dotnet test      # incl. new EndSession-publishes-ended test
```

### Level 3 — two-client live verification (stack per docs/STARTUP.md)

```bash
# 0. Enable hosting in dev (60s flag cache):
#    docker.exe exec docker-postgres-1 psql -U spectr -d spectr -c \
#      "UPDATE feature_flags SET value='true' WHERE name='room_hosting_enabled';"
# 1. HOST (dev user, pro tier): open /listen-rack/{versionId} of an analyzed version,
#    switch to ROOM, Start live room → LIVE badge, roster shows host.
# 2. GUEST: second registered user; host creates an invite (Share dialog), guest
#    accepts /invite/{token}, opens the same /listen-rack/{versionId}, ROOM mode.
#    Verify BOTH clients: roster lists both real handles; no 'maek'/fixtures.
# 3. Chat both directions; kill chat POST via devtools/route-block → input retained
#    + toast. React with server down-path (block /react) → no pop + toast.
# 4. Host play/seek/pause → guest follows within ~2 s; guest transport locked
#    ("FOLLOWING HOST"); guest autoplay prompt appears if no prior gesture.
# 5. Abort the guest's stream (devtools offline toggle) → "reconnecting…" → recovers
#    with correct roster. Exhaust retries → "Connection lost" + Retry works.
# 6. Host "End room + publish recap" → BOTH clients land in "room ended" within ~1 s;
#    session flips to ended in DB once streams close (check via
#    GET /api/sessions/{id}); recap publishes (or 409 path toasts with Retry).
# 7. Demo route /listen-rack still renders fixtures identically (ROOM_LISTENERS,
#    SEED_CHAT, ambient sim).
# 8. Start-room refusal: flip the flag back to false (wait 60s), click Start →
#    explicit "hosting isn't enabled" toast. Flip back OFF at the end (leave dev DB
#    as found unless told otherwise... leave ON if further room work continues).
```

## Anti-Patterns to Avoid

- Do NOT wire remote `rack`/`visuals` application — explicitly deferred (Epic 11-5);
  the reducer keeps dropping them (seq still advances).
- Do NOT append `ended` to the Redis WAL or give it a seq — it is a transient signal;
  the WAL belongs to the finalize actor.
- Do NOT locally append sent chat (server echo is the single source of truth).
- Do NOT build a second invite surface — open the existing VersionShareDialog.
- Do NOT gate the SSE stream on `mode === 'room'` (host presence while in Work mode is
  load-bearing — see gotchas).
- Do NOT add polling for session status — the ended event + POST-409 fold cover it.
- Do NOT touch the worker (`recap_actor.py`) — finalize semantics are correct once
  clients close streams on ended.
- Do NOT let reconnect retry 403/404 — those are terminal.
- Do NOT alter demo-route rendering; every live behavior branches on `roomLive`/roster
  presence.
- Do NOT hand-build toast plumbing — wave-3 `meta.errorToast` for plain copy,
  hook-level `onError` + `extractApiError` for code-dependent copy.

## Final Checklist

- [ ] All Level 1 + 2 gates green (frontend 4 gates; dotnet build/test)
- [ ] Level 3 two-client script passes end to end
- [ ] Success-criteria boxes above all check
- [ ] Demo route visually unchanged
- [ ] `docs/api-contracts-bff.md` room section matches the code (incl. `ended`)
- [ ] Docs tail (PORTING_NOTES / listen README / smoke script) refreshed
