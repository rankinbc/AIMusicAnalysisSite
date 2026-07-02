using System.Text.Json;

namespace Spectr.Bff.Services;

/// <summary>
/// Story 7.1 (FR22/AC3) — the DEFAULT-DENY projection for public share pages.
///
/// The full <c>analyses.final_json</c> contains things a public stranger must
/// never see: .als project internals (phase 8 — track names, devices, plugin
/// chains), raw stem paths (phase 4), reference file paths, upload keys. This
/// builder constructs a NEW object containing ONLY allowlisted values — nothing
/// from the source document flows through unless a rule below names it. Adding
/// a field to final_json can therefore never leak it by default.
/// </summary>
public static class ShareReportProjection
{
    // Phase 1 (universal mix analysis) — safe numeric/summary keys only.
    private static readonly string[] Phase1Keys =
    [
        "bpm", "detected_key", "lufs", "true_peak_db", "peak_dbfs",
        "clipping_detected", "duration_seconds", "mono_compatibility",
        "stereo_width", "frequency_balance", "bands",
    ];

    // Phase 2 (genre detection) — genre label + confidence.
    private static readonly string[] Phase2Keys = ["genre", "confidence", "scores"];

    // Phase 6 (genre profile gap) — percentile summary vs the reference library.
    private static readonly string[] Phase6Keys = ["percentiles", "genre", "summary"];

    public static JsonElement Build(JsonElement? finalJson)
    {
        var root = new Dictionary<string, object?>();
        if (finalJson is JsonElement fj && fj.ValueKind == JsonValueKind.Object)
        {
            CopyIf(fj, root, "grade");
            CopyIf(fj, root, "overall_score");
            CopyIf(fj, root, "danceability_score");

            if (fj.TryGetProperty("phases", out var phases) && phases.ValueKind == JsonValueKind.Array)
            {
                var projected = new List<object>();
                foreach (var p in phases.EnumerateArray())
                {
                    if (p.ValueKind != JsonValueKind.Object) continue;
                    if (!p.TryGetProperty("phase", out var num) || !num.TryGetInt32(out var phaseNo)) continue;
                    string[]? allow = phaseNo switch
                    {
                        1 => Phase1Keys,
                        2 => Phase2Keys,
                        6 => Phase6Keys,
                        _ => null, // phases 3/4/5/7/8 (incl. stems + .als) NEVER project
                    };
                    if (allow is null) continue;
                    var data = new Dictionary<string, object?>();
                    if (p.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var key in allow) CopyIf(d, data, key);
                    }
                    projected.Add(new Dictionary<string, object?>
                    {
                        ["phase"] = phaseNo,
                        ["data"] = data,
                    });
                }
                root["phases"] = projected;
            }
        }
        return JsonSerializer.SerializeToElement(root);
    }

    private static void CopyIf(JsonElement source, Dictionary<string, object?> target, string key)
    {
        if (source.TryGetProperty(key, out var v) && v.ValueKind != JsonValueKind.Undefined)
        {
            target[key] = v.Clone();
        }
    }
}
