using System.Text.Json.Nodes;
using Spectr.Bff.Services;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D12 — NormalizeFinalJsonForSeed pure-function coverage. A seeded
// demo's copied final_json can carry phase 7's arrangement_status: "pending"
// from the source analysis; nothing ever re-runs structure detection on a
// SEEDED copy, so "pending" must become "unavailable" at seed time (the
// status the UI already renders as "Not assessed for this track", commit
// dbe569d). Integration-level coverage of the two seed call sites lives in
// DemoSnapshotSeedTests (snapshot path) / DemoSeederTests (fallback path);
// exporter coverage lives in DemoSnapshotExportTests.
public sealed class DemoSeedMappingFinalJsonTests
{
    private const string PendingFinalJson =
        "{\"phases\":[{\"phase\":6,\"data\":{\"foo\":\"bar\"}},"
        + "{\"phase\":7,\"data\":{\"arrangement_status\":\"pending\",\"grade\":\"C\"}}]}";

    [Fact]
    public void Pending_Arrangement_Status_Becomes_Unavailable()
    {
        var result = DemoSeedMapping.NormalizeFinalJsonForSeed(PendingFinalJson);

        var phase7 = JsonNode.Parse(result)!["phases"]!.AsArray()
            .Single(p => p!["phase"]!.GetValue<int>() == 7);
        Assert.Equal("unavailable", phase7!["data"]!["arrangement_status"]!.GetValue<string>());
        // The other phase-7 key is untouched by the rewrite.
        Assert.Equal("C", phase7["data"]!["grade"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("scored")]
    [InlineData("unavailable")]
    [InlineData("failed")]
    public void Other_Arrangement_Statuses_Are_Left_Untouched(string status)
    {
        var json = "{\"phases\":[{\"phase\":7,\"data\":{\"arrangement_status\":\"" + status + "\"}}]}";

        var result = DemoSeedMapping.NormalizeFinalJsonForSeed(json);

        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), JsonNode.Parse(result)),
            $"expected no change for status '{status}', got: {result}");
    }

    [Fact]
    public void No_Phase_7_Is_Unchanged()
    {
        const string json = "{\"phases\":[{\"phase\":6,\"data\":{\"foo\":\"bar\"}}]}";

        var result = DemoSeedMapping.NormalizeFinalJsonForSeed(json);

        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), JsonNode.Parse(result)));
    }

    [Theory]
    [InlineData("{not valid json")]
    [InlineData("")]
    public void Malformed_Or_Empty_Json_Is_Returned_Unchanged_Without_Throwing(string json)
    {
        var result = DemoSeedMapping.NormalizeFinalJsonForSeed(json);

        Assert.Equal(json, result);
    }

    [Fact]
    public void Other_Phases_Data_Is_Structurally_Identical()
    {
        var result = DemoSeedMapping.NormalizeFinalJsonForSeed(PendingFinalJson);

        var resultPhase6 = JsonNode.Parse(result)!["phases"]!.AsArray()
            .Single(p => p!["phase"]!.GetValue<int>() == 6);
        var sourcePhase6 = JsonNode.Parse(PendingFinalJson)!["phases"]!.AsArray()
            .Single(p => p!["phase"]!.GetValue<int>() == 6);
        Assert.True(JsonNode.DeepEquals(sourcePhase6, resultPhase6));
    }
}
