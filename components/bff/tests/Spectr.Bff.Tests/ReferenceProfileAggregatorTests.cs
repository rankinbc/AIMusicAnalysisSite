using System.Text.Json;
using Spectr.Bff.Services;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Reference-profiles Task 2: the BFF aggregate (mean±std per metric over a set's
// analyzed members, in the phase-6 statistical-profile shape) + fingerprint cache.
public sealed class ReferenceProfileAggregatorTests
{
    private static ReferenceTrack Track(
        bool analyzed,
        double? lufs = null,
        double? bpm = null,
        string? bands = null,
        Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        Title = "t",
        Analyzed = analyzed,
        AnalysisStatus = analyzed ? "analyzed" : "pending",
        Lufs = lufs,
        Bpm = bpm,
        BandLevels = bands,
    };

    private static JsonElement Stats(string json, string feature)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("feature_statistics").GetProperty(feature).Clone();
    }

    private static int IntProp(string json, string prop)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty(prop).GetInt32();
    }

    [Fact]
    public void Mean_And_Std_Computed_Over_Analyzed_Members()
    {
        // lufs -6,-9,-12 → mean -9, sample std = sqrt(18/2) = 3.0 (above floor 1.0).
        var members = new[] { Track(true, lufs: -6), Track(true, lufs: -9), Track(true, lufs: -12) };
        var json = ReferenceProfileAggregator.Compute(members);
        var lufs = Stats(json, "lufs");
        Assert.Equal(-9.0, lufs.GetProperty("mean").GetDouble(), 3);
        Assert.Equal(3.0, lufs.GetProperty("std").GetDouble(), 3);
        Assert.Equal(3, IntProp(json, "analyzed_count"));
        Assert.Equal(3, IntProp(json, "track_count"));
    }

    [Fact]
    public void Std_Floor_Applies_When_Sample_Spread_Is_Tiny()
    {
        // lufs -8, -8.1 → sample std ≈ 0.07 < floor 1.0 → std == 1.0.
        var members = new[] { Track(true, lufs: -8.0), Track(true, lufs: -8.1) };
        var lufs = Stats(ReferenceProfileAggregator.Compute(members), "lufs");
        Assert.Equal(1.0, lufs.GetProperty("std").GetDouble(), 3);
    }

    [Fact]
    public void Single_Analyzed_Member_Std_Equals_Floor()
    {
        var lufs = Stats(ReferenceProfileAggregator.Compute(new[] { Track(true, lufs: -8.0) }), "lufs");
        Assert.Equal(-8.0, lufs.GetProperty("mean").GetDouble(), 3);
        Assert.Equal(1.0, lufs.GetProperty("std").GetDouble(), 3); // lufs floor
    }

    [Fact]
    public void Unanalyzed_Members_Do_Not_Contribute()
    {
        var members = new[]
        {
            Track(true, lufs: -8.0),
            Track(false, lufs: -99.0), // pending — must be ignored
        };
        var json = ReferenceProfileAggregator.Compute(members);
        Assert.Equal(1, IntProp(json, "analyzed_count"));
        Assert.Equal(2, IntProp(json, "member_count"));
        Assert.Equal(-8.0, Stats(json, "lufs").GetProperty("mean").GetDouble(), 3);
    }

    [Fact]
    public void Bands_Aggregate_Over_Key_Intersection_Not_Whole_Profile()
    {
        // A has bass+air, B has bass only → band_bass = 2 samples, band_air = 1 sample.
        var members = new[]
        {
            Track(true, bands: "{\"bass\": -4, \"air\": -12}"),
            Track(true, bands: "{\"bass\": -6}"),
        };
        var json = ReferenceProfileAggregator.Compute(members);
        Assert.Equal(-5.0, Stats(json, "band_bass").GetProperty("mean").GetDouble(), 3);
        Assert.Equal(-12.0, Stats(json, "band_air").GetProperty("mean").GetDouble(), 3);
        Assert.Equal(2.0, Stats(json, "band_air").GetProperty("std").GetDouble(), 3); // band floor
    }

    [Fact]
    public void Zero_Analyzed_Members_Is_Not_Ready_With_Empty_Stats()
    {
        var members = new[] { Track(false, lufs: -8.0), Track(false, lufs: -9.0) };
        var json = ReferenceProfileAggregator.Compute(members);
        Assert.Equal(0, IntProp(json, "analyzed_count"));
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(doc.RootElement.GetProperty("feature_statistics").EnumerateObject());
    }

    [Fact]
    public void Fingerprint_Changes_On_Add_Remove_And_Reanalyze()
    {
        var a = Track(true, lufs: -8.0, id: Guid.NewGuid());
        var b = Track(true, lufs: -9.0, id: Guid.NewGuid());
        var baseFp = ReferenceProfileAggregator.Fingerprint(new[] { a, b });

        // re-analyze (metric change)
        var a2 = Track(true, lufs: -7.0, id: a.Id);
        Assert.NotEqual(baseFp, ReferenceProfileAggregator.Fingerprint(new[] { a2, b }));
        // remove a member
        Assert.NotEqual(baseFp, ReferenceProfileAggregator.Fingerprint(new[] { a }));
        // add a member
        var c = Track(true, lufs: -10.0, id: Guid.NewGuid());
        Assert.NotEqual(baseFp, ReferenceProfileAggregator.Fingerprint(new[] { a, b, c }));
        // stable: same members, same order-independent → identical
        Assert.Equal(baseFp, ReferenceProfileAggregator.Fingerprint(new[] { b, a }));
    }

    [Fact]
    public void EnsureFresh_Populates_Then_Skips_When_Unchanged()
    {
        var agg = new ReferenceProfileAggregator();
        var set = new ReferenceSet { Id = Guid.NewGuid(), UserId = Guid.NewGuid(), Name = "p" };
        var members = new[] { Track(true, lufs: -8.0), Track(true, lufs: -9.0) };

        agg.EnsureFresh(set, members);
        Assert.NotNull(set.ProfileJson);
        Assert.NotNull(set.ProfileFingerprint);
        var fp = set.ProfileFingerprint;
        var json = set.ProfileJson;

        agg.EnsureFresh(set, members); // unchanged fingerprint → no recompute
        Assert.Equal(fp, set.ProfileFingerprint);
        Assert.Equal(json, set.ProfileJson);
    }
}
