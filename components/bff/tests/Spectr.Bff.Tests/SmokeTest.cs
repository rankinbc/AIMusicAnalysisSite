using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SmokeTest(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task Root_Returns_Ok()
    {
        // Story 12.7: the request pipeline touches Redis — without it this
        // failed at request time instead of skipping. In CI (SPECTR_REQUIRE_DB=1)
        // an unreachable Redis is a hard failure, so the smoke stays a real proof.
        TestDb.Require(TestDb.RedisUp(_factory), "Redis");

        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/");
        Assert.True(resp.IsSuccessStatusCode);
    }
}
