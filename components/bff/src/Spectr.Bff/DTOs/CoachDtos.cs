using System.Text.Json;

namespace Spectr.Bff.DTOs;

// Combined view consumed by the AI Coach tab. Reduces N round-trips on
// page-load (analysis → verdicts → summary) to one.
public sealed record CoachViewDto(
    Guid JobId,
    string? SongName,
    JsonElement FinalJson,
    int SpecialistsRun,
    int SpecialistsTotal,
    int CriticalCount,
    int WarningCount,
    int InfoCount,
    JsonElement Verdicts);

public sealed record CoachChatRequest(string Message);

public sealed record CoachChatNotWiredResponse(string Detail);
