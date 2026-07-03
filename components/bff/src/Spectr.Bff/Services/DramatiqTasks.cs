namespace Spectr.Bff.Services;

// Canonical actor names — must match @dramatiq.actor(...) declarations in
// the Python worker (components/worker/app/*). Mismatch produces dead-letter
// on the Python side.
public static class DramatiqTasks
{
    public const string AnalyzeAudioJob = "analyze_audio_job";
    public const string ClassifyStems = "classify_stems";
    public const string RunSpecialist = "run_specialist";
    public const string RunTriage = "run_triage";
    public const string RunReferenceAnalyzer = "run_reference_analyzer";
    public const string CoachReply = "coach_reply";
    public const string RerunPhase = "rerun_phase";
    public const string SynthesizeRecap = "synthesize_recap";
    public const string GenerateFixRack = "generate_fix_rack";
    public const string SweepRetention = "sweep_retention"; // story 3.4 — maintenance queue
    public const string SendEmail = "send_email";           // story 4.2 — maintenance queue
}
