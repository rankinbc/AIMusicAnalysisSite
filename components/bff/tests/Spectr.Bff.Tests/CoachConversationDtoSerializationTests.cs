using System.Text.Json;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 1.5: wire-format contract for the new coach DTOs. Camel-cased via
// JsonSerializerDefaults.Web — the frontend's CoachMessageDto interface
// reads `refusalReason`, `completedAt`, `conversationId`, etc.
public sealed class CoachConversationDtoSerializationTests
{
    private static readonly JsonSerializerOptions WebDefaults =
        new(JsonSerializerDefaults.Web);

    [Fact]
    public void CoachEvidence_serializes_with_camelCase()
    {
        var evi = new CoachEvidenceDto("LUFS -11.2", "phase1.lufs_integrated");
        var json = JsonSerializer.Serialize(evi, WebDefaults);
        Assert.Contains("\"label\":\"LUFS -11.2\"", json);
        Assert.Contains("\"path\":\"phase1.lufs_integrated\"", json);
    }

    [Fact]
    public void CoachMessage_assistant_complete_round_trips_with_camelCase()
    {
        var msg = new CoachMessageDto(
            Id: Guid.NewGuid(),
            Role: "assistant",
            Status: "complete",
            Content: "Your LUFS sits at -11.2.",
            Evidence: new[] { new CoachEvidenceDto("LUFS -11.2", "phase1.lufs_integrated") },
            RefusalReason: null,
            CreatedAt: new DateTimeOffset(2026, 6, 15, 12, 0, 0, TimeSpan.Zero),
            CompletedAt: new DateTimeOffset(2026, 6, 15, 12, 0, 5, TimeSpan.Zero));

        var json = JsonSerializer.Serialize(msg, WebDefaults);
        Assert.Contains("\"role\":\"assistant\"", json);
        Assert.Contains("\"status\":\"complete\"", json);
        Assert.Contains("\"refusalReason\":null", json);
        Assert.Contains("\"createdAt\":", json);
        Assert.Contains("\"completedAt\":", json);
        Assert.Contains("\"evidence\":", json);
        // snake-case wire keys would be a regression — the legacy
        // routing_plan inconsistency must NOT be widened here.
        Assert.DoesNotContain("refusal_reason", json);
        Assert.DoesNotContain("completed_at", json);
        Assert.DoesNotContain("created_at", json);

        var back = JsonSerializer.Deserialize<CoachMessageDto>(json, WebDefaults);
        Assert.NotNull(back);
        Assert.Equal("Your LUFS sits at -11.2.", back!.Content);
        Assert.NotNull(back.Evidence);
        Assert.Single(back.Evidence!);
    }

    [Fact]
    public void CoachMessage_user_omits_evidence_payload_field()
    {
        var msg = new CoachMessageDto(
            Id: Guid.NewGuid(),
            Role: "user",
            Status: "complete",
            Content: "Why?",
            Evidence: null,
            RefusalReason: null,
            CreatedAt: DateTimeOffset.UtcNow,
            CompletedAt: DateTimeOffset.UtcNow);

        var json = JsonSerializer.Serialize(msg, WebDefaults);
        Assert.Contains("\"evidence\":null", json);
    }

    [Fact]
    public void CoachConversation_envelope_uses_camelCase_keys()
    {
        var dto = new CoachConversationDto(
            ConversationId: Guid.NewGuid(),
            AnalysisId: Guid.NewGuid(),
            Messages: Array.Empty<CoachMessageDto>(),
            Caps: new CoachCapsDto(Used: 0, Limit: 3, CapReached: false));

        var json = JsonSerializer.Serialize(dto, WebDefaults);
        Assert.Contains("\"conversationId\":", json);
        Assert.Contains("\"analysisId\":", json);
        Assert.Contains("\"messages\":[]", json);
        Assert.Contains("\"caps\":", json);
        Assert.Contains("\"capReached\":false", json);
        Assert.DoesNotContain("conversation_id", json);
        Assert.DoesNotContain("analysis_id", json);
    }

    [Fact]
    public void CreateCoachMessage_request_and_response_round_trip()
    {
        var req = new CreateCoachMessageRequest("hi coach");
        var reqJson = JsonSerializer.Serialize(req, WebDefaults);
        Assert.Contains("\"content\":\"hi coach\"", reqJson);

        var resp = new CreateCoachMessageResponse(
            ConversationId: Guid.NewGuid(),
            UserMessageId: Guid.NewGuid(),
            PendingAssistantMessageId: Guid.NewGuid(),
            Caps: new CoachCapsDto(Used: 1, Limit: 3, CapReached: false));
        var respJson = JsonSerializer.Serialize(resp, WebDefaults);
        Assert.Contains("\"conversationId\":", respJson);
        Assert.Contains("\"userMessageId\":", respJson);
        Assert.Contains("\"pendingAssistantMessageId\":", respJson);
        Assert.Contains("\"caps\":", respJson);
        Assert.Contains("\"used\":1", respJson);
        Assert.Contains("\"limit\":3", respJson);
        Assert.DoesNotContain("user_message_id", respJson);
    }
}
