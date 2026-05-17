using Spectr.Bff.Infrastructure;

namespace Spectr.Bff.Endpoints;

public static class CoachEndpoints
{
    public static IEndpointRouteBuilder MapCoachEndpoints(this IEndpointRouteBuilder app)
    {
        // Phase 3. v1 ships the verdict-list portion of Coach; chat panel arrives later.
        var g = app.MapGroup("/coach").WithTags("coach").RequireAuthorization();

        g.MapGet("/{jobId:guid}", (Guid jobId) => NotImplementedResult.Stub());                  // combined analysis + verdicts + summary
        g.MapPost("/{jobId:guid}/chat", (Guid jobId) => NotImplementedResult.Stub());            // SSE; Vercel AI SDK Data Stream protocol

        return app;
    }
}
