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

    Task NotifyDigestAsync(
        ActorRef recipient,
        string digestType,
        CancellationToken ct = default);
}

/// <summary>Default no-op sink — does nothing until PRP-7 registers the real one.</summary>
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
        CancellationToken ct = default) => Task.CompletedTask;
}
