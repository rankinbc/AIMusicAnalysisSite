using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

/// <summary>
/// Aggregates a ReferenceSet's <b>analyzed</b> members into the exact statistical-
/// profile shape phase 6 already consumes (<c>feature_statistics: {feature:{mean,std}}</c>
/// + <c>track_count</c>). Pure arithmetic over already-persisted metrics — no audio,
/// no worker. Fingerprint-cached on the set row so reads/dispatch recompute only on drift.
/// </summary>
public sealed class ReferenceProfileAggregator
{
    public const int SchemaVersion = 1;

    // std = max(sample_stddev, floor). Stops a tight 2-track set (std≈0) from
    // flagging everything; for analyzed_count==1 the std IS the floor.
    private static readonly IReadOnlyDictionary<string, double> ScalarFloors = new Dictionary<string, double>
    {
        ["lufs"] = 1.0,
        ["true_peak"] = 0.5,
        ["dynamic_range"] = 1.0,
        ["stereo_width"] = 0.05,
        ["stereo_correlation"] = 0.05,
        ["bpm"] = 2.0,
    };
    private const double BandFloor = 2.0;

    /// <summary>Recompute + persist the cached aggregate iff the fingerprint drifted.
    /// Set must be change-tracked so the caller's SaveChanges flushes it.</summary>
    public void EnsureFresh(ReferenceSet set, IReadOnlyCollection<ReferenceTrack> members)
    {
        var fp = Fingerprint(members);
        if (fp == set.ProfileFingerprint && set.ProfileJson is not null) return;
        set.ProfileJson = Compute(members);
        set.ProfileFingerprint = fp;
    }

    public static int AnalyzedCount(IEnumerable<ReferenceTrack> members) =>
        members.Count(m => m.Analyzed);

    /// <summary>Build the aggregate JSON. Only analyzed members contribute; a member
    /// missing a feature is excluded from THAT feature's stats, not the whole profile.</summary>
    public static string Compute(IReadOnlyCollection<ReferenceTrack> members)
    {
        var analyzed = members.Where(m => m.Analyzed).ToList();

        // feature -> list of present values
        var samples = new Dictionary<string, List<double>>();
        void Add(string feature, double? v)
        {
            if (v is null || double.IsNaN(v.Value) || double.IsInfinity(v.Value)) return;
            (samples.TryGetValue(feature, out var list) ? list : samples[feature] = new List<double>())
                .Add(v.Value);
        }

        foreach (var m in analyzed)
        {
            Add("lufs", m.Lufs);
            Add("true_peak", m.TruePeakDb);
            Add("dynamic_range", m.DynamicRangeLu);
            Add("stereo_width", m.StereoWidth);
            Add("stereo_correlation", m.StereoCorrelation);
            Add("bpm", m.Bpm);
            foreach (var (band, val) in ParseBands(m.BandLevels))
                Add($"band_{band}", val);
        }

        var stats = new Dictionary<string, object>();
        foreach (var (feature, values) in samples)
        {
            if (values.Count == 0) continue;
            var mean = values.Average();
            var floor = ScalarFloors.TryGetValue(feature, out var f) ? f : BandFloor;
            var std = Math.Max(SampleStdDev(values, mean), floor);
            stats[feature] = new { mean = Round(mean), std = Round(std) };
        }

        var payload = new
        {
            schema_version = SchemaVersion,
            member_count = members.Count,
            analyzed_count = analyzed.Count,
            track_count = analyzed.Count,
            feature_statistics = stats,
        };
        return JsonSerializer.Serialize(payload);
    }

    /// <summary>Stable hash over each member's metric tuple, sorted by id. Changes when a
    /// member is added/removed OR a member's metrics change (re-analyze) — self-invalidating.</summary>
    public static string Fingerprint(IEnumerable<ReferenceTrack> members)
    {
        var sb = new StringBuilder();
        foreach (var m in members.OrderBy(x => x.Id))
        {
            sb.Append(m.Id).Append('|')
              .Append(m.Analyzed ? '1' : '0').Append('|')
              .Append(Inv(m.Lufs)).Append('|')
              .Append(Inv(m.TruePeakDb)).Append('|')
              .Append(Inv(m.DynamicRangeLu)).Append('|')
              .Append(Inv(m.StereoWidth)).Append('|')
              .Append(Inv(m.StereoCorrelation)).Append('|')
              .Append(Inv(m.Bpm)).Append('|')
              .Append(m.BandLevels ?? "").Append(';');
        }
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static IEnumerable<(string band, double? value)> ParseBands(string? rawJson)
    {
        if (string.IsNullOrEmpty(rawJson)) yield break;
        JsonDocument doc;
        try { doc = JsonDocument.Parse(rawJson); }
        catch (JsonException) { yield break; }
        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object) yield break;
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                double? v = prop.Value.ValueKind == JsonValueKind.Number
                    && prop.Value.TryGetDouble(out var d) ? d : null;
                yield return (prop.Name, v);
            }
        }
    }

    private static double SampleStdDev(IReadOnlyList<double> values, double mean)
    {
        if (values.Count < 2) return 0.0;
        var ss = values.Sum(x => (x - mean) * (x - mean));
        return Math.Sqrt(ss / (values.Count - 1));
    }

    private static double Round(double v) => Math.Round(v, 4, MidpointRounding.AwayFromZero);

    private static string Inv(double? v) =>
        v?.ToString("R", CultureInfo.InvariantCulture) ?? "";
}
