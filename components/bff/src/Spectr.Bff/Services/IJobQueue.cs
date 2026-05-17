using StackExchange.Redis;
using System.Text.Json;

namespace Spectr.Bff.Services;

// Posts dramatiq-compatible JSON jobs to Redis. The Python worker pulls them via
// dramatiq's @actor decorator on the matching task name.
public interface IJobQueue
{
    Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default);
}

internal sealed class DramatiqJobQueue(IConfiguration config) : IJobQueue
{
    private const string Namespace = "dramatiq";
    private const string DefaultQueue = "default";

    private readonly ConnectionMultiplexer _redis = ConnectionMultiplexer.Connect(
        config["Redis:ConnectionString"] ?? throw new InvalidOperationException("Redis:ConnectionString not set"));

    public async Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
    {
        // Dramatiq's RedisBroker (per dispatch.lua "enqueue" branch) uses:
        //   * dramatiq:<queue>.msgs   — HASH: { message_id → JSON payload }
        //   * dramatiq:<queue>        — LIST: message_ids only (RPUSH on enqueue, LPOP on fetch)
        // We mirror that exactly. The list holds *only* the id; the actual payload
        // lives in the hash. We wrap both writes in a MULTI/EXEC so a worker can
        // never LPOP an id without finding its body in the hash.
        // Dramatiq generates a SEPARATE id for the redis hash/list key vs the
        // actor-visible message_id (so retries don't reuse the same hash slot).
        // We use one uuid for both since slice 1 doesn't rely on retries.
        var redisMessageId = Guid.NewGuid().ToString();
        var actorMessageId = Guid.NewGuid().ToString();
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var envelope = new
        {
            queue_name = DefaultQueue,
            actor_name = taskName,
            args,
            kwargs = new { },
            // CRITICAL: dramatiq's consumer reads options["redis_message_id"]
            // during ack/nack/requeue (brokers/redis.py:311). Without it the
            // worker throws KeyError on every successful or failed message.
            options = new { redis_message_id = redisMessageId },
            message_id = actorMessageId,
            message_timestamp = timestamp,
        };
        var json = JsonSerializer.Serialize(envelope);

        var queueKey = $"{Namespace}:{DefaultQueue}";
        var msgsKey = $"{queueKey}.msgs";

        var db = _redis.GetDatabase();
        var tx = db.CreateTransaction();
        _ = tx.HashSetAsync(msgsKey, redisMessageId, json);
        _ = tx.ListRightPushAsync(queueKey, redisMessageId);
        await tx.ExecuteAsync();
    }
}
