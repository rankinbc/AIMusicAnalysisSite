using Microsoft.Extensions.Logging;

namespace Spectr.Bff.Services;

// Story 4.4 review — ONE place for the email-link base URL. A missing
// App:FrontendOrigin in prod would ship localhost deep links in real
// customer emails; the warning makes that loud (boot-time validation is
// 10.1's full-config sweep).
public static class AppUrls
{
    public const string DevFallbackOrigin = "http://localhost:5174";

    public static string FrontendOrigin(IConfiguration cfg, ILogger? logger = null)
    {
        var origin = cfg["App:FrontendOrigin"];
        if (string.IsNullOrWhiteSpace(origin))
        {
            logger?.LogWarning(
                "App:FrontendOrigin not configured — email links will point at localhost.");
            return DevFallbackOrigin;
        }
        return origin.TrimEnd('/');
    }
}
