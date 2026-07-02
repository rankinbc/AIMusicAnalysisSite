using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Data;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Story 11.6 — the notifications inbox API. Every route is recipient-scoped
// through the JWT user id (IDOR-safe by construction: the WHERE clause always
// carries recipient_user_id = me; ids from the client only narrow further).
public static class NotificationEndpoints
{
    private const int DefaultLimit = 30;
    private const int MaxLimit = 50;

    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me/notifications").WithTags("notifications").RequireAuthorization();
        g.MapGet("/", List);
        g.MapGet("/unread-count", UnreadCount);
        g.MapPost("/{notificationId:guid}/read", MarkRead);
        g.MapPost("/read-all", MarkAllRead);
        return app;
    }

    public sealed record NotificationDto(
        Guid Id,
        string EventType,
        JsonElement? Payload,
        string? DigestKey,
        int Count,
        DateTimeOffset? ReadAt,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);

    public sealed record NotificationPageDto(
        IReadOnlyList<NotificationDto> Items,
        int Page,
        int Limit,
        bool HasMore);

    public sealed record UnreadCountDto(int Unread);

    // GET /api/me/notifications?page=0&limit=30 — updated_at DESC (digest
    // upserts bump updated_at so fresh activity resurfaces).
    private static async Task<IResult> List(
        ClaimsPrincipal currentUser, AppDbContext db,
        int? page, int? limit, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var take = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);
        var pageN = Math.Max(0, page ?? 0);
        var skip = pageN * take;

        var rows = await db.Notifications.AsNoTracking()
            .Where(n => n.RecipientUserId == userId)
            .OrderByDescending(n => n.UpdatedAt)
            .Skip(skip)
            .Take(take + 1) // one extra row = cheap HasMore probe
            .ToListAsync(ct);

        var hasMore = rows.Count > take;
        var items = rows.Take(take).Select(n => new NotificationDto(
            n.Id, n.EventType,
            n.PayloadJson is null ? null : JsonSerializer.Deserialize<JsonElement>(n.PayloadJson),
            n.DigestKey, n.Count, n.ReadAt, n.CreatedAt, n.UpdatedAt)).ToList();

        return Results.Ok(new NotificationPageDto(items, pageN, take, hasMore));
    }

    private static async Task<IResult> UnreadCount(
        ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var unread = await db.Notifications.AsNoTracking()
            .CountAsync(n => n.RecipientUserId == userId && n.ReadAt == null, ct);
        return Results.Ok(new UnreadCountDto(unread));
    }

    private static async Task<IResult> MarkRead(
        Guid notificationId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var updated = await db.Notifications
            .Where(n => n.Id == notificationId && n.RecipientUserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTimeOffset.UtcNow), ct);
        // Already-read is idempotent success; a foreign/unknown id is 404.
        if (updated == 0 &&
            !await db.Notifications.AsNoTracking()
                .AnyAsync(n => n.Id == notificationId && n.RecipientUserId == userId, ct))
            return Results.NotFound();
        return Results.NoContent();
    }

    private static async Task<IResult> MarkAllRead(
        ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        await db.Notifications
            .Where(n => n.RecipientUserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, DateTimeOffset.UtcNow), ct);
        return Results.NoContent();
    }
}
