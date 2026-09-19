using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Spectr.Bff.Tests;

// Solo fork guard — SPECTR ships as a single-user tool. These fail if an
// endpoint that exposes, or implies, other users comes back. When one fails,
// remove the endpoint. Only extend an allowlist for a route that is provably
// single-user, and say why in the commit.
public sealed class NoSocialSurfaceTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string SkipReason = "enabled in the final BFF task of the solo strip";

    private static string Norm(RouteEndpoint e)
    {
        var raw = e.RoutePattern.RawText ?? "";
        var s = (raw.StartsWith('/') ? raw : "/" + raw).TrimEnd('/').ToLowerInvariant();
        return s.Length == 0 ? "/" : s;
    }

    private List<RouteEndpoint> Routes() =>
        factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints.OfType<RouteEndpoint>().ToList();

    // Substring matches on the normalized (lower-cased) pattern. NOTE "/api/u"
    // is matched EXACTLY below — as a fragment it would also hit /api/uploads
    // and /api/usage.
    private static readonly string[] BannedFragments =
    [
        "/api/u/", "/api/sessions", "/api/share", "/api/v/", "/r/{",
        "/api/me/feed", "/api/me/notifications", "/api/me/bookmarks",
        "/share", "/invites", "/access", "/view", "/sessions", "/comments",
        "/suggestions", "/bookmarks", "/follow",
    ];

    [SkippableFact(Skip = SkipReason)]
    public async Task No_Route_Matches_A_Removed_Social_Prefix()
    {
        await TestDb.RequireAsync(factory);
        var offenders = Routes().Select(Norm).Distinct()
            .Where(p => p == "/api/u"
                || BannedFragments.Any(f => p.Contains(f, StringComparison.Ordinal)))
            .OrderBy(p => p).ToList();
        Assert.True(offenders.Count == 0, "Social routes still mapped:\n" + string.Join("\n", offenders));
    }

    // Exact paths, or prefixes ending in '/'. Everything anonymous must be here.
    private static readonly string[] AnonymousAllowlist =
    [
        "/", "/pricing", "/analyze", "/trust/",
        "/healthz", "/metrics", "/openapi/",
        "/api/auth/", "/api/anon/",
        "/api/billing/plans", "/api/billing/stripe/webhook", "/api/email/webhook",
        "/api/health/", "/api/admin/", "/api/dev/",
    ];

    [SkippableFact(Skip = SkipReason)]
    public async Task Every_Anonymous_Endpoint_Is_On_The_Allowlist()
    {
        await TestDb.RequireAsync(factory);
        // Program.cs sets NO FallbackPolicy, so an endpoint is reachable
        // anonymously if it opts in (IAllowAnonymous) OR simply never asked
        // for authorization (no IAuthorizeData). Both count.
        var offenders = Routes()
            .Where(e => e.Metadata.GetMetadata<IAllowAnonymous>() is not null
                || e.Metadata.GetMetadata<IAuthorizeData>() is null)
            .Select(Norm).Distinct()
            .Where(p => !AnonymousAllowlist.Any(a =>
                a.EndsWith('/') && a.Length > 1 ? p.StartsWith(a, StringComparison.Ordinal) || p == a.TrimEnd('/') : p == a))
            .OrderBy(p => p).ToList();
        Assert.True(offenders.Count == 0, "Unexpected anonymous endpoints:\n" + string.Join("\n", offenders));
    }

    [SkippableFact(Skip = SkipReason)]
    public async Task Worker_Health_Does_Not_Expose_Global_Queue_Depth()
    {
        await TestDb.RequireAsync(factory);
        var body = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/health/worker");
        Assert.False(body.TryGetProperty("queueDepth", out _), "queueDepth leaks site-wide load to anonymous callers");
        Assert.True(body.TryGetProperty("healthy", out _));
    }

    [SkippableFact(Skip = SkipReason)]
    public async Task Registered_User_Payload_And_Token_Carry_No_Handle()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var client = factory.CreateClient();
        var email = $"solo-guard-{Guid.NewGuid():N}@spectr.test";
        var resp = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "SoloGuard!2026-pw" });
        resp.EnsureSuccessStatusCode();
        var json = await resp.Content.ReadFromJsonAsync<JsonElement>();

        Assert.DoesNotContain("handle", json.GetRawText(), StringComparison.OrdinalIgnoreCase);

        var token = json.GetProperty("accessToken").GetString()!;
        var payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        var claims = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        Assert.DoesNotContain("\"handle\"", claims, StringComparison.OrdinalIgnoreCase);
    }

    [Fact(Skip = SkipReason)]
    public void Tag_Contracts_Have_No_Public_Flag()
    {
        Assert.Null(typeof(Spectr.Bff.DTOs.TagDto).GetProperty("IsPublic"));
        Assert.Null(typeof(Spectr.Bff.DTOs.CreateTagRequest).GetProperty("IsPublic"));
    }
}
