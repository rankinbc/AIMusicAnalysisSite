namespace Spectr.Bff.Services;

/// <summary>
/// Forward-compat seam (mirrors PRP-0's no-op sink convention). A future PRP-8
/// swaps in the real impl that turns a verdict.fix.dsp_chain (coach) or an
/// analysis output into a <c>source='coach'|'analysis'</c> RackPreset row. This
/// slice ships storage + the reserved CHECK values only — no generator runs yet,
/// so the DI default is a no-op and nothing in PRP-1 calls it.
/// </summary>
public interface IPresetGenerator
{
    /// <summary>Generate system presets for a version; returns the count written.</summary>
    Task<int> GenerateForVersionAsync(Guid songVersionId, string source, CancellationToken ct = default);
}

public sealed class NoOpPresetGenerator : IPresetGenerator
{
    public Task<int> GenerateForVersionAsync(
        Guid songVersionId, string source, CancellationToken ct = default) => Task.FromResult(0);
}
