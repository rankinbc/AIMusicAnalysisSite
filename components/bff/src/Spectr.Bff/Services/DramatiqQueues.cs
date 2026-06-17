namespace Spectr.Bff.Services;

// Canonical dramatiq queue names — must match @dramatiq.actor(queue_name=...)
// declarations in the Python worker. Story 1.5 introduced `coach`; story 2.5
// adds the AR23 split queues `analysis-paid`, `analysis-free`, `maintenance`.
public static class DramatiqQueues
{
    // Legacy/back-compat only. After story 2.5 NO live enqueue targets `default`
    // (prod has no `default` consumer — see the enforcement tests). Kept defined
    // so the 2-arg IJobQueue overload still compiles for source-compat.
    public const string Default = "default";
    public const string Coach = "coach";

    // AR23 production topology (story 2.5):
    //   W1 (worker-paid) consumes: coach, analysis-paid
    //   W2 (worker-free) consumes: analysis-free, maintenance
    public const string AnalysisPaid = "analysis-paid";
    public const string AnalysisFree = "analysis-free";
    public const string Maintenance = "maintenance";
}
