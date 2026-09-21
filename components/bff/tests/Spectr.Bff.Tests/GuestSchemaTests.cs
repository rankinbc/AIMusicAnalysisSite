using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection; using Spectr.Data; using Xunit;
namespace Spectr.Bff.Tests;
public sealed class GuestSchemaTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [SkippableFact]
    public async Task A_Registered_User_Is_Not_A_Guest()
    {
        await TestDb.RequireAsync(factory);
        var (userId, _) = await TestAuth.RegisterAsync(factory.CreateClient());
        using var scope = factory.Services.CreateScope();
        var u = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Id == userId);
        Assert.False(u.IsGuest); Assert.Null(u.GuestExpiresAt); Assert.Null(u.GuestDeviceId);
    }
    [SkippableTheory]
    [InlineData("demo_enabled")] [InlineData("guest_ttl_hours")] [InlineData("demo_guests_per_ip_hourly")]
    [InlineData("demo_guests_daily_cap")] [InlineData("guest_uploads_max")] [InlineData("guest_analyses_per_hour")]
    [InlineData("coach_guest_messages")] [InlineData("llm_budget_guest_usd")] [InlineData("anon_sample_per_hour_global")]
    public async Task Demo_Flag_Is_Seeded(string name)
    {
        await TestDb.RequireAsync(factory);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.True(await db.FeatureFlags.AsNoTracking().AnyAsync(f => f.Name == name), $"flag {name} missing");
    }
    // The flag ROWS are live-tunable, so a database can't be asserted on values —
    // the MIGRATION can, with no database at all. demo_enabled='false' is the one
    // that must never drift: prod may not serve a demo before a real snapshot exists.
    [Theory]
    [InlineData("demo_enabled", "false")] [InlineData("guest_ttl_hours", "72")] [InlineData("demo_guests_per_ip_hourly", "5")]
    [InlineData("demo_guests_daily_cap", "300")] [InlineData("guest_uploads_max", "1")] [InlineData("guest_analyses_per_hour", "10")]
    [InlineData("coach_guest_messages", "20")] [InlineData("llm_budget_guest_usd", "5")] [InlineData("anon_sample_per_hour_global", "20")]
    public void Seed_Migration_Pins_The_Value(string name, string value)
    {
        var sql = string.Join(" ", new Spectr.Data.Migrations.SeedDemoFlags().UpOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Matches($@"\('{name}',\s*'{value}',", sql);
    }
}
