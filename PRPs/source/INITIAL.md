<!--
  INITIAL.md — feature intake for /generate-prp.

  Feature: Listen-rack live Room completion — real roster/chat/transport + honest failure states
  Authored: 2026-07-23 from docs/edge-case-report.md E6.8–E6.14 + a fresh REAL-vs-FIXTURE code map
-->

## FEATURE

Finish the live Room on the canonical Listen page (`/listen-rack/$versionId`). The entire
Room BACKEND is real and shipped (PRP-4 / Epic 11-5): `RoomEndpoints.cs` implements
sessions CRUD, an SSE relay over Redis pub/sub (snapshot-then-delta, heartbeat, presence),
`react/chat/status/transport/visuals/rack/grant/revoke/end/recap-publish` event posts, the
`listening_sessions` + `control_grants` tables exist, and the `synthesize_recap` dramatiq
actor finalizes the Redis WAL to Postgres. The frontend orchestration spine is also real:
`useRoomOrchestration` (mounted from `routes/_app/listen-rack.$versionId.tsx`, gated by
`VITE_ROOM_LIVE_SSE`) composes `useRoomSession`/`useRoomStream`/`useRoomActions`, and
start/end/react/grant/recap all hit the wire.

What is NOT real is the part users would actually see in a live room — the edge-case
report's E6.8–E6.14 cluster (its #1-ranked risk):

- **E6.14 (Critical) — People and Chat panels are pure fixtures.** `PeoplePanel`
  (`rail.tsx:391-460`) renders hard-coded `ROOM_LISTENERS`; the real
  `roomLive.state.roster` is never passed in, so real participants never appear and the
  "+DJ"/"+Vis" grant buttons target fixture actors (grants POST with `userId:null`).
  "↗ Invite" has no click handler. `ChatPanel.send()` (`rail.tsx:476-480`) appends
  locally under the hardcoded handle `'maek'` and never calls `roomLive.sendChat`;
  fixture `SEED_CHAT` renders into real rooms. The core room loop — see who's here,
  grant them control, talk to them — silently does not function.
- **E6.8 (High) — "Start live room" refusal is silent.** `startRoom` is
  `() => startMut.mutate()` with no error handling (`useRoomOrchestration.ts:177`);
  a 403 `room_not_hostable` looks like a dead button.
- **E6.9 (High) — any SSE hiccup permanently freezes the room.** 403 `not_joinable`,
  409 `session_ended`, and transient network blips all collapse to `status
  'error'|'closed'` with no reconnect and no user-facing state beyond a raw status word
  in the header (`useRoomStream.ts:55-101`; SSE `id:` lines ignored).
- **E6.11 (High) — transport sync wholly absent.** `useRoomActions.transport` has zero
  call sites; the reducer folds incoming `transport` into state but nothing reads it;
  playback is local-only. "Live synchronized playback" is the pivot's core promise.
  (Incoming `visuals`/`rack` deltas are deliberately dropped — remote rack/visuals
  APPLICATION stays deferred per the Epic 11-5 note; do NOT pull it into this PRP.)
- **E6.10 (Medium) — zombie sessions.** Host closes the tab without `/end`; the server
  finalizes ~3 min later via the delayed-recap backstop, but the client has no `ended`
  event handling, so listeners sit in a dead room and the next visitor can join a
  still-`live`-looking session.
- **E6.12 (Medium) — recap publish failure is silent.** `endRoom` chains
  `recapMut.mutate` inside `endMut.onSuccess`, no `onError` on either.
- **E6.13 (Medium) — react/chat/status failures look delivered.** `void
  actions.react(...)` discards the rejection and the local presence pop fires anyway.

Deliverable: one PR-sized change set (frontend-first; BFF only if a small seam is
missing) that makes a real two-person room work end to end — host starts, guest joins
via the existing share/invite surface, both see the real roster, chat crosses the wire,
host transport drives the guest's playback, failures are visible, disconnects reconnect,
ended rooms say so. Closes E6.8–E6.14 (E6.11 scoped to transport only).

Also fold in the small "cutover tail" doc debt (same page, trivial): refresh the stale
`features/listen-rack/PORTING_NOTES.md` (still describes the pre-cutover mock world but
is cited as the live wiring map from `ListenRackPage.tsx:12`) and
`features/listen/README.md` (describes the deleted page); re-point
`PRPs/listen-smoke-script.md` at the live route + `window.__spectrRackGraph`.

**Out of scope:** remote rack/visuals application (Epic 11-5 deferral stands), audio-driven
beat/drop visuals (synthetic stays), PRP-5 game-plan work, flipping `room_hosting_enabled`
in prod (admin decision — dev seeds it ON for verification), anything on the mock/demo
listen-rack route (`/listen-rack` demo must stay byte-identical where feasible).

## COMPONENTS

### COMPONENT: frontend-spectr-v2

**Pattern**: v2 stack rules in CLAUDE.md (TS strict, CSS Modules, fetcher.ts, wave-3
`mutation.meta.errorToast` mechanism now exists in `src/api/mutation-error-toast.ts`)

**Purpose**: Wire the room UI to the real seam; add reconnect + honest failure states;
host→listener transport sync.

**Inputs**: BFF `RoomEndpoints.cs` surface (already shipped)
**Outputs**: browser

**Notes**:
- **Roster (E6.14a)**: `PeoplePanel` must render `roomLive.state.roster` in real rooms
  (fixture `ROOM_LISTENERS` only on the mock/demo route). Grant buttons build `ActorRef`
  from real roster entries (server roster events carry the actor identity — check
  `roomStateReducer.ts` roster shape). The "N listening" count in the People tab must be
  the same real number the header shows.
- **Chat (E6.14b)**: `ChatPanel.send()` calls `roomLive.sendChat(text)`; render incoming
  chat from the real feed (already folded, 💬-tagged); own messages appear via the
  server echo (dedupe by event id if the send is also locally appended — prefer
  server-echo-only to avoid divergence). No `SEED_CHAT` in real rooms; keep it for the
  demo route. Sender identity = real actor handle, never `'maek'`.
- **Invite (E6.14c)**: "↗ Invite" opens the existing `VersionShareDialog`
  (`features/listen/VersionShareDialog.tsx`, shipped in audit wave 3) — do not build a
  second invite surface.
- **Start/end/recap errors (E6.8, E6.12)**: `useStartSession` gets error surfacing —
  distinguish 403 `room_not_hostable` ("Room hosting isn't enabled for your account")
  from generic failure; consume `isStartingRoom` for a pending state on the button.
  `endRoom`: end and recap-publish get explicit `onError` — end failure keeps the room
  UI up with a toast; recap failure toasts "Room ended — recap publish failed" with a
  retry affordance (the recap endpoint is idempotent). Use the wave-3
  `meta.errorToast` mechanism where a plain toast suffices; hook-level `onError` where
  copy needs the error code.
- **SSE reconnect (E6.9)**: on transient close/error, auto-reconnect with capped backoff
  (e.g. 1s/2s/5s ×N) by re-opening the stream — the server's snapshot-then-delta design
  makes reconnect safe (state events are LWW-idempotent, feed dedupes by event id/seq;
  see PRP-4 G3). Distinguish terminal statuses: 403 `not_joinable` → visible "You no
  longer have access" state; 409/`session_ended` → the ended state (below); N failed
  reconnects → "Connection lost" state with a manual Retry. Surface a subtle
  "reconnecting…" indicator instead of a frozen roster.
- **Ended rooms (E6.10)**: reducer handles a session-end signal (check what the server
  emits on end — if the stream just closes after `/end`, treat a clean close + a
  follow-up `GET /sessions/{id}` showing `ended` as the signal; add an `ended` event
  type only if the server already sends one). Ended state UI: "This room has ended" +
  recap link if published + exit back to Work/View mode. Joining a session that the
  lazy-finalize backstop has since ended must land in the same state, not a frozen room.
- **Transport sync (E6.11, host→listener only)**: host emits `transport` events
  (play/pause/seek — throttle seeks) via `useRoomActions.transport`; listeners read
  `roomLive.state.transport` and follow: play/pause the local `<audio>` and correct
  position when drift exceeds ~2 s (snap, don't micro-adjust; Web Audio pitch mode can
  stay out — room listeners use plain element playback). Join-mid-play: the snapshot's
  transport state seeds initial position. Listener-local transport controls in a live
  room either disable or clearly become "follow host" — pick per the §04 capability
  matrix (`capabilities.ts` — guests already lack transport capability in room mode;
  verify and lean on it).
- **Send feedback (E6.13)**: reaction/chat/status sends surface failure — at minimum the
  optimistic local pop/append must not fire when the POST rejects (await it or roll
  back), plus a low-noise deduped toast for repeated failures.
- **Demo route stays demo**: all fixture rendering (ROOM_LISTENERS, SEED_CHAT, ambient
  reaction sim) remains for the `real === false` route; every change above branches on
  the real seam being present.

### COMPONENT: bff

**Pattern**: bff conventions in CLAUDE.md (minimal-API groups, ErrorEnvelope)

**Purpose**: Only if the frontend work exposes a missing seam — candidates below; verify
before building, the surface may already suffice.

**Notes**:
- Verify the SSE stream emits an explicit end/`ended` event when a session ends (host
  `/end` or lazy finalize) — if it only closes the connection, add a final `ended` event
  before close so clients don't have to poll `GET /sessions/{id}` to disambiguate.
- Verify roster events carry enough actor identity (userId/anonId + display handle) for
  the grant buttons to target real actors. If the roster payload lacks the id needed by
  `grant`, extend the event payload (additive).
- Verify SSE `id:` lines / heartbeat cadence are sufficient for the reconnect design; no
  Last-Event-ID replay is required (snapshot-then-delta covers it) — do not build one.
- No schema changes expected. If any endpoint change lands, extend
  `components/bff/tests` accordingly and keep `docs/api-contracts-bff.md` current.

### COMPONENT: worker

No changes expected (`synthesize_recap` already handles finalize paths). Touch nothing
unless a verification failure traces there.

## SHARED DOCUMENTATION

- `docs/edge-case-report.md` — E6.8–E6.14 full texts (file:line evidence per finding)
- `PRPs/archive/2026-06-22_listen-v3-room-sessions.md` — PRP-4: the room protocol design
  (WAL/seq semantics, snapshot-then-delta, G1/G2/G3 resolutions the reconnect leans on)
- `PRPs/design_handoffs/design_handoff_listen_rack/LISTEN_V3_ROOM_UI_SEAMS.md` — UI↔backend
  room seams contract
- `components/frontend-spectr-v2/src/features/listen-rack/useRoomOrchestration.ts` — the
  seam every UI change hangs off; `roomStateReducer.ts` — pure fold logic (extend + test)
- `components/frontend-spectr-v2/src/features/listen/useRoomStream.ts` /
  `useRoomSession.ts` / `useRoomActions.ts` — wire hooks (reconnect lands in useRoomStream)
- `components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs` + `Services/AccessService.cs`
  (roomHostable/roomJoinable resolution, `room_hosting_enabled` flag)
- `src/api/mutation-error-toast.ts` — wave-3 global error-toast mechanism (reuse, don't
  duplicate)
- `CLAUDE.md` — validation gates, feature-flag conventions (60s cache, seed via migration)

## OTHER CONSIDERATIONS

- **Dev verification needs the flag ON**: `room_hosting_enabled` is seeded false. For dev
  + live verification, flip it in the dev DB (`UPDATE feature_flags …`) — do NOT ship a
  migration changing the prod default. Note the 60s flag cache when testing.
- **Two-client live verification is mandatory** (stack per `docs/STARTUP.md`): host
  context starts a room; guest context joins via share link (`/v/{token}` or invite);
  verify: both appear in People (real handles); chat crosses both ways; host
  play/pause/seek drives guest playback within ~2 s; kill the guest's network (or abort
  the stream) → guest shows reconnecting then recovers; host closes tab → guest lands in
  the ended state within the backstop window (shrink the delayed-finalize interval in dev
  if needed, or end via API); 403 start (flag off / free tier) shows the explicit copy.
- **StrictMode double-mount**: the room stream + one-shot session starts must survive
  React StrictMode (dev). Beware the wave-3 lesson: a mutation fired in a ref-guarded
  one-shot effect loses its observer on the simulated remount — use `mutateAsync` +
  local state for any fire-on-mount mutation (see `routes/_app/invite.$token.tsx`).
- **Don't regress the mock/demo page**: the `/listen-rack` (no versionId) demo route and
  its fixtures are a sales surface — keep byte-identical rendering there; every
  real-room behavior branches on the live seam.
- **Reducer stays pure**: reconnect/ended/transport logic that can be expressed as pure
  state folds goes in `roomStateReducer.ts` with unit tests; the hooks stay thin wire
  adapters. Existing tests (`roomStateReducer.test.ts`, `useRoomStream.test.ts`) must be
  extended, not replaced.
- **Chat/react rate limits exist server-side** (PRP-0 IRateLimiter) — surfaced 429s
  should show "Slow down" copy, not generic failure.
- **Validation gates**: standard set — frontend `tsc --noEmit` / `lint --max-warnings 0`
  / `build` / `npx vitest run`; `dotnet build && dotnet test` if bff touched; plus new
  tests: reducer (roster/chat/transport/ended folds, reconnect resync), reconnect
  backoff logic (fake timers), transport follow logic (pure helper), send-failure
  rollback, start/end/recap error surfacing.
