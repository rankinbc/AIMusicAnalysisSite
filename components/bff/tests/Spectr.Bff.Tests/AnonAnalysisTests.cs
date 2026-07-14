using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 6.3 — the anonymous instant-analysis vertical: device-cookie upload,
// song-less job rows (XOR ownership), device-scoped poll/results, one-active
// guard, and the 4.5 claim re-parenting making the authed endpoints serve the
// job after registration.
public sealed class AnonAnalysisTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // The spectr_device cookie is Secure=true (repo cookie policy; browsers
    // allow Secure on localhost but HttpClient's CookieContainer drops it over
    // http). 4-1 precedent: HandleCookies=false + manual Cookie header.
    private HttpClient Client() => _factory.CreateClient(
        new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static void CarryDeviceCookie(HttpResponseMessage from, HttpClient to)
    {
        var setCookie = from.Headers.TryGetValues("Set-Cookie", out var vals)
            ? vals.FirstOrDefault(v => v.StartsWith("spectr_device=", StringComparison.Ordinal))
            : null;
        Assert.NotNull(setCookie);
        var pair = setCookie!.Split(';')[0];
        to.DefaultRequestHeaders.Remove("Cookie");
        to.DefaultRequestHeaders.Add("Cookie", pair);
    }

    private static MultipartFormDataContent Wav(string name = "tone.wav")
    {
        // Tiny RIFF/WAVE header + silence — enough for extension + magic bytes;
        // no worker runs in these tests so the content is never decoded.
        var bytes = new byte[128];
        "RIFF"u8.ToArray().CopyTo(bytes, 0);
        "WAVEfmt "u8.ToArray().CopyTo(bytes, 8);
        var content = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes);
        part.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
        content.Add(part, "file", name);
        return content;
    }

    private async Task CleanupDeviceAsync(string deviceId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.Analyses.Where(a => a.DeviceId == deviceId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.DeviceId == deviceId).ExecuteDeleteAsync();
        await db.Devices.Where(d => d.Id == deviceId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Anon_Upload_Creates_Songless_Device_Job_And_Is_Pollable()
    {
        await TestDb.RequireAsync(_factory);
        var client = Client();

        var resp = await client.PostAsync("/api/anon/analyses", Wav());
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        CarryDeviceCookie(resp, client);
        var jobId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("jobId").GetGuid();

        string deviceId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var job = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.Null(job.UserId);
            Assert.Null(job.VersionId);
            Assert.NotNull(job.DeviceId);
            Assert.NotNull(job.FilePath);
            Assert.StartsWith($"audio/anon/{job.DeviceId}/{jobId}/", job.FilePath);
            deviceId = job.DeviceId!;
        }

        try
        {
            // Device-scoped poll works with the cookie...
            var status = await client.GetAsync($"/api/anon/jobs/{jobId}");
            Assert.Equal(HttpStatusCode.OK, status.StatusCode);

            // ...and jobs/current restores the same job (AC5).
            var current = await client.GetAsync("/api/anon/jobs/current");
            Assert.Equal(HttpStatusCode.OK, current.StatusCode);
            var currentId = (await current.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("jobId").GetGuid();
            Assert.Equal(jobId, currentId);

            // A DIFFERENT device (fresh client, no cookie) sees nothing.
            var stranger = Client();
            Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/anon/jobs/{jobId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/anon/jobs/{jobId}/results")).StatusCode);

            // One ACTIVE analysis per device — second upload 409s with the code.
            var second = await client.PostAsync("/api/anon/analyses", Wav("two.wav"));
            await TestContract.AssertEnvelopeAsync(second, HttpStatusCode.Conflict, "anon_active_analysis");
        }
        finally
        {
            await CleanupDeviceAsync(deviceId);
        }
    }

    [SkippableFact]
    public async Task Anon_Results_Serve_Device_Analysis_And_Claim_Reparents_To_Authed_Endpoints()
    {
        await TestDb.RequireAsync(_factory);
        var client = Client();

        var resp = await client.PostAsync("/api/anon/analyses", Wav());
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        CarryDeviceCookie(resp, client);
        var jobId = (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("jobId").GetGuid();

        string deviceId;
        Guid? userId = null;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var job = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            deviceId = job.DeviceId!;
            // Simulate the worker completing the song-less job (XOR: device-owned).
            db.Analyses.Add(new Analysis
            {
                Id = Guid.NewGuid(),
                JobId = jobId,
                DeviceId = deviceId,
                UserId = null,
                FinalJson = """{"grade":"C","overall_score":63.0,"phases":[]}""",
            });
            await db.AnalysisJobs.Where(j => j.Id == jobId)
                .ExecuteUpdateAsync(s => s.SetProperty(j => j.Status, "complete"));
            await db.SaveChangesAsync();
        }

        try
        {
            // Anon results readable with the device cookie.
            var results = await client.GetAsync($"/api/anon/jobs/{jobId}/results");
            Assert.Equal(HttpStatusCode.OK, results.StatusCode);
            var body = await results.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("C", body.GetProperty("finalJson").GetProperty("grade").GetString());

            // Register on the SAME client — the device cookie rides the POST and
            // the 4.5 claim re-parents the rows. The AUTHED endpoints then serve them.
            var (uid, token) = await TestAuth.RegisterAsync(client);
            userId = uid;
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            var authedStatus = await client.GetAsync($"/api/jobs/{jobId}");
            Assert.Equal(HttpStatusCode.OK, authedStatus.StatusCode);
            var authedResults = await client.GetAsync($"/api/jobs/{jobId}/results");
            Assert.Equal(HttpStatusCode.OK, authedResults.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var job = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.Equal(uid, job.UserId);
            Assert.Null(job.DeviceId); // XOR restored to user ownership
        }
        finally
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db);
            await db.Analyses.Where(a => a.JobId == jobId).ExecuteDeleteAsync();
            await db.AnalysisJobs.Where(j => j.Id == jobId).ExecuteDeleteAsync();
            await db.Devices.Where(d => d.Id == deviceId).ExecuteDeleteAsync();
            if (userId is Guid u)
            {
                await db.RefreshTokens.Where(t => t.UserId == u).ExecuteDeleteAsync();
                await db.Songs.Where(s => s.UserId == u).ExecuteDeleteAsync();
                await db.Users.Where(x => x.Id == u).ExecuteDeleteAsync();
            }
        }
    }

    [SkippableFact]
    public async Task Anon_Upload_Rejects_Non_Audio_With_Code()
    {
        await TestDb.RequireAsync(_factory);
        var client = Client();
        var content = new MultipartFormDataContent();
        var part = new ByteArrayContent(new byte[16]);
        content.Add(part, "file", "notes.txt");
        var resp = await client.PostAsync("/api/anon/analyses", content);
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.BadRequest, "invalid_file");
    }
}
