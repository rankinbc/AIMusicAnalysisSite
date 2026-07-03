using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 10.1 (AC2/AR29) — EF migrations at BFF boot, serialized by a
// Postgres session advisory lock so concurrent replicas (rolling deploys,
// compose restarts) never race the migrator. Config-gated
// (Migrations:ApplyAtBoot) — dev keeps the CLI/launcher flow. Alembic stays
// frozen (v1-only).
public static class BootMigrator
{
    // Arbitrary-but-stable app-wide lock key.
    private const long LockKey = 727274; // "SPECTR"

    public static async Task ApplyAsync(IServiceProvider services, ILogger logger)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // ALWAYS take the lock (no pre-lock fast path): the check-then-lock
        // shortcut left the lock path untested and only saved one no-op
        // round-trip per boot. Opening the context's connection here means
        // the lock session and EF's migration session are the same Postgres
        // session (GetDbConnection returns the context-owned connection;
        // a manual Open makes EF reuse it).
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            logger.LogInformation("BootMigrator: waiting for advisory lock {Key}…", LockKey);
            await using (var acquire = conn.CreateCommand())
            {
                acquire.CommandText = $"SELECT pg_advisory_lock({LockKey})";
                // A peer's migration may legitimately run for minutes — the
                // default 30 s command timeout would crash-loop the waiter.
                acquire.CommandTimeout = 0;
                await acquire.ExecuteNonQueryAsync(); // blocks until the peer finishes
            }
            try
            {
                var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
                if (pending.Count > 0)
                {
                    logger.LogInformation(
                        "BootMigrator: applying {Count} migration(s) under advisory lock: {Names}",
                        pending.Count, string.Join(", ", pending));
                    await db.Database.MigrateAsync();
                    logger.LogInformation("BootMigrator: done.");
                }
                else
                {
                    logger.LogInformation("BootMigrator: schema up to date.");
                }
            }
            finally
            {
                try
                {
                    await using var release = conn.CreateCommand();
                    release.CommandText = $"SELECT pg_advisory_unlock({LockKey})";
                    await release.ExecuteNonQueryAsync();
                }
                catch (Exception ex)
                {
                    // Never mask the real migration failure — closing the
                    // session releases the lock anyway.
                    logger.LogWarning(ex, "BootMigrator: unlock failed (session close releases it).");
                }
            }
        }
        finally
        {
            await conn.CloseAsync();
        }
    }
}
