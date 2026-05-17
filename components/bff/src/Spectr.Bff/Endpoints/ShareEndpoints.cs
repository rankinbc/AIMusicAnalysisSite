using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class ShareEndpoints
{
    public static IEndpointRouteBuilder MapShareEndpoints(this IEndpointRouteBuilder app)
    {
        // Producer-side share-link management (authed)
        var owner = app.MapGroup("/analyses/{analysisId:guid}/share").WithTags("share").RequireAuthorization();
        owner.MapPost("/", (Guid analysisId) => NotImplementedResult.Stub());                         // generate share_token
        owner.MapPatch("/", (Guid analysisId) => NotImplementedResult.Stub());                         // toggle show_verdicts
        owner.MapDelete("/", (Guid analysisId) => NotImplementedResult.Stub());                        // revoke

        // Public share-link consumption (anonymous reviewer)
        var pub = app.MapGroup("/share/{token}").WithTags("share").AllowAnonymous();
        pub.MapGet("/", (string token) => NotImplementedResult.Stub());                             // metadata + final_json + optional verdicts
        pub.MapGet("/audio", (string token) => NotImplementedResult.Stub());                        // streaming with Range
        pub.MapGet("/peaks", (string token) => NotImplementedResult.Stub());                        // waveform peaks JSON
        pub.MapGet("/comments", (string token) => NotImplementedResult.Stub());
        pub.MapPost("/comments", (string token) => NotImplementedResult.Stub());                    // anonymous; rate-limited per IP hash

        return app;
    }
}
