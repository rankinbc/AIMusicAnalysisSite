namespace Spectr.Bff.Services;

// Canonical dramatiq queue names — must match @dramatiq.actor(queue_name=...)
// declarations in the Python worker. Story 1.5 introduced `coach`; story 2.5
// adds the AR23 split queues `analysis-paid`, `analysis-free`, `maintenance`;
// the interactive AI lane adds `ai`.
public static class DramatiqQueues
{
    // Legacy/back-compat only. After story 2.5 NO live enqueue targets `default`
    // (prod has no `default` consumer — see the enforcement tests). Kept defined
    // so the 2-arg IJobQueue overload still compiles for source-compat.
    public const string Default = "default";
    public const string Coach = "coach";

    // Production topology (infra/compose.prod.yml, STARTUP.md #3b):
    //   worker-paid (interactive, WORKER_THREADS=4) consumes: coach, ai
    //   worker-free (batch, 1 thread) consumes: analysis-paid, analysis-free, maintenance
    //   worker-guest-ai (1 thread) consumes: ai-guest
    public const string AnalysisPaid = "analysis-paid";
    public const string AnalysisFree = "analysis-free";
    public const string Maintenance = "maintenance";

    // Interactive LLM actors the user is waiting on — run_triage,
    // run_specialist, generate_fix_rack. Its own lane so Triage never queues
    // behind a multi-minute analyze_audio_job / allin1 structure run on the
    // one-thread batch worker. Guests are NOT routed here (GuestLimits.AiQueueFor).
    public const string Ai = "ai";

    // Guests' interactive AI actors (same three actors as `ai`): a separate
    // lane consumed by its own small one-thread worker (prod: worker-guest-ai)
    // so demo traffic never takes real users' `ai` threads nor queues behind
    // batch analysis. Dispatch is by actor_name, so no actor declares it.
    public const string AiGuest = "ai-guest";
}
