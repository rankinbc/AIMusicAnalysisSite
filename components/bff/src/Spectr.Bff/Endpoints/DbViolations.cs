using Microsoft.EntityFrameworkCore;

namespace Spectr.Bff.Endpoints;

// Wave-2 (E3.2) — shared Postgres unique-violation detector for
// DbUpdateException catch filters. SqlState 23505 = unique_violation.
// SongEndpoints keeps its private copy (pre-existing); new catch sites
// (VersionEndpoints.UploadVersion, UploadEndpoints.Complete) use this one.
internal static class DbViolations
{
    internal static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";
}
