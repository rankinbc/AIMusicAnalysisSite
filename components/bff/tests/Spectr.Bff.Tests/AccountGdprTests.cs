using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 4.6 — export shape, deletion flow (re-auth, AC3 gate, audit,
// enqueue), and JWT token-versioning.
public sealed class AccountGdprTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private sealed class RecordingQueue : IJobQueue
    {
        public ConcurrentQueue<(string Task, object[] Args, string Queue)> Calls { get; } = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
        { Calls.Enqueue((taskName, args, DramatiqQueues.Default)); return Task.CompletedTask; }

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        { Calls.Enqueue((taskName, args, queueName)); return Task.CompletedTask; }

        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        { Calls.Enqueue((taskName, args, queueName)); return Task.CompletedTask; }
    }

    [Fact]
    public async Task Export_Contains_All_Six_Categories_And_Manifest()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var jobId = Guid.NewGuid();
        var analysisId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AnalysisJobs.Add(new AnalysisJob
            { Id = jobId, UserId = userId, VersionId = versionId, Status = "complete" });
            db.Analyses.Add(new Analysis
            {
                Id = analysisId, JobId = jobId, UserId = userId, VersionId = versionId,
                SongId = songId, SongName = "Export Me", FinalJson = """{"grade":"A"}""",
            });
            var conv = new Conversation { AnalysisId = analysisId, UserId = userId };
            db.Conversations.Add(conv);
            db.CoachMessages.Add(new CoachMessage
            { ConversationId = conv.Id, Role = "user", Content = "hello coach" });
            await db.SaveChangesAsync();
        }

        try
        {
            var resp = await client.GetAsync("/api/me/export");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();

            Assert.Equal("spectr-export/v1", body.GetProperty("format").GetString());
            Assert.Equal(userId, body.GetProperty("account").GetProperty("id").GetGuid());
            Assert.Contains(body.GetProperty("songs").EnumerateArray(),
                s => s.GetProperty("id").GetGuid() == songId);
            Assert.Contains(body.GetProperty("versions").EnumerateArray(),
                v => v.GetProperty("id").GetGuid() == versionId);
            Assert.Contains(body.GetProperty("reports").EnumerateArray(),
                r => r.GetProperty("id").GetGuid() == analysisId);
            Assert.True(body.TryGetProperty("verdicts", out _));
            var conv = Assert.Single(body.GetProperty("conversations").EnumerateArray());
            Assert.Contains(conv.GetProperty("messages").EnumerateArray(),
                m => m.GetProperty("content").GetString() == "hello coach");
            // Manifest lists the version's storage key.
            Assert.Contains(body.GetProperty("mediaManifest").EnumerateArray(),
                m => (m.GetProperty("key").GetString() ?? "").Length > 0);
        }
        finally
        {
            await CleanupContentAsync(userId);
        }
    }

    [Fact]
    public async Task Delete_Requires_Password_And_Subscription_Confirmation()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var queue = new RecordingQueue();
        var stripe = new FakeStripe();
        using var f = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s =>
            {
                s.AddSingleton<IJobQueue>(queue);
                s.AddSingleton<IStripeSubscriptionClient>(stripe);
            }));
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        try
        {
            // Wrong password → 403 (NOT 401: the fetcher auto-refresh-retries
            // 401s — a destructive POST must never be silently replayed).
            var wrong = await client.PostAsJsonAsync("/api/me/delete", new { password = "nope-wrong" });
            Assert.Equal(HttpStatusCode.Forbidden, wrong.StatusCode);

            // Active subscription without confirmCancel → 409 explanation.
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Subscriptions.Add(new Subscription
                {
                    UserId = userId, Status = "active",
                    CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(10),
                    PriceId = "price_test", StripeCustomerId = $"cus_{userId:N}",
                    StripeSubscriptionId = $"sub_{userId:N}",
                });
                await db.SaveChangesAsync();
            }
            var blocked = await client.PostAsJsonAsync("/api/me/delete",
                new { password = TestAuth.Password });
            Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
            Assert.Contains("subscription_active", await blocked.Content.ReadAsStringAsync());

            // With confirmCancel → deletion proceeds.
            var ok = await client.PostAsJsonAsync("/api/me/delete",
                new { password = TestAuth.Password, confirmCancel = true });
            Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.False(await db.Users.AnyAsync(u => u.Id == userId));           // user row gone
                Assert.True(await db.AuditLogs.AnyAsync(a =>
                    a.ActorUserId == userId && a.Action == "account_delete"));         // AC4
                Assert.False(await db.RefreshTokens.AnyAsync(t => t.UserId == userId));
                // Billing rows RETAINED per policy.
                Assert.True(await db.Subscriptions.AnyAsync(s2 => s2.UserId == userId));
            }
            Assert.Contains(queue.Calls, c =>
                c.Task == DramatiqTasks.DeleteAccountData
                && c.Queue == DramatiqQueues.Maintenance
                && (string)c.Args[0] == userId.ToString());
            Assert.Equal($"sub_{userId:N}", stripe.LastCanceled); // immediate cancel fired

            // The DELETED user's access token is dead immediately (tver row
            // gone + same-process cache evict) — the 4.6 token-versioning
            // covers deletion, not just password reset.
            var ghost = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            ghost.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().SendAsync(ghost)).StatusCode);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
            await TestAuth.AllowPurgeAsync(db);
            await db.AuditLogs.Where(a => a.ActorUserId == userId).ExecuteDeleteAsync();
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Password_Reset_Kills_Outstanding_Access_Tokens()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // 4.3's recorded gap, closed by 4.6 token-versioning: the OLD access
        // token dies as soon as the version bumps (instant same-process).
        var email = new RecordingEmailSenderLocal();
        using var f = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email)));
        var client = f.CreateClient();
        var address = $"tver+{Guid.NewGuid():N}@spectr.test";

        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "OldPassword9!" });
        reg.EnsureSuccessStatusCode();
        var oldAccess = (await reg.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("accessToken").GetString();

        // Old token works now.
        var me1 = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        me1.Headers.Authorization = new AuthenticationHeaderValue("Bearer", oldAccess);
        Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().SendAsync(me1)).StatusCode);

        // Reset the password (forgot → token → reset).
        await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = address });
        string? resetToken = null;
        for (var i = 0; i < 50 && resetToken is null; i++)
        {
            var mail = email.Sent.FirstOrDefault(s => s.Template == EmailTemplates.Reset);
            if (mail.Template is not null)
                resetToken = System.Text.RegularExpressions.Regex
                    .Match(mail.Data["resetUrl"], @"token=([A-Za-z0-9_\-]+)").Groups[1].Value;
            else await Task.Delay(100);
        }
        Assert.NotNull(resetToken);
        var reset = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token = resetToken, newPassword = "NewPassword9!" });
        reset.EnsureSuccessStatusCode();

        // The OLD access token is now dead (tver mismatch) — 401, well
        // before its 15-minute natural expiry.
        var me2 = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        me2.Headers.Authorization = new AuthenticationHeaderValue("Bearer", oldAccess);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().SendAsync(me2)).StatusCode);

        // A fresh login issues a working token with the new version.
        var login = await client.PostAsJsonAsync("/api/auth/login",
            new { email = address, password = "NewPassword9!" });
        var newAccess = (await login.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>())
            .GetProperty("accessToken").GetString();
        var me3 = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        me3.Headers.Authorization = new AuthenticationHeaderValue("Bearer", newAccess);
        Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().SendAsync(me3)).StatusCode);
    }

    private sealed class FakeStripe : IStripeSubscriptionClient
    {
        public string? LastCanceled { get; private set; }

        public Task CancelImmediatelyAsync(string subscriptionId, Guid userId, CancellationToken ct)
        { LastCanceled = subscriptionId; return Task.CompletedTask; }

        public Task<Stripe.Subscription> UpdateAsync(string s, Stripe.SubscriptionUpdateOptions o, string k, CancellationToken ct)
            => throw new NotImplementedException();
        public Task<Stripe.BillingPortal.Session> CreatePortalSessionAsync(Stripe.BillingPortal.SessionCreateOptions o, string k, CancellationToken ct)
            => throw new NotImplementedException();
        public Task<Stripe.Subscription?> GetSubscriptionAsync(string s, CancellationToken ct)
            => Task.FromResult<Stripe.Subscription?>(null);
        public Task<Stripe.Price?> GetPriceAsync(string p, CancellationToken ct)
            => Task.FromResult<Stripe.Price?>(null);
    }

    private sealed class RecordingEmailSenderLocal : IEmailSender
    {
        public ConcurrentQueue<(string To, string Template, IReadOnlyDictionary<string, string> Data)> Sent { get; } = new();

        public Task SendAsync(string toEmail, string template,
            IReadOnlyDictionary<string, string> data, CancellationToken ct = default)
        {
            Sent.Enqueue((toEmail, template, data));
            return Task.CompletedTask;
        }
    }

    private async Task CleanupContentAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.CoachMessages.Where(m => db.Conversations.Any(c => c.Id == m.ConversationId && c.UserId == userId)).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
    }
}
