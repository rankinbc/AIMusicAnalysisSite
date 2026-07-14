using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Story 6.3 review (CRITICAL) — the server-side gate for the anonymous report.
// The /analyze funnel promises "create a free account to see all N findings";
// that gate is only real if the withheld findings are never sent. This projects
// a full analysis final_json down to ONLY the fields UX-DR27 shows unlocked:
// grade/score/danceability, phase-1 (for streaming readiness), and the SINGLE
// top finding — plus the total finding count so the blur can honestly tease
// "N more". The full report is served exclusively by the authed endpoint after
// the device is claimed.
public sealed record AnonReport(
    JsonElement FinalJson,
    string? TopFinding,
    int TotalFindings);

public static class AnonReportProjection
{
    public static AnonReport Empty(Guid jobId) =>
        new(JsonDocument.Parse("{}").RootElement.Clone(), null, 0);

    public static AnonReport Build(Guid jobId, JsonElement full)
    {
        var findings = ExtractFindings(full);
        var reduced = new Dictionary<string, object?>();

        CopyIf(full, "grade", reduced);
        CopyIf(full, "overall_score", reduced);
        CopyIf(full, "danceability_score", reduced);

        // Keep ONLY phase 1 (loudness/true-peak → streaming readiness). Every
        // other phase's detail is the paid content.
        if (full.TryGetProperty("phases", out var phases) && phases.ValueKind == JsonValueKind.Array)
        {
            var phase1 = phases.EnumerateArray()
                .FirstOrDefault(p => p.TryGetProperty("phase", out var n)
                    && n.ValueKind == JsonValueKind.Number && n.GetInt32() == 1);
            if (phase1.ValueKind == JsonValueKind.Object)
                reduced["phases"] = new[] { JsonSerializer.Deserialize<object>(phase1.GetRawText()) };
        }

        // Only the #1 finding text ships; the rest is a count.
        if (findings.Count > 0)
            reduced["top_fixes"] = new[] { findings[0] };

        var json = JsonSerializer.SerializeToElement(reduced);
        return new AnonReport(json, findings.Count > 0 ? findings[0] : null, findings.Count);
    }

    private static void CopyIf(JsonElement src, string name, Dictionary<string, object?> dst)
    {
        if (src.TryGetProperty(name, out var v) && v.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
            dst[name] = JsonSerializer.Deserialize<object>(v.GetRawText());
    }

    private static List<string> ExtractFindings(JsonElement full)
    {
        foreach (var key in new[] { "top_fixes", "coached_fixes" })
        {
            if (full.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                var list = arr.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString()!)
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .ToList();
                if (list.Count > 0) return list;
            }
        }
        return [];
    }
}
