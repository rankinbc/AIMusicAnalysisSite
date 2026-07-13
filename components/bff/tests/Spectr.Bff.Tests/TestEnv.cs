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
//
// Story 12.7 (12-2 review deferral, documented): a consequence of this pin is
// that NO factory-hosted integration test ever exercises the Development
// fast-tier reaper config end-to-end — the dev 5-minute grace is verified
// ONLY by StaleJobReaperTests' explicit-options unit tests
// (Pending_Fast_Tier_Fires_Only_When_The_Heartbeat_Is_Stale and
// Pending_Fast_Tier_Fires_When_No_Heartbeat_Exists). If the fast tier's
// wiring in appsettings.Development.json changes, those tests will not catch
// a broken binding; the trade-off is accepted because unpinning would let
// factory reapers eat test-seeded pending jobs mid-assertion.
internal static class TestEnv
{
    [ModuleInitializer]
    internal static void Init() =>
        Environment.SetEnvironmentVariable("Worker__PendingNoWorkerGraceMinutes", "240");
}
