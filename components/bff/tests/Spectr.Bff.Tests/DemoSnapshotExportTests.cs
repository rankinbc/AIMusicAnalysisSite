using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D4 — admin demo-snapshot exporter: POST /api/admin/demo/snapshot
// exports ONE real analyzed version (final_json, routing plan, verdicts incl.
// fix ops, the owner's coach conversation, rack presets, images, audio) to
// storage under audio/demo/snapshot/, in place, so a fresh sign-up can seed
// from it (D3/DemoSeeder). Spec §6 + §6.1 bind the shape and the seed-time
// safety rules this exporter must respect.
public sealed class DemoSnapshotExportTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private const string Key = "test-admin-key-0123456789-0123456789-d4";
    private readonly List<Guid> _userIds = [];
    private readonly List<Guid> _versionIds = [];
    private string? _dir;

    private WebApplicationFactory<Program> Build()
    {
        _dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        return factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", Key);
            b.UseSetting("Demo:SnapshotKey", _dir + "snapshot.json");
        });
    }

    private static HttpClient Admin(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient();
        c.DefaultRequestHeaders.Add("X-Admin-Key", Key);
        return c;
    }

    private static async Task<string?> Code(HttpResponseMessage r)
    {
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static async Task SetAsync(WebApplicationFactory<Program> f, Guid analysisId, Action<Analysis> mutate)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var a = await db.Analyses.SingleAsync(x => x.Id == analysisId);
        mutate(a);
        await db.SaveChangesAsync();
    }

    // Registers a fresh user (triggering DemoSeeder.SeedAsync — since
    // Demo:SnapshotKey points at a not-yet-written key in this test's own
    // directory, that seed falls back to the sine-tone report, which after
    // D3 already carries a non-null routing plan) and returns the seeded
    // version/analysis to export FROM.
    private async Task<(Guid VersionId, Guid AnalysisId, string Email)> SeedAnalyzedAsync(WebApplicationFactory<Program> f)
    {
        var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
        _userIds.Add(userId);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId);
        var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
        _versionIds.Add(analysis.VersionId!.Value);
        return (analysis.VersionId!.Value, analysis.Id, user.Email);
    }

    [SkippableFact]
    public async Task Export_Requires_The_Admin_Key()
    {
        await TestDb.RequireAsync(factory); var f = Build();
        var r = await f.CreateClient().PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [SkippableFact]
    public async Task Export_Refuses_An_Untriaged_Analysis()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _) = await SeedAnalyzedAsync(f);
        await SetAsync(f, analysisId, a => a.RoutingPlan = null);
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_not_ready", await Code(r));
    }

    [SkippableFact]
    public async Task Export_Refuses_A_Degraded_Analysis()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _) = await SeedAnalyzedAsync(f);
        await SetAsync(f, analysisId, a => a.DegradationNotice = "{\"reason\":\"tier_budget\"}");
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_not_ready", await Code(r));
    }

    [SkippableFact]
    public async Task Export_Aborts_When_The_Owner_Would_Leak()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, email) = await SeedAnalyzedAsync(f);
        await SetAsync(f, analysisId, a => a.FinalJson = "{\"note\":\"" + email + "\"}");
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_leak", await Code(r));
    }

    [SkippableFact]
    public async Task Export_Round_Trips_Through_The_Seeder()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, _, _) = await SeedAnalyzedAsync(f);
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<DemoSnapshotExportResponse>();
        Assert.StartsWith("audio/demo/", body!.SnapshotKey); Assert.True(body.AudioBytes > 0);
        var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());          // a NEW account now seeds from the export
        _userIds.Add(userId);
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var v = await db.SongVersions.AsNoTracking().SingleAsync(x => db.Songs.Any(s => s.Id == x.SongId && s.UserId == userId));
        Assert.StartsWith(Path.GetDirectoryName(body.SnapshotKey)!.Replace('\\', '/'), v.FilePath);
    }

    private static async Task CleanupUserAsync(AppDbContext db, Guid userId)
    {
        var analysisIds = await db.Analyses.Where(a => a.UserId == userId).Select(a => a.Id).ToListAsync();
        await db.Verdicts.Where(v => analysisIds.Contains(v.AnalysisId)).ExecuteDeleteAsync();
        var convoIds = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
        await db.CoachMessages.Where(m => convoIds.Contains(m.ConversationId)).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        var songIds = await db.Songs.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync();
        var versionIds = await db.SongVersions.Where(v => songIds.Contains(v.SongId)).Select(v => v.Id).ToListAsync();
        await db.RackPresets.Where(p => versionIds.Contains(p.SongVersionId)).ExecuteDeleteAsync();
        await db.SongVersions.Where(v => songIds.Contains(v.SongId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // The class deletes its own snapshot-directory objects (and every DB row
    // its tests created) after each test — never touches the shared canonical
    // demo audio/report, and always writes under a per-test-run
    // audio/demo/test-snapshots/<guid>/ prefix, never the real installed
    // audio/demo/snapshot/.
    public void Dispose()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        TestAuth.AllowPurgeAsync(db).GetAwaiter().GetResult();

        if (_dir is not null)
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            storage.DeleteAsync(_dir + "snapshot.json").GetAwaiter().GetResult();
            storage.DeleteAsync(_dir + "source.wav").GetAwaiter().GetResult();
        }
        if (_versionIds.Count > 0)
        {
            var targets = _versionIds.Select(v => v.ToString()).ToList();
            db.AuditLogs.Where(a => targets.Contains(a.Target)).ExecuteDeleteAsync().GetAwaiter().GetResult();
        }
        foreach (var userId in _userIds)
            CleanupUserAsync(db, userId).GetAwaiter().GetResult();
    }
}
