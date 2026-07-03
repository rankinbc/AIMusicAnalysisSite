using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 10.1 — /healthz smoke surface + boot-migrator behavior.
public sealed class DeployTopologyTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Healthz_Reports_Ok_When_Dependencies_Are_Up()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var resp = await _factory.CreateClient().GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task BootMigrator_Is_A_NoOp_On_A_Migrated_Schema_And_Reruns_Safely()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // The dev DB is at head — both passes must be clean no-ops, and the
        // advisory lock must be acquired/released without deadlocking the
        // second pass (the multi-replica boot story).
        await BootMigrator.ApplyAsync(_factory.Services, NullLogger.Instance);
        await BootMigrator.ApplyAsync(_factory.Services, NullLogger.Instance);

        // Connection pool healthy afterward (lock released).
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.True(await db.Database.CanConnectAsync());
    }
}
