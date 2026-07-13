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
public sealed class DemoSeeder(
    AppDbContext db,
    IFileStorage storage,
    ILogger<DemoSeeder> logger)
{
    public const string DemoSongName = "Demo: Sample Report";
    public const string DemoAudioKey = "audio/demo/source.wav";
    private const string DemoDescription =
        "Seeded sample so you can explore a full SPECTR report right away — "
        + "the findings below come from a deliberately rough demo mix, not from this audio. "
        + "Upload your own track to get real answers.";

    /// <summary>Seed the demo song for a fresh user. Idempotent; never throws.</summary>
    public async Task SeedAsync(Guid userId, CancellationToken ct = default)
    {
        try
        {
            if (await db.Songs.AsNoTracking()
                    .AnyAsync(s => s.UserId == userId && s.Name == DemoSongName, ct))
                return;

            // Cheap precondition first: no point writing ~880 KB of audio if
            // the report asset is missing.
            var finalJson = await LoadSampleFinalJsonAsync(ct);
            if (finalJson is null) return; // sample asset missing — skip quietly
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
                CreatedAt = DateTimeOffset.UtcNow,
            };

            db.Songs.Add(song);
            db.SongVersions.Add(version);
            db.AnalysisJobs.Add(job);
            db.Analyses.Add(analysis);
            await db.SaveChangesAsync(ct);
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
        }
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
