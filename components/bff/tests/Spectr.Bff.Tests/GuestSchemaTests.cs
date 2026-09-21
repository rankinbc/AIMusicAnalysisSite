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
}
