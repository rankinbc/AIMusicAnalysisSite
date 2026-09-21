using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G3 — the demo snapshot exporter must never leak the coach brief's
// server-authored trigger row: not as a producer message in
// freeText.userMessages, and not in the exported conversation.messages
// array. Split from DemoSnapshotExportTests.cs (already ~580 lines) per the
// repo's file-size convention — reuses its internal-static plumbing.
public sealed class DemoSnapshotBriefExclusionTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IAsyncLifetime
{
    private readonly List<Guid> _userIds = [];
    private readonly List<Guid> _versionIds = [];
    private string? _dir;

    public Task InitializeAsync() => Task.CompletedTask;

    private WebApplicationFactory<Program> Build()
    {
        WebApplicationFactory<Program> f;
        (f, _dir) = DemoSnapshotExportTests.BuildFactory(factory, DemoSnapshotExportTests.Key);
        return f;
    }

    [SkippableFact]
    public async Task Export_Never_Includes_The_Hidden_Brief_Trigger_Row()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (_, analysisId, userId, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);

        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conversation = new Conversation { Id = Guid.NewGuid(), AnalysisId = analysisId, UserId = userId };
            db.Conversations.Add(conversation);
            var t0 = DateTimeOffset.UtcNow;

            // The hidden trigger row (CoachBriefEndpoints.Post's shape) —
            // must never surface anywhere in the export.
            db.CoachMessages.Add(new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conversation.Id, Role = "user", Status = "complete",
                Mode = CoachBrief.Mode, Content = CoachBrief.Instruction, CreatedAt = t0, CompletedAt = t0,
            });
            // The completed brief ANSWER is legitimate coach output and
            // SHOULD still export — only the trigger row is hidden.
            db.CoachMessages.Add(new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conversation.Id, Role = "assistant", Status = "complete",
                Mode = CoachBrief.Mode, Content = "Here's your opening brief: findings, fixes, top 3.",
                CreatedAt = t0.AddMilliseconds(1), CompletedAt = t0.AddMilliseconds(1),
            });
            // An ordinary follow-up so the export isn't trivially empty.
            db.CoachMessages.Add(new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conversation.Id, Role = "user", Status = "complete",
                Mode = "qa", Content = "Anything else?", CreatedAt = t0.AddSeconds(1), CompletedAt = t0.AddSeconds(1),
            });
            await db.SaveChangesAsync();
        }

        Guid versionId;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            versionId = (await db.Analyses.AsNoTracking().SingleAsync(x => x.Id == analysisId)).VersionId!.Value;
        }
        var r = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "g3 brief exclusion" });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<DemoSnapshotExportResponse>();

        // Never as a "user message" (freeText.userMessages).
        Assert.DoesNotContain(CoachBrief.Instruction, body!.FreeText.UserMessages);
        Assert.Equal(["Anything else?"], body.FreeText.UserMessages);

        // Two of the three seeded rows export (hidden trigger excluded) —
        // the completed brief ANSWER plus the ordinary follow-up.
        Assert.Equal(2, body.Messages);

        var (audioKey, imageKeys) = await DemoSnapshotExportTests.ReadAssetKeysAsync(f, _dir + "snapshot.json");
        if (audioKey is not null)
        {
            using var scope = f.Services.CreateScope();
            var storage = scope.ServiceProvider.GetRequiredService<Spectr.Bff.Services.IFileStorage>();
            await storage.DeleteAsync(audioKey);
            foreach (var k in imageKeys) await storage.DeleteAsync(k);
        }
    }

    public async Task DisposeAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);

        if (_dir is not null)
        {
            var storage = scope.ServiceProvider.GetRequiredService<Spectr.Bff.Services.IFileStorage>();
            await storage.DeleteAsync(_dir + "snapshot.json");
            await storage.DeleteAsync(_dir + "retired.json");
        }
        if (_versionIds.Count > 0)
        {
            var targets = _versionIds.Select(v => v.ToString()).ToList();
            await db.AuditLogs.Where(a => targets.Contains(a.Target)).ExecuteDeleteAsync();
        }
        foreach (var userId in _userIds)
            await DemoSnapshotSeedTests.CleanupAsync(factory, userId);
    }
}
