using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class BookmarkEndpoints
{
    public static IEndpointRouteBuilder MapBookmarkEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me/bookmarks").WithTags("bookmarks").RequireAuthorization();

        g.MapGet("/", () => NotImplementedResult.Stub());                       // returns joined track metadata
        g.MapPost("/", () => NotImplementedResult.Stub());                      // body: { target_share_token } | { target_published_track }
        g.MapDelete("/{bookmarkId:guid}", (Guid bookmarkId) => NotImplementedResult.Stub());

        return app;
    }
}
