using System.Text.Json;
using System.Text.Json.Nodes;
using Spectr.Bff.DTOs;
using StackExchange.Redis;

namespace Spectr.Bff.Services;

// Listen V3 (PRP-4) — the Room real-time engine over the singleton
// IConnectionMultiplexer. GENERALIZES the coach SSE-over-Redis-pubsub pattern
// with a fan-out channel + a durable write-ahead log.
//
// DURABILITY MODEL (the one principle everything falls out of): the Redis LIST
// room:{id}:log is the session's WRITE-AHEAD LOG / single source of truth. Every
// event gets a monotonic seq from INCR room:{id}:seq, appended ATOMICALLY with
// the RPUSH via a Lua script (no phantom-seq gap on crash). room:{id}:chain |
// :transport | :visuals | :present are DERIVED, last-write-wins caches —
// eviction-safe because the chain reconstructs from the log on a miss (G2).
// The BFF NEVER flushes/DELs the log: the synthesize_recap actor is the sole
// flusher (Python). This service only writes/reads Redis.
public sealed class RoomBus(IConnectionMultiplexer redis)
{
    private readonly IConnectionMultiplexer _redis = redis;

    // Atomic INCR seq + RPUSH log in one round-trip. The body JSON is appended
    // a ,"seq":<n> field by stripping its trailing '}' and re-closing — this
    // guarantees an UNQUOTED numeric seq (a string-placeholder gsub would quote
    // it). Bodies are always non-empty JSON objects, so #body-1 is safe.
    private const string AppendLua = @"
        local seq = redis.call('INCR', KEYS[1])
        local body = ARGV[1]
        local evt = string.sub(body, 1, #body - 1) .. ',""seq"":' .. seq .. '}'
        redis.call('RPUSH', KEYS[2], evt)
        return {seq, evt}";

    private const int FeedCap = 14;            // ticker projection size (seams §1)

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    // ── key helpers ──────────────────────────────────────────────────────────
    private static string SeqKey(Guid id) => $"room:{id:N}:seq";
    private static string LogKey(Guid id) => $"room:{id:N}:log";
    private static string ChainKey(Guid id) => $"room:{id:N}:chain";
    private static string TransportKey(Guid id) => $"room:{id:N}:transport";
    private static string VisualsKey(Guid id) => $"room:{id:N}:visuals";
    private static string PresentKey(Guid id) => $"room:{id:N}:present";

    public static RedisChannel ChannelFor(Guid id) =>
        new($"room:{id:N}", RedisChannel.PatternMode.Literal);

    private IDatabase Db => _redis.GetDatabase();

    public static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ── append (atomic seq+log) ──────────────────────────────────────────────
    // evt is a wire object WITHOUT seq (type/at/actor/payload). Returns the
    // assigned seq + the final seq-stamped JSON that was logged.
    private async Task<(long Seq, string Evt)> AppendAsync(Guid id, object evt)
    {
        var body = JsonSerializer.Serialize(evt, Json);
        var result = await Db.ScriptEvaluateAsync(
            AppendLua,
            new RedisKey[] { SeqKey(id), LogKey(id) },
            new RedisValue[] { body });
        var arr = (RedisResult[])result!;
        return ((long)arr[0], (string)arr[1]!);
    }

    public async Task PublishAsync(Guid id, string evtJson) =>
        await _redis.GetSubscriber().PublishAsync(ChannelFor(id), evtJson);

    // TRANSIENT signal path (e.g. the terminal "ended" on host /end): publish
    // only — NO WAL append, NO seq. The WAL belongs to the finalize actor and
    // is about to be flushed; durability for these signals comes from the DB
    // session status, not the log.
    public Task PublishTransientAsync(Guid id, string type) =>
        PublishAsync(id, JsonSerializer.Serialize(new { type, at = NowMs() }, Json));

    // The common path for react/chat/status/transport/visuals/grant/presence:
    // durable record FIRST (atomic seq+append), best-effort live publish AFTER.
    public async Task<long> AppendAndPublishAsync(Guid id, object evt)
    {
        var (seq, json) = await AppendAsync(id, evt);
        await PublishAsync(id, json);
        return seq;
    }

    // SESSION START: write the seq=1 BASE so chain reconstruction always has a
    // base, even if the host never touches the rack. Sets the chain cache too.
    public async Task SeedBaseAsync(Guid id, JsonNode chain, ActorRefDto host)
    {
        await AppendAsync(id, new { type = "base", at = NowMs(), actor = host, chain });
        await Db.StringSetAsync(ChainKey(id), chain.ToJsonString(Json));
    }

    public async Task<long> CurrentSeqAsync(Guid id)
    {
        var v = await Db.StringGetAsync(SeqKey(id));
        return v.HasValue ? (long)v : 0;
    }

    // ── current-state caches (last-write-wins) ───────────────────────────────
    public Task SetTransportAsync(Guid id, JsonNode transport) =>
        Db.StringSetAsync(TransportKey(id), transport.ToJsonString(Json));

    public Task SetVisualsAsync(Guid id, JsonNode visuals) =>
        Db.StringSetAsync(VisualsKey(id), visuals.ToJsonString(Json));

    // Apply a rack delta ({effectId, params}) onto the shared chain, persisting
    // the folded result to the chain cache. Reconstructs from the log first on a
    // cache miss (G2). Returns the new full chain (for snapshot/echo if needed).
    public async Task<JsonNode> ApplyRackDeltaAsync(Guid id, string effectId, JsonNode @params)
    {
        var chain = await GetChainOrReconstructAsync(id) ?? NeutralChain();
        FoldRackDelta(chain, effectId, @params);
        await Db.StringSetAsync(ChainKey(id), chain.ToJsonString(Json));
        return chain;
    }

    // The shared chain a grantee-save snapshots into a Suggestion, and the
    // hydrate sync frame carries. Cache hit is the common path (the broker runs
    // noeviction); on a miss, fold the log's rack deltas over the seq=1 base.
    public async Task<JsonNode?> GetChainOrReconstructAsync(Guid id)
    {
        var cached = await Db.StringGetAsync(ChainKey(id));
        if (cached.HasValue)
        {
            try { return JsonNode.Parse(cached.ToString()); }
            catch (JsonException) { /* corrupt cache → reconstruct below */ }
        }
        return ReconstructChainFromLog(await ReadLogAsync(id));
    }

    // ── presence (roster = a HASH actorKey -> ActorRef JSON) ─────────────────
    // Membership is maintained by the SSE connect/disconnect lifecycle. A relay
    // that crashes without running its finally leaves a stale entry; the
    // lazy-on-read finalize backstop (GET /sessions/{id}) is the safety net.
    public Task PresenceAddAsync(Guid id, string actorKey, ActorRefDto actor) =>
        Db.HashSetAsync(PresentKey(id), actorKey, JsonSerializer.Serialize(actor, Json));

    public Task PresenceRemoveAsync(Guid id, string actorKey) =>
        Db.HashDeleteAsync(PresentKey(id), actorKey);

    public async Task<bool> PresenceEmptyAsync(Guid id) =>
        await Db.HashLengthAsync(PresentKey(id)) == 0;

    public async Task<IReadOnlyList<ActorRefDto>> PresenceListAsync(Guid id)
    {
        var vals = await Db.HashValuesAsync(PresentKey(id));
        var list = new List<ActorRefDto>(vals.Length);
        foreach (var v in vals)
        {
            if (!v.HasValue) continue;
            try
            {
                var a = JsonSerializer.Deserialize<ActorRefDto>(v.ToString(), Json);
                if (a is not null) list.Add(a);
            }
            catch (JsonException) { /* skip a corrupt entry */ }
        }
        return list;
    }

    // ── hydrate snapshot ─────────────────────────────────────────────────────
    public async Task<RoomSnapshot> SnapshotAsync(Guid id)
    {
        // Read the log ONCE; derive chain-fallback + feed from it.
        var log = await ReadLogAsync(id);
        var snapshotSeq = await CurrentSeqAsync(id);

        var cachedChain = await Db.StringGetAsync(ChainKey(id));
        JsonNode? chain = null;
        if (cachedChain.HasValue)
        {
            try { chain = JsonNode.Parse(cachedChain.ToString()); } catch (JsonException) { }
        }
        chain ??= ReconstructChainFromLog(log);

        var transport = await ReadNodeAsync(TransportKey(id));
        var visuals = await ReadNodeAsync(VisualsKey(id));
        var roster = await PresenceListAsync(id);

        // feed = the last FeedCap reaction events, in chronological order.
        var feed = new List<JsonNode>();
        for (var i = log.Count - 1; i >= 0 && feed.Count < FeedCap; i--)
        {
            var node = TryParse(log[i]);
            if (node?["type"]?.GetValue<string>() == "reaction") feed.Add(node);
        }
        feed.Reverse();

        return new RoomSnapshot(chain, transport, visuals, roster, feed, snapshotSeq);
    }

    private async Task<JsonNode?> ReadNodeAsync(string key)
    {
        var v = await Db.StringGetAsync(key);
        if (!v.HasValue) return null;
        try { return JsonNode.Parse(v.ToString()); } catch (JsonException) { return null; }
    }

    public async Task<IReadOnlyList<string>> ReadLogRawAsync(Guid id) =>
        (await ReadLogAsync(id)).AsReadOnly();

    private async Task<List<string>> ReadLogAsync(Guid id)
    {
        var entries = await Db.ListRangeAsync(LogKey(id));
        var list = new List<string>(entries.Length);
        foreach (var e in entries)
            if (e.HasValue) list.Add(e!);
        return list;
    }

    // ── chain folding ────────────────────────────────────────────────────────
    private static JsonNode? ReconstructChainFromLog(List<string> log)
    {
        JsonNode? chain = null;
        foreach (var raw in log)
        {
            var node = TryParse(raw);
            if (node is null) continue;
            var type = node["type"]?.GetValue<string>();
            if (type == "base")
            {
                // The base carries the full chain (deep-clone it out of the evt).
                chain = node["chain"] is JsonNode c ? JsonNode.Parse(c.ToJsonString()) : null;
            }
            else if (type == "rack" && chain is not null)
            {
                var effectId = node["effectId"]?.GetValue<string>();
                if (effectId is not null && node["params"] is JsonNode p)
                    FoldRackDelta(chain, effectId, p);
            }
        }
        return chain;
    }

    // Merge a {effectId, params} patch into chain.modules[effectId] in place.
    private static void FoldRackDelta(JsonNode chain, string effectId, JsonNode @params)
    {
        if (chain["modules"] is not JsonObject modules)
        {
            modules = new JsonObject();
            chain["modules"] = modules;
        }
        if (modules[effectId] is not JsonObject mod)
        {
            mod = new JsonObject();
            modules[effectId] = mod;
        }
        if (@params is JsonObject patch)
        {
            foreach (var kv in patch)
                mod[kv.Key] = kv.Value is null ? null : JsonNode.Parse(kv.Value.ToJsonString());
        }
    }

    private static JsonNode NeutralChain() =>
        new JsonObject
        {
            ["order"] = new JsonArray(),
            ["modules"] = new JsonObject(),
            ["masterBypass"] = false,
        };

    private static JsonNode? TryParse(string raw)
    {
        try { return JsonNode.Parse(raw); } catch (JsonException) { return null; }
    }
}
