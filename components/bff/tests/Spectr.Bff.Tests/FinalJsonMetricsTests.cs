using Spectr.Bff.Support;
using Xunit;

namespace Spectr.Bff.Tests;

public class FinalJsonMetricsTests
{
    private const string Sample = """
    {
      "overall_score": 87,
      "grade": "A",
      "phases": [
        { "phase": 1, "data": {
            "lufs": -9.1,
            "loudness_range_lu": 8.4,
            "low_energy": 62,
            "stereo_width": 48,
            "bands": { "bass": 70, "air": 71 }
        } },
        { "phase": 2, "data": { "bpm": 124 } }
      ]
    }
    """;

    [Fact]
    public void Read_extracts_all_six_metrics()
    {
        var m = FinalJsonMetrics.Read(Sample);
        Assert.NotNull(m);
        Assert.Equal(87, m!.Score);
        Assert.Equal(-9.1, m.Lufs);
        Assert.Equal(8.4, m.DynamicRangeLu);
        Assert.Equal(62, m.Bass);
        Assert.Equal(71, m.Air);
        Assert.Equal(48, m.StereoWidth);
    }

    [Fact]
    public void Read_falls_back_to_mix_score_when_overall_absent()
    {
        var m = FinalJsonMetrics.Read("""{ "mix_score": 73, "phases": [] }""");
        Assert.Equal(73, m!.Score);
    }

    [Fact]
    public void Read_returns_nulls_for_missing_metrics_but_nonnull_dto()
    {
        var m = FinalJsonMetrics.Read("""{ "overall_score": 50, "phases": [] }""");
        Assert.NotNull(m);
        Assert.Equal(50, m!.Score);
        Assert.Null(m.Lufs);
        Assert.Null(m.Air);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    public void Read_returns_null_for_unusable_input(string? input)
    {
        Assert.Null(FinalJsonMetrics.Read(input));
    }
}
