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
//
// Fix-round-1 (post-review): every export writes its assets into a FRESH
// per-export subdirectory (`<dir>/<exportId>/…`, exportId a random id — never
// a source id) so a crash mid-export, or a routine leak/size abort, can never
// pair a stale snapshot.json with half-written assets or delete the CURRENTLY
// LIVE demo. `snapshot.json` at the fixed configured key is the one atomic
// "go live" write; only after it succeeds do we best-effort retire the
// PREVIOUS export's asset objects (read from the old snapshot.json before it
// was overwritten).
public static partial class AdminEndpoints
{
    // Comfortably under DemoSnapshotStore's 4 MB load cap — a document that
    // creeps past this (more verdicts, a longer chat) is refused here rather
    // than written and silently rejected by every future seed attempt.
    // Overridable via config so a test can exercise the refusal without
    // allocating megabytes of fixture text.
    private const long DefaultMaxSnapshotDocBytes = 3 * 1024 * 1024;

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
        DemoSnapshotStore snapshotStore, IConfiguration config, HttpContext httpCtx, CancellationToken ct)
    {
        // Same convention as every other admin mutation (PostRefund/PostBan/…).
        if (ValidateReason(req.Reason) is { } badReason) return badReason;

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

        // Fix-round-1 items 1+4: resolve + validate the DESTINATION before any
        // write (see ResolveSnapshotKey below).
        var (resolvedKey, keyError) = ResolveSnapshotKey(config);
        if (keyError is not null) return keyError;
        var snapshotKey = resolvedKey!; // non-null whenever keyError is null

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

        var dir = DirOf(snapshotKey);
        // Fix-round-1 item 2: a FRESH, random per-export subdirectory — never
        // a source id (the seeder's tokenizer only substitutes the four
        // SOURCE guids; a random export id is never touched by it, and is
        // still validated id-free below). Every asset this export writes
        // lives here, so an abort can delete EXACTLY what this export
        // created without ever touching the live snapshot's assets.
        var exportId = Guid.NewGuid().ToString("N");
        var exportDir = dir + exportId + "/";

        var ext = ExtensionOf(version.FilePath);
        var audioKey = exportDir + "source" + ext;
        var writtenKeys = new List<string>();
        // Fix-round-2 item (b): once the go-live write succeeds, writtenKeys
        // stops meaning "delete these on failure" and starts meaning "the
        // live demo's own assets" — a post-go-live failure (cancellation, a
        // failing audit SaveChangesAsync, …) must never delete them.
        var wentLive = false;

        // Read the CURRENTLY LIVE snapshot's asset keys BEFORE we overwrite
        // the pointer. Best-effort: a missing or corrupt previous snapshot
        // just means "nothing to retire" — it must never block a fresh
        // export.
        var previousAssetKeys = await ReadPreviousAssetKeysAsync(storage, snapshotKey, ct);

        try
        {
            await CopyAsync(storage, version.FilePath, audioKey, AudioContentType(ext), ct);
            writtenKeys.Add(audioKey);

            string? spectrogramKey = null, waveformKey = null, peaksKey = null;
            if (await CopyIfPresentAsync(storage, analysis.SpectrogramImagePath, exportDir + "spectrogram.webp", "image/webp", ct))
            { spectrogramKey = exportDir + "spectrogram.webp"; writtenKeys.Add(spectrogramKey); }
            if (await CopyIfPresentAsync(storage, analysis.WaveformImagePath, exportDir + "waveform.webp", "image/webp", ct))
            { waveformKey = exportDir + "waveform.webp"; writtenKeys.Add(waveformKey); }
            if (await CopyIfPresentAsync(storage, analysis.WaveformPeaksPath, exportDir + "peaks.json", "application/json", ct))
            { peaksKey = exportDir + "peaks.json"; writtenKeys.Add(peaksKey); }

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

            var maxDocBytes = config.GetValue<long?>("Demo:SnapshotExportMaxBytes") ?? DefaultMaxSnapshotDocBytes;
            var byteCount = Encoding.UTF8.GetByteCount(docJson);
            if (byteCount > maxDocBytes)
            {
                foreach (var key in writtenKeys) await storage.DeleteAsync(key, ct);
                return ErrorEnvelope.Build(409, "snapshot_too_large",
                    $"Snapshot document is {byteCount} bytes, over the {maxDocBytes} byte export cap "
                    + "(kept under the 4 MB loader cap) — trim verdicts/conversation and retry.");
            }

            // snapshot.json is written LAST, at the fixed configured key —
            // this single write is the atomic "go live" moment. Every asset
            // it references already exists under exportDir before this runs.
            await storage.WriteAsync(snapshotKey,
                new MemoryStream(Encoding.UTF8.GetBytes(docJson)), "application/json", ct);
            wentLive = true; // the demo is now live on these assets — nothing below may delete them
            var audioBytes = await storage.GetFileSizeAsync(audioKey, ct) ?? 0;

            // The next sign-up must see this without waiting out the 60s TTL.
            snapshotStore.Invalidate();

            db.AuditLogs.Add(new AuditLog
            {
                ActorUserId = OperatorActor,
                Action = "demo_snapshot_export",
                Target = req.VersionId.ToString(),
                Reason = Fit(req.Reason!),
            });
            await db.SaveChangesAsync(ct);

            // Only NOW — after the new snapshot.json is live — best-effort
            // retire the PREVIOUS export's assets. A failure here is logged
            // and swallowed; it must never turn a successful export into an
            // error response.
            //
            // Fix-round-2 item (a): the OLD snapshot.json is untrusted input
            // (corrupted, tampered, or hand-edited) — it could name ANY
            // storage key. Retire a key only when it passes every guard:
            // inside the required shared prefix, inside THIS snapshot's own
            // directory, not the pointer file itself, and not (defense in
            // depth) under the brand-new export directory. Anything else is
            // skipped and logged, never deleted — a foreign user's audio or
            // the shared canonical sine-tone key must never be retired.
            if (previousAssetKeys.Count > 0)
            {
                var logger = httpCtx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Admin");
                foreach (var key in previousAssetKeys)
                {
                    if (!IsRetireableAssetKey(key, dir, snapshotKey, exportDir))
                    {
                        logger.LogWarning(
                            "Refusing to retire demo snapshot asset outside its own export directory: {Key}", key);
                        continue;
                    }
                    try { await storage.DeleteAsync(key, ct); }
                    catch (Exception ex) { logger.LogWarning(ex, "Could not retire old demo snapshot asset {Key}", key); }
                }
            }

            var freeText = new DemoSnapshotFreeText(
                song.Name,
                rackPresets.Select(p => p.Name).ToList(),
                messages.Where(m => m.Role == "user").Select(m => m.Content).ToList());

            return Results.Json(new DemoSnapshotExportResponse(
                snapshotKey, verdicts.Count, messages.Count, rackPresets.Count, audioBytes, freeText));
        }
        catch
        {
            // Fix-round-2 item (b): once wentLive is true, writtenKeys ARE
            // the live demo's assets — a failure here (cancellation, a
            // failing audit SaveChangesAsync, …) must never delete them.
            // Pre-go-live, this is exactly the old behaviour: this export's
            // own assets only, never the live snapshot or any previous
            // export's assets.
            if (!wentLive)
            {
                foreach (var key in writtenKeys)
                {
                    try { await storage.DeleteAsync(key, ct); }
                    catch { /* best-effort cleanup — the original exception is what matters */ }
                }
            }
            throw;
        }
    }

    // Fix-round-2 item (a) — every hold must pass before a key read from an
    // untrusted OLD snapshot.json is ever deleted.
    private static bool IsRetireableAssetKey(string key, string dir, string snapshotKey, string exportDir)
    {
        if (!DemoSnapshotStore.IsSharedKey(key)) return false;
        if (!key.StartsWith(dir, StringComparison.Ordinal)) return false;
        if (key == snapshotKey) return false;
        if (key.StartsWith(exportDir, StringComparison.Ordinal)) return false; // never the NEW export's own assets
        return true;
    }

    // Fix-round-1 items 1+4 — resolves the configured destination BEFORE any
    // storage write, mirroring DemoSnapshotStore.GetAsync exactly:
    //   - a MISSING config value (`config[...]` is null) falls back to
    //     DemoSnapshotFormat.DefaultKey (`config[...] ?? Default`);
    //   - an EXPLICITLY EMPTY value ("") is the documented disable — refused
    //     here (409 demo_snapshot_disabled) rather than silently falling
    //     back, which would export into a key nobody asked for;
    //   - anything outside DemoSnapshotStore.SharedPrefix (typo, leading
    //     slash, backslash, parent-traversal) is refused (409
    //     snapshot_key_invalid) — a real user's audio/analysis/coach
    //     transcript must never land somewhere the purge/loader prefix
    //     checks don't protect.
    // Pure + internal so a test can exercise the "missing config" fallback
    // directly against a fake IConfiguration, without ever risking a real
    // HTTP-triggered write to the production default key.
    internal static (string? Key, IResult? Error) ResolveSnapshotKey(IConfiguration config)
    {
        var configuredKey = config["Demo:SnapshotKey"];
        if (configuredKey is { Length: 0 })
            return (null, ErrorEnvelope.Build(409, "demo_snapshot_disabled",
                "Demo:SnapshotKey is explicitly disabled (empty) — configure a real key before exporting."));
        var key = configuredKey ?? DemoSnapshotFormat.DefaultKey;
        if (!DemoSnapshotStore.IsSharedKey(key))
            return (null, ErrorEnvelope.Build(409, "snapshot_key_invalid",
                $"Configured Demo:SnapshotKey '{key}' is outside the required shared prefix "
                + $"'{DemoSnapshotStore.SharedPrefix}' — refusing to write real user data there."));
        return (key, null);
    }

    // Reads the asset keys the CURRENTLY LIVE snapshot.json names, so they
    // can be retired after a NEW export goes live. Missing/corrupt/unparseable
    // → empty list: never block or fail an export over the old document.
    private static async Task<List<string>> ReadPreviousAssetKeysAsync(
        IFileStorage storage, string snapshotKey, CancellationToken ct)
    {
        var keys = new List<string>();
        try
        {
            if (!await storage.ExistsAsync(snapshotKey, ct)) return keys;
            await using var stream = await storage.OpenReadAsync(snapshotKey, ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var root = doc.RootElement;
            if (root.TryGetProperty("version", out var v) && v.TryGetProperty("audioKey", out var a)
                && a.ValueKind == JsonValueKind.String && a.GetString() is { Length: > 0 } audioKey)
                keys.Add(audioKey);
            if (root.TryGetProperty("analysis", out var an))
            {
                foreach (var prop in new[] { "spectrogramImageKey", "waveformImageKey", "waveformPeaksKey" })
                    if (an.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String
                        && el.GetString() is { Length: > 0 } key)
                        keys.Add(key);
            }
        }
        catch
        {
            return []; // corrupt previous snapshot — nothing safe to retire
        }
        return keys;
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
