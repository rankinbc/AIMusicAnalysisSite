namespace Spectr.Domain;

// Mirrors aimusic_shared.models.JobStatus on the Python side.
// Source of truth is the Python worker; keep in sync.
public enum JobStatus
{
    Pending,
    Processing,
    Complete,
    Failed,
    AwaitingStemMapping,
}

public enum VerdictSeverity { Critical, Severe, Moderate, Minor, Win }
public enum VerdictCategory { LowEnd, Frequency, Dynamics, Stereo, Loudness, Arrangement, Reference, Detail, Overall }
public enum FixStepKind { Plugin, Fx, Target, Automation, Check, Arrangement, Production }
public enum ChartType { Lufs, Frequency, EqCurve, Sidechain, Arrangement, Stems }
