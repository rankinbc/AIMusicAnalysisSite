using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Listen V3 (PRP-4) — resolves an opaque SESSION-scoped invite token → the
// session's versionId, off the JwtBearer ?t= path (PRP-0 hard rule). Plugs into
// ResourceTokenAuth via Kind="session", the sibling of ShareTokenResolver. Only
// resolves while the session is live and the invite is pending/accepted, so a
// revoked invite or an ended session instantly stops the link from resolving.
//
// (Session-invite CREATION has no endpoint in this slice — anon room join works
// today via the version share token. This resolver completes the seam so a
// host/listener session invite link resolves once that path is added.)
public sealed class SessionTokenResolver(AppDbContext db) : ITokenResolver
{
    public string Kind => "session";

    public async Task<ResolvedResource?> ResolveAsync(string token, CancellationToken ct = default)
    {
        var versionId = await (
            from i in db.Invites.AsNoTracking()
            join s in db.ListeningSessions.AsNoTracking() on i.SessionId equals s.Id
            where i.Token == token
                && i.Scope == "session"
                && (i.Status == "pending" || i.Status == "accepted")
                && s.Status == "live"
            select (Guid?)s.SongVersionId).FirstOrDefaultAsync(ct);
        return versionId is Guid v ? new ResolvedResource(Kind, v) : null;
    }
}
