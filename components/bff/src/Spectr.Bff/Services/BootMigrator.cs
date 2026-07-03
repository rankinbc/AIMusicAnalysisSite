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

        var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
        if (pending.Count == 0)
        {
            logger.LogInformation("BootMigrator: schema up to date.");
            return;
        }

        // A dedicated open connection: the advisory lock is session-scoped
        // and must live for exactly the duration of MigrateAsync.
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            await using (var acquire = conn.CreateCommand())
            {
                acquire.CommandText = $"SELECT pg_advisory_lock({LockKey})";
                await acquire.ExecuteNonQueryAsync(); // blocks until the peer finishes
            }
            try
            {
                // Re-check under the lock — the peer that held it may have
                // just applied everything.
                pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
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
                    logger.LogInformation("BootMigrator: peer already applied — nothing to do.");
                }
            }
            finally
            {
                await using var release = conn.CreateCommand();
                release.CommandText = $"SELECT pg_advisory_unlock({LockKey})";
                await release.ExecuteNonQueryAsync();
            }
        }
        finally
        {
            await conn.CloseAsync();
        }
    }
}
