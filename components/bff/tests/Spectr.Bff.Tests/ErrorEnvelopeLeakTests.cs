using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 10.8 (NFR9) — production error responses leak nothing. The
// exception handler is registered UNCONDITIONALLY, so exercising it via the
// Development-only /api/dev/throw detonator tests the exact prod path.
public sealed class ErrorEnvelopeLeakTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Unhandled_Exception_Returns_Envelope_With_No_Internals()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var resp = await _factory.CreateClient().GetAsync("/api/dev/throw");
        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);
        Assert.Equal("application/json", resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadAsStringAsync();
        // The envelope, with a support-correlatable trace id.
        Assert.Contains("internal_error", body);
        Assert.Contains("traceId", body);
        // NOTHING internal: no exception message, no stack frames, no types.
        Assert.DoesNotContain("SECRET-INTERNAL-DETAIL", body);
        Assert.DoesNotContain("hunter2", body);
        Assert.DoesNotContain("InvalidOperationException", body);
        Assert.DoesNotContain("at Spectr.", body);
        Assert.DoesNotContain("Program.cs", body);
    }
}
