using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class FileEndpoints
{
    public static IEndpointRouteBuilder MapFileEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/files").WithTags("files").RequireAuthorization();

        // Authenticated fall-through for IFileStorage's "presigned URL" on local disk.
        // In R2 mode this route is unused — clients hit the signed R2 URL directly.
        g.MapGet("/{**key}", (string key) => NotImplementedResult.Stub());

        return app;
    }
}
