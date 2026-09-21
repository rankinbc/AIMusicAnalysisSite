using Microsoft.AspNetCore.Authorization;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;

namespace Spectr.Bff.Auth;

// Task D6 — default-deny guest guard (spec D4). ONE endpoint filter on the
// `/api` group: a guest principal's request passes only when the endpoint is
// explicitly marked. This means an endpoint added next month is CLOSED to
// guests by construction — nobody has to remember to gate it.
public enum GuestQuota { None, Upload }

public sealed record GuestAllowed(GuestQuota Quota);

public sealed class GuestDenied
{
    public static readonly GuestDenied Instance = new();
    private GuestDenied() { }
}

public static class GuestGuard
{
    public static async ValueTask<object?> Filter(
        EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        if (!http.User.IsGuest()) return await next(ctx);          // real users: one branch, no cost

        var meta = http.GetEndpoint()?.Metadata;
        // logout/refresh/the anon funnel/`POST /auth/demo` itself carry a
        // guest bearer too when the frontend fetcher happens to attach one —
        // IAllowAnonymous endpoints are never guest-gated.
        if (meta?.GetMetadata<IAllowAnonymous>() is not null) return await next(ctx);
        if (meta?.GetMetadata<GuestDenied>() is not null) return Restricted("not_allowed");

        var allowed = meta?.GetMetadata<GuestAllowed>();
        var method = http.Request.Method;
        var safe = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
        if (allowed is null && !safe) return Restricted("not_allowed"); // an endpoint added later is closed by default

        if (allowed?.Quota == GuestQuota.Upload)
        {
            var limits = http.RequestServices.GetRequiredService<GuestLimits>();
            if (await limits.CheckUploadAsync(http.User.UserId(), http.RequestAborted) is { } denied)
                return denied;
        }

        return await next(ctx);
    }

    internal static IResult Restricted(string reason, string? message = null) => ErrorEnvelope.Build(
        403, "guest_restricted",
        message ?? "That's not part of the demo sandbox — create a free account to do this.",
        new { reason });

    public static TBuilder AllowGuest<TBuilder>(this TBuilder b)
        where TBuilder : IEndpointConventionBuilder
        => b.WithMetadata(new GuestAllowed(GuestQuota.None));

    public static TBuilder AllowGuestUpload<TBuilder>(this TBuilder b)
        where TBuilder : IEndpointConventionBuilder
        => b.WithMetadata(new GuestAllowed(GuestQuota.Upload));

    public static TBuilder DenyGuest<TBuilder>(this TBuilder b)
        where TBuilder : IEndpointConventionBuilder
        => b.WithMetadata(GuestDenied.Instance);
}
