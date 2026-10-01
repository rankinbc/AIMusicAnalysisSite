using Npgsql;
using StackExchange.Redis;

namespace Spectr.Bff.Tests;

/// <summary>
/// Keeps the test suite out of the developer's working data. Without this the
/// suite wrote straight into the dev database (`spectr`) and Redis db 0 and
/// never cleaned up: hundreds of fixture users, songs and fake Stripe
/// subscriptions piled up (the BFF's daily reconciliation then logged a
/// "SubscriptionMissing" warning per fake `sub_pro_…` row), and enqueue tests
/// pushed messages onto the queues the local dramatiq worker consumes.
///
/// At assembly load (before any WebApplicationFactory reads its config) this:
///  - points every host at a dedicated database (`spectr_test`, override with
///    SPECTR_TEST_DB), dropped and recreated per run so each run starts clean;
///    the BFF's own BootMigrator applies the schema on first host boot
///    (Migrations:ApplyAtBoot, advisory-locked, so parallel hosts are safe);
///  - moves Redis to db 9 (unless the connection string already names a
///    defaultDatabase) and flushes that db, so rate-limit keys and queued test
///    messages never reach the worker's db 0.
/// Same host/credentials as configured (env ConnectionStrings__Postgres /
/// Redis__ConnectionString, else the appsettings defaults), so the IPv4 pin
/// from docs/STARTUP.md keeps working. If Postgres or Redis is unreachable this
/// does nothing and the existing skip / SPECTR_REQUIRE_DB behavior applies.
/// </summary>
internal static class TestIsolation
{
    // Mirrors components/bff/src/Spectr.Bff/appsettings.json.
    private const string DefaultPostgres = "Host=localhost;Port=5432;Database=spectr;Username=spectr;Password=spectr";
    private const string DefaultRedis = "localhost:6379";
    private const int TestRedisDb = 9;

    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void Isolate()
    {
        IsolatePostgres();
        IsolateRedis();
    }

    private static void IsolatePostgres()
    {
        var configured = Environment.GetEnvironmentVariable("ConnectionStrings__Postgres");
        var csb = new NpgsqlConnectionStringBuilder(string.IsNullOrWhiteSpace(configured) ? DefaultPostgres : configured);
        var testDb = Environment.GetEnvironmentVariable("SPECTR_TEST_DB");
        csb.Database = string.IsNullOrWhiteSpace(testDb) ? "spectr_test" : testDb;

        Environment.SetEnvironmentVariable("ConnectionStrings__Postgres", csb.ConnectionString);
        Environment.SetEnvironmentVariable("Migrations__ApplyAtBoot", "true");

        try
        {
            var admin = new NpgsqlConnectionStringBuilder(csb.ConnectionString) { Database = "postgres", Timeout = 5 };
            using var conn = new NpgsqlConnection(admin.ConnectionString);
            conn.Open();
            // Identifier can't be a bind parameter; it's our own setting, quoted.
            var quoted = "\"" + csb.Database!.Replace("\"", "\"\"") + "\"";
            using (var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)", conn))
                drop.ExecuteNonQuery();
            using (var create = new NpgsqlCommand($"CREATE DATABASE {quoted}", conn))
                create.ExecuteNonQuery();
        }
        catch (Exception)
        {
            // Unreachable Postgres: leave it to TestDb.Require (skip locally,
            // hard-fail under SPECTR_REQUIRE_DB=1).
        }
    }

    private static void IsolateRedis()
    {
        var configured = Environment.GetEnvironmentVariable("Redis__ConnectionString");
        var cs = string.IsNullOrWhiteSpace(configured) ? DefaultRedis : configured;
        if (!cs.Contains("defaultDatabase", StringComparison.OrdinalIgnoreCase))
            cs += $",defaultDatabase={TestRedisDb}";
        Environment.SetEnvironmentVariable("Redis__ConnectionString", cs);

        try
        {
            var options = ConfigurationOptions.Parse(cs);
            options.AllowAdmin = true; // FLUSHDB
            options.ConnectTimeout = 3000;
            options.AbortOnConnectFail = true;
            using var mux = ConnectionMultiplexer.Connect(options);
            var db = options.DefaultDatabase ?? TestRedisDb;
            foreach (var endpoint in mux.GetEndPoints())
                mux.GetServer(endpoint).FlushDatabase(db);
        }
        catch (Exception)
        {
            // Unreachable Redis: RedisUp() gates the tests that need it.
        }
    }
}
