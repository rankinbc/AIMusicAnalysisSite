using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class MeEndpoints
{
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me").WithTags("me").RequireAuthorization();

        g.MapGet("/profile", () => NotImplementedResult.Stub());
        g.MapPatch("/profile", () => NotImplementedResult.Stub());
        g.MapGet("/stats", () => NotImplementedResult.Stub());
        g.MapGet("/activity", () => NotImplementedResult.Stub());    // UNION over jobs/songs/versions

        return app;
    }
}
