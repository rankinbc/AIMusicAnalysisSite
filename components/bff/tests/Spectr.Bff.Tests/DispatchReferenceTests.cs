using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story: user profile of reference tracks — integration tests for selecting a
// saved reference at dispatch time (POST /api/versions/{id}/analyze?referenceId=…)
// and for the setIds projection on ReferenceDto. Uses RecordingJobQueue (defined
// in UploadDeferralTests.cs) so Redis is not needed; skips when Postgres is down.
public sealed class DispatchReferenceTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch { return false; }
    }

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

    private static async Task<(HttpClient Client, Guid UserId)> AuthAsync(HttpClient client, string prefix)
    {
        var email = $"{prefix}+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private static async Task<Guid> CreateVersionAsync(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(new byte[1024]);
        file.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(file, "file", "ref-dispatch.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<UploadResponse>();
        return body!.VersionId;
    }

    private static async Task<Guid> CreateReferenceAsync(HttpClient client, string title = "Ref")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(new byte[1024]);
        file.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(file, "file", "reference.wav");
        form.Add(new StringContent(title), "title");
        var resp = await client.PostAsync("/api/references/", form);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var dto = await resp.Content.ReadFromJsonAsync<ReferenceDto>();
        return dto!.Id;
    }

    // ── Happy path: analyze?referenceId=<own ref> sets AnalysisJob.ReferenceId ─
    [Fact]
    public async Task Analyze_WithOwnReference_SetsReferenceIdOnJob()
    {
        if (!await PostgresReachable()) return;
        var (client, queue) = NewClient();
        await AuthAsync(client, "ref-own");
        var referenceId = await CreateReferenceAsync(client);
        var versionId = await CreateVersionAsync(client);

        var resp = await client.PostAsync($"/api/versions/{versionId}/analyze?referenceId={referenceId}", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.Single(queue.Calls);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.AnalysisJobs.AsNoTracking().FirstOrDefaultAsync(j => j.VersionId == versionId);
        Assert.NotNull(job);
        Assert.Equal(referenceId, job!.ReferenceId);
    }

    // ── IDOR: dispatching with another user's referenceId → 404, no job row ────
    [Fact]
    public async Task Analyze_WithOtherUsersReference_404_NoJob()
    {
        if (!await PostgresReachable()) return;

        // User A owns the reference.
        var (clientA, _) = NewClient();
        await AuthAsync(clientA, "ref-owner");
        var foreignReferenceId = await CreateReferenceAsync(clientA);

        // User B owns the version and tries to use A's reference.
        var (clientB, queueB) = NewClient();
        await AuthAsync(clientB, "ref-attacker");
        var versionId = await CreateVersionAsync(clientB);

        var resp = await clientB.PostAsync(
            $"/api/versions/{versionId}/analyze?referenceId={foreignReferenceId}", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("reference_not_found", body?.Error?.Code);
        Assert.Empty(queueB.Calls);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobCount = await db.AnalysisJobs.CountAsync(j => j.VersionId == versionId);
        Assert.Equal(0, jobCount);
    }

    // ── Back-compat: no referenceId → job dispatched with null ReferenceId ────
    [Fact]
    public async Task Analyze_NoReference_NullReferenceId()
    {
        if (!await PostgresReachable()) return;
        var (client, queue) = NewClient();
        await AuthAsync(client, "ref-none");
        var versionId = await CreateVersionAsync(client);

        var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.Single(queue.Calls);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.AnalysisJobs.AsNoTracking().FirstOrDefaultAsync(j => j.VersionId == versionId);
        Assert.NotNull(job);
        Assert.Null(job!.ReferenceId);
    }

    // ── setIds projection: a reference added to a set reports it on ReferenceDto ─
    [Fact]
    public async Task ListReferences_ProjectsSetMembership()
    {
        if (!await PostgresReachable()) return;
        var (client, _) = NewClient();
        await AuthAsync(client, "ref-sets");
        var referenceId = await CreateReferenceAsync(client);

        var setResp = await client.PostAsJsonAsync("/api/reference-sets/", new { name = "House refs", hue = 200 });
        Assert.Equal(HttpStatusCode.Created, setResp.StatusCode);
        var set = await setResp.Content.ReadFromJsonAsync<ReferenceSetDto>();
        Assert.NotNull(set);

        var addResp = await client.PostAsJsonAsync(
            $"/api/reference-sets/{set!.Id}/members", new { referenceId });
        Assert.Equal(HttpStatusCode.NoContent, addResp.StatusCode);

        var list = await client.GetFromJsonAsync<List<ReferenceDto>>("/api/references/");
        Assert.NotNull(list);
        var dto = list!.Single(x => x.Id == referenceId);
        Assert.Contains(set.Id, dto.SetIds);
    }

    private sealed class ErrorEnvelopeBody
    {
        public ErrorEnvelopeError? Error { get; set; }
    }
    private sealed class ErrorEnvelopeError
    {
        public string? Code { get; set; }
        public string? Message { get; set; }
    }
}
