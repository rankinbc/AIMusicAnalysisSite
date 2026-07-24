# Coach Stream Chunk-Ordering Fix (follow-up to item 2)

## Status: design approved, ready for implementation planning

This PRP tracks a confirmed root cause discovered during
`PRPs/archive/*_first-upload-trust-quickwins.md` Task 4 (item 2). That task's
explicit scope was repro + root-cause confirmation only — no fix was written.
This document now carries the approved fix design; implementation happens via
a follow-up plan (see "Next step").

## Confirmed root cause

`components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:442-449`
subscribes to the per-message Redis Pub/Sub channel via StackExchange.Redis's
**delegate** `sub.SubscribeAsync(channel, Handler)` overload. Per the
library's own docs
([PubSubOrder.md](https://github.com/StackExchange/StackExchange.Redis/blob/main/docs/PubSubOrder.md)),
this overload gives **no ordering guarantee**, even for messages published to
the *same* channel — each incoming message is dispatched to the .NET
ThreadPool independently, so `Handler` invocations for consecutive messages
can race and complete out of order. The alternative `Subscribe(channel)
.OnMessage(handler)` / `SubscribeAsync(channel)` → `ChannelMessageQueue` form
processes messages "in exactly the same order in which they are received
(via a queue)" and does not have this problem.

**Scoping discovery (this design pass):** `RoomEndpoints.cs:StreamSession`
(the Listen V3 Room feature's SSE relay) uses the *identical* delegate
`SubscribeAsync(channel, Handler)` pattern, and its `RelayLoop` only filters
already-seen events via `seq > snapshotSeq` — it never sorts or buffers by
seq. Room therefore carries the same latent reordering exposure as Coach; it
has simply never been exercised by a test. Confirmed via grep across
`components/bff/src/Spectr.Bff/` that these are the **only two** delegate-form
subscribe call sites in the BFF.

## Automated evidence

`components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs`:
`Stream_Preserves_Chunk_Order_At_Low_Concurrency` publishes 30
recognizable-payload frames (`"chunk-0"`, `"chunk-1"`, ...) to a **single**
channel, **sequentially awaited** (no client-side concurrency at all — each
`PublishAsync` call completes before the next begins), and asserts the SSE
consumer receives them in the same order.

Across 8 live runs against the local dev stack (Postgres + Redis already
running), this test **failed 6 of 8 times** (~75%), always with a small
adjacent-pair swap (e.g. `chunk-1`/`chunk-2` transposed), never a
wholesale scramble — consistent with two ThreadPool-dispatched handler
invocations racing each other, not a queue being dropped or reversed
wholesale.

This is a **stronger** reproduction than the originating hypothesis
anticipated (that document expected low concurrency to "always pass" and
looked to many-simultaneous-conversations to manufacture the race). It turns
out a single publisher on a single channel is already sufficient — because
`PublishAsync` completing (server ack) has no relationship to when the
BFF's `Handler` delegate actually runs; the reordering happens entirely
inside the BFF process's dispatch of that one channel's messages.

The sibling test, `Stream_Preserves_Chunk_Order_At_High_Concurrency` (20
simultaneous conversations, each on its own channel, all publishing
concurrently with each other), passed 8/8 times as designed. This is not a
contradiction: cross-channel ordering was never the invariant at risk (Redis
Pub/Sub makes no cross-channel ordering promise, and nothing in the BFF
needs one). The bug lives entirely *within* a single channel's dispatch,
which the low-concurrency test already isolates and reproduces reliably
without needing multiple conversations at all.

## What was ruled out (do not re-investigate)

Per the originating PRP's Task 4: worker's synchronous Phase D loop, the
producer-thread/queue bridge in `llm/streaming.py`, BFF's `RelayLoop` (single
sequential writer to the response body), `stream_parser.py`'s
`StreamSplitter` (append-only, exhaustively tested), and the frontend's SSE
consumption (`CoachChat.tsx`, single `while(true)` loop).

## Approved fix design

### The code change (same shape at both call sites)

`CoachConversationEndpoints.cs::StreamMessage` and `RoomEndpoints.cs::StreamSession`
both do this today:

```csharp
void Handler(RedisChannel _, RedisValue value) { /* ...frames.Writer.TryWrite(payload)... */ }
await sub.SubscribeAsync(channelName, Handler);
...
finally { await sub.UnsubscribeAsync(channelName, Handler); }
```

Both switch to the ordered `ChannelMessageQueue` form:

```csharp
void Handler(ChannelMessage msg) { /* msg.Message instead of value */ }
var queue = await sub.SubscribeAsync(channelName);
queue.OnMessage(Handler);
...
finally { await queue.UnsubscribeAsync(); }
```

Design notes:

- **The existing race protection survives unchanged.** Both endpoints rely
  on "subscribe completes *before* we re-check row/snapshot state" (explicit
  P1/G3 comments in both files). `await sub.SubscribeAsync(channelName)`
  still awaits the server-side subscribe ack exactly like today;
  `queue.OnMessage(handler)` attaches the client-side callback synchronously
  right after, with no round-trip gap in between.
- **No change to the shared singleton.** The `IConnectionMultiplexer`
  registration in `Program.cs:230-238` is untouched — this is a per-call-site
  change to how one channel's messages get dispatched, not a change to the
  connection object itself. Dramatiq's job queue keeps its own separate
  multiplexer already (per the existing Program.cs comment), so there is no
  cross-feature coupling introduced.
- **Backpressure is a non-issue.** Both `Handler`s do exactly one O(1),
  non-blocking thing: parse the payload and `TryWrite` into an
  already-bounded, `DropOldest` in-process channel. `ChannelMessageQueue`'s
  ordered (one-at-a-time) dispatch has nothing slow to serialize behind
  here.

### Scope: fix both Coach and Room

Both of the only two delegate-form subscribe sites in the BFF get the fix in
the same change, since they share the identical bug shape (Handler writes to
a bounded in-process channel; no reordering tolerance downstream).

### Testing

- Un-skip `Stream_Preserves_Chunk_Order_At_Low_Concurrency` (drop the
  `Skip = "..."` reason) — it becomes the real Coach regression guard.
  Keep `[Trait("Category", "Slow")]`.
- Add a mirrored ordering test for Room's `StreamSession` (single channel,
  sequentially-awaited publishes of recognizable payloads, assert received
  order) — there is currently no Room stream test file at all, so this is
  new coverage, not a port of existing coverage.
- Before trusting either test long-term, manually rerun both ~8-10x against
  the live local Redis (the same method that produced the original 6/8
  failure rate) to build confidence the fix is structural, not incidentally
  passing.

## Rejected alternatives

- **Sequence-number reorder buffer** (mirroring Room's own WAL `seq` model,
  `RoomBus.cs`'s Lua `INCR`+`RPUSH`): would require worker-side changes to
  stamp a monotonic seq per coach chunk, a new Redis key + Lua script, and a
  reorder/gap-wait buffer in the BFF's `RelayLoop`. Solves nothing that the
  `ChannelMessageQueue` switch doesn't already solve for free at the
  transport layer, at several times the blast radius (new cross-language
  wire contract, new Redis keys, new buffering/timeout logic). Not pursued.
- **Frontend-side reordering**: would require the worker to stamp an
  explicit index in each chunk's JSON payload and the frontend to buffer and
  resequence before rendering — pushes complexity across three layers
  (worker, BFF, frontend) to work around a bug that is entirely contained in
  one BFF method today. Not pursued.

## Next step

Implementation planning (task breakdown, validation gates) via the
`writing-plans` skill / `/execute-prp` flow. On successful execution: verify
`dotnet build && dotnet test` green (including the now-unskipped ordering
test and the new Room test), archive this PRP.
