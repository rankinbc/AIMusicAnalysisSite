using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G1 — guests get stems, .als, a reference, delete and retry under caps;
// guest data lives 24 hours (spec G-D5/G-D7). Shares the "DemoAuth"
// collection with the other demo-auth suites — they all read/count the
// SHARED users.is_guest rows and must not run in parallel with each other.
[Collection("DemoAuth")]
public sealed class GuestAllowancesTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingQueue : IJobQueue
    {
        public readonly List<(string Task, string Queue)> Sent = [];
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default)
        { Sent.Add((t, "")); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default)
        { Sent.Add((t, q)); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default)
        { Sent.Add((t, q)); return Task.CompletedTask; }
    }

    private WebApplicationFactory<Program> Build(RecordingQueue? queue = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue ?? new RecordingQueue());
            });
        });

    private static async Task<(HttpClient Client, DemoStartResponse Demo)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body);
    }

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // ── caps ──────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task The_Analysis_Cap_Counts_Analyses_Not_Uploads()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, demo) = await StartGuestAsync(f);
        try
        {
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                for (var i = 0; i < 6; i++)
                    db.UsageEvents.Add(new UsageEvent { UserId = demo.User.Id, EventType = "analysis",
                        BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"), Reference = Guid.NewGuid().ToString() });
                await db.SaveChangesAsync();
            }
            var resp = await client.PostAsync($"/api/versions/{demo.Demo.VersionId}/analyze", null);
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(403, (int)resp.StatusCode);
            Assert.Equal("analysis_limit", body.GetProperty("error").GetProperty("details").GetProperty("reason").GetString());
        }
        finally { await CleanupAsync(f, demo.User.Id); }
    }

    [SkippableFact]
    public async Task Stems_Are_Capped_By_Count_And_By_Size()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); using var scope = f.Services.CreateScope();
        var limits = scope.ServiceProvider.GetRequiredService<GuestLimits>();
        const long MB = 1024 * 1024;
        Assert.Null(await limits.CheckStemsAsync(0, 0, addFiles: 12, addBytes: 300 * MB, default));
        Assert.NotNull(await limits.CheckStemsAsync(10, 0, addFiles: 3, addBytes: MB, default));        // 13 files
        Assert.NotNull(await limits.CheckStemsAsync(0, 299 * MB, addFiles: 1, addBytes: 2 * MB, default)); // 301 MB
    }

    [Theory]
    [InlineData("guest_analyses_max", "6")] [InlineData("guest_stems_max_files", "12")]
    [InlineData("guest_stems_max_mb", "300")] [InlineData("guest_references_max", "1")]
    [InlineData("guest_track_max_seconds", "720")]
    public void The_Migration_Seeds_The_New_Flags(string name, string value)
    {
        var sql = string.Join(" ", new Spectr.Data.Migrations.SeedGuestFirstUploadFlags().UpOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Matches($@"'{name}'\s*,\s*'{value}'", sql);
    }

    [Theory]
    [InlineData("guest_ttl_hours", "24", "72")] [InlineData("guest_uploads_max", "2", "1")]
    [InlineData("llm_budget_guest_usd", "30", "5")]
    public void Value_Changes_Never_Overwrite_An_Operators_Tuning(string name, string to, string from)
    {
        var sql = string.Join(" ", new Spectr.Data.Migrations.SeedGuestFirstUploadFlags().UpOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Matches($@"UPDATE feature_flags SET value\s*=\s*'{to}'[^;]*WHERE name\s*=\s*'{name}'\s+AND value\s*=\s*'{from}'", sql);
    }

    // ── the second reference upload trips CheckReferenceAsync (same style as
    // The_Analysis_Cap_Counts_Analyses_Not_Uploads) — needs the POST
    // /api/references/ marker from step 5, so it lives here rather than with
    // the other cap tests above. ────────────────────────────────────────────

    [SkippableFact]
    public async Task The_Second_Guest_Reference_Upload_Is_403_Restricted()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, demo) = await StartGuestAsync(f);
        try
        {
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.ReferenceTracks.Add(new ReferenceTrack { UserId = demo.User.Id, Title = "Seeded ref" });
                await db.SaveChangesAsync();
            }

            var form = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
            form.Add(fileContent, "file", "second-ref.wav");
            var resp = await client.PostAsync("/api/references/", form);
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(403, (int)resp.StatusCode);
            Assert.Equal("guest_restricted", body.GetProperty("error").GetProperty("code").GetString());
            Assert.Equal("reference_limit", body.GetProperty("error").GetProperty("details").GetProperty("reason").GetString());
        }
        finally { await CleanupAsync(f, demo.User.Id); }
    }

    // ── step 3's allowance tests: the NowOpen / StillClosed route lists ─────

    public static TheoryData<string, string> NowOpen => new()
    {
        { "DELETE", "/api/versions/{id}" }, { "POST", "/api/versions/{id}/stems/stage" },
        { "POST", "/api/versions/{id}/stems/stage-keys" }, { "POST", "/api/versions/{id}/stems/classify" },
        { "POST", "/api/versions/{id}/stems/confirm" }, { "POST", "/api/versions/{id}/als" },
        { "POST", "/api/versions/{id}/als-key" }, { "POST", "/api/uploads/attachments/init" },
        { "POST", "/api/references/" }, { "POST", "/api/references/complete-key" },
        { "POST", "/api/references/{id}/analyze" }, { "DELETE", "/api/references/{id}" },
        { "DELETE", "/api/songs/{id}" }, { "POST", "/api/songs/{id}/restore" }, { "POST", "/api/jobs/{id}/retry" },
    };
    public static TheoryData<string, string> StillClosed => new()
    {
        { "DELETE", "/api/songs/{id}/permanent" }, { "POST", "/api/songs/" },
        { "POST", "/api/reports/{id}/phases/4/rerun" }, { "POST", "/api/versions/{id}/stems" },
        { "POST", "/api/me/delete" }, { "GET", "/api/me/export" },
    };

    private static async Task<(int Status, string? Code)> SendAsync(HttpClient c, string method, string path)
    {
        var req = new HttpRequestMessage(new HttpMethod(method), path.Replace("{id}", Guid.NewGuid().ToString()));
        if (method != "GET" && method != "DELETE") req.Content = JsonContent.Create(new { });
        var resp = await c.SendAsync(req);
        string? code = null;
        try { code = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetProperty("code").GetString(); } catch { }
        return ((int)resp.StatusCode, code);
    }

    [SkippableTheory, MemberData(nameof(NowOpen))]
    public async Task A_Guest_Reaches_The_Handler(string method, string path)
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, demo) = await StartGuestAsync(f);
        try
        {
            var (_, code) = await SendAsync(client, method, path);
            Assert.NotEqual("guest_restricted", code); // 400/404/415 from the handler are all fine — the GUARD let it through
        }
        finally { await CleanupAsync(f, demo.User.Id); }
    }

    [SkippableTheory, MemberData(nameof(StillClosed))]
    public async Task A_Guest_Is_Still_Refused(string method, string path)
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, demo) = await StartGuestAsync(f);
        try
        {
            var (status, code) = await SendAsync(client, method, path);
            Assert.Equal(403, status); Assert.Equal("guest_restricted", code);
        }
        finally { await CleanupAsync(f, demo.User.Id); }
    }
}
