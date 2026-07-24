# Coach/Room SSE Chunk-Ordering Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed Redis Pub/Sub chunk-reordering bug in the Coach SSE relay, and close the identical latent exposure in the Room SSE relay, by switching both from StackExchange.Redis's unordered delegate `SubscribeAsync(channel, Handler)` form to the ordered `SubscribeAsync(channel)` → `ChannelMessageQueue.OnMessage(handler)` form.

**Architecture:** Two BFF minimal-API SSE endpoints (`CoachConversationEndpoints.cs::StreamMessage`, `RoomEndpoints.cs::StreamSession`) each subscribe to a per-session Redis Pub/Sub channel and relay published messages into an SSE response. Both currently use the delegate subscribe overload, which StackExchange.Redis's own docs say gives no per-channel ordering guarantee. The fix is a like-for-like swap of the subscribe/unsubscribe calls at each site — no change to the shared `IConnectionMultiplexer` singleton, no change to any other logic in either method.

**Tech Stack:** .NET 10 minimal APIs, StackExchange.Redis 2.7.33, xUnit + `SkippableFact` (Postgres/Redis-gated via `TestDb.RequireAsync` / `TestDb.Require(RedisReachable(), "Redis")`).

## Global Constraints

- Full design + evidence: `PRPs/coach-stream-ordering-fix.md` (read before starting; this plan implements that document verbatim).
- Windows dev gotcha: if `dotnet build` fails with a file-lock error on `Spectr.Bff.exe`, a running BFF dev process holds the lock — stop it (`Stop-Process -Id <PID> -Force`) before rebuilding.
- Local Postgres + Redis must already be running (`docker compose -f docker/docker-compose.yml up -d` from repo root) — the Redis-gated tests in this plan silently skip (not fail) if Redis is unreachable at `localhost:6379`, so a "0 tests ran" or all-skip result means check infra first, not a plan bug.
- Never weaken a test to make it pass. If a test in this plan fails after the fix, that means the fix is incomplete — investigate, don't relax the assertion.
- All commands below are given as full relative paths from the repo root; do not `cd` first.

---

### Task 1: Re-enable the Coach chunk-order test and reconfirm the pre-fix baseline

**Files:**
- Modify: `components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs:391-414` (historical comment), `:440-446` (attribute + in-test comment)

**Interfaces:**
- Consumes: nothing new — this task only changes test-visibility (removes `Skip=`), not behavior.
- Produces: a live (non-skipped) `[Trait("Category","Slow")]` fact named `Stream_Preserves_Chunk_Order_At_Low_Concurrency`, which Task 2 will make pass reliably.

- [ ] **Step 1: Update the class-level historical comment**

Replace (lines 391-414):

```csharp
    // ── item 2 / Task 4: coach stream chunk-ordering repro (no fix) ─────
    //
    // PRPs/first-upload-trust-quickwins.md item 2: a real coach reply
    // rendered two prose chunks swapped. Leading hypothesis: StackExchange
    // .Redis's delegate `sub.SubscribeAsync(channel, Handler)` overload
    // (CoachConversationEndpoints.cs:442-449) gives NO ordering guarantee,
    // even for messages on the SAME channel (see the library's own
    // PubSubOrder.md docs), unlike the ordered `Subscribe(channel)
    // .OnMessage(handler)` form.
    //
    // CONFIRMED (see PRPs/coach-stream-ordering-fix.md for full writeup):
    // Stream_Preserves_Chunk_Order_At_Low_Concurrency — a SINGLE publisher,
    // SINGLE channel, sequentially-awaited publishes (no client-side
    // concurrency at all) — failed 6 of 8 live runs against the local dev
    // stack, always an adjacent-pair swap. This is a stronger repro than
    // hypothesized: `PublishAsync` completing has no relationship to when
    // the BFF's `Handler` delegate actually runs, so the race is entirely
    // inside the BFF's per-channel dispatch, not caller-side concurrency.
    // The sibling high-concurrency test (many DIFFERENT channels, published
    // concurrently) passed 8/8 — expected, since cross-channel ordering was
    // never the invariant at risk; the bug is intra-channel, and the
    // low-concurrency test already isolates and reproduces it directly.
    // Per Task 4's explicit scope: repro + root-cause confirmation only —
    // NO fix here; see the follow-up PRP stub for the fix design.
```

with:

```csharp
    // ── item 2 / Task 4: coach stream chunk-ordering repro + fix ─────────
    //
    // PRPs/first-upload-trust-quickwins.md item 2: a real coach reply
    // rendered two prose chunks swapped. Root cause: StackExchange.Redis's
    // delegate `sub.SubscribeAsync(channel, Handler)` overload
    // (CoachConversationEndpoints.cs) gives NO ordering guarantee, even for
    // messages on the SAME channel (see the library's own PubSubOrder.md
    // docs), unlike the ordered `SubscribeAsync(channel)` →
    // `ChannelMessageQueue.OnMessage(handler)` form.
    //
    // CONFIRMED (see PRPs/coach-stream-ordering-fix.md for full writeup):
    // Stream_Preserves_Chunk_Order_At_Low_Concurrency — a SINGLE publisher,
    // SINGLE channel, sequentially-awaited publishes (no client-side
    // concurrency at all) — failed 6 of 8 live runs against the local dev
    // stack, always an adjacent-pair swap. This is a stronger repro than
    // hypothesized: `PublishAsync` completing has no relationship to when
    // the BFF's `Handler` delegate actually runs, so the race is entirely
    // inside the BFF's per-channel dispatch, not caller-side concurrency.
    // The sibling high-concurrency test (many DIFFERENT channels, published
    // concurrently) passed 8/8 — expected, since cross-channel ordering was
    // never the invariant at risk; the bug is intra-channel, and the
    // low-concurrency test already isolates and reproduces it directly.
    // FIXED: CoachConversationEndpoints.cs now subscribes via the ordered
    // ChannelMessageQueue form (PRPs/coach-stream-ordering-fix.md).
```

- [ ] **Step 2: Un-skip the test and update its in-test comment**

Replace (lines 440-451, the attribute plus the first comment block inside the method):

```csharp
    [SkippableFact(Skip =
        "Confirmed bug — see PRPs/coach-stream-ordering-fix.md, tracked for a follow-up PRP. " +
        "Reproduces ~75% of live runs (6/8): the delegate SubscribeAsync(channel, Handler) " +
        "overload gives no per-channel ordering guarantee. Skipped (not deleted) so CI stays " +
        "green while the evidence + repro steps stay runnable on demand.")]
    [Trait("Category", "Slow")]
    public async Task Stream_Preserves_Chunk_Order_At_Low_Concurrency()
    {
        // Originally written as a "control" expected to always pass, paired
        // with a high-concurrency sibling meant to manufacture the race.
        // It turned out THIS is the one that reproduces the bug — a single
        // publisher on a single channel is already sufficient. See the
        // class-level comment above and PRPs/coach-stream-ordering-fix.md.
```

with:

```csharp
    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Stream_Preserves_Chunk_Order_At_Low_Concurrency()
    {
        // Originally written as a "control" expected to always pass, paired
        // with a high-concurrency sibling meant to manufacture the race.
        // It turned out THIS is the one that reproduces the bug — a single
        // publisher on a single channel is already sufficient. Now a live
        // regression guard for the ChannelMessageQueue fix — see the
        // class-level comment above and PRPs/coach-stream-ordering-fix.md.
```

- [ ] **Step 3: Confirm the pre-fix baseline still reproduces the bug**

Run (PowerShell):

```powershell
1..5 | ForEach-Object {
    dotnet test components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj `
        --filter "FullyQualifiedName~Stream_Preserves_Chunk_Order_At_Low_Concurrency" `
        -v minimal | Select-String "Passed!|Failed!"
}
```

Expected: at least 1 of the 5 lines reads `Failed!` (matches the ~75% historical failure rate; do not worry if fewer than expected fail — any observed failure confirms the baseline is still broken pre-fix). If Redis is unreachable the test will report as skipped, not failed/passed — start the local Redis container first (`docker compose -f docker/docker-compose.yml up -d`) and rerun.

- [ ] **Step 4: Commit**

```bash
git add components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs
git commit -m "test: re-enable coach chunk-order regression test (pre-fix baseline)"
```

---

### Task 2: Fix Coach's SSE relay to use the ordered ChannelMessageQueue subscribe form

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:442-449` (Handler + subscribe), `:470` (unsubscribe)

**Interfaces:**
- Consumes: `ISubscriber sub` (already in scope, from `redis.GetSubscriber()`), `RedisChannel channelName` (already in scope), `Channel<string> frames` (already in scope, unchanged).
- Produces: a local `ChannelMessageQueue messageQueue` variable that must stay in scope from the subscribe call through the `finally` block's unsubscribe call.

- [ ] **Step 1: Switch the subscribe call to the ordered form**

Replace:

```csharp
        void Handler(RedisChannel _, RedisValue value)
        {
            var payload = value.ToString();
            if (!string.IsNullOrEmpty(payload))
                frames.Writer.TryWrite(payload);
        }

        await sub.SubscribeAsync(channelName, Handler);
```

with:

```csharp
        void Handler(ChannelMessage msg)
        {
            var payload = msg.Message.ToString();
            if (!string.IsNullOrEmpty(payload))
                frames.Writer.TryWrite(payload);
        }

        // Ordered form: ChannelMessageQueue processes messages one at a time,
        // in the order received — the delegate SubscribeAsync(channel, Handler)
        // overload used previously gives no such guarantee, even for messages
        // on the same channel (confirmed bug, PRPs/coach-stream-ordering-fix.md).
        var messageQueue = await sub.SubscribeAsync(channelName);
        messageQueue.OnMessage(Handler);
```

- [ ] **Step 2: Switch the unsubscribe call in the `finally` block**

Replace:

```csharp
            try { await sub.UnsubscribeAsync(channelName, Handler); } catch { /* best-effort */ }
```

with:

```csharp
            try { await messageQueue.UnsubscribeAsync(); } catch { /* best-effort */ }
```

- [ ] **Step 3: Build**

If the BFF dev server is running, stop it first (Windows file-lock gotcha):

```powershell
Get-Process Spectr.Bff -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet build components/bff/src/Spectr.Bff/Spectr.Bff.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Run the ordering test 10x to confirm it now passes reliably**

```powershell
1..10 | ForEach-Object {
    dotnet test components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj `
        --filter "FullyQualifiedName~Stream_Preserves_Chunk_Order_At_Low_Concurrency" `
        -v minimal | Select-String "Passed!|Failed!"
}
```

Expected: all 10 lines read `Passed!`. If any read `Failed!`, the fix is incomplete — do not proceed; re-examine the diff against Step 1/2 above (a common mistake is leaving the old `Handler(RedisChannel, RedisValue)` signature in place, which won't compile against `OnMessage`, or forgetting to update the `finally` block, which throws at runtime instead of failing to build).

- [ ] **Step 5: Run the full Coach stream test file to check for regressions**

```powershell
dotnet test components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj `
    --filter "FullyQualifiedName~CoachStreamEndpointTests" -v minimal
```

Expected: all tests in the file pass (or skip, if Redis/Postgres unreachable — re-run with infra up to get a true signal).

- [ ] **Step 6: Commit**

```bash
git add components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs
git commit -m "fix(bff): coach SSE relay subscribes via ordered ChannelMessageQueue"
```

---

### Task 3: Add the Room chunk-order regression test (pre-fix baseline)

**Files:**
- Modify: `components/bff/tests/Spectr.Bff.Tests/RoomEndpointsTests.cs` (add `using System.Text.Json;`, one new test, three new private helpers)

**Interfaces:**
- Consumes: `NewAuthedClient()` → `(HttpClient Client, string Email, Guid UserId)`, `CreateVersion(HttpClient)` → `Guid`, `InsertLiveSession(Guid versionId, Guid hostId)` → `Guid` (all already defined in this file), `RedisReachable()` → `bool` (already defined in this file).
- Produces: `Stream_Preserves_Event_Order_At_Low_Concurrency` (a new `[Trait("Category","Slow")]` fact), plus three new private helpers (`PublishUntilSubscriberAttached`, `ReadSseFramesUntil`, `MarkerTextsInOrder`) that Task 4 does not need to touch.

**Why this test differs in shape from Coach's:** Room's SSE stream never terminates on its own (no "done" marker — it only stops on client disconnect), so the test can't call `ReadAsStringAsync()` on the full response body like Coach's test does; it must read the response stream line-by-line until it has collected the target number of frames, then cancel the request. Room also publishes a real `type:"presence"` event (the reader's own join) onto the same channel before any of our test payloads arrive, so frames must be filtered by the JSON payload's own `"type"` field, not just by SSE frame count.

- [ ] **Step 1: Add the missing using directive**

In `components/bff/tests/Spectr.Bff.Tests/RoomEndpointsTests.cs`, add to the existing using block (after `using StackExchange.Redis;`):

```csharp
using System.Text.Json;
```

- [ ] **Step 2: Write the new test and its helpers**

Insert before the closing `}` of the class (after `React_OnLiveSession_AppendsToRedisLog`, before the `// ── helpers ──` comment):

```csharp
    // ── item 2 follow-up: coach-stream-ordering-fix (PRPs/coach-stream-ordering-fix.md) ──
    //
    // Room's SSE relay used the identical delegate SubscribeAsync(channel, Handler)
    // pattern as Coach's — same no-ordering-guarantee exposure, just never exercised
    // by a test before now. This test establishes the PRE-FIX baseline; Task 4 makes
    // it pass reliably by switching Room's subscribe call to the ordered
    // ChannelMessageQueue form (identical fix to Coach's).
    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Stream_Preserves_Event_Order_At_Low_Concurrency()
    {
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");

        const int frameCount = 30;
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var sessionId = await InsertLiveSession(versionId, ownerId);

        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var sub = mux.GetSubscriber();
        var channel = new RedisChannel($"room:{sessionId:N}", RedisChannel.PatternMode.Literal);

        using var cts = new CancellationTokenSource();
        var requestTask = owner.GetAsync(
            $"/api/sessions/{sessionId}/stream", HttpCompletionOption.ResponseHeadersRead, cts.Token);

        // Payloads carry no "seq" field, so RoomEndpoints.cs's SeqOf(...) falls back
        // to long.MaxValue and the relay forwards every one of them — no need to
        // route these through RoomBus's WAL/seq machinery to exercise the bug.
        var attached = await PublishUntilSubscriberAttached(sub, channel,
            "{\"type\":\"marker\",\"text\":\"chunk-0\"}");
        Assert.True(attached, "BFF subscriber never attached within 2 s — relay loop is broken");

        for (var i = 1; i < frameCount; i++)
        {
            await sub.PublishAsync(channel, $"{{\"type\":\"marker\",\"text\":\"chunk-{i}\"}}");
        }

        try
        {
            var resp = await requestTask;
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
            // The reader's own presence-join event lands on this channel too
            // (published via RoomBus before RelayLoop starts draining), so we
            // count only "marker"-typed frames, not raw SSE frame count.
            bool IsMarkerFrame((string EventName, string Data) f)
            {
                if (f.EventName != "event") return false;
                using var doc = JsonDocument.Parse(f.Data);
                return doc.RootElement.TryGetProperty("type", out var t) && t.GetString() == "marker";
            }
            var frames = await ReadSseFramesUntil(stream, IsMarkerFrame, frameCount, TimeSpan.FromSeconds(10));

            var texts = MarkerTextsInOrder(frames);
            var expected = Enumerable.Range(0, frameCount).Select(i => $"chunk-{i}").ToList();
            Assert.Equal(expected, texts);
        }
        finally
        {
            cts.Cancel();
        }
    }

    private static async Task<bool> PublishUntilSubscriberAttached(
        ISubscriber sub, RedisChannel channel, string primerPayload)
    {
        for (var i = 0; i < 40; i++)
        {
            var receivers = await sub.PublishAsync(channel, primerPayload);
            if (receivers >= 1) return true;
            await Task.Delay(50);
        }
        return false;
    }

    private static async Task<List<(string EventName, string Data)>> ReadSseFramesUntil(
        Stream stream, Func<(string EventName, string Data), bool> countPredicate,
        int targetCount, TimeSpan timeout)
    {
        using var readCts = new CancellationTokenSource(timeout);
        var frames = new List<(string, string)>();
        using var reader = new StreamReader(stream);
        string? evt = null;
        string? data = null;
        try
        {
            while (frames.Count(countPredicate) < targetCount)
            {
                var line = await reader.ReadLineAsync(readCts.Token);
                if (line is null) break;
                if (line.Length == 0)
                {
                    if (evt is not null && data is not null) frames.Add((evt, data));
                    evt = null;
                    data = null;
                    continue;
                }
                if (line.StartsWith("event: ")) evt = line[7..];
                else if (line.StartsWith("data: ")) data = line[6..];
            }
        }
        catch (OperationCanceledException) { /* timed out — return whatever was captured */ }
        return frames;
    }

    private static List<string> MarkerTextsInOrder(List<(string EventName, string Data)> frames)
    {
        var texts = new List<string>();
        foreach (var f in frames)
        {
            if (f.EventName != "event") continue;
            using var doc = JsonDocument.Parse(f.Data);
            if (!doc.RootElement.TryGetProperty("type", out var t) || t.GetString() != "marker") continue;
            texts.Add(doc.RootElement.GetProperty("text").GetString() ?? "");
        }
        return texts;
    }
```

- [ ] **Step 3: Confirm the pre-fix baseline reproduces the same bug in Room**

```powershell
1..5 | ForEach-Object {
    dotnet test components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj `
        --filter "FullyQualifiedName~Stream_Preserves_Event_Order_At_Low_Concurrency" `
        -v minimal | Select-String "Passed!|Failed!"
}
```

Expected: at least 1 of the 5 lines reads `Failed!`, confirming Room shares Coach's exposure. (If all 5 pass, rerun a few more times before concluding otherwise — the race is probabilistic, not every run reproduces it, per the Coach evidence.)

- [ ] **Step 4: Commit**

```bash
git add components/bff/tests/Spectr.Bff.Tests/RoomEndpointsTests.cs
git commit -m "test: add room chunk-order regression test (pre-fix baseline)"
```

---

### Task 4: Fix Room's SSE relay to use the ordered ChannelMessageQueue subscribe form

**Files:**
- Modify: `components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs:186-191` (Handler + subscribe), `:221` (unsubscribe)

**Interfaces:**
- Consumes: `ISubscriber sub` (already in scope), `RedisChannel channel` (already in scope), `Channel<string> frames` (already in scope, unchanged).
- Produces: a local `ChannelMessageQueue messageQueue` variable, same pattern as Task 2.

- [ ] **Step 1: Switch the subscribe call to the ordered form**

Replace:

```csharp
        void Handler(RedisChannel _, RedisValue value)
        {
            var p = value.ToString();
            if (!string.IsNullOrEmpty(p)) frames.Writer.TryWrite(p);
        }
        await sub.SubscribeAsync(channel, Handler);
```

with:

```csharp
        void Handler(ChannelMessage msg)
        {
            var p = msg.Message.ToString();
            if (!string.IsNullOrEmpty(p)) frames.Writer.TryWrite(p);
        }
        // Ordered form — see CoachConversationEndpoints.cs::StreamMessage for the
        // identical fix + PRPs/coach-stream-ordering-fix.md for the confirmed bug.
        var messageQueue = await sub.SubscribeAsync(channel);
        messageQueue.OnMessage(Handler);
```

- [ ] **Step 2: Switch the unsubscribe call in the `finally` block**

Replace:

```csharp
            try { await sub.UnsubscribeAsync(channel, Handler); } catch { /* best-effort */ }
```

with:

```csharp
            try { await messageQueue.UnsubscribeAsync(); } catch { /* best-effort */ }
```

- [ ] **Step 3: Build**

```powershell
Get-Process Spectr.Bff -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet build components/bff/src/Spectr.Bff/Spectr.Bff.csproj
```

Expected: `Build succeeded.`

- [ ] **Step 4: Run the Room ordering test 10x to confirm it now passes reliably**

```powershell
1..10 | ForEach-Object {
    dotnet test components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj `
        --filter "FullyQualifiedName~Stream_Preserves_Event_Order_At_Low_Concurrency" `
        -v minimal | Select-String "Passed!|Failed!"
}
```

Expected: all 10 lines read `Passed!`.

- [ ] **Step 5: Run the full BFF test suite to check for regressions across both features**

```powershell
dotnet test components/bff/tests/Spectr.Bff.Tests/Spectr.Bff.Tests.csproj
```

Expected: same pass count as the pre-existing baseline (per `PRPs/archive/2026-07-23_first-upload-trust-quickwins.md`'s validation run: 415 passed + this plan's now-unskipped test + the new Room test — no new failures). If `AnonAnalysisTests.Anon_Upload_Creates_Songless_Device_Job_And_Is_Pollable` fails, that is a known pre-existing local-environment race unrelated to this change (a live dramatiq worker process racing shared dev Postgres/Redis) — rerun once to confirm it's not a real regression before treating it as one.

- [ ] **Step 6: Commit**

```bash
git add components/bff/src/Spectr.Bff/Endpoints/RoomEndpoints.cs
git commit -m "fix(bff): room SSE relay subscribes via ordered ChannelMessageQueue"
```

- [ ] **Step 7: Update the tracking PRP and archive it**

In `PRPs/coach-stream-ordering-fix.md`, change the `## Status:` header line from `design approved, ready for implementation planning` to `fixed and verified — both Coach and Room now use the ordered ChannelMessageQueue subscribe form; both regression tests pass reliably (10/10 local runs)`. Then archive per the project's PRP workflow:

```bash
mkdir -p PRPs/archive
mv PRPs/coach-stream-ordering-fix.md PRPs/archive/2026-07-23_coach-stream-ordering-fix.md
git add PRPs/coach-stream-ordering-fix.md PRPs/archive/2026-07-23_coach-stream-ordering-fix.md
git commit -m "docs: archive coach-stream-ordering-fix PRP as executed"
```
