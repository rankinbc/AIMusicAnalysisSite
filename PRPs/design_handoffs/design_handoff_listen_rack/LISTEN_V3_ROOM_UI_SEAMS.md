# Listen V3 — Room sessions: UI seams (for PRP-4)

**Reciprocal of `LISTEN_V3_UI_CONTRACT.md`.** That doc is backend → UI; this one
is **UI → backend** — the seams the ported page (`frontend-spectr-v2/src/features/listen-rack/`)
already exposes for Room mode, so `ListeningSession` / `events_json` /
`ControlGrant` / `SessionRecap` land as drop-ins rather than reverse-engineered.

Everything in Room is **mock** today: a `setInterval` fabricates presence +
reactions, `grantControl` just sets local state. The shapes below are what the UI
*consumes*; match them and the swap is `subscribe()` + `send()` instead of the
interval.

Authority note (mirrors contract Q1/Q2): the page already gates Room render on
`AccessDto.roomHostable || roomJoinable` and per-listener grant UI on
host-ness. Server stays the authority; this doc is only about **event + grant
payload shapes**.

---

## 0. Adopt `ActorRef` everywhere (the one cross-cutting decision)

The prototype identifies participants by a **bare `handle: string`** + `hue` +
`anon?` (`data.ts → RoomListener / ReactionFeedItem / PresencePopItem`, and
`grantControl(h, scope)`). PRP-3 already defined the richer **`ActorRef`**
(`type:'user'|'anon'`, `userId?`, `handle?`, `displayName?`, `hue?`).

**Lock:** Room presence / reactions / chat / grants all carry `ActorRef`, not a
bare handle — same identity object as comments + suggestions. The UI will swap
its `handle` strings for `actor.handle ?? actor.displayName`. This makes the
recap → View round-trip (§3) free, because both sides speak `ActorRef`.

---

## 1. The realtime event stream → `events_json`

The page drives four imperative seams off mock fixtures. Each is the handler for
one inbound event type — define a discriminated `SessionEvent` and the UI
subscribes once.

| Current mock seam (`ListenRackPage.tsx`) | Inbound event it should become | Payload the UI needs |
|---|---|---|
| `spawnPresence(listener, emoji)` (L190) — avatar burst on stage, auto-expires 2700ms | `presence` (join/leave/heartbeat) **+** `reaction` carries an emoji to burst | `{ actor: ActorRef }` / reaction below |
| `spawnReaction(emoji, handle)` (L196) — burst **and** prepend to the reaction ticker | `reaction` | `{ id, actor: ActorRef, emoji, t }` where `t` = playhead seconds (used by the transport ticker + recap) |
| `setMyStatus(e)` + the People status picker | `status` (participant's active emoji) | `{ actor, status }` — **participant state**, distinct from a one-shot reaction (see decision D1) |
| `handleDrop()` (L201) — drop ⇒ a wave of 🔥 pops | client-derived from the audio (NOT an event) — keep local, but a host could broadcast a `moment` marker for the recap | `{ t, kind:'drop' }` (optional) |

```ts
// Proposed — the UI subscribes to this union; each maps 1:1 to a seam above.
type SessionEvent =
  | { type: 'presence'; actor: ActorRef; state: 'join' | 'leave' }
  | { type: 'reaction'; id: string; actor: ActorRef; emoji: string; t: number }   // t = playhead sec
  | { type: 'status';   actor: ActorRef; status: string }                          // active emoji
  | { type: 'chat';     id: string; actor: ActorRef; body: string; t: number }
  | { type: 'grant';    grant: ControlGrant }                                      // §2
  | { type: 'transport'; playing: boolean; position: number }                      // host drives playback (D2)
  | { type: 'visuals';  patch: Partial<VizState>; stages?: string[]; director?: string }; // host drives the show (D2)
```

- The page keeps `feed: ReactionFeedItem[]` (the ticker, capped at 14) and
  `pops` (stage bursts, ephemeral). Both derive from `reaction` events — `feed`
  is the **`events_json` projection** you persist; `pops` are render-only.
- The reaction **vocabulary** is fixed in `data.ts`: `REACTION_GROUPS`
  (positive/neutral/negative) + `REACTION_EMOJI`. Reuse it as the allowed set.
- **Reaction `t` is the timeline anchor** — it's why recap → timestamped comment
  is lossless. Persist `t` on every reaction/chat event.

---

## 2. `ControlGrant` — host delegates rack / visuals independently

Today: `grantControl(handle, scope:'rack'|'visuals')` sets `rackController` /
`visualController` (a handle string) and fires an in-stage toast
(`AnnouncementMsg`). `PeoplePanel` renders per-listener **+ Rack / + Vis**
buttons and ● RACK / ● VIS holder chips; the bottom module shows a
"controlled by @handle" chip.

```ts
// Proposed
interface ControlGrant {
  id: string;                       // === Suggestion.viaGrantId + RackPreset.viaGrantId (contract Q3/Q4)
  sessionId: string;
  scope: 'rack' | 'visuals';        // LOCK this enum — UI has exactly these two
  grantee: ActorRef;
  grantedBy: ActorRef;              // the host
  revokedAt: string | null;
}
```

- The UI keys **presentation** off "who holds each scope" (one grantee per scope
  at a time, today). Authority stays server-side: only the current holder's
  writes are accepted.
- **The grantee→Suggestion link is already in the contract:** a grantee who edits
  the rack and saves produces a `SuggestionDto` **carrying the chain directly**, with
  `createdInSessionId = sessionId` and `viaGrantId = grant.id` (a `RackPreset` materializes
  only if the owner accepts — `source='user'` + `fromSuggestionId`).
  (contract Q4 D4.3 — Suggestion is the single convergence point for async View
  reviewers *and* live Room grantees). So Room control-handoff **reuses PRP-3's
  Suggestion path** — no separate "live edit" persistence.
- `grantControl` becomes: `send({type:'grant',...})`; the holder chips update
  from the server-echoed `grant` event (don't trust the local optimistic set as
  authority).

---

## 3. `SessionRecap` → View publish (the recap loop)

The recap's raw material is exactly what the page already accumulates:
`feed` (reactions, each with `actor` + `emoji` + `t`) + chat events. The spec's
"hottest moments → timestamped comments" maps cleanly onto the **`CommentDto`**
the View Comments panel **already renders** (`rail.tsx → CommentsPanel`,
`access.ts → CommentDto`).

```ts
interface SessionRecap {
  sessionId: string;
  songVersionId: string;
  hottestMoments: { t: number; reactionCount: number; topEmoji: string }[];
  // publish (host opt-in) emits CommentDto[] onto the version:
  //   { t, body: "🔥 12 reactions here", author: <host ActorRef>, status:'open', ... }
}
```

- **Round-trip is closed:** recap → `CommentDto[]` (status `'open'`, `t` = moment)
  → the View Comments panel shows them with no new UI. This is the "Room → View"
  lifecycle arrow from the modes spec §05.
- This is the slice's **first dramatiq actor** (recap generation, mirroring
  `analyses.final_json`): consume `events_json`, emit `SessionRecap` +
  (on host opt-in) the `CommentDto` rows.

---

## 4. Decisions to lock before building

1. **`status` vs `reaction`** — a participant's *active status emoji* (`myStatus`,
   persists until changed) is modeled separately from a *one-shot reaction*
   (bursts + tickers + recap). The UI treats them differently; keep them as two
   event types, not one.
2. **Host-driven transport + visuals as events** — in Room "everyone sees the
   same stage in sync" (spec §03). My page currently drives `playing`/`position`
   and `viz`/`stages`/`director` locally. For real sync these need `transport`
   and `visuals` events from the host (included in the union above) — confirm
   PRP-4 owns the host→room broadcast of these, or it's a later slice.
3. **Grant cardinality** — one holder per scope (current UI), or a queue/multiple?
   The UI assumes one `rackController` + one `visualController`.
4. **Anon participants** — already supported in the UI (`Avatar anon` → `BotFace`,
   anon entries in `ROOM_LISTENERS`); `ActorRef.type='anon'` covers it. Confirm
   anon may react/chat in Room (likely yes per the link-join policy).

---

## 5. Symbol index (where each seam lives)

- `ListenRackPage.tsx` — `pops`/`feed`/`myStatus`/`rackController`/`visualController`
  state; `spawnPresence` L190, `spawnReaction` L196, `handleDrop` L201,
  `grantControl` L151; the mock driver is the `setInterval` at L208 (**delete on wire**).
- `rail.tsx` — `PeoplePanel` (grant buttons + status picker), `ChatPanel`
  (`feed` + local msgs stream + `send`), `CommentsPanel` (recap target).
- `data.ts` — `ReactionFeedItem`, `PresencePopItem`, `AnnouncementMsg`,
  `RoomListener` (→ replace with live roster), `REACTION_GROUPS`, `REACTION_EMOJI`.
- `access.ts` — `ActorRef`, `SuggestionDto.createdInSessionId`, `CommentDto`
  (recap output), `AccessDto.roomHostable/roomJoinable` (render gate).
