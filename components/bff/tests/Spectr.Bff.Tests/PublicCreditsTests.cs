using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Xunit;
namespace Spectr.Bff.Tests;
public sealed class PublicCreditsTests
{
    private static IConfiguration Config(string? value)
    {
        var data = new Dictionary<string, string?>();
        if (value is not null) data["Credits:Enabled"] = value;
        return new ConfigurationBuilder().AddInMemoryCollection(data).Build();
    }
    private static Func<CancellationToken, Task<Dictionary<string, string>>> Flags(Dictionary<string, string> f) => _ => Task.FromResult(f);
    private static readonly Func<CancellationToken, Task<Dictionary<string, string>>> Throws = _ => throw new InvalidOperationException("db down");
    [Fact]
    public async Task Config_Key_Wins_And_Never_Touches_The_Database() =>
        Assert.False(await PublicCredits.ResolveAsync(Config("false"), Throws, NullLogger.Instance, default));
    [Theory]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public async Task Flag_Row_Decides_When_Config_Is_Silent(string flag, bool expected) =>
        Assert.Equal(expected, await PublicCredits.ResolveAsync(
            Config(null), Flags(new() { ["credits_enabled"] = flag }), NullLogger.Instance, default));
    [Fact]
    public async Task Missing_Everywhere_Means_On() =>
        Assert.True(await PublicCredits.ResolveAsync(Config(null), Flags(new()), NullLogger.Instance, default));
    [Fact]
    public async Task A_Failed_Flag_Read_Is_Unknown_Not_A_Guess() =>
        Assert.Null(await PublicCredits.ResolveAsync(Config(null), Throws, NullLogger.Instance, default));
}
