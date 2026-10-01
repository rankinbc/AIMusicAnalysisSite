using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SpecialistChargeTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> f = baseFactory.WithWebHostBuilder(b =>
        b.UseSetting("Credits:Prices:Specialist", "15"));

    private async Task<(HttpClient C, Guid Uid, Guid JobId, Guid AnalysisId)> SeedAsync(int grant)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        var analysisId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = uid, Status = "complete", Tier = "credits" });
        db.Analyses.Add(new Analysis
        {
            Id = analysisId, JobId = jobId, UserId = uid, FinalJson = "{}",
            RoutingPlan = "{\"specialists_to_run\":[{\"name\":\"low_end\",\"priority\":1,\"focus\":\"x\"}],\"skip\":[],\"rationale\":\"r\",\"estimated_total_tokens\":1}",
        });
        await db.SaveChangesAsync();
        await scope.ServiceProvider.GetRequiredService<CreditLedgerService>()
            .GrantSignupBonusAsync(uid, grant, CancellationToken.None);
        return (client, uid, jobId, analysisId);
    }

    private async Task<int> BalanceAsync(Guid uid)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        var analysisIds = await db.Analyses.Where(a => a.UserId == userId).Select(a => a.Id).ToListAsync();
        await db.Verdicts.Where(v => analysisIds.Contains(v.AnalysisId)).ExecuteDeleteAsync();
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Routed_Specialist_Is_Free()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, _) = await SeedAsync(100);
        try
        {
            Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/reports/{jobId}/verdicts/run/low_end", null)).StatusCode);
            Assert.Equal(100, await BalanceAsync(uid));
        }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Extra_Specialist_Costs_15_Once_Even_When_Posted_Twice()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, _) = await SeedAsync(100);
        try
        {
            await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
            await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
            Assert.Equal(85, await BalanceAsync(uid));
        }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Extra_Specialist_Without_Credits_Returns_402()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, _) = await SeedAsync(10);
        try
        {
            var resp = await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
            await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.PaymentRequired, "insufficient_credits");
        }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Failed_Specialist_Is_Refunded_When_Verdicts_Are_Listed()
    {
        await TestDb.RequireAsync(f);
        var (c, uid, jobId, analysisId) = await SeedAsync(100);
        try
        {
            await c.PostAsync($"/api/reports/{jobId}/verdicts/run/dynamics", null);
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Verdicts.Add(TestVerdicts.FailMarker(analysisId, "dynamics"));
                await db.SaveChangesAsync();
            }
            await c.GetAsync($"/api/reports/{jobId}/verdicts");
            await c.GetAsync($"/api/reports/{jobId}/verdicts");
            Assert.Equal(100, await BalanceAsync(uid));
        }
        finally { await CleanupAsync(uid); }
    }
}
