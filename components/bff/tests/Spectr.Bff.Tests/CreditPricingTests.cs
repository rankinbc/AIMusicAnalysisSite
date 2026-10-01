using Microsoft.Extensions.Configuration;
using Spectr.Bff.Services;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CreditPricingTests
{
    private static IConfiguration Cfg(params (string K, string V)[] kv) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(kv.Select(p => new KeyValuePair<string, string?>(p.K, p.V)))
            .Build();

    [Fact]
    public void Defaults_When_No_Config_And_No_Flags()
    {
        var p = CreditPricing.Resolve(Cfg(), new Dictionary<string, string>());
        Assert.Equal(new CreditPrices(100, 15, 5, 5, 500, 15), p);
    }

    [Fact]
    public void Flag_Overrides_Default_And_Config_Overrides_Flag()
    {
        var flags = new Dictionary<string, string>
        {
            ["credit_cost_analysis"] = "80",
            ["credit_cost_specialist"] = "12",
            ["signup_bonus_credits"] = "300",
        };
        var p = CreditPricing.Resolve(Cfg(("Credits:Prices:Analysis", "1")), flags);
        Assert.Equal(1, p.Analysis);        // config wins
        Assert.Equal(12, p.Specialist);     // flag wins over default
        Assert.Equal(300, p.SignupGrant);
        Assert.Equal(5, p.CoachMessage);    // default
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("-5")]
    [InlineData("")]
    public void Garbage_Or_Negative_Falls_Back_To_Default(string raw)
    {
        var p = CreditPricing.Resolve(Cfg(), new Dictionary<string, string> { ["credit_cost_coach_mix"] = raw });
        Assert.Equal(5, p.CoachMix);
    }

    [Fact]
    public void Zero_Is_Allowed_Meaning_Free()
    {
        var p = CreditPricing.Resolve(Cfg(("Credits:SignupGrant", "0")), new Dictionary<string, string>());
        Assert.Equal(0, p.SignupGrant);
    }
}
