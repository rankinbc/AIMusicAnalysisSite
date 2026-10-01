using System.Security.Claims;
using Spectr.Bff.Auth;
using Spectr.Bff.Services;
using Xunit;

namespace Spectr.Bff.Tests;

// Interactive AI lane — run_triage / run_specialist / generate_fix_rack enqueue
// on `ai` (consumed by the multi-thread `coach ai` interactive pool) so Triage
// never waits behind a multi-minute analysis on the one-thread batch worker.
// Guests keep riding the free lane: demo traffic must never take the
// interactive pool's threads from real users. The end-to-end call-site check
// (all three endpoints, guest vs real user) lives in GuestCapsTests.
public sealed class InteractiveAiLaneTests
{
    [Fact]
    public void Ai_Queue_Name_Matches_The_Worker_Declaration()
        // components/worker/app/{triage,verdict,fix_rack}_actor.py queue_name="ai"
        => Assert.Equal("ai", DramatiqQueues.Ai);

    [Fact]
    public void Real_User_Interactive_Work_Rides_The_Ai_Lane()
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "test"));
        Assert.Equal(DramatiqQueues.Ai, GuestLimits.QueueFor(user, DramatiqQueues.Ai));
    }

    [Fact]
    public void Guest_Interactive_Work_Stays_On_The_Free_Lane()
    {
        var guest = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(GuestIdentity.ClaimType, "1") }, "test"));
        Assert.Equal(DramatiqQueues.AnalysisFree, GuestLimits.QueueFor(guest, DramatiqQueues.Ai));
    }
}
