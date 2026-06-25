using System.Text.Json.Nodes;

namespace Spectr.Bff.DTOs;

// Listen V3 (PRP-4) — Room session DTOs. The live SessionEvent wire union is
// relayed as raw JSON (built in RoomEndpoints, never round-tripped through a C#
// record), matching LISTEN_V3_ROOM_UI_SEAMS §1. These records are the
// request/response envelopes + the hydrate snapshot.

// GET /sessions/{id} + the start response. recap is populated post-end.
public sealed record SessionDto(
    Guid Id,
    Guid SongVersionId,
    Guid HostId,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt,
    JsonNode? Recap);

// The control grant projection (seams §2). id === via_grant_id on a forked preset.
public sealed record ControlGrantDto(
    Guid Id,
    Guid SessionId,
    string Scope,
    ActorRefDto Grantee,
    ActorRefDto GrantedBy,
    DateTimeOffset? RevokedAt);

// Hydrate-on-join snapshot (seams §1 ⭐) — the FULL current room state a late
// joiner needs before deltas. snapshotSeq = GET room:{id}:seq at read time;
// the relay drops buffered deltas with seq <= snapshotSeq.
public sealed record RoomSnapshot(
    JsonNode? Chain,
    JsonNode? Transport,
    JsonNode? Visuals,
    IReadOnlyList<ActorRefDto> Roster,
    IReadOnlyList<JsonNode> Feed,
    long SnapshotSeq);

// ── action request bodies ────────────────────────────────────────────────────
// Reaction/chat carry t = playhead seconds (the recap → timestamped-comment anchor).
public sealed record ReactRequest(string Emoji, double? T, string? Text);
public sealed record ChatRequest(string Body, double? T);
public sealed record StatusRequest(string Emoji);
public sealed record TransportRequest(bool Playing, double Position);
public sealed record VisualsRequest(JsonNode? Patch, string[]? Stages, string? Director);
public sealed record RackRequest(string EffectId, JsonNode Params);

// Grantee is identified by user id OR anon id (must be a current participant).
public sealed record GranteeRef(Guid? UserId, string? AnonId, string? DisplayName);
public sealed record GrantRequest(string Scope, GranteeRef Grantee);
public sealed record RevokeRequest(string Scope);

public sealed record RecapPublishRequest(int[] MomentIds);

// Live session authority (resolved fresh — host_id + active control_grants).
// transport/grant/revoke/end/recap = IsHost; rack/visuals = the scope holder.
public sealed record SessionRoleDto(bool IsHost, bool HoldsRack, bool HoldsVisuals);
