using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Listen V3 — projects an ActorRef (user/anon) into the wire ActorRefDto with a
// resolved avatar hue. Shared by the Room real-time layer (PRP-4); mirrors the
// FeedbackEndpoints.ActorOf logic (PRP-3) so comments, suggestions, presence,
// reactions, chat, and grants all speak one identity shape.
public static class ActorProjection
{
    // Stable FNV-1a hue (0–359) — deterministic across runs (matches PRP-3).
    public static int HueFrom(string? key)
    {
        if (string.IsNullOrEmpty(key)) return 210;
        unchecked
        {
            uint h = 2166136261;
            foreach (var ch in key) { h ^= ch; h *= 16777619; }
            return (int)(h % 360);
        }
    }

    public static async Task<ActorRefDto> ToDtoAsync(
        ActorRef actor, AppDbContext db, CancellationToken ct)
    {
        if (actor.Type == ActorType.User && actor.UserId is Guid uid)
        {
            var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == uid, ct);
            return new ActorRefDto("user", uid, u?.Handle,
                u?.DisplayName ?? u?.Handle, u?.AvatarHue ?? HueFrom(uid.ToString()));
        }
        return new ActorRefDto("anon", null, null, actor.DisplayName,
            HueFrom(actor.AnonId ?? actor.DisplayName));
    }
}
