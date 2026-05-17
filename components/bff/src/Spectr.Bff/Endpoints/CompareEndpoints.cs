using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class CompareEndpoints
{
    public static IEndpointRouteBuilder MapCompareEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/compare").WithTags("compare").RequireAuthorization();

        // Cacheable GET — keyed by (track_version_id, reference_id). Returns
        // match score, sub-scores, delta rows, templated suggestions.
        g.MapGet("/", () => NotImplementedResult.Stub());

        return app;
    }
}
