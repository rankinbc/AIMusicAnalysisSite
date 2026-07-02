using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Story 11.9 — follow graph. Writes are auth-required + rate-limited (AC5);
// the counts read is public (profiles render them for anyone, AC3).
public static class FollowEndpoints
{
    public static IEndpointRouteBuilder MapFollowEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/u/{handle}/follow").WithTags("follow");
        g.MapGet("/", GetFollowState).AllowAnonymous();
        g.MapPut("/", Follow).RequireAuthorization();
        g.MapDelete("/", Unfollow).RequireAuthorization();
        return app;
    }

    public sealed record FollowStateDto(int Followers, int Following, bool IsFollowing, bool IsSelf);

    private static Task<Guid?> ResolveHandle(AppDbContext db, string handle, CancellationToken ct) =>
        db.Users.AsNoTracking()
            .Where(u => u.Handle == handle && u.IsActive)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(ct);

    private static async Task<IResult> GetFollowState(
        string handle, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var target = await ResolveHandle(db, handle, ct);
        if (target is not Guid followee) return Results.NotFound();

        var followers = await db.FollowRelations.AsNoTracking().CountAsync(f => f.FolloweeId == followee, ct);
        var following = await db.FollowRelations.AsNoTracking().CountAsync(f => f.FollowerId == followee, ct);

        var me = user.Identity?.IsAuthenticated == true ? user.UserId() : (Guid?)null;
        var isFollowing = me is Guid m &&
            await db.FollowRelations.AsNoTracking().AnyAsync(f => f.FollowerId == m && f.FolloweeId == followee, ct);

        return Results.Ok(new FollowStateDto(followers, following, isFollowing, me == followee));
    }

    private static async Task<IResult> Follow(
        string handle, ClaimsPrincipal user, HttpContext http, AppDbContext db,
        IRateLimiter limiter, CancellationToken ct)
    {
        var me = user.UserId();
        var target = await ResolveHandle(db, handle, ct);
        if (target is not Guid followee) return Results.NotFound();
        if (followee == me)
            return ErrorEnvelope.Build(400, "self_follow", "You can't follow yourself.");

        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var rl = await limiter.CheckAsync($"user:{me}", ip, "follow", limit: 30, TimeSpan.FromMinutes(1), ct);
        if (!rl.Allowed)
            return ErrorEnvelope.Build(429, "rate_limited", "Too many follow actions — slow down.");

        // Idempotent: the unique (follower, followee) index absorbs races; a
        // duplicate insert is success, not an error (AC1).
        db.FollowRelations.Add(new FollowRelation { FollowerId = me, FolloweeId = followee });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear(); // already following — idempotent OK
        }
        return Results.NoContent();
    }

    private static async Task<IResult> Unfollow(
        string handle, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var me = user.UserId();
        var target = await ResolveHandle(db, handle, ct);
        if (target is not Guid followee) return Results.NotFound();

        await db.FollowRelations
            .Where(f => f.FollowerId == me && f.FolloweeId == followee)
            .ExecuteDeleteAsync(ct);
        return Results.NoContent(); // unfollow of a non-follow is idempotent success
    }
}
