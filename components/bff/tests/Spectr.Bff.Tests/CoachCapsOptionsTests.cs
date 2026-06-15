using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 1.9 Task 1.3 + Task 7.2: validate the CoachCaps options binding.
//   - Default fallback (no config block) = 3 (AC4 config-default fallback).
//   - Explicit config values bind.
//   - Non-positive values fail-fast at ValidateOnStart.
public sealed class CoachCapsOptionsTests
{
    private static IOptions<CoachCapsOptions> BindWith(
        IDictionary<string, string?>? settings)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddOptions<CoachCapsOptions>()
            .Bind(config.GetSection(CoachCapsOptions.SectionName))
            .Validate(o => o.FreeFollowups > 0, "CoachCaps:FreeFollowups must be > 0")
            .ValidateOnStart();

        var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IOptions<CoachCapsOptions>>();
    }

    [Fact]
    public void Defaults_To_Three_When_No_Config_Block_Present()
    {
        // AC4: config-default fallback so the story functions before Epic 2
        // even when appsettings has no CoachCaps section at all.
        var opts = BindWith(settings: null);
        Assert.Equal(3, opts.Value.FreeFollowups);
    }

    [Fact]
    public void Binds_Explicit_Value_From_Configuration()
    {
        var opts = BindWith(new Dictionary<string, string?>
        {
            ["CoachCaps:FreeFollowups"] = "5",
        });
        Assert.Equal(5, opts.Value.FreeFollowups);
    }

    [Fact]
    public async Task ValidateOnStart_Throws_At_Host_Build_On_Zero_FreeFollowups()
    {
        // review-fix P8 — exercise the actual ValidateOnStart hook by
        // building a real host. The prior version of this test only
        // asserted on IOptions<T>.Value access, which would still throw
        // even if ValidateOnStart were removed from Program.cs. This
        // version fails fast at host.StartAsync the same way prod does.
        var hostBuilder = Host.CreateDefaultBuilder()
            .ConfigureAppConfiguration(cfg =>
            {
                cfg.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["CoachCaps:FreeFollowups"] = "0",
                });
            })
            .ConfigureServices((ctx, services) =>
            {
                services.AddOptions<CoachCapsOptions>()
                    .Bind(ctx.Configuration.GetSection(CoachCapsOptions.SectionName))
                    .Validate(o => o.FreeFollowups > 0, "CoachCaps:FreeFollowups must be > 0")
                    .ValidateOnStart();
            });

        var host = hostBuilder.Build();
        var ex = await Assert.ThrowsAsync<OptionsValidationException>(
            async () => await host.StartAsync());
        Assert.Contains("must be > 0", ex.Message);
        await host.StopAsync();
    }
}
