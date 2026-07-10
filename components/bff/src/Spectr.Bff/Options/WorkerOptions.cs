namespace Spectr.Bff.Options;

/// <summary>
/// Worker-supervision knobs. Single source of truth for the stale-job policy:
/// the <c>StaleJobReaper</c> background service reads <see cref="StaleJobMinutes"/>,
/// and <c>scripts/recover-jobs.ps1</c> reads the same value out of appsettings so
/// the launcher and the runtime reaper never drift.
/// </summary>
public sealed class WorkerOptions
{
    public const string SectionName = "Worker";

    /// <summary>
    /// A PROCESSING job whose started_at (falling back to dispatched_at for
    /// rows whose status flipped before started_at committed) is older than
    /// this is treated as abandoned by a dead worker and marked failed. Must
    /// exceed the longest legitimate single job (structure/demucs ~20 min
    /// measured from started_at) so a slow-but-live job is never false-failed.
    /// </summary>
    public int StaleJobMinutes { get; init; } = 30;

    /// <summary>
    /// Story 3.5 (NFR16): a PENDING job's message still sits in the Redis
    /// queue and resumes when the worker returns — it must NOT be failed on
    /// the short processing window just because the worker was down. This
    /// much longer grace (from dispatched_at) only catches truly orphaned
    /// rows whose message was lost.
    /// </summary>
    public int PendingGraceMinutes { get; init; } = 240;

    /// <summary>
    /// Story 12.2 (AC2): the FAST pending tier — when NO live worker heartbeat
    /// exists (stale or absent), a pending job's message has nothing draining
    /// the queue, so it is failed after this much shorter grace instead of
    /// <see cref="PendingGraceMinutes"/>. A merely-busy worker keeps its
    /// heartbeat fresh, so its queued jobs are never false-failed by this
    /// tier. Deliberately NOT clamped by <see cref="StaleJobMinutes"/> (a dead
    /// worker cannot be "still working on it"). Default equals
    /// <see cref="PendingGraceMinutes"/> = zero behavior change unless
    /// overridden (Development sets 5).
    /// </summary>
    public int PendingNoWorkerGraceMinutes { get; init; } = 240;

    /// <summary>
    /// The worker is considered offline if the most recent dramatiq heartbeat
    /// (max score in the <c>dramatiq:__heartbeats__</c> ZSET) is older than this.
    /// A live worker refreshes its heartbeat every few seconds, so 60 s gives a
    /// safe margin against transient pauses.
    /// </summary>
    public int HeartbeatStaleSeconds { get; init; } = 60;
}
