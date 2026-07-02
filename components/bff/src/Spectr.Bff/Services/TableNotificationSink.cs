using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Text.Json;

namespace Spectr.Bff.Services;

/// <summary>
/// Story 11.6 — the real INotificationSink: writes `notifications` rows.
///
/// - EVENT rows: one per NotifyAsync (comment_created / suggestion_created /
///   suggestion_accepted / mention), digest_key NULL.
/// - DIGEST rows: NotifyDigestAsync collapses per (recipient, digestType,
///   version, UTC day) via INSERT … ON CONFLICT (digest_key) DO UPDATE
///   count+1 — the partial unique index makes the upsert race-safe.
/// - Anon recipients are a NO-OP (AC2 — no orphan rows: the inbox is
///   account-scoped; anon reviewers get their surface in story 11.4).
/// - Best-effort: emitters call after their own SaveChanges; a sink failure
///   is logged and never breaks the domain write.
/// </summary>
public sealed class TableNotificationSink(AppDbContext db, ILogger<TableNotificationSink> log)
    : INotificationSink
{
    public async Task NotifyAsync(
        ActorRef recipient,
        string eventType,
        IReadOnlyDictionary<string, object?> data,
        CancellationToken ct = default)
    {
        if (recipient.Type != ActorType.User || recipient.UserId is not Guid uid) return;
        try
        {
            db.Notifications.Add(new Notification
            {
                RecipientUserId = uid,
                EventType = eventType,
                PayloadJson = JsonSerializer.Serialize(data),
            });
            await db.SaveChangesAsync(ct);
        }
        catch (Exception e)
        {
            log.LogWarning(e, "notification write failed (event={EventType} recipient={UserId})", eventType, uid);
        }
    }

    public async Task NotifyDigestAsync(
        ActorRef recipient,
        string digestType,
        Guid versionId,
        CancellationToken ct = default)
    {
        if (recipient.Type != ActorType.User || recipient.UserId is not Guid uid) return;
        var day = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
        var digestKey = $"{uid}:{digestType}:{versionId}:{day}";
        var payload = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["versionId"] = versionId,
            ["day"] = day,
        });
        try
        {
            // Atomic upsert on the partial unique index. New activity re-unreads
            // the digest row and bumps updated_at so it resurfaces in the inbox.
            await db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO notifications (id, recipient_user_id, event_type, payload, digest_key, count, read_at, created_at, updated_at)
VALUES (gen_random_uuid(), {uid}, {digestType}, {payload}::jsonb, {digestKey}, 1, NULL, now(), now())
ON CONFLICT (digest_key) WHERE digest_key IS NOT NULL
DO UPDATE SET count = notifications.count + 1, read_at = NULL, updated_at = now()", ct);
        }
        catch (Exception e)
        {
            log.LogWarning(e, "digest notification upsert failed (type={DigestType} recipient={UserId})", digestType, uid);
        }
    }
}
