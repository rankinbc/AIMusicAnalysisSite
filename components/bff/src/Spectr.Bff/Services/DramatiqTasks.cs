namespace Spectr.Bff.Services;

// Canonical actor names — must match @dramatiq.actor(...) declarations in
// the Python worker (components/worker/app/*). Mismatch produces dead-letter
// on the Python side.
public static class DramatiqTasks
{
    public const string AnalyzeAudioJob = "analyze_audio_job";
    public const string RunSpecialist = "run_specialist";
}
