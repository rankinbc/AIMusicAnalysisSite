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
    /// A non-terminal job (pending/processing) whose most-recent activity
    /// (started_at, else dispatched_at) is older than this is treated as
    /// abandoned by a dead worker and marked failed. Must exceed the longest
    /// legitimate single job (structure/demucs ~20 min measured from started_at)
    /// so a slow-but-live job is never false-failed.
    /// </summary>
    public int StaleJobMinutes { get; init; } = 30;

    /// <summary>
    /// The worker is considered offline if the most recent dramatiq heartbeat
    /// (max score in the <c>dramatiq:__heartbeats__</c> ZSET) is older than this.
    /// A live worker refreshes its heartbeat every few seconds, so 60 s gives a
    /// safe margin against transient pauses.
    /// </summary>
    public int HeartbeatStaleSeconds { get; init; } = 60;
}
