using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using StackExchange.Redis;
using Xunit;

namespace Spectr.Bff.Tests;

// Fix wave FW3 (final review I3, BFF half):
//   - closing the page never cancels a BRIEF (the SSE disconnect must not set
//     coach:cancel:{id} for a mode=brief row; a normal reply still does);
//   - brief re-enqueues are capped at 3 per conversation (Redis INCR), and a
//     Redis failure on that counter answers `exists` (fail closed).
[Collection("DemoAuth")]
public sealed class CoachBriefRobustnessTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private (WebApplicationFactory<Program> F, CoachBriefTests.RecordingJobQueue Q) Build(
        IConnectionMultiplexer? redis = null)
    {
        var queue = new CoachBriefTests.RecordingJobQueue();
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue);
                if (redis is not null)
                {
                    s.RemoveAll<IConnectionMultiplexer>();
                    s.AddSingleton(redis);
                }
            });
        });
        return (f, queue);
    }

    private static async Task MarkErrorAsync(WebApplicationFactory<Program> f, Guid messageId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.CoachMessages.Where(m => m.Id == messageId).ExecuteUpdateAsync(s => s
            .SetProperty(m => m.Status, "error")
            .SetProperty(m => m.Content, "The coach hit a transient error. Please try again.")
            .SetProperty(m => m.CompletedAt, DateTimeOffset.UtcNow));
    }

    [SkippableFact]
    public async Task Brief_Retries_Are_Capped_At_Three_Per_Conversation()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = Build();
        var (client, userId) = await CoachBriefTests.RegisterRealUserAsync(f);
        var analysisId = await CoachBriefTests.SeedAnalysisAsync(f, userId);
        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Single(queue.Calls);

            var statuses = new List<string>();
            for (var i = 0; i < 4; i++)
            {
                await MarkErrorAsync(f, first!.MessageId!.Value);
                var r = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                    .Content.ReadFromJsonAsync<CoachBriefResponse>();
                statuses.Add(r!.Status);
            }

            Assert.Equal(new[] { "retried", "retried", "retried", "exists" }, statuses);
            Assert.Equal(1 + 3, queue.Calls.Count);
        }
        finally { await CoachBriefTests.CleanupUser(f, userId); }
    }

    [SkippableFact]
    public async Task A_Redis_Failure_On_The_Retry_Counter_Answers_Exists()
    {
        await TestDb.RequireAsync(factory);
        // A real multiplexer pointed at a closed port: every command throws.
        using var dead = await ConnectionMultiplexer.ConnectAsync(
            "127.0.0.1:1,abortConnect=false,connectTimeout=200,syncTimeout=500,asyncTimeout=500");
        var (f, queue) = Build(dead);
        var (client, userId) = await CoachBriefTests.RegisterRealUserAsync(f);
        var analysisId = await CoachBriefTests.SeedAnalysisAsync(f, userId);
        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Single(queue.Calls);
            await MarkErrorAsync(f, first!.MessageId!.Value);

            var r = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            Assert.Equal("exists", r!.Status);
            Assert.Single(queue.Calls);
        }
        finally { await CoachBriefTests.CleanupUser(f, userId); }
    }

    [SkippableTheory]
    [Trait("Category", "Slow")]
    [InlineData("brief", false)]
    [InlineData("qa", true)]
    public async Task Sse_Disconnect_Sets_The_Cancel_Key_Only_For_A_Non_Brief_Reply(string mode, bool expectKey)
    {
        await TestDb.RequireAsync(factory);
        using var mux = await ConnectionMultiplexer.ConnectAsync(
            TestDb.RedisEndpoint("abortConnect=false,connectTimeout=500"));
        TestDb.Require(mux.IsConnected, "Redis");
        var (f, _) = Build();
        var (client, userId) = await CoachBriefTests.RegisterRealUserAsync(f);
        var analysisId = await CoachBriefTests.SeedAnalysisAsync(f, userId);
        Guid conversationId, messageId;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conv = new Conversation { Id = Guid.NewGuid(), AnalysisId = analysisId, UserId = userId, CreatedAt = DateTimeOffset.UtcNow };
            var msg = new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conv.Id, Role = "assistant", Status = "pending",
                Content = "", Mode = mode, CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Conversations.Add(conv);
            db.CoachMessages.Add(msg);
            await db.SaveChangesAsync();
            (conversationId, messageId) = (conv.Id, msg.Id);
        }
        var cancelKey = $"coach:cancel:{messageId}";
        var channel = new RedisChannel($"coach:{conversationId}:{messageId}", RedisChannel.PatternMode.Literal);
        var sub = mux.GetSubscriber();
        try
        {
            using var cts = new CancellationTokenSource();
            var request = client.GetAsync($"/api/coach/{analysisId}/messages/{messageId}/stream",
                HttpCompletionOption.ResponseHeadersRead, cts.Token);
            var attached = false;
            for (var i = 0; i < 300 && !attached; i++)
            {
                attached = await sub.PublishAsync(channel, "{\"type\":\"token\",\"text\":\"w\"}") >= 1;
                if (!attached) await Task.Delay(50);
            }
            Assert.True(attached, "BFF subscriber never attached");

            cts.Cancel();
            try { await request; } catch { /* expected */ }

            // The handler's finally unsubscribes, THEN (maybe) sets the key —
            // wait for the unsubscribe, then give the SET a moment.
            for (var i = 0; i < 300 && await sub.PublishAsync(channel, "{}") >= 1; i++)
                await Task.Delay(50);
            var found = false;
            for (var i = 0; i < 20 && !found; i++)
            {
                found = await mux.GetDatabase().KeyExistsAsync(cancelKey);
                if (!found) await Task.Delay(50);
            }
            Assert.Equal(expectKey, found);
        }
        finally
        {
            await mux.GetDatabase().KeyDeleteAsync(cancelKey);
            await CoachBriefTests.CleanupUser(f, userId);
        }
    }
}
