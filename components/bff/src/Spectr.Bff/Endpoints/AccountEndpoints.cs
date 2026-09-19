using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.Auth;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Story 4.6 (FR27) — GDPR export + account deletion.
//
// Split of responsibilities (decision 2): this endpoint handles identity,
// audit, and token revocation SYNCHRONOUSLY; the content subtree + storage
// objects purge via the worker's delete_account_data actor on the
// maintenance queue (the BFF cannot delete R2 objects and must not block a
// request on N of them).
//
// "Detached per policy" (decision 3): Stripe-side records are RETAINED
// (Tax/NFR23 — financial records, legitimate interest); local billing tables
// (subscriptions, credit_ledger, usage_events, webhook_events, llm_calls)
// are RETAINED keyed by the now-orphaned user id — pseudonymous once the
// user row is gone. Everything content/PII deletes.
public static class AccountEndpoints
{
    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me").WithTags("account").RequireAuthorization();
        g.MapGet("/export", Export);
        g.MapPost("/delete", DeleteAccount);
        return app;
    }

    public sealed record DeleteAccountRequest(string? Password, bool ConfirmCancel = false);

    // ── GET /api/me/export — AC1 ─────────────────────────────────────────────
    private static async Task<IResult> Export(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IMultipartObjectStore objectStore,
        IRateLimiter limiter,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var cfg = httpCtx.RequestServices.GetRequiredService<IConfiguration>();
        if (!string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var verdict = await limiter.CheckAsync(
                    $"user:{userId}", httpCtx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    "account_export", 2, TimeSpan.FromHours(1), ct);
                if (!verdict.Allowed)
                    return ErrorEnvelope.Build(429, "rate_limited",
                        "Export is limited to a couple of runs per hour.");
            }
            catch (Exception) { /* fail-open (4.3 precedent) */ }
        }

        var account = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                u.Id, u.Email, u.Handle, u.DisplayName, u.Bio, u.PublicLink,
                u.EmailVerifiedAt, u.NotifyAnalysisComplete, u.CreatedAt,
            })
            .FirstOrDefaultAsync(ct);
        if (account is null) return Results.Unauthorized();

        var songs = await db.Songs.AsNoTracking()
            .Where(s => s.UserId == userId)
            .Select(s => new { s.Id, s.Name, s.ArchivedAt, s.CreatedAt })
            .ToListAsync(ct);
        var songIds = songs.Select(s => s.Id).ToList();

        var versions = await db.SongVersions.AsNoTracking()
            .Where(v => songIds.Contains(v.SongId))
            .Select(v => new
            {
                v.Id, v.SongId, v.VersionNumber, v.FilePath, v.ReferencePath,
                v.AlsFilePath, v.StemPaths, v.RawAudioPurgedAt, v.CreatedAt,
            })
            .ToListAsync(ct);

        var analyses = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId)
            .Select(a => new
            {
                a.Id, a.JobId, a.SongId, a.SongName, a.VersionId,
                a.FinalJson, a.ShareToken, a.CreatedAt,
                a.SpectrogramImagePath, a.WaveformImagePath,
            })
            .ToListAsync(ct);
        var analysisIds = analyses.Select(a => a.Id).ToList();

        var verdicts = await db.Verdicts.AsNoTracking()
            .Where(v => analysisIds.Contains(v.AnalysisId))
            .ToListAsync(ct);

        var conversations = await db.Conversations.AsNoTracking()
            .Where(c => c.UserId == userId)
            .ToListAsync(ct);
        var convIds = conversations.Select(c => c.Id).ToList();
        var messages = await db.CoachMessages.AsNoTracking()
            .Where(m => convIds.Contains(m.ConversationId))
            .Select(m => new { m.Id, m.ConversationId, m.Role, m.Content, m.CreatedAt })
            .ToListAsync(ct);

        // Right-to-access PARITY (review-hardened): everything deletion
        // destroys — and the retained billing rows — is exportable.
        var referenceTracks = await db.ReferenceTracks.AsNoTracking()
            .Where(r => r.UserId == userId).ToListAsync(ct);
        var ratings = await db.VersionUserRatings.AsNoTracking()
            .Where(r => r.UserId == userId).ToListAsync(ct);
        var compareNotes = await db.VersionCompareNotes.AsNoTracking()
            .Where(n => n.UserId == userId).ToListAsync(ct);
        var sessionNotes = await db.SessionNotes.AsNoTracking()
            .Where(n => n.UserId == userId).ToListAsync(ct);
        var comments = await db.TrackComments.AsNoTracking()
            .Where(c => c.AuthorUserId == userId).ToListAsync(ct);
        var bookmarks = await db.TrackBookmarks.AsNoTracking()
            .Where(b => b.UserId == userId).ToListAsync(ct);
        var billing = new
        {
            subscriptions = await db.Subscriptions.AsNoTracking()
                .Where(s => s.UserId == userId)
                .Select(s => new { s.Status, s.CurrentPeriodEnd, s.CreatedAt })
                .ToListAsync(ct),
            creditLedger = await db.CreditLedger.AsNoTracking()
                .Where(e => e.UserId == userId)
                .Select(e => new { e.Amount, e.Reason, e.CreatedAt })
                .ToListAsync(ct),
            usageEventCount = await db.UsageEvents.CountAsync(e => e.UserId == userId, ct),
        };

        // Media manifest: every storage key the user owns + a signed link
        // when object storage is configured (15-min expiry — the export is a
        // point-in-time snapshot, links are re-obtainable by re-exporting).
        var mediaKeys = new List<string>();
        foreach (var v in versions)
        {
            if (v.RawAudioPurgedAt is null)
            {
                if (!string.IsNullOrEmpty(v.FilePath)) mediaKeys.Add(v.FilePath);
                if (!string.IsNullOrEmpty(v.ReferencePath)) mediaKeys.Add(v.ReferencePath!);
                if (!string.IsNullOrEmpty(v.AlsFilePath)) mediaKeys.Add(v.AlsFilePath!);
                if (v.StemPaths is not null)
                    mediaKeys.AddRange(ExtractStemKeys(v.StemPaths));
            }
        }
        foreach (var a in analyses)
        {
            if (!string.IsNullOrEmpty(a.SpectrogramImagePath)) mediaKeys.Add(a.SpectrogramImagePath!);
            if (!string.IsNullOrEmpty(a.WaveformImagePath)) mediaKeys.Add(a.WaveformImagePath!);
        }
        mediaKeys.AddRange(referenceTracks
            .Where(r => !string.IsNullOrEmpty(r.FilePath))
            .Select(r => r.FilePath!));
        var manifest = mediaKeys.Distinct().Select(key => new
        {
            key,
            signedUrl = objectStore.IsConfigured ? objectStore.PresignGetUrl(key) : null,
        }).ToList();

        var export = new
        {
            exportedAt = DateTimeOffset.UtcNow,
            format = "spectr-export/v1",
            account,
            songs,
            versions,
            // Machine-readable form: final_json embedded as real JSON, not an
            // escaped string.
            reports = analyses.Select(a => new
            {
                a.Id, a.JobId, a.SongId, a.SongName, a.VersionId,
                finalJson = TryParse(a.FinalJson),
                a.ShareToken, a.CreatedAt,
            }),
            verdicts,
            conversations = conversations.Select(c => new
            {
                c.Id, c.AnalysisId, c.CreatedAt,
                messages = messages.Where(m => m.ConversationId == c.Id).OrderBy(m => m.CreatedAt),
            }),
            referenceTracks,
            ratings,
            compareNotes,
            sessionNotes,
            comments,
            bookmarks,
            billing,
            mediaManifest = manifest,
        };

        return Results.Json(export, contentType: "application/json");

        static object? TryParse(string? json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            try { return System.Text.Json.JsonDocument.Parse(json).RootElement.Clone(); }
            catch (System.Text.Json.JsonException) { return json; }
        }

        static IEnumerable<string> ExtractStemKeys(string stemPathsJson)
        {
            List<string> keys = [];
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(stemPathsJson);
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    if (prop.Value.ValueKind == System.Text.Json.JsonValueKind.Array)
                        keys.AddRange(prop.Value.EnumerateArray()
                            .Where(e => e.ValueKind == System.Text.Json.JsonValueKind.String)
                            .Select(e => e.GetString()!));
                    else if (prop.Value.ValueKind == System.Text.Json.JsonValueKind.String)
                        keys.Add(prop.Value.GetString()!);
                }
            }
            catch (System.Text.Json.JsonException) { /* legacy shape — skip */ }
            return keys;
        }
    }

    // ── POST /api/me/delete — AC2/AC3/AC4 ────────────────────────────────────
    private static async Task<IResult> DeleteAccount(
        DeleteAccountRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        PasswordHasher hasher,
        RefreshTokenService refresh,
        IJobQueue queue,
        IStripeSubscriptionClient stripe,
        IRateLimiter limiter,
        HttpContext httpCtx,
        HttpResponse resp,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.Unauthorized();

        // Password-guessing throttle: an attacker holding only an access
        // token must not get an unthrottled oracle at the deadliest endpoint.
        var cfgDel = httpCtx.RequestServices.GetRequiredService<IConfiguration>();
        if (!string.Equals(cfgDel["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var verdict = await limiter.CheckAsync(
                    $"user:{userId}", httpCtx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    "account_delete", 5, TimeSpan.FromMinutes(15), ct);
                if (!verdict.Allowed)
                    return ErrorEnvelope.Build(429, "rate_limited", "Too many attempts — slow down.");
            }
            catch (Exception) { /* fail-open */ }
        }

        // Re-auth: deletion is the most destructive action in the product.
        // 403, NOT 401 — the fetcher's transport contract treats 401 as
        // "token expired" and would silently refresh + auto-RETRY this
        // destructive POST.
        if (string.IsNullOrEmpty(req.Password) || !hasher.Verify(req.Password, user.HashedPassword))
            return ErrorEnvelope.Build(403, "invalid_password", "Password check failed.");

        // AC3 — active subscription: explain cancellation-first; proceed only
        // with explicit confirmation, which cancels IMMEDIATELY (an account
        // about to not exist has no period-end to wait for; no refunds —
        // stated in the confirm copy).
        var anyLive = await db.Subscriptions.AsNoTracking()
            .AnyAsync(s => s.UserId == userId
                && (s.Status == "active" || s.Status == "trialing" || s.Status == "past_due"), ct);
        if (anyLive && !req.ConfirmCancel)
            return ErrorEnvelope.Build(409, "subscription_active",
                "Your subscription is still active. Deleting your account cancels it "
                + "immediately with no refund for the remaining period. Re-submit with "
                + "confirmCancel to proceed.");
        // Cancel EVERY sub row with a Stripe id, regardless of local status —
        // the mirror can be stale (unpaid/incomplete/missed webhook) and a
        // live Stripe sub must never keep invoicing a deleted account.
        // CancelImmediatelyAsync is idempotent on already-canceled.
        var stripeSubIds = await db.Subscriptions.AsNoTracking()
            .Where(s => s.UserId == userId && s.StripeSubscriptionId != "")
            .Select(s => s.StripeSubscriptionId)
            .ToListAsync(ct);
        foreach (var subId in stripeSubIds)
        {
            try
            {
                await stripe.CancelImmediatelyAsync(subId, userId, ct);
            }
            catch (Exception ex)
            {
                httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Account").LogError(ex,
                        "Immediate Stripe cancel failed for {UserId} sub {SubId} — deletion aborted.",
                        userId, subId);
                return ErrorEnvelope.Build(502, "stripe_cancel_failed",
                    "Could not cancel the subscription — account not deleted. Try again.");
            }
        }

        // AC4 + identity teardown in ONE transaction: the audit row must
        // commit with the delete (actor = the user being removed; audit_log
        // deliberately has no FK for exactly this reason).
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            db.AuditLogs.Add(new AuditLog
            {
                ActorUserId = userId,
                Action = "account_delete",
                Target = userId.ToString(),
                Reason = "user-initiated (FR27)",
            });
            await db.SaveChangesAsync(ct);

            await refresh.RevokeAllForUserAsync(userId, ct);
            await db.AuthTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(ct);
            await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(ct);
            // Devices this user claimed: sever attribution AND scrub the
            // peppered ip/ua hashes (hashed network identifiers are still
            // personal data once the account is gone).
            await db.Devices.Where(d => d.ClaimedByUserId == userId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(d => d.ClaimedByUserId, (Guid?)null)
                    .SetProperty(d => d.IpHash, "")
                    .SetProperty(d => d.UaHash, ""), ct);
            // PII scrub the FK graph can't do: the user's email inside OTHERS'
            // invite rows (survives the SetNull cascade otherwise).
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE invites SET invited_email = NULL WHERE invited_email = {user.Email}", ct);

            // The user row: FK-cascades take viz_presets, listening_sessions,
            // control_grants, notifications, follow_relations, invites.
            db.Users.Remove(user);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }

        // Local session teardown FIRST — must happen even if the enqueue
        // below fails (the deleted user's cached tver must not validate for
        // another 60 s).
        httpCtx.RequestServices.GetRequiredService<IMemoryCache>().Remove($"tver:{userId:N}");
        resp.Cookies.Delete(RefreshTokenService.CookieName);

        // Content subtree + storage objects purge asynchronously (idempotent).
        // A failed enqueue must NOT 500: the identity deletion already
        // committed and the user cannot retry (login is dead). LogCritical +
        // the nightly sweep's orphaned-account detector re-enqueues.
        try
        {
            await queue.EnqueueAsync(
                DramatiqTasks.DeleteAccountData, [userId.ToString()], DramatiqQueues.Maintenance, ct);
        }
        catch (Exception ex)
        {
            httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("Account").LogCritical(ex,
                    "Account-purge enqueue FAILED for {UserId} — sweep_retention's "
                    + "orphaned-account detector will re-enqueue on the next nightly run.",
                    userId);
        }

        return Results.NoContent();
    }
}
