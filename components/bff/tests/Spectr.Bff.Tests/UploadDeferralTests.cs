using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Recording IJobQueue so we can assert exactly how many analysis jobs were
// dispatched without standing up a live Redis broker.
internal sealed class RecordingJobQueue : IJobQueue
{
    // Task name only — preserved for the existing ~8 assertions.
    public ConcurrentQueue<string> Calls { get; } = new();

    // Story 2.5: also capture the target queue so dispatch-routing tests can
    // assert tier → queue. The 2-arg overload records the implicit `default`.
    public ConcurrentQueue<(string Task, string Queue)> Enqueues { get; } = new();

    public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
    {
        Calls.Enqueue(taskName);
        Enqueues.Enqueue((taskName, DramatiqQueues.Default));
        return Task.CompletedTask;
    }

    public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
    {
        Calls.Enqueue(taskName);
        Enqueues.Enqueue((taskName, queueName));
        return Task.CompletedTask;
    }
}

// Verifies the unified-upload deferral flag: `analyze=false` creates the version
// (or attaches the .als) WITHOUT creating an AnalysisJob row or dispatching, while
// the default (field omitted) preserves the original analyze-on-upload behavior.
// Gated on Postgres like the other integration tests.
public sealed class UploadDeferralTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private (HttpClient client, RecordingJobQueue queue) NewClient()
    {
        var queue = new RecordingJobQueue();
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<IJobQueue>();
                s.AddSingleton<IJobQueue>(queue);
            });
        }).CreateClient();
        return (client, queue);
    }

    [Fact]
    public async Task UploadVersion_AnalyzeFalse_CreatesVersion_NoJob_NoDispatch()
    {
        if (!await PostgresReachable()) { return; }

        var (client, queue) = NewClient();
        await Authenticate(client);

        using var form = MixForm(analyze: false);
        var resp = await client.PostAsync("/api/versions/", form);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<UploadResponse>();
        Assert.NotNull(body);
        Assert.Null(body!.JobId);                     // deferred → no job id
        Assert.Empty(queue.Calls);                    // nothing dispatched
        Assert.Equal(0, await JobCount(body.VersionId)); // no AnalysisJob row
    }

    [Fact]
    public async Task UploadVersion_Default_DispatchesExactlyOneJob()
    {
        if (!await PostgresReachable()) { return; }

        var (client, queue) = NewClient();
        await Authenticate(client);

        using var form = MixForm(analyze: null); // omit field → defaults to true
        var resp = await client.PostAsync("/api/versions/", form);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<UploadResponse>();
        Assert.NotNull(body);
        Assert.NotNull(body!.JobId);
        Assert.Single(queue.Calls);
        Assert.Equal(DramatiqTasks.AnalyzeAudioJob, queue.Calls.First());
        Assert.Equal(1, await JobCount(body.VersionId));
    }

    [Fact]
    public async Task UploadAls_AnalyzeFalse_AttachesProject_NoJob_NoDispatch()
    {
        if (!await PostgresReachable()) { return; }

        var (client, queue) = NewClient();
        await Authenticate(client);

        // First create a version (deferred) to attach the .als to.
        using var mix = MixForm(analyze: false);
        var mixResp = await client.PostAsync("/api/versions/", mix);
        Assert.Equal(HttpStatusCode.OK, mixResp.StatusCode);
        var version = (await mixResp.Content.ReadFromJsonAsync<UploadResponse>())!;

        using var alsForm = AlsForm(analyze: false);
        var alsResp = await client.PostAsync($"/api/versions/{version.VersionId}/als", alsForm);
        Assert.Equal(HttpStatusCode.OK, alsResp.StatusCode);

        var als = await alsResp.Content.ReadFromJsonAsync<AlsUploadResponse>();
        Assert.NotNull(als);
        Assert.Null(als!.ReanalysisJobId);
        Assert.Empty(queue.Calls);
        Assert.Equal(0, await JobCount(version.VersionId));
    }

    [Fact]
    public async Task UploadAls_WithProjectJson_PersistsAlsProjectColumn()
    {
        if (!await PostgresReachable()) { return; }

        var (client, _) = NewClient();
        await Authenticate(client);

        using var mix = MixForm(analyze: false);
        var version = (await (await client.PostAsync("/api/versions/", mix))
            .Content.ReadFromJsonAsync<UploadResponse>())!;

        const string projectJson =
            "{\"schemaVersion\":1,\"source\":\"client-als-preview\",\"tempo\":128," +
            "\"tracks\":[{\"index\":0,\"name\":\"Kick\",\"type\":\"audio\",\"color\":13,\"devices\":[\"EQ Eight\"]}]}";
        using var alsForm = AlsForm(analyze: false);
        alsForm.Add(new StringContent(projectJson), "project_json");
        var resp = await client.PostAsync($"/api/versions/{version.VersionId}/als", alsForm);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var stored = await AlsProjectColumn(version.VersionId);
        Assert.NotNull(stored);
        using var doc = System.Text.Json.JsonDocument.Parse(stored!);
        Assert.Equal(128, doc.RootElement.GetProperty("tempo").GetInt32());
        Assert.Equal("Kick", doc.RootElement.GetProperty("tracks")[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task UploadAls_InvalidProjectJson_Returns400()
    {
        if (!await PostgresReachable()) { return; }

        var (client, _) = NewClient();
        await Authenticate(client);

        using var mix = MixForm(analyze: false);
        var version = (await (await client.PostAsync("/api/versions/", mix))
            .Content.ReadFromJsonAsync<UploadResponse>())!;

        using var alsForm = AlsForm(analyze: false);
        alsForm.Add(new StringContent("not-json"), "project_json");
        var resp = await client.PostAsync($"/api/versions/{version.VersionId}/als", alsForm);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);

        // The .als file write happens after validation, so the column stays null.
        Assert.Null(await AlsProjectColumn(version.VersionId));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static async Task Authenticate(HttpClient client)
    {
        var email = $"unified+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
    }

    private static MultipartFormDataContent MixForm(bool? analyze)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[1024]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", "unified-test.wav");
        if (analyze.HasValue)
            form.Add(new StringContent(analyze.Value ? "true" : "false"), "analyze");
        return form;
    }

    private static MultipartFormDataContent AlsForm(bool? analyze)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[256]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(fileContent, "file", "project.als");
        if (analyze.HasValue)
            form.Add(new StringContent(analyze.Value ? "true" : "false"), "analyze");
        return form;
    }

    private async Task<int> JobCount(Guid versionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.AnalysisJobs.CountAsync(j => j.VersionId == versionId);
    }

    private async Task<string?> AlsProjectColumn(Guid versionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.SongVersions
            .Where(v => v.Id == versionId)
            .Select(v => v.AlsProjectJson)
            .FirstOrDefaultAsync();
    }

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch
        {
            return false;
        }
    }
}
