using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 4.4 — analysis-complete poller: one email per completed job, deep
// link, opt-out respected, digest ledger dedupes; plus the password-changed
// notification and template renders.
public sealed class LifecycleEmailTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private sealed class RecordingEmailSender : IEmailSender
    {
        public ConcurrentQueue<(string To, string Template, IReadOnlyDictionary<string, string> Data)> Sent { get; } = new();

        public Task SendAsync(string toEmail, string template,
            IReadOnlyDictionary<string, string> data, CancellationToken ct = default)
        {
            Sent.Enqueue((toEmail, template, data));
            return Task.CompletedTask;
        }
    }

    private (LifecycleEmailScheduler Scheduler, RecordingEmailSender Email, WebApplicationFactory<Program> Factory)
        Build(LifecycleOptions? opts = null)
    {
        var email = new RecordingEmailSender();
        var f = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email)));
        var scheduler = new LifecycleEmailScheduler(
            f.Services.GetRequiredService<IServiceScopeFactory>(),
            Microsoft.Extensions.Options.Options.Create(opts ?? new LifecycleOptions()),
            f.Services.GetRequiredService<IConfiguration>(),
            NullLogger<LifecycleEmailScheduler>.Instance);
        return (scheduler, email, f);
    }

    private static async Task<(Guid UserId, Guid SongId, Guid JobId)> SeedCompletedAnalysisAsync(
        WebApplicationFactory<Program> f, string email, bool notify = true)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = Guid.NewGuid();
        var songId = Guid.NewGuid();
        var versionId = Guid.NewGuid();
        var jobId = Guid.NewGuid();
        db.Users.Add(new User
        {
            Id = userId, Email = email, HashedPassword = "x",
            NotifyAnalysisComplete = notify,
        });
        db.Songs.Add(new Song { Id = songId, UserId = userId, Name = "Neon Drift" });
        db.SongVersions.Add(new SongVersion
        {
            Id = versionId, SongId = songId, VersionNumber = 1, FilePath = "x.wav",
        });
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId, UserId = userId, VersionId = versionId,
            Status = "complete", CompletedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        });
        db.Analyses.Add(new Analysis
        {
            Id = Guid.NewGuid(), JobId = jobId, UserId = userId,
            VersionId = versionId, SongId = songId, SongName = "Neon Drift",
            FinalJson = "{}",
        });
        await db.SaveChangesAsync();
        return (userId, songId, jobId);
    }

    private static async Task CleanupAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Notifications.Where(n => n.RecipientUserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.SongVersions.Where(v => db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Completed_Analysis_Emails_Once_With_Deep_Link()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var address = $"lc+{Guid.NewGuid():N}@spectr.test";
        var (scheduler, email, f) = Build();
        var (userId, songId, jobId) = await SeedCompletedAnalysisAsync(f, address);
        try
        {
            var sent = await scheduler.RunOnceAsync(CancellationToken.None);
            Assert.True(sent >= 1);

            var mail = email.Sent.Single(s => s.To == address);
            Assert.Equal(EmailTemplates.AnalysisComplete, mail.Template);
            Assert.Equal("Neon Drift", mail.Data["songName"]);
            Assert.Contains($"/songs/{songId}/results/{jobId}", mail.Data["reportUrl"]);

            // Ledger row exists (doubles as the in-app notification).
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.True(await db.Notifications.AnyAsync(
                    n => n.DigestKey == $"analysis_complete:{jobId}"));
            }

            // Second sweep: no duplicate.
            await scheduler.RunOnceAsync(CancellationToken.None);
            Assert.Single(email.Sent, s => s.To == address);
        }
        finally
        {
            await CleanupAsync(f, userId);
        }
    }

    [Fact]
    public async Task Opted_Out_User_Gets_No_Email()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var address = $"lcoff+{Guid.NewGuid():N}@spectr.test";
        var (scheduler, email, f) = Build();
        var (userId, _, _) = await SeedCompletedAnalysisAsync(f, address, notify: false);
        try
        {
            await scheduler.RunOnceAsync(CancellationToken.None);
            Assert.DoesNotContain(email.Sent, s => s.To == address);
        }
        finally
        {
            await CleanupAsync(f, userId);
        }
    }

    [Fact]
    public async Task Password_Reset_Sends_Changed_Notification()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var email = new RecordingEmailSender();
        using var f = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email)));
        var client = f.CreateClient();
        var address = $"pc+{Guid.NewGuid():N}@spectr.test";

        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "OldPassword9!" });
        reg.EnsureSuccessStatusCode();
        await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = address });

        (string To, string Template, IReadOnlyDictionary<string, string> Data) resetMail = default;
        for (var i = 0; i < 50; i++)
        {
            resetMail = email.Sent.FirstOrDefault(s => s.Template == EmailTemplates.Reset);
            if (resetMail.Template is not null) break;
            await Task.Delay(100);
        }
        Assert.NotNull(resetMail.Template);
        var token = System.Text.RegularExpressions.Regex
            .Match(resetMail.Data!["resetUrl"], @"token=([A-Za-z0-9_\-]+)").Groups[1].Value;

        var reset = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "NewPassword9!" });
        reset.EnsureSuccessStatusCode();

        Assert.Contains(email.Sent, s =>
            s.Template == EmailTemplates.PasswordChanged && s.To == address);
    }

    [Fact]
    public void PasswordChanged_Template_Renders_Link_Free()
    {
        var (subject, html) = EmailTemplates.Render(
            EmailTemplates.PasswordChanged, new Dictionary<string, string>());
        Assert.Contains("password was changed", subject);
        Assert.DoesNotContain("<a ", html); // deliberately link-free (phishing hygiene)
    }

    [Fact]
    public void AnalysisComplete_Grade_Line_Is_Conditional()
    {
        var (_, withGrade) = EmailTemplates.Render(EmailTemplates.AnalysisComplete,
            new Dictionary<string, string>
            { ["songName"] = "T", ["grade"] = "A", ["reportUrl"] = "https://x" });
        Assert.Contains("Grade:", withGrade);

        var (_, withoutGrade) = EmailTemplates.Render(EmailTemplates.AnalysisComplete,
            new Dictionary<string, string>
            { ["songName"] = "T", ["reportUrl"] = "https://x" });
        Assert.DoesNotContain("Grade:", withoutGrade);
    }

    [Fact]
    public async Task Notify_Toggle_Roundtrips_Via_Patch_Me_Profile()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (_, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var initial = await client.GetFromJsonAsync<System.Text.Json.JsonElement>("/api/me/profile");
        Assert.True(initial.GetProperty("notifyAnalysisComplete").GetBoolean()); // default ON

        var patch = await client.PatchAsJsonAsync("/api/me/profile",
            new { notifyAnalysisComplete = false });
        patch.EnsureSuccessStatusCode();
        var after = await patch.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.False(after.GetProperty("notifyAnalysisComplete").GetBoolean());
    }
}
