using System.Text.Json;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 1.4: serialization smoke test for the new DegradationNoticeDto and
// the extended VerdictsListResponse. The wire shape is the contract the
// v2 frontend reads off `GET /api/reports/{jobId}/verdicts/`, so we lock
// it down here without needing a live BFF or Postgres.
//
// .NET 10 minimal-API default serializer is `JsonSerializerDefaults.Web`
// (camelCase). The frontend's `DegradationNotice` interface mirrors that.
public sealed class VerdictsDtoSerializationTests
{
    private static readonly JsonSerializerOptions WebDefaults =
        new(JsonSerializerDefaults.Web);

    [Fact]
    public void DegradationNotice_serializes_with_camelCase_fields()
    {
        var notice = new DegradationNoticeDto(
            Reason: "tier_budget",
            Detail: "tier=free spent=$5.12 ceiling=$5.00",
            OccurredAt: new DateTimeOffset(2026, 6, 15, 12, 0, 0, TimeSpan.Zero));

        var json = JsonSerializer.Serialize(notice, WebDefaults);

        Assert.Contains("\"reason\":\"tier_budget\"", json);
        Assert.Contains("\"detail\":", json);
        Assert.Contains("\"occurredAt\":", json);
    }

    [Fact]
    public void VerdictsListResponse_carries_optional_degradation_field()
    {
        var healthy = new VerdictsListResponse(
            Verdicts: Array.Empty<VerdictDto>(),
            Specialists: Array.Empty<SpecialistStatus>(),
            RoutingPlan: null,
            Degradation: null);

        var degraded = healthy with
        {
            Degradation = new DegradationNoticeDto(
                Reason: "circuit_breaker",
                Detail: "provider unavailable",
                OccurredAt: DateTimeOffset.UtcNow),
        };

        var healthyJson = JsonSerializer.Serialize(healthy, WebDefaults);
        var degradedJson = JsonSerializer.Serialize(degraded, WebDefaults);

        // Both serialize the field — null on a healthy report, populated when degraded.
        Assert.Contains("\"degradation\":null", healthyJson);
        Assert.Contains("\"degradation\":{", degradedJson);
        Assert.Contains("\"reason\":\"circuit_breaker\"", degradedJson);
    }

    [Theory]
    [InlineData("tier_budget")]
    [InlineData("global_budget")]
    [InlineData("circuit_breaker")]
    public void DegradationNotice_round_trips_for_every_known_reason(string reason)
    {
        var original = new DegradationNoticeDto(reason, "some detail", DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(original, WebDefaults);
        var roundTripped = JsonSerializer.Deserialize<DegradationNoticeDto>(json, WebDefaults);

        Assert.NotNull(roundTripped);
        Assert.Equal(original.Reason, roundTripped!.Reason);
        Assert.Equal(original.Detail, roundTripped.Detail);
    }
}
