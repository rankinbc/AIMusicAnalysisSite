using Spectr.Bff.Auth;
using Spectr.Bff.Endpoints;

namespace Spectr.Bff.Services;

// Fix wave FW1 (final review I1) — one guest upload charges ONE slot of
// `guest_uploads_max`, on both upload paths, and an upload that never lands
// a version gives its slot back.
//
// The slots live in a removable ledger (IGuestSlots — a Redis sorted set
// keyed per guest, member = the upload's id, atomic Lua count-and-add), NOT
// the IRateLimiter sliding window: that window records anonymous hits, so an
// aborted upload's charge could never be refunded. Members:
//   pending:{jobId}  presigned /init — lapses on its own once the part URLs
//                    have expired, so an upload that is never completed or
//                    aborted cannot hold the slot forever;
//   done:{jobId}     a presigned upload /complete promoted (atomic move — two
//                    racing completes of one upload cannot both win);
//   done:{random}    a proxy POST /versions/ that committed its version row.
// Completed entries are held for `guest_ttl_hours` (the window the old
// limiter used; the guest itself expires then). Like every guest limiter the
// ledger sits behind RateLimits:Enabled, where only the DB count gates, and
// every ledger failure fails CLOSED.
public sealed partial class GuestLimits
{
    // Set by an upload handler right after its version row is committed; the
    // guard refunds the slot of any request that ends without it.
    internal const string UploadCommittedItem = "fw1.guest_upload_committed";

    public static void MarkUploadCommitted(HttpContext http) => http.Items[UploadCommittedItem] = true;

    internal static string UploadSlotsKey(Guid userId) => $"guest_upload_slots:{userId}";
    private static string PendingMember(Guid jobId) => $"pending:{jobId:N}";
    private static string DoneMember(Guid jobId) => $"done:{jobId:N}";

    // The per-IP and global arms are HOURLY windows, so an init-time charge
    // may stand in for a dispatch within that hour only; past it the
    // dispatch simply charges the arms afresh.
    private static readonly TimeSpan PrechargeHold = TimeSpan.FromHours(1);
    private static string PrechargeKey(Guid userId) => $"guest_analysis_precharge:{userId}";

    private TimeSpan CompletedHold(Dictionary<string, string> flags)
        => TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24));

    // ── proxy path (and any future .AllowGuestUpload() route) ───────────────
    // Called by GuestGuard AFTER CheckUploadAsync. Charges one slot, runs the
    // handler, and gives the slot back unless the handler committed a version
    // row — a refused request (bad file, name clash, storage error, exception)
    // costs nothing, and a committed one keeps the ledger in step with the
    // DB count GET /api/me/guest reports.
    public async Task<object?> ChargeUploadAroundAsync(HttpContext http, Func<ValueTask<object?>> handler)
    {
        if (!RateLimitsEnabled) return await handler();

        var key = UploadSlotsKey(http.User.UserId());
        var member = $"done:{Guid.NewGuid():N}";
        try
        {
            var flags = await ents.GetFlagsAsync(http.RequestAborted);
            var max = Flag(flags, "guest_uploads_max", 2);
            if (!await slots.TryTakeAsync(key, member, max, CompletedHold(flags), http.RequestAborted))
                return UploadLimit(max);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest upload slots unavailable — failing CLOSED");
            return DemoCapacity();
        }

        try
        {
            return await handler();
        }
        finally
        {
            if (!http.Items.ContainsKey(UploadCommittedItem)) await ReleaseSlotAsync(key, member);
        }
    }

    // ── presigned path: POST /uploads/init ───────────────────────────────────
    // Evaluates, before any byte moves: the guest's own analysis count, then
    // (rate limits on) takes a PENDING slot for this upload, then CHARGES the
    // per-IP + global analysis arms once for this upload. The slot is taken
    // before the arms so a guest with no slot left can never burn the shared
    // arms; if the arms refuse, the slot is given back.
    public async Task<IResult?> BeginPresignedUploadAsync(
        Guid userId, Guid jobId, HttpContext http, TimeSpan pendingHold, CancellationToken ct)
    {
        Dictionary<string, string> flags;
        try
        {
            flags = await ents.GetFlagsAsync(ct);
            if (await AnalysisCountRefusalAsync(userId, flags, ct) is { } over) return over;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest analysis quota unreadable at upload init — failing CLOSED");
            return DemoCapacity();
        }

        if (!RateLimitsEnabled) return null;

        var key = UploadSlotsKey(userId);
        var member = PendingMember(jobId);
        try
        {
            var max = Flag(flags, "guest_uploads_max", 2);
            if (!await slots.TryTakeAsync(key, member, max, pendingHold, ct)) return UploadLimit(max);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest upload slots unavailable — failing CLOSED");
            return DemoCapacity();
        }

        if (await ChargeAnalysisArmsAsync(flags, http, ct) is { } armsRefused)
        {
            await ReleaseSlotAsync(key, member);
            return armsRefused;
        }
        return null;
    }

    // /uploads/init's storage call failed, or the client aborted the upload:
    // a PENDING slot goes back. A completed upload is never refunded here —
    // its member is `done:`, which this never touches.
    public async Task CancelPresignedUploadAsync(Guid userId, Guid jobId)
    {
        if (!RateLimitsEnabled) return;
        await ReleaseSlotAsync(UploadSlotsKey(userId), PendingMember(jobId));
    }

    // ── presigned path: POST /uploads/complete ───────────────────────────────
    // Promotes this upload's pending slot to a completed one — charging
    // nothing new. No pending slot (never initiated by this guest, aborted,
    // lapsed, or already completed) → refused before any version is created.
    public async Task<IResult?> ClaimPresignedUploadAsync(Guid userId, Guid jobId, CancellationToken ct)
    {
        if (!RateLimitsEnabled) return null;
        try
        {
            var flags = await ents.GetFlagsAsync(ct);
            if (await slots.MoveAsync(UploadSlotsKey(userId), PendingMember(jobId), DoneMember(jobId),
                    CompletedHold(flags), ct))
                return null;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest upload slots unavailable at complete — failing CLOSED");
            return DemoCapacity();
        }
        return ErrorEnvelope.Build(409, "upload_not_started",
            "This upload has expired or was never started — please upload the file again.");
    }

    // /complete claimed the slot but did not commit a version (storage error,
    // name clash, exception): give it back — the client restarts from /init.
    public async Task ReleaseClaimedUploadAsync(Guid userId, Guid jobId)
    {
        if (!RateLimitsEnabled) return;
        await ReleaseSlotAsync(UploadSlotsKey(userId), DoneMember(jobId));
    }

    // /complete committed the version of an upload whose arms /init already
    // charged: record that, so the first analysis dispatched for this version
    // (at /complete itself, or later via /analyze or /stems/confirm when the
    // upload deferred analysis) spends it instead of charging again. A write
    // failure only means that dispatch charges the arms itself (fail-safe).
    public async Task CreditPrechargedAnalysisAsync(Guid userId, Guid versionId)
    {
        if (!RateLimitsEnabled) return;
        try
        {
            await slots.TryTakeAsync(PrechargeKey(userId), versionId.ToString("N"), int.MaxValue, PrechargeHold);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "guest analysis pre-charge not recorded — the dispatch will charge the arms");
        }
    }

    private async Task<bool> TryConsumePrechargedAnalysisAsync(Guid userId, Guid versionId)
    {
        try
        {
            return await slots.ReleaseAsync(PrechargeKey(userId), versionId.ToString("N"));
        }
        catch (Exception ex)
        {
            // Unknown → charge the arms (which themselves fail CLOSED).
            log.LogWarning(ex, "guest analysis pre-charge unreadable — charging the arms");
            return false;
        }
    }

    // Best-effort refund. If it fails the entry still lapses on its own —
    // the guest is under-granted for a while, never over-granted.
    private async Task ReleaseSlotAsync(string key, string member)
    {
        try
        {
            await slots.ReleaseAsync(key, member);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "guest upload slot refund failed — the entry will lapse on its own");
        }
    }
}
