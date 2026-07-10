using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 12.2 (AC4) — GET /api/health/full: the aggregated always-200 health
// JSON behind the dev shell indicator. Unlike /healthz (deploy contract,
// 200/503), this endpoint returns 200 with per-check state so the frontend
// can render partial degradation.
public sealed class HealthEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Full_Health_Returns_200_With_The_Aggregated_Shape()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/health/full");

        // Always 200 — degradation lives in the body, never the status code.
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();

        // Dev stack (postgres + redis) is up per the TestDb gate above.
        Assert.Equal("ok", body.GetProperty("status").GetString());
        var checks = body.GetProperty("checks");
        Assert.True(checks.GetProperty("postgres").GetBoolean());
        Assert.True(checks.GetProperty("redis").GetBoolean());

        // Worker state is informational — shape only (whether a live worker
        // is heartbeating against the dev Redis is not this test's concern).
        var worker = checks.GetProperty("worker");
        Assert.True(worker.GetProperty("healthy").ValueKind
            is JsonValueKind.True or JsonValueKind.False);
        _ = worker.GetProperty("lastHeartbeatAgeSeconds"); // present (may be null)
        Assert.Equal(JsonValueKind.Number, worker.GetProperty("queueDepth").ValueKind);

        // Storage: no Storage:S3 config in tests → local mode; ok is a bool
        // (its value depends on the host CWD, which is not this test's concern).
        var storage = checks.GetProperty("storage");
        Assert.Equal("local", storage.GetProperty("mode").GetString());
        Assert.True(storage.GetProperty("ok").ValueKind is JsonValueKind.True or JsonValueKind.False);
    }

    [Fact]
    public async Task Full_Health_Is_Anonymous()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // No Authorization header at all — must not 401 (same anonymous
        // group as /api/health/worker).
        var client = _factory.CreateClient();
        var resp = await client.GetAsync("/api/health/full");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }
}
