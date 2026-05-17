using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SmokeTest(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Root_Returns_Ok()
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/");
        Assert.True(resp.IsSuccessStatusCode);
    }
}
