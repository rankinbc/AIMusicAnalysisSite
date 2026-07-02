namespace Spectr.Bff.Services;

/// <summary>
/// Cross-slice notification seam (PRP-0). Emitters — PRP-3 (comment/suggestion
/// created, suggestion accepted) and PRP-6 (bookmark) — call this IN the same
/// <c>SaveChanges</c> as their write, so a rolled-back transaction emits nothing.
/// PRP-7 registers the real implementation; the no-op default lets the earlier
/// slices build + test standalone (kills the PRP-3 → PRP-7 backward dependency).
/// The signatures are the seam — PRP-7 may refine the payload shape.
/// </summary>
public interface INotificationSink
{
    Task NotifyAsync(
        ActorRef recipient,
        string eventType,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct = default);

    // Story 11.6 seam refinement (reserved above): digest rows key on the
    // version, so the call site must supply it.
    Task NotifyDigestAsync(
        ActorRef recipient,
        string digestType,
        Guid versionId,
        CancellationToken ct = default);
}

/// <summary>No-op sink — kept for tests; TableNotificationSink is registered (story 11.6).</summary>
public sealed class NoOpNotificationSink : INotificationSink
{
    public Task NotifyAsync(
        ActorRef recipient,
        string eventType,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct = default) => Task.CompletedTask;

    public Task NotifyDigestAsync(
        ActorRef recipient,
        string digestType,
        Guid versionId,
        CancellationToken ct = default) => Task.CompletedTask;
}
