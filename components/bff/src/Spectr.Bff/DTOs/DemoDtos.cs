namespace Spectr.Bff.DTOs;

// Task D4 — admin demo-snapshot exporter wire shapes (spec §5 API contracts).
public sealed record DemoSnapshotExportRequest(Guid VersionId, string? Reason);

// Fix-round-1 item 7: the id/email leak scan can't judge free text a human
// typed on purpose (song title, rack preset names, the owner's own coach
// questions) — it's exported verbatim by design. This is pure disclosure so
// an operator can read it before flipping the demo on; no filtering here.
public sealed record DemoSnapshotFreeText(
    string Title, IReadOnlyList<string> RackPresetNames, IReadOnlyList<string> UserMessages);

public sealed record DemoSnapshotExportResponse(
    string SnapshotKey, int Verdicts, int Messages, int RackPresets, long AudioBytes,
    DemoSnapshotFreeText FreeText);

// Task D5 — POST /api/auth/demo response shapes (spec §5).
public sealed record DemoTarget(Guid SongId, Guid VersionId, Guid JobId);

public sealed record DemoStartResponse(
    string AccessToken, AuthedUser User, DemoTarget Demo, bool Resumed);

// Task D6 — GET /api/me/guest response (404 for non-guests). Lets the
// frontend flip "+ Upload" to "Create free account" once the guest's one
// upload / one analysis is spent, and render the coach chip consistently
// with CoachCapsDto's Used/Limit shape.
public sealed record GuestStateDto(
    int UploadsUsed, int UploadsMax,
    int AnalysesUsed, int AnalysesMax,
    int CoachMessagesUsed, int CoachMessagesMax,
    DateTimeOffset? ExpiresAt);
