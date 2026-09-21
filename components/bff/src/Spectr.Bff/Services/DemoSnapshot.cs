using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Spectr.Bff.Services;

// D6 — track-agnostic demo snapshot: an operator-installed export of ONE
// real analyzed version (PRPs/guest-demo-sandbox.md §6). DemoSeeder seeds
// from this when present, else falls back to the sine-tone seed. See
// DemoSnapshotStore below for the load/validate/cache contract and
// DemoSnapshotTemplate for the id-remapping (the non-obvious part).
public static class DemoSnapshotFormat
{
    public const string Id = "spectr-demo-snapshot/v1";
    public const string Prefix = "audio/demo/snapshot/";
    public const string DefaultKey = Prefix + "snapshot.json";
}

// ── Wire shape (spec §6) ────────────────────────────────────────────────
// JsonElement is used for every free-form JSON blob (finalJson, routingPlan,
// phaseDurations, stemMetrics, verdict evidence/fix/sources/where, coach
// message evidence, rack preset chain/coachMeta) so this store never has to
// model the pipeline's or verdict engine's full shape — it round-trips them
// verbatim via GetRawText() into the matching jsonb columns.

public sealed record DemoSnapshotSourceIds(Guid SongId, Guid VersionId, Guid JobId, Guid AnalysisId);

public sealed record DemoSnapshotSong(string Title, string? GenreHint);

public sealed record DemoSnapshotVersion(string AudioKey);

public sealed record DemoSnapshotAnalysis(
    JsonElement FinalJson,
    JsonElement? RoutingPlan,
    string? PipelineVersion,
    string? RuleEngineVersion,
    string? ValidatorVersion,
    string? PromptSetVersion,
    JsonElement? PhaseDurations,
    JsonElement? StemMetrics,
    string? SpectrogramImageKey,
    string? WaveformImageKey,
    string? WaveformPeaksKey);

public sealed record DemoSnapshotVerdict(
    string Id,
    string Specialist,
    string PromptVersion,
    string Model,
    string Severity,
    string Category,
    double Confidence,
    int PriorityScore,
    string? Impact,
    string? ChartType,
    string Headline,
    string? Summary,
    string? Body,
    string? MetricLine,
    string? WhyItMatters,
    string? PresetName,
    JsonElement? Evidence,
    JsonElement? Fix,
    JsonElement? Sources,
    string? ProblemId,
    string? Kind,
    string? Source,
    string? DataTier,
    bool Fixable,
    bool Suspected,
    JsonElement? Where,
    string? Refines,
    int? PriorityBase,
    double? PriorityCategoryWeight,
    double? PriorityScopeMultiplier,
    string? Scope);

public sealed record DemoSnapshotMessage(
    string Role,
    string? Status,
    string? Mode,
    string? Content,
    JsonElement? Evidence,
    string? RefusalReason);

public sealed record DemoSnapshotConversation(IReadOnlyList<DemoSnapshotMessage> Messages);

public sealed record DemoSnapshotRackPreset(
    string Name,
    string? Source,
    JsonElement Chain,
    JsonElement? CoachMeta);

// The four remapped Guids live under Source — the seeder reads the NEW ids
// from here (they were substituted into the raw JSON text before this was
// deserialized, so every embedded reference — finalJson, routingPlan, coach
// prose — already carries the same fresh values).
public sealed record DemoSnapshotDoc(
    string Format,
    DateTimeOffset ExportedAt,
    DemoSnapshotSourceIds Source,
    DemoSnapshotSong Song,
    DemoSnapshotVersion Version,
    DemoSnapshotAnalysis Analysis,
    IReadOnlyList<DemoSnapshotVerdict> Verdicts,
    DemoSnapshotConversation? Conversation,
    IReadOnlyList<DemoSnapshotRackPreset>? RackPresets)
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };
}

// Parses + validates a raw snapshot export once, then hands out fresh,
// internally-consistent copies via Materialize(). Immutable/reusable —
// DemoSnapshotStore caches ONE instance per configured key for 60s.
public sealed class DemoSnapshotTemplate
{
    private readonly string _tokenized;
    private readonly int _verdictCount;

    public string Title { get; }

    internal DemoSnapshotTemplate(string rawJson)
    {
        using var doc = JsonDocument.Parse(rawJson);
        var root = doc.RootElement;
        if (root.GetProperty("format").GetString() != DemoSnapshotFormat.Id)
            throw new JsonException("unknown snapshot format");

        Title = root.GetProperty("song").GetProperty("title").GetString() ?? "Sample";

        // D2-review addendum: the worker's is_shared_key() only protects
        // audio/demo/ from guest/retention purges. Every asset key this
        // snapshot names must live under that prefix, or a seeded row would
        // point at storage the very first guest purge deletes for everyone.
        var audioKey = root.GetProperty("version").GetProperty("audioKey").GetString();
        if (string.IsNullOrEmpty(audioKey))
            throw new JsonException("snapshot missing version.audioKey");
        RequireSharedKey(audioKey, "version.audioKey");

        var analysisEl = root.GetProperty("analysis");
        RequireSharedKey(OptionalString(analysisEl, "spectrogramImageKey"), "analysis.spectrogramImageKey");
        RequireSharedKey(OptionalString(analysisEl, "waveformImageKey"), "analysis.waveformImageKey");
        RequireSharedKey(OptionalString(analysisEl, "waveformPeaksKey"), "analysis.waveformPeaksKey");

        var text = rawJson;
        var src = root.GetProperty("source");
        foreach (var (prop, token) in new[]
        {
            ("songId", "§song§"), ("versionId", "§version§"),
            ("jobId", "§job§"), ("analysisId", "§analysis§"),
        })
        {
            var id = src.GetProperty(prop).GetGuid();
            text = text.Replace(id.ToString("D"), token, StringComparison.OrdinalIgnoreCase)
                       .Replace(id.ToString("N"), token, StringComparison.OrdinalIgnoreCase);
        }

        var i = 0;
        foreach (var v in root.GetProperty("verdicts").EnumerateArray())
            text = text.Replace(v.GetProperty("id").GetString()!, $"§v{i++}§", StringComparison.Ordinal);

        _tokenized = text;
        _verdictCount = i;
    }

    // Image keys are optional/nullable — a null/absent key names no asset,
    // so there is nothing to validate; the seeder just leaves that column null.
    private static string? OptionalString(JsonElement obj, string prop)
        => obj.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static void RequireSharedKey(string? key, string field)
    {
        if (key is null) return;
        if (!DemoSnapshotStore.IsSharedKey(key))
            throw new JsonException(
                $"snapshot {field} is outside the required shared prefix '{DemoSnapshotStore.SharedPrefix}'");
    }

    /// <summary>One fresh, internally consistent copy: every id — including ids embedded in
    /// finalJson, coach prose or coachMeta — is replaced in a single pass.</summary>
    public DemoSnapshotDoc Materialize()
    {
        var sb = new StringBuilder(_tokenized)
            .Replace("§song§", Guid.NewGuid().ToString()).Replace("§version§", Guid.NewGuid().ToString())
            .Replace("§job§", Guid.NewGuid().ToString()).Replace("§analysis§", Guid.NewGuid().ToString());
        for (var i = 0; i < _verdictCount; i++) sb.Replace($"§v{i}§", "vrd_" + UlidGen.NewUlid());
        return JsonSerializer.Deserialize<DemoSnapshotDoc>(sb.ToString(), DemoSnapshotDoc.JsonOptions)
               ?? throw new JsonException("empty snapshot");
    }
}

// Loads the operator-installed snapshot (if any) from storage, validates it,
// and caches the parsed template for 60s so a burst of registrations/polls
// doesn't hammer storage or re-parse the same JSON. A missing/disabled key,
// a corrupt/invalid export, or a key outside the shared-storage prefix all
// resolve to `null` — DemoSeeder falls back to the sine-tone seed.
public sealed class DemoSnapshotStore(
    IFileStorage storage, IMemoryCache cache, IConfiguration config, ILogger<DemoSnapshotStore> logger)
{
    private const int CacheSeconds = 60;

    // Mirrors components/worker/app/retention_actor.py::SHARED_STORAGE_PREFIXES.
    // Keep these two in lockstep — anything outside this prefix is NOT
    // protected from the worker's guest/retention purge, so a snapshot (or
    // any asset key it names) that lives outside it must never be trusted:
    // the first guest purge would delete it out from under every future seed.
    internal const string SharedPrefix = "audio/demo/";

    internal static bool IsSharedKey(string key)
    {
        if (string.IsNullOrEmpty(key)) return false;
        if (key.Contains('\\')) return false;      // POSIX-style keys only
        if (key.StartsWith('/')) return false;     // no leading slash
        if (!key.StartsWith(SharedPrefix, StringComparison.Ordinal)) return false;
        foreach (var segment in key.Split('/'))
            if (segment == "..") return false;     // no parent-traversal segments
        return true;
    }

    public async Task<DemoSnapshotTemplate?> GetAsync(CancellationToken ct)
    {
        var key = config["Demo:SnapshotKey"] ?? DemoSnapshotFormat.DefaultKey;
        if (string.IsNullOrEmpty(key)) return null; // explicit disable — nothing to cache

        return await cache.GetOrCreateAsync<DemoSnapshotTemplate?>("demo-snapshot:" + key, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(CacheSeconds);

            if (!IsSharedKey(key))
            {
                // Never log file contents — only the (already-untrusted) key
                // and the prefix requirement.
                logger.LogWarning(
                    "Demo:SnapshotKey {Key} is outside the required shared prefix {Prefix} — no snapshot installed.",
                    key, SharedPrefix);
                return null;
            }

            try
            {
                if (!await storage.ExistsAsync(key, ct))
                {
                    logger.LogWarning("Demo snapshot key {Key} does not exist — demo seed will use the fallback.", key);
                    return null;
                }

                await using var stream = await storage.OpenReadAsync(key, ct);
                using var reader = new StreamReader(stream);
                var raw = await reader.ReadToEndAsync(ct);
                return new DemoSnapshotTemplate(raw);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Demo snapshot at {Key} could not be loaded — demo seed will use the fallback.", key);
                return null;
            }
        });
    }

    /// <summary>Drops the cached template for the currently-configured key (used after
    /// (re)installing a snapshot so the next seed picks it up within the request instead
    /// of waiting out the 60s TTL). Not yet called anywhere in this slice.</summary>
    public void Invalidate()
    {
        var key = config["Demo:SnapshotKey"] ?? DemoSnapshotFormat.DefaultKey;
        if (!string.IsNullOrEmpty(key)) cache.Remove("demo-snapshot:" + key);
    }
}
