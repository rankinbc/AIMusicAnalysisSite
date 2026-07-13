using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 12.7 fail-loud tripwire: when SPECTR_REQUIRE_DB=1 (set by the CI test
// step, where Postgres/Redis service containers are provisioned) this plain
// [Fact] HARD-FAILS if the DB is unreachable — so a broken services block or
// connection-string typo can never yield a green run of all-skipped tests.
// Locally (env unset) it passes as a no-op so dev runs without docker stay green.
public sealed class CiDbCanaryTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Db_Reachable_When_Required_By_Ci()
    {
        if (Environment.GetEnvironmentVariable("SPECTR_REQUIRE_DB") != "1")
            return; // local run without provisioned DB — the canary only arms in CI

        Assert.True(
            await TestDb.Reachable(_factory),
            "SPECTR_REQUIRE_DB=1 but Postgres is unreachable — CI services wiring is broken; " +
            "every [SkippableFact] integration test would otherwise fail loudly too.");
    }
}
