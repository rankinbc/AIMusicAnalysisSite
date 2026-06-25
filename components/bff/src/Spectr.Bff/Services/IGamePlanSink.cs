namespace Spectr.Bff.Services;

/// <summary>
/// Cross-slice game-plan drain seam (PRP-0). Emitters — PRP-3 (suggestion
/// accepted → adopted-preset) and PRP-4 (room recap published) — call
/// <see cref="InsertDrainItemAsync"/> IN the same <c>SaveChanges</c> as their
/// write. PRP-5 registers the real implementation that appends to the GamePlan
/// drain; the no-op default removes the PRP-3 → PRP-5 backward dependency. The
/// signature is the seam — PRP-5 may refine it.
/// </summary>
public interface IGamePlanSink
{
    Task InsertDrainItemAsync(
        Guid songVersionId,
        string source,
        string refType,
        string refId,
        CancellationToken ct = default);
}

/// <summary>Default no-op sink — does nothing until PRP-5 registers the real one.</summary>
public sealed class NoOpGamePlanSink : IGamePlanSink
{
    public Task InsertDrainItemAsync(
        Guid songVersionId,
        string source,
        string refType,
        string refId,
        CancellationToken ct = default) => Task.CompletedTask;
}
