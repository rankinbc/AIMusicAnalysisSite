using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
using Xunit.Abstractions;

namespace Spectr.Bff.Tests;

// Story 12.7 fail-loud tripwire: when SPECTR_REQUIRE_DB=1 (set by the CI test
// step, where Postgres/Redis service containers are provisioned) these plain
// [Fact]s HARD-FAIL if a dependency is unreachable — so a broken services
// block or connection-string typo can never yield a green run of all-skipped
// tests. Locally (env unset) they pass as logged no-ops so dev runs without
// docker stay green. NOTE: only the exact value "1" arms the tripwire — any
// other value (true/yes) leaves it disarmed, matching TestDb.Require.
public sealed class CiDbCanaryTests(
    WebApplicationFactory<Program> factory, ITestOutputHelper output)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private bool Armed()
    {
        if (Environment.GetEnvironmentVariable("SPECTR_REQUIRE_DB") == "1") return true;
        output.WriteLine("SPECTR_REQUIRE_DB not '1' — canary disarmed (local run without provisioned deps).");
        return false;
    }

    [Fact]
    public async Task Db_Reachable_When_Required_By_Ci()
    {
        if (!Armed()) return;

        Assert.True(
            await TestDb.Reachable(_factory),
            "SPECTR_REQUIRE_DB=1 but Postgres is unreachable — CI services wiring is broken; " +
            "every [SkippableFact] integration test would otherwise fail loudly too.");
    }

    [Fact]
    public void Redis_Reachable_When_Required_By_Ci()
    {
        if (!Armed()) return;

        Assert.True(
            TestDb.RedisUp(_factory),
            "SPECTR_REQUIRE_DB=1 but Redis is unreachable — CI services wiring is broken; " +
            "the rate-limiter/abuse/stream tests would otherwise skip or fail loudly too.");
    }
}
