using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Spectr.Bff.Tests;

// Hot-fix regression coverage: a seeded demo song's SongVersion.FilePath
// points at a SHARED storage key under "audio/demo/" (one blob serves every
// registered user + guest that got the demo snapshot seeded). Before this
// fix, DELETE /api/versions/{id} and DELETE /api/songs/{id}/permanent both
// deleted whatever key was on the row with no shared-key guard — so the
// FIRST user to delete their demo song deleted the demo audio for everybody.
// Reuses the RecordingJobQueue defined in UploadDeferralTests.cs so nothing
// here touches the real dramatiq/Redis broker.
public sealed class SharedDemoAudioDeleteTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task DeleteVersion_WithSharedDemoKey_RemovesRow_But_PreservesBlob()
    {
        await TestDb.RequireAsync(_factory);
        using var f = NewFactory();
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterWithDemoAsync(f, client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var key = $"audio/demo/test-{Guid.NewGuid():N}/source.wav";
        var songId = Guid.Empty;
        try
        {
            await WriteBlobAsync(f, key);
            Guid versionId;
            (songId, versionId) = await SeedSongVersionAsync(f, userId, key);

            var del = await client.DeleteAsync($"/api/versions/{versionId}");
            Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Null(await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == versionId));

            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            Assert.True(await storage.ExistsAsync(key),
                "shared demo blob must survive a version delete — it serves every seeded account");
        }
        finally
        {
            await CleanupAsync(f, userId, songId, key);
        }
    }

    [SkippableFact]
    public async Task PermanentDeleteSong_WithSharedDemoKey_RemovesRows_But_PreservesBlob()
    {
        await TestDb.RequireAsync(_factory);
        using var f = NewFactory();
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterWithDemoAsync(f, client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var key = $"audio/demo/test-{Guid.NewGuid():N}/source.wav";
        var songId = Guid.Empty;
        try
        {
            await WriteBlobAsync(f, key);
            Guid versionId;
            (songId, versionId) = await SeedSongVersionAsync(f, userId, key);

            var del = await client.DeleteAsync($"/api/songs/{songId}/permanent");
            Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Null(await db.Songs.AsNoTracking().FirstOrDefaultAsync(s => s.Id == songId));
            Assert.Null(await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == versionId));

            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            Assert.True(await storage.ExistsAsync(key),
                "shared demo blob must survive a song hard-delete — it serves every seeded account");
        }
        finally
        {
            await CleanupAsync(f, userId, songId, key);
        }
    }

    // Control: an ORDINARY (non-shared) key must still be cleaned up by a
    // version delete — proves the guard doesn't disable normal cleanup.
    [SkippableFact]
    public async Task DeleteVersion_WithOrdinaryKey_DeletesBlob_Control()
    {
        await TestDb.RequireAsync(_factory);
        using var f = NewFactory();
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterWithDemoAsync(f, client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var key = $"audio/upload/test-{Guid.NewGuid():N}/source.wav";
        var songId = Guid.Empty;
        try
        {
            await WriteBlobAsync(f, key);
            Guid versionId;
            (songId, versionId) = await SeedSongVersionAsync(f, userId, key);

            var del = await client.DeleteAsync($"/api/versions/{versionId}");
            Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

            using var scope = f.Services.CreateScope();
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            Assert.False(await storage.ExistsAsync(key),
                "an ordinary (non-shared) blob must still be cleaned up on version delete");
        }
        finally
        {
            await CleanupAsync(f, userId, songId, key);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    // Swaps in the recording IJobQueue so nothing here can ever reach the
    // real dramatiq/Redis broker shared with a live dev worker.
    private WebApplicationFactory<Program> NewFactory()
    {
        var queue = new RecordingJobQueue();
        return _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<IJobQueue>();
            s.AddSingleton<IJobQueue>(queue);
        }));
    }

    private static async Task WriteBlobAsync(WebApplicationFactory<Program> f, string key)
    {
        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        await storage.WriteAsync(key, new MemoryStream(new byte[16]), "audio/wav");
    }

    private static async Task<(Guid SongId, Guid VersionId)> SeedSongVersionAsync(
        WebApplicationFactory<Program> f, Guid userId, string filePath)
    {
        var songId = Guid.NewGuid();
        var versionId = Guid.NewGuid();

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Songs.Add(new Song
        {
            Id = songId,
            UserId = userId,
            Name = $"Shared Demo {Guid.NewGuid():N}",
        });
        db.SongVersions.Add(new SongVersion
        {
            Id = versionId,
            SongId = songId,
            VersionNumber = 1,
            Label = "demo",
            IsCurrent = true,
            FilePath = filePath,
        });
        await db.SaveChangesAsync();

        return (songId, versionId);
    }

    private static async Task CleanupAsync(
        WebApplicationFactory<Program> f, Guid userId, Guid songId, string? blobKey)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);

        if (songId != Guid.Empty)
        {
            await db.SongVersions.Where(v => v.SongId == songId).ExecuteDeleteAsync();
            await db.Songs.Where(s => s.Id == songId).ExecuteDeleteAsync();
        }
        if (userId != Guid.Empty)
        {
            await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
            await db.AuditLogs.Where(a => a.Target == userId.ToString()).ExecuteDeleteAsync();
            await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }

        if (!string.IsNullOrEmpty(blobKey))
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            try { await storage.DeleteAsync(blobKey); }
            catch { /* best-effort test cleanup */ }
        }
    }
}
