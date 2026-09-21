using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Task D6 — GET /api/me/guest: quota state for the guest banner/upgrade
// dialog. 404 for a non-guest (the route doesn't exist for a real account).
public static class GuestEndpoints
{
    public static IEndpointRouteBuilder MapGuestEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me").WithTags("guest").RequireAuthorization();
        g.MapGet("/guest", GetGuestState);
        return app;
    }

    private static async Task<IResult> GetGuestState(
        ClaimsPrincipal currentUser, AppDbContext db, GuestLimits limits, CancellationToken ct)
    {
        if (!currentUser.IsGuest()) return Results.NotFound();
        var userId = currentUser.UserId();
        var guest = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (guest is null) return Results.NotFound();
        return Results.Ok(await limits.GetStateAsync(guest, ct));
    }
}
