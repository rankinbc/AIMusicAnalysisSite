namespace Spectr.Bff.Services;

// Canonical dramatiq queue names — must match @dramatiq.actor(queue_name=...)
// declarations in the Python worker. Story 1.5 introduces `coach`; future
// stories add `analysis-paid`, `analysis-free`, `maintenance` (AR23).
public static class DramatiqQueues
{
    public const string Default = "default";
    public const string Coach = "coach";
}
