using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Endpoints;

// Task D4 — the snapshot exporter. D3 built the CONSUMER side (DemoSnapshotStore
// loads + validates a `spectr-demo-snapshot/v1` document, DemoSeeder copies it
// per-guest with fresh ids). This is the PRODUCER: POST /api/admin/demo/snapshot
// exports ONE real analyzed version — final_json, routing plan, verdict rows
// (incl. `fix` ops so the Listen page's "Apply live" works on the seeded copy),
// the owner's coach conversation, rack presets, images and the audio — to
// storage under audio/demo/snapshot/, in place. Spec §6 (wire shape) + §6.1
// "Seed-time safety" (added after the D3 review) bind this handler too.
public static partial class AdminEndpoints
{
    // Comfortably under DemoSnapshotStore's 4 MB load cap — a document that
    // creeps past this (more verdicts, a longer chat) is refused here rather
    // than written and silently rejected by every future seed attempt.
    private const long MaxSnapshotDocBytes = 3 * 1024 * 1024;

    // Relaxed encoder: the default JSON encoder escapes several ASCII
    // punctuation characters (defensive against HTML/JS embedding), which
    // would silently mangle a plain-text substring match — including the
    // §6.1 leak scan below, and the '+' in the disposable test email
    // convention (test+<ulid>@spectr.test). This document is only ever
    // written to storage and re-parsed as JSON by DemoSnapshotStore, never
    // embedded in HTML, so relaxed escaping is safe here.
    private static readonly JsonSerializerOptions SnapshotDocOptions =
        new() { WriteIndented = false, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static async Task<IResult> PostDemoSnapshot(
        DemoSnapshotExportRequest req, AppDbContext db, IFileStorage storage,
        DemoSnapshotStore snapshotStore, IConfiguration config, CancellationToken ct)
    {
        if (req.VersionId == Guid.Empty)
            return ErrorEnvelope.Build(400, "invalid_request", "versionId is required.");

        var version = await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == req.VersionId, ct);
        var song = version is null ? null
            : await db.Songs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == version.SongId, ct);
        var owner = song is null ? null
            : await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == song.UserId, ct);
        var analysis = version is null ? null
            : await db.Analyses.AsNoTracking()
                .Where(a => a.VersionId == version.Id)
                .OrderByDescending(a => a.CreatedAt)
                .FirstOrDefaultAsync(ct);
        if (version is null || song is null || owner is null || analysis is null)
            return ErrorEnvelope.Build(404, "version_not_found", "No analyzed version by that id.");

        // §6 — a snapshot that would fire paid triage the instant a guest
        // opens it, or that already carries a degradation notice, defeats
        // the point. Refuse rather than export something DemoSeeder would
        // have to paper over.
        if (analysis.RoutingPlan is null || analysis.DegradationNotice is not null)
            return ErrorEnvelope.Build(409, "snapshot_not_ready",
                "That version's analysis has no routing plan yet, or is degraded — "
                + "let it finish a clean run before exporting.");

        var verdicts = await db.Verdicts.AsNoTracking()
            .Where(v => v.AnalysisId == analysis.Id).OrderBy(v => v.CreatedAt).ToListAsync(ct);
        // Only the OWNER's conversation for this analysis — never another
        // user's (a shared analysis id can't happen today, but the filter is
        // the honest statement of intent and doubles as a leak guard).
        var conversation = await db.Conversations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.AnalysisId == analysis.Id && c.UserId == owner.Id, ct);
        var messages = conversation is null
            ? []
            : await db.CoachMessages.AsNoTracking()
                .Where(m => m.ConversationId == conversation.Id).OrderBy(m => m.CreatedAt).ToListAsync(ct);
        var rackPresets = await db.RackPresets.AsNoTracking()
            .Where(p => p.SongVersionId == version.Id).OrderBy(p => p.CreatedAt).ToListAsync(ct);

        var snapshotKey = config["Demo:SnapshotKey"];
        if (string.IsNullOrEmpty(snapshotKey)) snapshotKey = DemoSnapshotFormat.DefaultKey;
        var dir = DirOf(snapshotKey);

        // Asset keys are id-free (D3-review rule, §6.1): "source<ext>",
        // "spectrogram.webp", "waveform.webp", "peaks.json" — never the
        // source song/version/analysis id.
        var ext = ExtensionOf(version.FilePath);
        var audioKey = dir + "source" + ext;
        var writtenKeys = new List<string>();
        try
        {
            await CopyAsync(storage, version.FilePath, audioKey, AudioContentType(ext), ct);
            writtenKeys.Add(audioKey);

            string? spectrogramKey = null, waveformKey = null, peaksKey = null;
            if (await CopyIfPresentAsync(storage, analysis.SpectrogramImagePath, dir + "spectrogram.webp", "image/webp", ct))
            { spectrogramKey = dir + "spectrogram.webp"; writtenKeys.Add(spectrogramKey); }
            if (await CopyIfPresentAsync(storage, analysis.WaveformImagePath, dir + "waveform.webp", "image/webp", ct))
            { waveformKey = dir + "waveform.webp"; writtenKeys.Add(waveformKey); }
            if (await CopyIfPresentAsync(storage, analysis.WaveformPeaksPath, dir + "peaks.json", "application/json", ct))
            { peaksKey = dir + "peaks.json"; writtenKeys.Add(peaksKey); }

            var docJson = BuildSnapshotDocument(
                version, song, analysis, verdicts, messages, rackPresets,
                audioKey, spectrogramKey, waveformKey, peaksKey);

            // §6/§6.1 leak guard — the repo and the site are public. Scan the
            // WHOLE serialized document (finalJson, coach prose, everything)
            // for the owner's id (both Guid formats) or email. Never trust
            // that the source rows are already clean.
            if (ContainsOwnerIdentity(docJson, owner.Id, owner.Email))
            {
                foreach (var key in writtenKeys) await storage.DeleteAsync(key, ct);
                return ErrorEnvelope.Build(409, "snapshot_leak",
                    "The export would leak the owner's id or email — aborted, nothing was written.");
            }

            var byteCount = Encoding.UTF8.GetByteCount(docJson);
            if (byteCount > MaxSnapshotDocBytes)
            {
                foreach (var key in writtenKeys) await storage.DeleteAsync(key, ct);
                return ErrorEnvelope.Build(409, "snapshot_too_large",
                    $"Snapshot document is {byteCount} bytes, over the {MaxSnapshotDocBytes} byte export cap "
                    + "(kept under the 4 MB loader cap) — trim verdicts/conversation and retry.");
            }

            // snapshot.json is written LAST — every asset it references must
            // already exist in storage before the pointer to them does.
            await storage.WriteAsync(snapshotKey,
                new MemoryStream(Encoding.UTF8.GetBytes(docJson)), "application/json", ct);
            var audioBytes = await storage.GetFileSizeAsync(audioKey, ct) ?? 0;

            // The next sign-up must see this without waiting out the 60s TTL.
            snapshotStore.Invalidate();

            db.AuditLogs.Add(new AuditLog
            {
                ActorUserId = OperatorActor,
                Action = "demo_snapshot_export",
                Target = req.VersionId.ToString(),
                Reason = Fit(string.IsNullOrWhiteSpace(req.Reason) ? "-" : req.Reason),
            });
            await db.SaveChangesAsync(ct);

            return Results.Json(new DemoSnapshotExportResponse(
                snapshotKey, verdicts.Count, messages.Count, rackPresets.Count, audioBytes));
        }
        catch
        {
            foreach (var key in writtenKeys)
            {
                try { await storage.DeleteAsync(key, ct); }
                catch { /* best-effort cleanup — the original exception is what matters */ }
            }
            throw;
        }
    }

    // POSIX-style storage keys only — Path.GetDirectoryName would apply OS
    // separator rules (this handler runs on Windows dev boxes too).
    private static string DirOf(string key)
    {
        var idx = key.LastIndexOf('/');
        return idx < 0 ? "" : key[..(idx + 1)];
    }

    private static string ExtensionOf(string key)
    {
        var slash = key.LastIndexOf('/');
        var name = slash < 0 ? key : key[(slash + 1)..];
        var dot = name.LastIndexOf('.');
        return dot < 0 ? "" : name[dot..];
    }

    private static string AudioContentType(string ext) => ext.ToLowerInvariant() switch
    {
        ".wav" => "audio/wav",
        ".flac" => "audio/flac",
        ".mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    };

    private static async Task CopyAsync(
        IFileStorage storage, string sourceKey, string destKey, string contentType, CancellationToken ct)
    {
        await using var stream = await storage.OpenReadAsync(sourceKey, ct);
        await storage.WriteAsync(destKey, stream, contentType, ct);
    }

    private static async Task<bool> CopyIfPresentAsync(
        IFileStorage storage, string? sourceKey, string destKey, string contentType, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(sourceKey)) return false;
        if (!await storage.ExistsAsync(sourceKey, ct)) return false;
        await CopyAsync(storage, sourceKey, destKey, contentType, ct);
        return true;
    }

    // §6/§6.1 leak guard: the owner's Guid in both hyphenated ("D") and bare
    // ("N") forms, plus their email, case-insensitive — finalJson or coach
    // prose could embed either verbatim.
    private static bool ContainsOwnerIdentity(string json, Guid ownerId, string ownerEmail)
    {
        if (json.Contains(ownerId.ToString("D"), StringComparison.OrdinalIgnoreCase)) return true;
        if (json.Contains(ownerId.ToString("N"), StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.IsNullOrEmpty(ownerEmail) && json.Contains(ownerEmail, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // Builds the exact §6 wire shape (DemoSnapshotDoc's consuming side lives in
    // Services/DemoSnapshot.cs). JsonNode rather than the typed record tree —
    // the jsonb columns are already-serialized JSON text that must round-trip
    // byte-for-byte into the document, which JsonNode embeds directly with no
    // extra (de)serialization pass.
    private static string BuildSnapshotDocument(
        SongVersion version, Song song, Analysis analysis,
        List<Verdict> verdicts, List<CoachMessage> messages, List<RackPreset> rackPresets,
        string audioKey, string? spectrogramKey, string? waveformKey, string? peaksKey)
    {
        var root = new JsonObject
        {
            ["format"] = DemoSnapshotFormat.Id,
            ["exportedAt"] = DateTimeOffset.UtcNow,
            ["source"] = new JsonObject
            {
                ["songId"] = song.Id,
                ["versionId"] = version.Id,
                ["jobId"] = analysis.JobId,
                ["analysisId"] = analysis.Id,
            },
            ["song"] = new JsonObject
            {
                ["title"] = song.Name,
                ["genreHint"] = song.GenreHint,
            },
            ["version"] = new JsonObject { ["audioKey"] = audioKey },
            ["analysis"] = new JsonObject
            {
                ["finalJson"] = ParseJson(analysis.FinalJson),
                ["routingPlan"] = ParseJson(analysis.RoutingPlan!),
                ["pipelineVersion"] = analysis.PipelineVersion,
                ["ruleEngineVersion"] = analysis.RuleEngineVersion,
                ["validatorVersion"] = analysis.ValidatorVersion,
                ["promptSetVersion"] = analysis.PromptSetVersion,
                ["phaseDurations"] = ParseJson(analysis.PhaseDurations),
                ["stemMetrics"] = ParseJsonOrNull(analysis.StemMetrics),
                ["spectrogramImageKey"] = spectrogramKey,
                ["waveformImageKey"] = waveformKey,
                ["waveformPeaksKey"] = peaksKey,
            },
            ["verdicts"] = new JsonArray(verdicts.Select(v => (JsonNode)new JsonObject
            {
                ["id"] = v.Id,
                ["specialist"] = v.Specialist,
                ["promptVersion"] = v.PromptVersion,
                ["model"] = v.Model,
                ["severity"] = v.Severity,
                ["category"] = v.Category,
                ["confidence"] = v.Confidence,
                ["priorityScore"] = v.PriorityScore,
                ["impact"] = v.Impact,
                ["chartType"] = v.ChartType,
                ["headline"] = v.Headline,
                ["summary"] = v.Summary,
                ["body"] = v.Body,
                ["metricLine"] = v.MetricLine,
                ["whyItMatters"] = v.WhyItMatters,
                ["presetName"] = v.PresetName,
                ["evidence"] = ParseJson(v.Evidence),
                ["fix"] = ParseJsonOrNull(v.Fix),
                ["sources"] = ParseJson(v.Sources),
                ["problemId"] = v.ProblemId,
                ["kind"] = v.Kind,
                ["source"] = v.Source,
                ["dataTier"] = v.DataTier,
                ["fixable"] = v.Fixable,
                ["suspected"] = v.Suspected,
                ["where"] = ParseJsonOrNull(v.Where),
                ["refines"] = v.Refines,
                ["priorityBase"] = v.PriorityBase,
                ["priorityCategoryWeight"] = v.PriorityCategoryWeight,
                ["priorityScopeMultiplier"] = v.PriorityScopeMultiplier,
                ["scope"] = v.Scope,
            }).ToArray()),
            ["conversation"] = new JsonObject
            {
                ["messages"] = new JsonArray(messages.Select(m => (JsonNode)new JsonObject
                {
                    ["role"] = m.Role,
                    ["status"] = m.Status,
                    ["mode"] = m.Mode,
                    ["content"] = m.Content,
                    ["evidence"] = ParseJsonOrNull(m.Evidence),
                    ["refusalReason"] = m.RefusalReason,
                    // LlmCallId is deliberately dropped (§6/§6.1) — an
                    // ops-internal ULID into the owner's LLM spend ledger,
                    // never needed by the seeder (seeded rows are unmetered).
                }).ToArray()),
            },
            ["rackPresets"] = new JsonArray(rackPresets.Select(p => (JsonNode)new JsonObject
            {
                ["name"] = p.Name,
                ["source"] = p.Source,
                ["chain"] = ParseJson(p.ChainJson),
                ["coachMeta"] = ParseJsonOrNull(p.CoachMeta),
            }).ToArray()),
        };
        return root.ToJsonString(SnapshotDocOptions);
    }

    private static JsonNode? ParseJson(string json) => JsonNode.Parse(json);
    private static JsonNode? ParseJsonOrNull(string? json) => string.IsNullOrEmpty(json) ? null : JsonNode.Parse(json);
}
