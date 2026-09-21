using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Story 12.8 (AC1) — first-run demo: a clearly-labeled sample report seeded
// into every NEW account's library so a full report is explorable in seconds,
// before the user's own first analysis lands.
//
// Design (scouted): every library/report/audio query is strictly user-scoped,
// so the demo is COPY-PER-USER rows. Only the audio object is shared — all
// seeded SongVersions point at ONE canonical generated tone (ownership checks
// ride the version row, not the blob). HONESTY RULE: the name/description say
// this is SAMPLE data — the report showcases the UI (a deliberately rough
// mix, grade F, so there are real findings to explore); it is not an analysis
// of the tone. Best-effort: seeding must never fail registration.
//
// D6 (2026-09-20) — track-agnostic snapshot seeding: when an operator has
// installed a real analyzed-version export (DemoSnapshotStore), seed a full
// copy of it (verdicts, coach conversation, rack presets, routing plan)
// instead of the sine-tone report. Every path now stamps a routing plan at
// seed time — a demo report with NO routing plan lazily fired paid Triage on
// the very first GET /verdicts for every single account.
public sealed record DemoSeedResult(Guid SongId, Guid VersionId, Guid JobId, bool FromSnapshot);

public sealed class DemoSeeder(
    AppDbContext db,
    IFileStorage storage,
    DemoSnapshotStore snapshotStore,
    ILogger<DemoSeeder> logger)
{
    public const string DemoSongName = "Demo: Sample Report";
    public const string DemoSongPrefix = "Demo: ";
    public const string DemoAudioKey = "audio/demo/source.wav";
    private const string DemoDescription =
        "Seeded sample so you can explore a full SPECTR report right away — "
        + "the findings below come from a deliberately rough demo mix, not from this audio. "
        + "Upload your own track to get real answers.";

    // Closes the paid-triage-on-GET leak (VerdictEndpoints.ListVerdicts only
    // lazy-fires run_triage when routing_plan IS NULL): a "nothing to triage"
    // plan in the SAME shape run_triage itself writes (specialists_to_run /
    // skip / rationale / estimated_total_tokens, snake_case — see
    // RoutingPlanDto + VerdictEndpoints.ParseRoutingPlan).
    private const string FallbackRoutingPlanJson =
        "{\"specialists_to_run\":[],\"skip\":[],"
        + "\"rationale\":\"Seeded sample report — nothing to triage.\","
        + "\"estimated_total_tokens\":0}";

    /// <summary>Seed the demo song for a fresh user. Idempotent; never throws.</summary>
    public async Task<DemoSeedResult?> SeedAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            if (await db.Songs.AsNoTracking()
                    .AnyAsync(s => s.UserId == userId && s.Name.StartsWith(DemoSongPrefix), ct))
                return await FindAsync(userId, ct);

            var template = await snapshotStore.GetAsync(ct);
            if (template is not null)
            {
                try
                {
                    return await SeedFromSnapshotAsync(userId, template, ct);
                }
                catch (Exception ex)
                {
                    // A snapshot that fails mid-materialize/insert must not
                    // leave the user with NO demo — fall through to the
                    // sine-tone seed instead of bubbling to the outer catch.
                    db.ChangeTracker.Clear();
                    logger.LogWarning(ex,
                        "Demo snapshot seed failed for user {UserId} — falling back to the sine-tone seed", userId);
                }
            }

            return await SeedFallbackAsync(userId, ct);
        }
        catch (Exception ex)
        {
            // Never fail registration for a demo (device-claim precedent).
            // CRITICAL (review P2): drop any tracked-but-unsaved demo entities —
            // the scoped DbContext is shared with the rest of the Register
            // request, and a poisoned tracker would make the NEXT SaveChanges
            // (refresh-token issuance) retry the failed inserts and blow up.
            db.ChangeTracker.Clear();
            logger.LogWarning(ex, "Demo seed failed for user {UserId} — registration unaffected", userId);
            return null;
        }
    }

    /// <summary>Locate a user's already-seeded demo (either origin: snapshot or fallback).
    /// Null if none exists yet.</summary>
    public async Task<DemoSeedResult?> FindAsync(Guid userId, CancellationToken ct = default)
    {
        // Fix-round-1 item 7: ASCENDING — the seeded demo is always the
        // user's FIRST "Demo: "-prefixed song. A later user song the user
        // happens to rename "Demo: something" must never shadow it (the
        // guest landing flow in task D5 depends on always finding the
        // ORIGINAL seed here).
        var song = await db.Songs.AsNoTracking()
            .Where(s => s.UserId == userId && s.Name.StartsWith(DemoSongPrefix))
            .OrderBy(s => s.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (song is null) return null;

        var version = await db.SongVersions.AsNoTracking()
            .Where(v => v.SongId == song.Id && v.IsCurrent)
            .FirstOrDefaultAsync(ct);
        if (version is null) return null;

        var job = await db.AnalysisJobs.AsNoTracking()
            .Where(j => j.VersionId == version.Id)
            .OrderByDescending(j => j.DispatchedAt)
            .FirstOrDefaultAsync(ct);
        if (job is null) return null;

        // The fallback seed always points at the ONE shared sine-tone key;
        // a snapshot seed's version always points somewhere else under
        // audio/demo/snapshot/. Cheap, reliable signal — no extra column.
        return new DemoSeedResult(song.Id, version.Id, job.Id, version.FilePath != DemoAudioKey);
    }

    private async Task<DemoSeedResult> SeedFromSnapshotAsync(Guid userId, DemoSnapshotTemplate template, CancellationToken ct)
    {
        var doc = template.Materialize();

        var song = new Song
        {
            Id = doc.Source.SongId,
            UserId = userId,
            Name = DemoSeedMapping.TruncateSongName(DemoSongPrefix + doc.Song.Title),
            Description = DemoDescription,
            GenreHint = doc.Song.GenreHint,
        };
        var version = new SongVersion
        {
            Id = doc.Source.VersionId,
            SongId = song.Id,
            VersionNumber = 1,
            Label = "demo",
            IsCurrent = true,
            FilePath = doc.Version.AudioKey,
        };
        var job = new AnalysisJob
        {
            Id = doc.Source.JobId,
            UserId = userId,
            VersionId = version.Id,
            Status = "complete",
            CurrentPhase = "complete",
            PhasePct = 1.0,
            DispatchedAt = DateTimeOffset.UtcNow,
            CompletedAt = DateTimeOffset.UtcNow,
        };
        // Fix-round-1 items 1+2: the ids of specialists a seeded verdict
        // actually covers — mirrors CoachTab.tsx's own "already" rule
        // (data.specialists status != 'idle', i.e. ANY verdict row for that
        // slug). Used to (a) guarantee RoutingPlan is never null — a null
        // plan lazy-fires paid run_triage on the very first GET /verdicts
        // (VerdictEndpoints.ListVerdicts) — and (b) strip every routed
        // specialist that never produced a verdict, so CoachTab's auto-run
        // effect has nothing uncovered left to fire on page load.
        var coveredSpecialistSlugs = doc.Verdicts.Select(v => v.Specialist).ToHashSet(StringComparer.Ordinal);
        var routingPlanJson = doc.Analysis.RoutingPlan is { ValueKind: JsonValueKind.Object } plan
            ? DemoSeedMapping.RewriteRoutingPlanForSeed(plan.GetRawText(), coveredSpecialistSlugs)
            : DemoSeedMapping.EmptyRoutingPlanJson;

        var analysis = new Analysis
        {
            Id = doc.Source.AnalysisId,
            JobId = job.Id,
            UserId = userId,
            VersionId = version.Id,
            SongId = song.Id,
            SongName = song.Name,
            FinalJson = doc.Analysis.FinalJson.ValueKind is JsonValueKind.Undefined
                ? "{}" : doc.Analysis.FinalJson.GetRawText(),
            RoutingPlan = routingPlanJson,
            PipelineVersion = doc.Analysis.PipelineVersion,
            RuleEngineVersion = doc.Analysis.RuleEngineVersion,
            ValidatorVersion = doc.Analysis.ValidatorVersion,
            PromptSetVersion = doc.Analysis.PromptSetVersion,
            PhaseDurations = doc.Analysis.PhaseDurations?.GetRawText() ?? "{}",
            StemMetrics = doc.Analysis.StemMetrics?.GetRawText(),
            SpectrogramImagePath = doc.Analysis.SpectrogramImageKey,
            WaveformImagePath = doc.Analysis.WaveformImageKey,
            WaveformPeaksPath = doc.Analysis.WaveformPeaksKey,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Songs.Add(song);
        db.SongVersions.Add(version);
        db.AnalysisJobs.Add(job);
        db.Analyses.Add(analysis);

        foreach (var v in doc.Verdicts)
        {
            db.Verdicts.Add(new Verdict
            {
                Id = v.Id,
                AnalysisId = analysis.Id,
                Specialist = v.Specialist,
                PromptVersion = v.PromptVersion,
                Model = v.Model,
                Severity = v.Severity,
                Category = v.Category,
                Confidence = v.Confidence,
                PriorityScore = v.PriorityScore,
                Impact = v.Impact ?? "med",
                ChartType = v.ChartType,
                Headline = v.Headline,
                Summary = v.Summary,
                Body = v.Body,
                MetricLine = v.MetricLine,
                WhyItMatters = v.WhyItMatters,
                PresetName = v.PresetName,
                Evidence = v.Evidence?.GetRawText() ?? "[]",
                Fix = v.Fix?.GetRawText(),
                Sources = v.Sources?.GetRawText() ?? "[]",
                ProblemId = v.ProblemId,
                Kind = v.Kind ?? "fault",
                Source = v.Source ?? "rule_engine",
                DataTier = v.DataTier ?? "audio_only",
                Fixable = v.Fixable,
                Suspected = v.Suspected,
                Where = v.Where?.GetRawText(),
                Refines = v.Refines,
                PriorityBase = v.PriorityBase,
                PriorityCategoryWeight = v.PriorityCategoryWeight,
                PriorityScopeMultiplier = v.PriorityScopeMultiplier,
                Scope = v.Scope,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }

        var conversation = new Conversation
        {
            Id = Guid.NewGuid(),
            AnalysisId = analysis.Id,
            UserId = userId,
        };
        db.Conversations.Add(conversation);

        if (doc.Conversation is not null)
        {
            var i = 0;
            foreach (var m in doc.Conversation.Messages)
            {
                // Strictly increasing timestamps preserve message order for
                // every ORDER BY created_at consumer (frontend transcript,
                // this seeder's own tests) without needing a sequence column.
                var stamp = DateTimeOffset.UtcNow.AddSeconds(i);
                db.CoachMessages.Add(new CoachMessage
                {
                    Id = Guid.NewGuid(),
                    ConversationId = conversation.Id,
                    Role = m.Role,
                    Status = m.Status ?? "complete",
                    Mode = m.Mode ?? "qa",
                    Content = m.Content ?? "",
                    Evidence = m.Evidence?.GetRawText(),
                    RefusalReason = m.RefusalReason,
                    LlmCallId = null, // seeded rows never metered against the guest/coach budget
                    CreatedAt = stamp,
                    CompletedAt = stamp,
                });
                i++;
            }
        }

        if (doc.RackPresets is not null)
        {
            foreach (var p in doc.RackPresets)
            {
                // Fix-round-1 item 9b: a missing/null chain (Undefined or
                // JSON null) has nothing to seed — GetRawText() throws on
                // Undefined specifically. Skip that ONE preset rather than
                // letting it take down the whole SaveChanges.
                if (p.Chain.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null) continue;
                db.RackPresets.Add(new RackPreset
                {
                    Id = Guid.NewGuid(),
                    SongVersionId = version.Id,
                    Name = p.Name,
                    Source = p.Source ?? "analysis",
                    ChainJson = p.Chain.GetRawText(),
                    CoachMeta = p.CoachMeta?.GetRawText(),
                });
            }
        }

        await db.SaveChangesAsync(ct);
        return new DemoSeedResult(song.Id, version.Id, job.Id, true);
    }

    private async Task<DemoSeedResult?> SeedFallbackAsync(Guid userId, CancellationToken ct)
    {
        // Cheap precondition first: no point writing ~880 KB of audio if
        // the report asset is missing.
        var finalJson = await LoadSampleFinalJsonAsync(ct);
        if (finalJson is null) return null; // sample asset missing — skip quietly
        await EnsureDemoAudioAsync(ct);

        var song = new Song
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = DemoSongName,
            Description = DemoDescription,
        };
        var version = new SongVersion
        {
            Id = Guid.NewGuid(),
            SongId = song.Id,
            VersionNumber = 1,
            Label = "demo",
            IsCurrent = true,
            FilePath = DemoAudioKey,
        };
        var job = new AnalysisJob
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            VersionId = version.Id,
            Status = "complete",
            CurrentPhase = "complete",
            PhasePct = 1.0,
            DispatchedAt = DateTimeOffset.UtcNow,
            CompletedAt = DateTimeOffset.UtcNow,
        };
        var analysis = new Analysis
        {
            Id = Guid.NewGuid(),
            JobId = job.Id,
            UserId = userId,
            VersionId = version.Id,
            SongId = song.Id,
            SongName = DemoSongName,
            FinalJson = finalJson,
            PhaseDurations = "{}",
            RoutingPlan = FallbackRoutingPlanJson,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Songs.Add(song);
        db.SongVersions.Add(version);
        db.AnalysisJobs.Add(job);
        db.Analyses.Add(analysis);
        await db.SaveChangesAsync(ct);

        return new DemoSeedResult(song.Id, version.Id, job.Id, false);
    }

    // The canonical shared demo audio: a small generated stereo tone, written
    // once through IFileStorage (works for LocalDisk dev and R2 prod alike).
    private async Task EnsureDemoAudioAsync(CancellationToken ct)
    {
        // Size-validated (review P3): a torn write from a crashed/raced first
        // registration must not become the permanent canonical demo audio.
        var expected = 44L + 44100L * 5 * 2 * 2;
        var size = await storage.GetFileSizeAsync(DemoAudioKey, ct);
        if (size == expected) return;
        try
        {
            using var wav = new MemoryStream(GenerateToneWav());
            await storage.WriteAsync(DemoAudioKey, wav, "audio/wav", ct);
        }
        catch (IOException)
        {
            // Concurrent first registrations can race the same key — if the
            // other writer won, fine; otherwise rethrow into the best-effort
            // outer catch (that user just skips the demo, self-heals later).
            if (!await storage.ExistsAsync(DemoAudioKey, ct)) throw;
        }
    }

    // 5 s stereo 440 Hz sine, 44.1 kHz s16le (~880 KB) — same math as the
    // playwright fixture generator (gen-wav.mjs). -6 dBFS headroom.
    internal static byte[] GenerateToneWav()
    {
        const int sampleRate = 44100, seconds = 5, channels = 2, freq = 440;
        var frames = sampleRate * seconds;
        var dataBytes = frames * channels * 2;
        var buf = new byte[44 + dataBytes];

        void WriteAscii(int off, string s) => System.Text.Encoding.ASCII.GetBytes(s).CopyTo(buf, off);
        void WriteU32(int off, uint v) => BitConverter.GetBytes(v).CopyTo(buf, off);
        void WriteU16(int off, ushort v) => BitConverter.GetBytes(v).CopyTo(buf, off);

        WriteAscii(0, "RIFF"); WriteU32(4, (uint)(36 + dataBytes)); WriteAscii(8, "WAVE");
        WriteAscii(12, "fmt "); WriteU32(16, 16); WriteU16(20, 1); WriteU16(22, channels);
        WriteU32(24, sampleRate); WriteU32(28, (uint)(sampleRate * channels * 2));
        WriteU16(32, channels * 2); WriteU16(34, 16);
        WriteAscii(36, "data"); WriteU32(40, (uint)dataBytes);

        for (var i = 0; i < frames; i++)
        {
            var sample = (short)Math.Round(Math.Sin(2 * Math.PI * freq * i / sampleRate) * 16383);
            var off = 44 + i * channels * 2;
            BitConverter.GetBytes(sample).CopyTo(buf, off);
            BitConverter.GetBytes(sample).CopyTo(buf, off + 2);
        }
        return buf;
    }

    // The bundled sample report (schemas/samples, linked into the BFF output as
    // a content file — kept at its schemas/ home, no duplication).
    private static string? _sampleJsonCache;

    private async Task<string?> LoadSampleFinalJsonAsync(CancellationToken ct)
    {
        if (_sampleJsonCache is not null) return _sampleJsonCache;
        var path = Path.Combine(AppContext.BaseDirectory, "DemoAssets", "demo-final-json.json");
        if (!File.Exists(path))
        {
            logger.LogWarning("Demo sample final_json missing at {Path} — demo seed skipped", path);
            return null;
        }
        var text = await File.ReadAllTextAsync(path, ct);
        try
        {
            using var _ = System.Text.Json.JsonDocument.Parse(text); // corrupt asset → skip, don't seed garbage
        }
        catch (System.Text.Json.JsonException ex)
        {
            logger.LogWarning(ex, "Demo sample final_json unparseable — demo seed skipped");
            return null;
        }
        _sampleJsonCache = text;
        return _sampleJsonCache;
    }
}
