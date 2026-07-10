using System.Runtime.CompilerServices;

namespace Spectr.Bff.Tests;

// Story 12.2 test-ripple guard (the 12-1 lesson): WebApplicationFactory runs
// env=Development, so appsettings.Development.json's
// Worker:PendingNoWorkerGraceMinutes=5 would load into EVERY factory host.
// Tests run with NO worker (heartbeat absent → "dead"), and each factory's
// background StaleJobReaper sweeps at startup + every 60 s — backdated
// pending jobs seeded by tests would be reaped from under their assertions.
// Environment variables load AFTER appsettings.Development.json, so pinning
// the prod default here keeps every factory host on the long grace. The fast
// tier itself is covered by StaleJobReaperTests via explicit options + a
// heartbeat stub, independent of this pin.
internal static class TestEnv
{
    [ModuleInitializer]
    internal static void Init() =>
        Environment.SetEnvironmentVariable("Worker__PendingNoWorkerGraceMinutes", "240");
}
