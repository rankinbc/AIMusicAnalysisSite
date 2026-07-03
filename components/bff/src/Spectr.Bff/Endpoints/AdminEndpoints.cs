using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.Auth;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Text.RegularExpressions;

namespace Spectr.Bff.Endpoints;

// Story 10.5 (FR46/NFR7) — the operator surface. Every route sits behind
// AdminAuth.Filter (X-Admin-Key; 404 until configured). Every MUTATION
// requires a non-empty reason and writes an audit_log row in the same
// transaction — the audit row is the point, not a side effect.
//
// The audit actor for operator actions is Guid.Empty: there is no operator
// user row, and actor_user_id has deliberately carried no FK since 4.6.
public static partial class AdminEndpoints
{
    public static readonly Guid OperatorActor = Guid.Empty;

    // Mirrors the worker's prompt_loader._SAFE_VERSION_RE — path-injection
    // defense on the pin value (the worker builds a filename from it).
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._\-]{0,31}$")]
    private static partial Regex SafeVersion();

    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin")
            .AddEndpointFilter(AdminAuth.Filter)
            .AllowAnonymous(); // user-JWT pipeline deliberately NOT involved (NFR7)

        admin.MapGet("/users/{idOrEmail}/billing", GetBillingTrail);
        admin.MapPost("/refunds", PostRefund);
        admin.MapPost("/users/{id:guid}/ban", PostBan);
        admin.MapPost("/users/{id:guid}/unban", PostUnban);
        admin.MapPut("/flags/{name}", PutFlag);
        admin.MapPut("/prompts/{slug}", PutPromptPin);
        admin.MapGet("/audit", GetAudit);
    }

    // ── AC1 — the billing/webhook trail for refund decisions ────────────────
    private static async Task<IResult> GetBillingTrail(
        string idOrEmail, AppDbContext db, CancellationToken ct)
    {
        var user = Guid.TryParse(idOrEmail, out var uid)
            ? await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == uid, ct)
            : await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == idOrEmail.ToLowerInvariant(), ct);
        if (user is null)
            return ErrorEnvelope.Build(404, "user_not_found", "No user by that id/email.");

        var ledger = await db.CreditLedger.AsNoTracking()
            .Where(e => e.UserId == user.Id)
            .OrderByDescending(e => e.CreatedAt).Take(100).ToListAsync(ct);
        var subscription = await db.Subscriptions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == user.Id, ct);
        var usage = await db.UsageEvents.AsNoTracking()
            .Where(e => e.UserId == user.Id)
            .OrderByDescending(e => e.OccurredAt).Take(50).ToListAsync(ct);
        var llmSpend = await db.LlmCalls.AsNoTracking()
            .Where(c => c.UserId == user.Id)
            .GroupBy(c => c.Purpose)
            .Select(g => new { purpose = g.Key, calls = g.Count(), costUsd = g.Sum(c => c.CostUsd) })
            .ToListAsync(ct);
        // webhook_events carries NO user_id (payload-hash only, PCI hygiene) —
        // the operator correlates via the user's stripe ids; we hand both over.
        var recentWebhooks = await db.WebhookEvents.AsNoTracking()
            .OrderByDescending(w => w.ReceivedAt).Take(50).ToListAsync(ct);
        var priorActions = await db.AuditLogs.AsNoTracking()
            .Where(a => a.Target == user.Id.ToString())
            .OrderByDescending(a => a.CreatedAt).Take(50).ToListAsync(ct);

        return Results.Json(new
        {
            user = new
            {
                user.Id, user.Email, user.CreatedAt, user.StripeCustomerId,
                user.BannedAt, user.BanReason, user.TokenVersion,
            },
            subscription,
            creditBalance = ledger.Sum(e => e.Amount),
            creditLedger = ledger,
            usageEvents = usage,
            llmSpendByPurpose = llmSpend,
            stripeCorrelation = new
            {
                customerId = user.StripeCustomerId,
                subscriptionId = subscription?.StripeSubscriptionId,
            },
            recentWebhookEvents = recentWebhooks,
            priorAdminActions = priorActions,
        });
    }

    // ── AC2 — refunds (credits and/or Stripe), audited ──────────────────────
    public sealed record RefundRequest(
        Guid UserId, int? Credits, string? PaymentIntentId, string Reason);

    private static async Task<IResult> PostRefund(
        RefundRequest req, AppDbContext db, IStripeRefundClient stripe,
        HttpContext httpCtx, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return ErrorEnvelope.Build(400, "reason_required", "Every admin action needs a reason.");
        if (req.Credits is null && string.IsNullOrWhiteSpace(req.PaymentIntentId))
            return ErrorEnvelope.Build(400, "nothing_to_refund", "Provide credits and/or paymentIntentId.");
        if (req.Credits is <= 0)
            return ErrorEnvelope.Build(400, "invalid_credits", "credits must be positive.");
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == req.UserId, ct);
        if (user is null)
            return ErrorEnvelope.Build(404, "user_not_found", "No such user.");

        string? stripeRefundId = null;
        if (!string.IsNullOrWhiteSpace(req.PaymentIntentId))
        {
            try
            {
                var refund = await stripe.CreateRefundAsync(req.PaymentIntentId!, ct);
                stripeRefundId = refund.Id;
            }
            catch (Exception ex)
            {
                httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Admin").LogError(ex,
                        "Stripe refund failed for intent {Intent}", req.PaymentIntentId);
                return ErrorEnvelope.Build(502, "stripe_refund_failed",
                    "Stripe rejected the refund — nothing was recorded.");
            }
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (req.Credits is int credits)
        {
            db.CreditLedger.Add(new CreditLedgerEntry
            {
                Id = Guid.NewGuid(),
                UserId = req.UserId,
                Amount = credits,
                Reason = "adjustment", // the CHECK-reserved admin reason
                Reference = stripeRefundId ?? req.PaymentIntentId,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = OperatorActor,
            Action = "refund",
            Target = req.UserId.ToString(),
            Reason = $"{req.Reason} (credits={req.Credits?.ToString() ?? "-"}, intent={req.PaymentIntentId ?? "-"}, stripeRefund={stripeRefundId ?? "-"})",
        });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        return Results.Json(new { ok = true, stripeRefundId });
    }

    // ── AC3 — ban / unban (kills sessions via token-versioning) ─────────────
    public sealed record AdminActionRequest(string Reason);

    private static async Task<IResult> PostBan(
        Guid id, AdminActionRequest req, AppDbContext db, IMemoryCache cache,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return ErrorEnvelope.Build(400, "reason_required", "Every admin action needs a reason.");
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return ErrorEnvelope.Build(404, "user_not_found", "No such user.");
        if (user.BannedAt is not null)
            return ErrorEnvelope.Build(409, "already_banned", "User is already banned.");

        user.BannedAt = DateTimeOffset.UtcNow;
        user.BanReason = req.Reason[..Math.Min(req.Reason.Length, 500)];
        user.TokenVersion++; // outstanding sessions die (4.6 machinery)
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = OperatorActor, Action = "ban",
            Target = id.ToString(), Reason = req.Reason,
        });
        await db.SaveChangesAsync(ct);
        cache.Remove($"tver:{id:N}"); // instant same-process revocation
        return Results.Json(new { ok = true });
    }

    private static async Task<IResult> PostUnban(
        Guid id, AdminActionRequest req, AppDbContext db, IMemoryCache cache,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return ErrorEnvelope.Build(400, "reason_required", "Every admin action needs a reason.");
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return ErrorEnvelope.Build(404, "user_not_found", "No such user.");
        if (user.BannedAt is null)
            return ErrorEnvelope.Build(409, "not_banned", "User is not banned.");

        user.BannedAt = null;
        user.BanReason = null;
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = OperatorActor, Action = "unban",
            Target = id.ToString(), Reason = req.Reason,
        });
        await db.SaveChangesAsync(ct);
        cache.Remove($"tver:{id:N}");
        return Results.Json(new { ok = true });
    }

    // ── AC3 — feature flags (live no-redeploy knobs) ─────────────────────────
    public sealed record FlagRequest(string Value, string Reason);

    private static async Task<IResult> PutFlag(
        string name, FlagRequest req, AppDbContext db, IMemoryCache cache,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return ErrorEnvelope.Build(400, "reason_required", "Every admin action needs a reason.");
        if (name.Length is 0 or > 128 || req.Value.Length > 512)
            return ErrorEnvelope.Build(400, "invalid_flag", "name<=128, value<=512.");

        var flag = await db.FeatureFlags.FirstOrDefaultAsync(f => f.Name == name, ct);
        var previous = flag?.Value;
        if (flag is null)
            db.FeatureFlags.Add(new FeatureFlag { Name = name, Value = req.Value, UpdatedAt = DateTimeOffset.UtcNow });
        else
        {
            flag.Value = req.Value;
            flag.UpdatedAt = DateTimeOffset.UtcNow;
        }
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = OperatorActor, Action = "flag_change",
            Target = $"feature_flags/{name}",
            Reason = $"{req.Reason} ({previous ?? "<absent>"} → {req.Value})",
        });
        await db.SaveChangesAsync(ct);
        // Instant local effect; the worker's independent 60 s TTL is the
        // documented cross-service bound.
        cache.Remove("feature_flags_global");
        return Results.Json(new { ok = true, previous });
    }

    // ── AC3 — prompt pins (FR48 rollback without redeploy) ──────────────────
    public sealed record PromptPinRequest(string? PinnedVersion, string Reason);

    private static async Task<IResult> PutPromptPin(
        string slug, PromptPinRequest req, AppDbContext db, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return ErrorEnvelope.Build(400, "reason_required", "Every admin action needs a reason.");
        if (!SpecialistCatalog.SlugSet.Contains(slug))
            return ErrorEnvelope.Build(404, "unknown_slug", "Not a specialist slug.");
        if (req.PinnedVersion is not null && !SafeVersion().IsMatch(req.PinnedVersion))
            return ErrorEnvelope.Build(400, "invalid_version",
                "Version must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ (the worker builds a filename from it).");

        var row = await db.PromptVersions.FirstOrDefaultAsync(p => p.Slug == slug, ct);
        var previous = row?.PinnedVersion;
        if (row is null)
            db.PromptVersions.Add(new PromptVersion
            { Slug = slug, PinnedVersion = req.PinnedVersion, UpdatedAt = DateTimeOffset.UtcNow });
        else
        {
            row.PinnedVersion = req.PinnedVersion;
            row.UpdatedAt = DateTimeOffset.UtcNow;
        }
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = OperatorActor, Action = "prompt_pin",
            Target = $"prompt_versions/{slug}",
            Reason = $"{req.Reason} ({previous ?? "<live>"} → {req.PinnedVersion ?? "<live>"})",
        });
        await db.SaveChangesAsync(ct);
        // Worker pin cache TTL is 60 s — effective within a minute, no redeploy.
        return Results.Json(new { ok = true, previous });
    }

    // ── The evidence trail itself ────────────────────────────────────────────
    private static async Task<IResult> GetAudit(
        AppDbContext db, CancellationToken ct, string? target = null, int limit = 100)
    {
        limit = Math.Clamp(limit, 1, 500);
        var q = db.AuditLogs.AsNoTracking().OrderByDescending(a => a.CreatedAt).AsQueryable();
        if (!string.IsNullOrWhiteSpace(target)) q = q.Where(a => a.Target == target);
        return Results.Json(await q.Take(limit).ToListAsync(ct));
    }
}
