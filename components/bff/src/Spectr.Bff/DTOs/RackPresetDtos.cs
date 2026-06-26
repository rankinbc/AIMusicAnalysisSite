using System.Text.Json;

namespace Spectr.Bff.DTOs;

// Listen V3 (PRP-1). Rack presets/drafts are version-scoped (no userId surfaced);
// viz presets are user-scoped. `Chain`/`Viz` are raw JSON (jsonb) round-tripped as
// JsonElement so the chain_json never double-encodes. There is NO copiedFromId —
// portability is JSON export/import (a client-side envelope), not a server copy.

// source ∈ ('user','coach','analysis'); only 'user' is written in this slice.
public sealed record RackPresetDto(
    Guid Id,
    Guid SongVersionId,
    string Name,
    string Source,
    JsonElement Chain,
    Guid? CreatedInSessionId,
    Guid? ViaGrantId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record SaveRackPresetRequest(string Name, JsonElement Chain);

// The deterministic SOLVE output for an analysis — a system-generated
// RackPreset(source='analysis') exposed read-only on /reports/{jobId}/fix-rack.
public sealed record FixRackDto(string Name, JsonElement Chain, DateTimeOffset CreatedAt);

public sealed record RackDraftDto(
    Guid SongVersionId,
    JsonElement Chain,
    DateTimeOffset UpdatedAt);

public sealed record UpsertRackDraftRequest(JsonElement Chain);

public sealed record VizPresetDto(
    Guid Id,
    string Name,
    JsonElement Viz,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record SaveVizPresetRequest(string Name, JsonElement Viz);
