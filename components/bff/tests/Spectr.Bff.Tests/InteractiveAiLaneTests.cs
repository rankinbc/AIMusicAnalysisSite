using System.Security.Claims;
using Spectr.Bff.Auth;
using Spectr.Bff.Services;
using Xunit;

namespace Spectr.Bff.Tests;

// Interactive AI lane — run_triage / run_specialist / generate_fix_rack enqueue
// on `ai` (consumed by the multi-thread `coach ai` interactive pool) so Triage
// never waits behind a multi-minute analysis on the one-thread batch worker.
// Guests ride `ai-guest` (their own one-thread worker): demo traffic never takes
// the interactive pool's threads from real users nor waits behind batch work.
// The end-to-end call-site check
// (all three endpoints, guest vs real user) lives in GuestCapsTests.
public sealed class InteractiveAiLaneTests
{
    [Fact]
    public void Ai_Queue_Name_Matches_The_Worker_Declaration()
        // components/worker/app/{triage,verdict,fix_rack}_actor.py queue_name="ai"
        => Assert.Equal("ai", DramatiqQueues.Ai);

    [Fact]
    public void AiGuest_Queue_Name_Matches_The_Worker_Declaration()
        // components/worker/app/dramatiq_app.py broker.declare_queue("ai-guest")
        => Assert.Equal("ai-guest", DramatiqQueues.AiGuest);

    [Fact]
    public void Real_User_Interactive_Work_Rides_The_Ai_Lane()
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) }, "test"));
        Assert.Equal(DramatiqQueues.Ai, GuestLimits.AiQueueFor(user));
    }

    [Fact]
    public void Guest_Interactive_Work_Rides_The_AiGuest_Lane()
    {
        var guest = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(GuestIdentity.ClaimType, "1") }, "test"));
        Assert.Equal(DramatiqQueues.AiGuest, GuestLimits.AiQueueFor(guest));
    }

    [Fact]
    public void Guest_Analysis_Work_Stays_On_The_Free_Lane()
    {
        var guest = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(GuestIdentity.ClaimType, "1") }, "test"));
        Assert.Equal(DramatiqQueues.AnalysisFree, GuestLimits.QueueFor(guest, DramatiqQueues.AnalysisPaid));
    }
}
