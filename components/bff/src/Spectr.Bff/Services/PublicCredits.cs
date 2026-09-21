namespace Spectr.Bff.Services;

// Task P2 (public-surfaces-polish D6) — resolves `creditsEnabled` for
// LOGGED-OUT surfaces (GET /api/billing/plans, the /pricing crawler shell).
// A static class (no DI ctor) so both call sites can pass whatever
// IConfiguration/flag-loader/logger they already have in hand.
//
// Same precedence as EntitlementService.CreditsEnabled (config key wins,
// then the DB-backed feature-flag row, missing-everywhere = on), but a
// failed flag read here resolves to `null` ("unknown") rather than the
// fail-open `true` EntitlementService uses internally — a public page must
// be able to tell "credits are on" apart from "we don't know yet", so it
// can hide Pricing instead of guessing.
public static class PublicCredits
{
    public static async Task<bool?> ResolveAsync(
        IConfiguration config,
        Func<CancellationToken, Task<Dictionary<string, string>>> loadFlags,
        ILogger logger,
        CancellationToken ct)
    {
        try
        {
            var configValue = config["Credits:Enabled"];
            if (!string.IsNullOrEmpty(configValue))
            {
                // Config key wins outright — never touch the flag loader
                // (and therefore never the database) when it's set.
                return EntitlementService.CreditsEnabled(config, new Dictionary<string, string>());
            }

            var flags = await loadFlags(ct);
            return EntitlementService.CreditsEnabled(config, flags);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Failed to resolve public creditsEnabled — reporting unknown");
            return null;
        }
    }
}
