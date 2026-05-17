using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class ReferenceEndpoints
{
    public static IEndpointRouteBuilder MapReferenceEndpoints(this IEndpointRouteBuilder app)
    {
        var refs = app.MapGroup("/references").WithTags("references").RequireAuthorization();

        refs.MapGet("/", () => NotImplementedResult.Stub());
        refs.MapPost("/", () => NotImplementedResult.Stub());                         // multipart file upload
        refs.MapGet("/{referenceId:guid}", (Guid referenceId) => NotImplementedResult.Stub());
        refs.MapPatch("/{referenceId:guid}", (Guid referenceId) => NotImplementedResult.Stub());
        refs.MapDelete("/{referenceId:guid}", (Guid referenceId) => NotImplementedResult.Stub());
        refs.MapPost("/{referenceId:guid}/analyze", (Guid referenceId) => NotImplementedResult.Stub());

        var sets = app.MapGroup("/reference-sets").WithTags("reference-sets").RequireAuthorization();
        sets.MapGet("/", () => NotImplementedResult.Stub());
        sets.MapPost("/", () => NotImplementedResult.Stub());
        sets.MapPatch("/{setId:guid}", (Guid setId) => NotImplementedResult.Stub());
        sets.MapDelete("/{setId:guid}", (Guid setId) => NotImplementedResult.Stub());
        sets.MapPost("/{setId:guid}/members", (Guid setId) => NotImplementedResult.Stub());
        sets.MapDelete("/{setId:guid}/members/{referenceId:guid}", (Guid setId, Guid referenceId) => NotImplementedResult.Stub());

        return app;
    }
}
