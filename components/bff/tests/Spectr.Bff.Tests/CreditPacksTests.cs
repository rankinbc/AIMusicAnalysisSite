using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Net.Http.Json;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CreditPacksTests(WebApplicationFactory<Program> f) : IClassFixture<WebApplicationFactory<Program>>
{
    [SkippableFact]
    public async Task Plans_Lists_Three_Packs_And_Costs()
    {
        await TestDb.RequireAsync(f);
        var plans = await f.CreateClient().GetFromJsonAsync<PlansResponse>("/api/billing/plans");
        Assert.NotNull(plans);
        Assert.Equal(new[] { 500, 1500, 5000 }, plans!.CreditPacks.Select(p => p.Credits));
        Assert.Equal(new[] { 400, 1000, 3000 }, plans.CreditPacks.Select(p => p.Cents));
        Assert.NotNull(plans.Costs);
        Assert.Equal(15, plans.Costs!.Specialist);
    }

    // The config binder appends to a pre-populated list; configured packs must
    // REPLACE the defaults or the credits checkout would need Stripe prices for
    // packs the operator never configured.
    [SkippableFact]
    public async Task Configured_Packs_Replace_The_Defaults()
    {
        await TestDb.RequireAsync(f);
        var custom = f.WithWebHostBuilder(b =>
            b.UseSetting("PricingDisplay:CreditPacks:0:Credits", "1000")
             .UseSetting("PricingDisplay:CreditPacks:0:Cents", "1500"));
        var plans = await custom.CreateClient().GetFromJsonAsync<PlansResponse>("/api/billing/plans");
        Assert.NotNull(plans);
        Assert.Equal(new[] { 1000 }, plans!.CreditPacks.Select(p => p.Credits));
        Assert.Equal(new[] { 1500 }, plans.CreditPacks.Select(p => p.Cents));
    }

    [SkippableFact]
    public async Task Checkout_Rejects_Unknown_Pack_Size()
    {
        await TestDb.RequireAsync(f);
        var c = f.CreateClient();
        var (_, token) = await TestAuth.RegisterAsync(c);
        c.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var resp = await c.PostAsJsonAsync("/api/billing/checkout/credits", new { packSize = 5 });
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.BadRequest, "invalid_pack_size");
    }
}
