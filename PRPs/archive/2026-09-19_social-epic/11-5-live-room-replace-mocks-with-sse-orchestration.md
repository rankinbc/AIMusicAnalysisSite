# Story 11.5: Live Room — Replace Mocks with SSE Orchestration

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a producer,
I want to host a real synchronized listening room,
So that people hear my track together and react live.

## Acceptance Criteria

1. **Given** a host starts a room, **When** participants join, **Then** state syncs from the first `sync` snapshot frame and applies subsequent `SessionEvent` deltas (reuse the written-but-unwired `useRoomStream`).
2. **Given** a participant reacts/chats/changes transport-visuals-rack, **Then** the action POSTs via `useRoomActions` and fans out to all clients.
3. **Given** the host grants or revokes control, **Then** capabilities update live (reuse `identity.ts`/`capabilities.ts`).
4. **Given** the host ends the room, **Then** `PublishRecap` triggers and `recap_actor.py` produces the recap.
5. **Given** `useMockRoomOrchestration` is removed from the route, **Then** no mock import remains, the swap sits behind an adapter seam (not a page rewrite), and existing `listen-rack` tests still pass.

## Context — what already exists (reuse, do not rebuild)

> ⚠️ **Verify before building — the component-state claims below are grep-level, not
> render-truth.** Stories 5.6 and 11.1 both found the "missing"/"unwired" surface already
> existed as a **mock or dead code** (the rail `CommentsPanel` rendered `MOCK_COMMENTS`). This
> story is explicitly a mock→real swap, so **first grep the real render path** (which route
> renders `useMockRoomOrchestration` today) and confirm the mock vs. live seam before cutting over.

The room BACKEND is fully real: `RoomEndpoints.cs` (Start/List/Get/StreamSession SSE, React/Chat/Status, Transport/Visuals/Rack, Grant/Revoke, End/PublishRecap), `ListeningSession.cs`, `ControlGrant.cs`, worker `recap_actor.py`. The SSE **consumer is already written and unit-tested but UNWIRED**:
- `src/features/listen/useRoomStream.ts` — `useRoomStream(sessionId, handlers, token?)` (45); `parseRoomFrame` is unit-tested in `useRoomStream.test.ts`.
- `src/features/listen/useRoomActions.ts` — `useRoomActions(sessionId, token?)` (33) returns the action senders.
- `src/features/listen/useRoomSession.ts` — `useSession` (27), `useStartSession` (39), `useEndSession` (47), `usePublishRecap` (59), `useSessionHistory` (17).
- `SessionEventBase` type at `types.ts:1499`.

**Current mock seam (the swap point):** the routes `src/routes/_app/listen-rack.$versionId.tsx:28` and `src/routes/_app/listen-rack.tsx:23` call `useMockRoomOrchestration()` (`features/listen-rack/useMockRoomOrchestration.ts`, returns `MockRoomOrchestration` = `{ mode, modes, identity, access, roomControl, onModeChange, onGrant }`) and spread it into `<ListenRackPage>`. **`ListenRackPage` consumes these as props (`ListenRackPage.tsx:149`) and is otherwise backend-agnostic** — so the swap is at the route/orchestration layer, NOT a page rewrite.

## Tasks / Subtasks

- [ ] **Task 1: Real orchestration adapter (AC: 1, 2, 3)**
  - [ ] 1.1 Create `src/features/listen-rack/useRoomOrchestration.ts` exporting the SAME shape as `MockRoomOrchestration` (so `ListenRackPage` props are unchanged). It composes: `useSession`/`useStartSession`/`useEndSession`/`usePublishRecap` (`useRoomSession.ts`), `useRoomActions` for sends, and `useRoomStream` for receive.
  - [ ] 1.2 Maintain a local room-state reducer: apply the first `sync` snapshot frame, then fold subsequent `SessionEvent` deltas (reactions, chat, presence, transport/visuals/rack, grant/revoke). Derive `roomControl` (rack/visuals holders) from grant/revoke events so `resolveCapabilities` (already called at `ListenRackPage.tsx:604`) recomputes live (AC3).
  - [ ] 1.3 Map participant actions to `useRoomActions` senders (react/chat/status/transport/visuals/rack/grant/revoke). Keep `onModeChange`/`onGrant` signatures identical to the mock.
- [ ] **Task 2: Feature-flag the cutover (AC: 5)**
  - [ ] 2.1 In both route files, select orchestration via a flag (e.g. an env/config or `feature_flags` `room_live_sse`): flag on → `useRoomOrchestration`, off → `useMockRoomOrchestration`. This keeps the mock importable during rollout (de-risks the swap) while removing it from the default path.
  - [ ] 2.2 When the flag is on by default and verified, the mock is dead-path only; leave `useMockRoomOrchestration` for tests but ensure the default route render imports the real adapter.
- [ ] **Task 3: End → recap (AC: 4)**
  - [ ] 3.1 Host "End room" calls `useEndSession` then `usePublishRecap`; on success the page shows the recap state. (The worker `recap_actor.py` produces `recap_json` — no worker change.)
- [ ] **Task 4: Tests (AC: 1, 5)**
  - [ ] 4.1 Unit-test the reducer in `useRoomOrchestration` (snapshot-then-delta, grant/revoke → roomControl) with fixture `SessionEvent`s — pure-function style, no live SSE. Keep `useRoomStream.test.ts` (`parseRoomFrame`) passing.
  - [ ] 4.2 Confirm existing `listen-rack` tests (rail.plan, capabilities, identity) still pass unchanged.
- [ ] **Task 5: Gates** — `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`.

## Dev Notes

- **Highest integration risk in the sprint** — chosen for sprint 1 to surface SSE/fan-out issues early. Keep the change behind the adapter seam + flag; do NOT rewrite `ListenRackPage`.
- The `sync`-snapshot-then-delta contract, heartbeat frames, and reconnect/abort are handled inside `useRoomStream` — the adapter only consumes its `handlers`. Verify the handler set in `useRoomStream.ts` before wiring.
- Anon room joins use the opaque session `?token=` (already supported by `useRoomStream`/`useRoomActions` `token?` params) — never JWT `?t=`.
- Independent of 11.1–11.3, but their panels (comments/bookmarks) appear inside the room rail, so land those first if parallel capacity is tight.

### References
- AC source: `PRPs/epics.md` Story 11.5. Anchors: `useRoomStream.ts:45`, `useRoomActions.ts:33`, `useRoomSession.ts`, `useMockRoomOrchestration.ts`, routes `listen-rack.$versionId.tsx:28` + `listen-rack.tsx:23`, `ListenRackPage.tsx:149/604`, `RoomEndpoints.cs`, worker `recap_actor.py`.

## Dev Agent Record

### Agent Model Used

claude-fable-5 (2026-07-02)

### Completion Notes List

- **AC1** — `roomStateReducer.ts` (pure): `applySnapshot` hydrates roster/transport/feed at `snapshotSeq`; `applyEvent` folds deltas with seq dedupe (`seq <= lastSeq` dropped per relay resume contract). Consumed via `useRoomStream` handlers in the adapter.
- **AC2** — `useRoomOrchestration.ts` composes `useRoomSession` + `useRoomActions` + `useRoomStream`; senders are fire-and-forget POSTs (server fans back through the stream, no optimistic writes). Page's react/status handlers route through the `roomLive` seam when a session runs.
- **AC3** — `onGrant` maps to `actions.grant/revoke`; NO local state write — the grant event returns via SSE and folds into `roomControl`, so `resolveCapabilities` recomputes from server truth.
- **AC4** — host strip "End room + publish recap" → `useEndSession` then `usePublishRecap` (momentIds: [] = default hottest moments server-side).
- **AC5** — versioned route runs the real adapter behind `VITE_ROOM_LIVE_SSE` (default ON; `=0` reverts to mock). Both hooks called unconditionally (rules of hooks); the real hook's queries gate on empty versionId when flagged off. Param-less demo route stays mock BY DESIGN (no versionId → no access/session/SSE). Existing listen-rack tests untouched and green.
- Page changes are a SEAM, not a rewrite: optional `roomLive`/`onStartRoom` props, `feedShown` selection, ambient mock-reaction interval disabled when live, small LIVE-ROOM strip (start/end + roster count + stream status).
- Deferred (noted in reducer): remote `visuals`/`rack` deltas advance seq but don't yet drive the local engine surfaces — grantee edits fan out server-side but remote application to the local rack is a follow-on (needs an engine-write seam decision).
- Identity when anon (share-token room join) is minimal: `useMe` only — full anon reviewer surface is story 11.4.

### File List

- `src/features/listen-rack/roomStateReducer.ts` (new) + `roomStateReducer.test.ts` (10 tests)
- `src/features/listen-rack/useRoomOrchestration.ts` (new — adapter, same shape as mock + `live` seam)
- `src/features/listen-rack/ListenRackPage.tsx` (seam: roomLive/onStartRoom props, feedShown, live strip)
- `src/routes/_app/listen-rack.$versionId.tsx` (flagged cutover), `src/routes/_app/listen-rack.tsx` (doc comment)

### Change Log

- 2026-07-02: implemented; gates green (vite build, tsc -b, eslint, lint:css, lint:prices, vitest 611/611). Status → review.
