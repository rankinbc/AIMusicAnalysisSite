namespace Spectr.Bff.DTOs;

// Task D4 — admin demo-snapshot exporter wire shapes (spec §5 API contracts).
public sealed record DemoSnapshotExportRequest(Guid VersionId, string? Reason);

public sealed record DemoSnapshotExportResponse(
    string SnapshotKey, int Verdicts, int Messages, int RackPresets, long AudioBytes);
