using System.Text.Json;
using Spectr.Bff.DTOs;

namespace Spectr.Bff.Support;

/// <summary>
/// Single source of truth for pulling the song-console metrics out of an
/// analysis <c>final_json</c> blob. The shape is: root has <c>overall_score</c>
/// (legacy alias <c>mix_score</c>); the measured values live under the phase-1
/// object in <c>phases[]</c> → <c>data</c>.
/// </summary>
public static class FinalJsonMetrics
{
    public static VersionMetricsDto? Read(string? finalJson)
    {
        if (string.IsNullOrWhiteSpace(finalJson)) return null;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(finalJson); }
        catch (JsonException) { return null; }

        using (doc)
        {
            var root = doc.RootElement;
            var score = Num(root, "overall_score") ?? Num(root, "mix_score");

            var phase1 = FindPhaseData(root, 1);
            double? lufs = null, dr = null, bass = null, air = null, width = null;
            if (phase1 is { } p)
            {
                lufs = Num(p, "lufs");
                dr = Num(p, "loudness_range_lu");
                bass = Num(p, "low_energy");
                width = Num(p, "stereo_width");
                if (p.TryGetProperty("bands", out var bands) &&
                    bands.ValueKind == JsonValueKind.Object)
                {
                    air = Num(bands, "air");
                }
            }
            return new VersionMetricsDto(score, lufs, dr, bass, air, width);
        }
    }

    private static double? Num(JsonElement obj, string key) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(key, out var v) &&
        v.ValueKind == JsonValueKind.Number
            ? v.GetDouble()
            : null;

    private static JsonElement? FindPhaseData(JsonElement root, int phase)
    {
        if (!root.TryGetProperty("phases", out var phases) ||
            phases.ValueKind != JsonValueKind.Array) return null;
        foreach (var ph in phases.EnumerateArray())
        {
            if (ph.TryGetProperty("phase", out var pn) &&
                pn.ValueKind == JsonValueKind.Number && pn.GetInt32() == phase &&
                ph.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.Object)
            {
                return data;
            }
        }
        return null;
    }
}
