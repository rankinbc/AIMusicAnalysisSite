using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Listen V3 (PRP-2 G1) — resolves an opaque version SHARE token → versionId,
// off the JwtBearer ?t= path (which stays whitelisted to /audio and JWT-only).
// Plugs into ResourceTokenAuth via Kind="share". Only resolves tokens whose
// version is currently shared (visibility != 'private'), so flipping back to
// private instantly stops the link from resolving.
public sealed class ShareTokenResolver(AppDbContext db) : ITokenResolver
{
    public string Kind => "share";

    public async Task<ResolvedResource?> ResolveAsync(string token, CancellationToken ct = default)
    {
        var versionId = await db.ShareSettings.AsNoTracking()
            .Where(s => s.ShareToken == token && s.Visibility != "private")
            .Select(s => (Guid?)s.SongVersionId)
            .FirstOrDefaultAsync(ct);
        return versionId is Guid vid ? new ResolvedResource(Kind, vid) : null;
    }
}
