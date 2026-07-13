using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 10.5 — elevated auth, billing trail, refunds, bans, flags, prompt
// pins, and the DB-enforced append-only audit trail.
public sealed class AdminEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Key = "test-admin-key-0123456789-0123456789";
    private readonly WebApplicationFactory<Program> _factory = factory;

    private WebApplicationFactory<Program> WithAdmin(out FakeRefunds refunds)
    {
        var r = new FakeRefunds();
        refunds = r;
        return _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", Key);
            b.ConfigureServices(s => s.AddSingleton<IStripeRefundClient>(r));
        });
    }

    private sealed class FakeRefunds : IStripeRefundClient
    {
        public string? LastIntent { get; private set; }
        public string IntentCustomer { get; set; } = "cus_test";

        public Task<Stripe.Refund> CreateRefundAsync(string paymentIntentId, CancellationToken ct)
        {
            LastIntent = paymentIntentId;
            return Task.FromResult(new Stripe.Refund { Id = $"re_{paymentIntentId}" });
        }

        public Task<string?> GetIntentCustomerIdAsync(string paymentIntentId, CancellationToken ct)
            => Task.FromResult<string?>(IntentCustomer);
    }

    private static HttpRequestMessage Req(HttpMethod m, string url, object? body = null, string? key = Key)
    {
        var req = new HttpRequestMessage(m, url);
        if (key is not null) req.Headers.Add("X-Admin-Key", key);
        if (body is not null) req.Content = JsonContent.Create(body);
        return req;
    }

    [SkippableFact]
    public async Task Admin_Surface_Is_Invisible_Unconfigured_And_Locked_With_Wrong_Key()
    {
        await TestDb.RequireAsync(_factory);

        // Unconfigured factory (no Admin:ApiKey) → 404, not 401: invisible.
        var bare = _factory.CreateClient();
        var hidden = await bare.SendAsync(Req(HttpMethod.Get, "/api/admin/audit", key: "anything"));
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);

        using var f = WithAdmin(out _);
        var client = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.SendAsync(Req(HttpMethod.Get, "/api/admin/audit", key: "wrong"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.SendAsync(Req(HttpMethod.Get, "/api/admin/audit", key: null))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await client.SendAsync(Req(HttpMethod.Get, "/api/admin/audit"))).StatusCode);
    }

    [SkippableFact]
    public async Task Billing_Trail_Resolves_By_Email_And_Shows_Ledger()
    {
        await TestDb.RequireAsync(_factory);

        using var f = WithAdmin(out _);
        var client = f.CreateClient();
        var (userId, _) = await TestAuth.RegisterAsync(client);
        string email;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            email = (await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId)).Email;
            db.CreditLedger.Add(new CreditLedgerEntry
            { Id = Guid.NewGuid(), UserId = userId, Amount = 5, Reason = "purchase", Reference = "pi_test" });
            await db.SaveChangesAsync();
        }

        try
        {
            var resp = await client.SendAsync(Req(HttpMethod.Get, $"/api/admin/users/{email}/billing"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
            Assert.Equal(userId, body.GetProperty("user").GetProperty("id").GetGuid());
            Assert.Equal(5, body.GetProperty("creditBalance").GetInt32());
            Assert.True(body.GetProperty("recentWebhookEvents").ValueKind == System.Text.Json.JsonValueKind.Array);
        }
        finally { await Cleanup(f, userId); }
    }

    [SkippableFact]
    public async Task Refund_Writes_Ledger_Adjustment_And_Audit_Row()
    {
        await TestDb.RequireAsync(_factory);

        using var f = WithAdmin(out var refunds);
        var client = f.CreateClient();
        var (userId, _) = await TestAuth.RegisterAsync(client);
        using (var seed = f.Services.CreateScope())
        {
            var db = seed.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(u => u.Id == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.StripeCustomerId, "cus_test"));
        }

        try
        {
            // Reason required.
            var noReason = await client.SendAsync(Req(HttpMethod.Post, "/api/admin/refunds",
                new { userId, credits = 1, reason = "" }));
            Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);

            // Credits bounded (the ledger is append-only — typos are forever).
            Assert.Equal(HttpStatusCode.BadRequest,
                (await client.SendAsync(Req(HttpMethod.Post, "/api/admin/refunds",
                    new { userId, credits = 2000000, reason = "fat finger" }))).StatusCode);

            // Ownership mismatch → 409, no refund issued.
            refunds.IntentCustomer = "cus_SOMEONE_ELSE";
            var mismatch = await client.SendAsync(Req(HttpMethod.Post, "/api/admin/refunds",
                new { userId, paymentIntentId = "pi_not_mine", reason = "wrong paste" }));
            Assert.Equal(HttpStatusCode.Conflict, mismatch.StatusCode);
            Assert.Null(refunds.LastIntent);
            refunds.IntentCustomer = "cus_test";

            var ok = await client.SendAsync(Req(HttpMethod.Post, "/api/admin/refunds",
                new { userId, credits = 2, paymentIntentId = "pi_double_charge", reason = "double charge #1234" }));
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            Assert.Equal("pi_double_charge", refunds.LastIntent);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entry = await db.CreditLedger.AsNoTracking()
                .SingleAsync(e => e.UserId == userId && e.Reason == "adjustment");
            Assert.Equal(2, entry.Amount);
            var audit = await db.AuditLogs.AsNoTracking()
                .SingleAsync(a => a.Action == "refund" && a.Target == userId.ToString());
            Assert.Equal(AdminEndpoints.OperatorActor, audit.ActorUserId);
            Assert.Contains("double charge", audit.Reason);
        }
        finally { await Cleanup(f, userId); }
    }

    [SkippableFact]
    public async Task Ban_Blocks_Login_Kills_Tokens_And_Audits_Unban_Restores()
    {
        await TestDb.RequireAsync(_factory);

        using var f = WithAdmin(out _);
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        string email;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            email = (await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId)).Email;
        }

        try
        {
            var ban = await client.SendAsync(Req(HttpMethod.Post, $"/api/admin/users/{userId}/ban",
                new { reason = "scripted abuse (J6)" }));
            Assert.Equal(HttpStatusCode.OK, ban.StatusCode);

            // Outstanding access token dies (tver bump + banned flag).
            var me = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            me.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().SendAsync(me)).StatusCode);

            // Login refused with the explicit code.
            var login = await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = TestAuth.Password });
            Assert.Equal(HttpStatusCode.Forbidden, login.StatusCode);
            Assert.Contains("account_banned", await login.Content.ReadAsStringAsync());

            // Double-ban → 409.
            Assert.Equal(HttpStatusCode.Conflict,
                (await client.SendAsync(Req(HttpMethod.Post, $"/api/admin/users/{userId}/ban",
                    new { reason = "again" }))).StatusCode);

            var unban = await client.SendAsync(Req(HttpMethod.Post, $"/api/admin/users/{userId}/unban",
                new { reason = "appeal accepted" }));
            Assert.Equal(HttpStatusCode.OK, unban.StatusCode);
            var login2 = await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = TestAuth.Password });
            Assert.Equal(HttpStatusCode.OK, login2.StatusCode);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.AuditLogs.AsNoTracking()
                .CountAsync(a => a.Target == userId.ToString() && (a.Action == "ban" || a.Action == "unban")) == 2);
        }
        finally { await Cleanup(f, userId); }
    }

    [SkippableFact]
    public async Task Flag_Change_Persists_Evicts_And_Audits_Prompt_Pin_Validates()
    {
        await TestDb.RequireAsync(_factory);

        using var f = WithAdmin(out _);
        var client = f.CreateClient();
        var flagName = $"test_flag_{Guid.NewGuid():N}";

        try
        {
            var put = await client.SendAsync(Req(HttpMethod.Put, $"/api/admin/flags/{flagName}",
                new { value = "42", reason = "load test knob" }));
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);

            // Prompt pin: unknown slug 404s; path-traversal version 400s.
            Assert.Equal(HttpStatusCode.NotFound,
                (await client.SendAsync(Req(HttpMethod.Put, "/api/admin/prompts/not_a_slug",
                    new { pinnedVersion = "1.0", reason = "x" }))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,
                (await client.SendAsync(Req(HttpMethod.Put, "/api/admin/prompts/low_end",
                    new { pinnedVersion = "../../etc/passwd", reason = "x" }))).StatusCode);
            var pin = await client.SendAsync(Req(HttpMethod.Put, "/api/admin/prompts/low_end",
                new { pinnedVersion = "1.2.0", reason = "regression rollback" }));
            Assert.Equal(HttpStatusCode.OK, pin.StatusCode);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal("42", (await db.FeatureFlags.AsNoTracking().SingleAsync(x => x.Name == flagName)).Value);
            Assert.Equal("1.2.0", (await db.PromptVersions.AsNoTracking().SingleAsync(p => p.Slug == "low_end")).PinnedVersion);
            Assert.True(await db.AuditLogs.AsNoTracking().AnyAsync(a => a.Target == $"feature_flags/{flagName}"));

            // Unpin (cleanup semantics double as the null-pin path).
            var unpin = await client.SendAsync(Req(HttpMethod.Put, "/api/admin/prompts/low_end",
                new { pinnedVersion = (string?)null, reason = "restore live" }));
            Assert.Equal(HttpStatusCode.OK, unpin.StatusCode);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.FeatureFlags.Where(x => x.Name == flagName).ExecuteDeleteAsync();
            await TestAuth.AllowPurgeAsync(db);
            await db.AuditLogs.Where(a => a.Target == $"feature_flags/{flagName}"
                || a.Target == "prompt_versions/low_end").ExecuteDeleteAsync();
        }
    }

    [SkippableFact]
    public async Task Audit_Log_Is_DbEnforced_AppendOnly()
    {
        await TestDb.RequireAsync(_factory);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = new AuditLog
        { ActorUserId = Guid.Empty, Action = "test_append_only", Target = "t", Reason = "r" };
        db.AuditLogs.Add(row);
        await db.SaveChangesAsync();

        try
        {
            // UPDATE and DELETE both die on the trigger.
            await Assert.ThrowsAnyAsync<Exception>(() =>
                db.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE audit_log SET reason = 'tampered' WHERE id = {row.Id}"));
            await Assert.ThrowsAnyAsync<Exception>(() =>
                db.Database.ExecuteSqlInterpolatedAsync(
                    $"DELETE FROM audit_log WHERE id = {row.Id}"));
        }
        finally
        {
            using var scope2 = _factory.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db2);
            await db2.AuditLogs.Where(a => a.Id == row.Id).ExecuteDeleteAsync();
        }
    }

    private static async Task Cleanup(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.AuditLogs.Where(a => a.Target == userId.ToString()).ExecuteDeleteAsync();
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }
}

