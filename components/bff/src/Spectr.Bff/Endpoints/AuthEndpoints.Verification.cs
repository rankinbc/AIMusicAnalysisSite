using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Verify-before-sign-in (2026-10). A permanent account is PENDING until its
// emailed link is clicked:
//   - register      → 202 VerificationPendingResponse, no tokens/cookie
//   - login/refresh → 403 email_unverified for a pending account
//   - verify link   → activates AND signs in (tokens + refresh cookie); for a
//                     guest with a pending sign-up it performs the guest →
//                     account conversion first (same row, work kept)
//   - resend        → anonymous, by email, rate-limited, always the same 202
public static partial class AuthEndpoints
{
    internal static IResult EmailUnverified()
        => ErrorEnvelope.Build(403, "email_unverified",
            "Verify your email to sign in — use the link we sent you, or send a new one.");

    private static IResult InvalidVerifyToken()
        => ErrorEnvelope.Build(400, "invalid_token",
            "This verification link is invalid, expired, or already used.");

    // POST /api/auth/verify-email {token}
    private static async Task<IResult> VerifyEmail(
        VerifyEmailRequest req,
        AppDbContext db,
        AuthTokenService tokens,
        JwtTokenService jwt,
        RefreshTokenService refresh,
        IMemoryCache cache,
        CreditLedgerService ledger,
        EntitlementService entitlements,
        IRateLimiter limiter,
        ILoggerFactory loggerFactory,
        HttpContext httpCtx,
        HttpResponse resp,
        CancellationToken ct)
    {
        if (await RateLimitAsync(limiter, httpCtx, "auth_verify",
                $"ip:{ClientIp(httpCtx)}", 10, TimeSpan.FromMinutes(1), ct) is { } denied)
            return denied;

        // Read before the transaction opens (60 s cached flag map).
        var bonus = await SignupBonusAmountAsync(entitlements, loggerFactory, ct);
        var now = DateTimeOffset.UtcNow;
        var converted = false;
        Guid userId;

        // Transaction: consume + activate commit together — a failure after
        // the consume rolls the token back, never strands a burned link. An
        // early return disposes the transaction uncommitted (= rollback), so
        // a refused link stays exactly as it was.
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            var consumed = await tokens.ConsumeAsync(
                req.Token ?? "", AuthTokenService.PurposeVerifyEmail, ct);
            if (consumed is null) return InvalidVerifyToken();
            userId = consumed.Value;

            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct);
            // IsActive: a deactivated account must not gain a verified stamp.
            if (user is null || !user.IsActive) return InvalidVerifyToken();
            if (user.BannedAt is not null)
                return ErrorEnvelope.Build(403, "account_banned",
                    "This account is suspended. Contact support.");

            if (user.IsGuest)
            {
                // A guest only ever receives a verify link for a pending
                // sign-up (POST /auth/guest/convert). No pending data = a
                // stale link from a superseded attempt.
                if (user.PendingEmail is not { } pendingEmail
                    || user.PendingPasswordHash is not { } pendingHash)
                    return InvalidVerifyToken();

                int rows;
                try
                {
                    rows = await GuestConversion.TryConvertAsync(
                        db, userId, pendingEmail, pendingHash,
                        DeriveDisplayNameFromEmail(pendingEmail), autoVerify: true, now, ct);
                }
                // Someone registered that address between sign-up and click —
                // the users.email unique index is the arbiter.
                catch (Exception ex) when (IsUniqueViolation(ex))
                {
                    return ErrorEnvelope.Build(409, "email_taken",
                        "That email is already registered to another account — sign in to it instead.");
                }
                // 0 rows: the guest sandbox expired before the link was clicked.
                if (rows == 0)
                    return ErrorEnvelope.Build(410, "guest_expired",
                        "Your guest session ended before the email was verified — create an account to start again.");

                // Post-conversion this account has exactly one live session:
                // the one minted below. The guest's own refresh rows go.
                await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(ct);
                db.AuditLogs.Add(new AuditLog
                {
                    ActorUserId = userId,
                    Action = "guest_converted",
                    Target = userId.ToString(),
                    Reason = "guest created an account (email verified)",
                });
                await db.SaveChangesAsync(ct);
                converted = true;
                // Activation of a new permanent account → sign-up bonus,
                // committed atomically with the conversion.
                await ledger.GrantSignupBonusAsync(userId, bonus, ct);
            }
            else
            {
                var activated = await db.Users.Where(u => u.Id == userId && u.EmailVerifiedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailVerifiedAt, now), ct);
                // Only the click that ACTIVATES the account grants (an
                // already-verified account re-clicking a live link doesn't);
                // the ledger's idempotency key makes a second grant
                // impossible regardless.
                if (activated == 1) await ledger.GrantSignupBonusAsync(userId, bonus, ct);
            }
            await tx.CommitAsync(ct);
        }

        // A converted guest's OLD access token dies now (the conversion bumped
        // token_version) — evict the 60 s validation-cache entry (Story 4.6).
        if (converted) cache.Remove($"tver:{userId:N}");

        // Guest demo stays guest-only (owner decision 2026-10) — removed once
        // the conversion has committed; best-effort, never fails the click.
        if (converted) await GuestConversion.RemoveGuestDemoAsync(db, userId, loggerFactory);

        // The link proved mailbox control: sign in exactly as login does.
        // Session issuance is NOT part of the activation transaction — a blip
        // here leaves a verified account the owner signs into normally.
        try
        {
            var signedIn = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, ct);
            var (rawRefresh, _) = await refresh.IssueAsync(userId, ct);
            resp.Cookies.Append(RefreshTokenService.CookieName, rawRefresh, refresh.CookieOptions());
            return Results.Ok(new VerifyEmailResponse(jwt.Issue(signedIn),
                new AuthedUser(signedIn.Id, signedIn.Email, signedIn.DisplayName,
                    await ResolveTierAsync(db, userId, ct), signedIn.IsGuest),
                converted));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory.CreateLogger("Auth").LogError(ex,
                "Session issuance after email verification failed for {UserId}.", userId);
            return Results.NoContent(); // verified; the client sends them to sign in
        }
    }

    // POST /api/auth/resend-verification (auth) — no-op when already verified.
    // Serves the in-app VerifyEmailBanner (signed-in, still unverified: only
    // possible for a dev-login / pre-gate access token now).
    private static async Task<IResult> ResendVerification(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        AuthTokenService tokens,
        IEmailSender email,
        IConfiguration cfg,
        IWebHostEnvironment env,
        IRateLimiter limiter,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (await RateLimitAsync(limiter, httpCtx, "auth_resend_verify",
                $"user:{userId}", 3, TimeSpan.FromMinutes(15), ct) is { } denied)
            return denied;

        var user = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.Unauthorized();
        // Task D5 fix round 1 (I6) — a guest is stamped EmailVerifiedAt at
        // creation, so this is normally unreachable in practice; explicit
        // anyway so no future change to that stamp can open a send path.
        if (user.IsGuest) return Results.NoContent();
        if (user.EmailVerifiedAt is not null) return Results.NoContent(); // already done

        var lf = httpCtx.RequestServices.GetRequiredService<ILoggerFactory>();
        await SendVerificationEmailAsync(email, tokens, cfg, env, lf, user.Id, user.Email, IsLoopbackRequest(httpCtx), ct);
        return Results.NoContent();
    }

    // POST /api/auth/verify-email/resend {email} — ANONYMOUS. Always the same
    // 202 whether or not the address has a pending account, is already
    // verified, or is rate-limited (no enumeration). The lookup + send run
    // off-request in a fresh scope (ForgotPassword precedent) so response
    // timing isn't an oracle either.
    private static async Task<IResult> ResendVerificationByEmail(
        ResendVerificationRequest req,
        IRateLimiter limiter,
        ILoggerFactory loggerFactory,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var generic = Results.Accepted();
        var address = (req.Email ?? "").Trim();
        if (address.Length == 0 || address.Length > 320 || !address.Contains('@'))
            return generic;
        if (GuestIdentity.IsGuestEmail(address)) return generic;

        // Per-address arm (shared with register's send) — over the limit the
        // send is skipped, the response is not.
        if (!await VerifyResendAllowedAsync(limiter, httpCtx, address, ct))
            return generic;

        var scopeFactory = httpCtx.RequestServices.GetRequiredService<IServiceScopeFactory>();
        var logger = loggerFactory.CreateLogger("Auth");
        var localRequest = IsLoopbackRequest(httpCtx);
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var sp = scope.ServiceProvider;
                var sdb = sp.GetRequiredService<AppDbContext>();
                var now = DateTimeOffset.UtcNow;

                // A pending permanent account …
                var target = await sdb.Users.AsNoTracking()
                    .Where(u => u.Email == address && !u.IsGuest && u.IsActive
                        && u.BannedAt == null && u.EmailVerifiedAt == null)
                    .Select(u => new { u.Id, To = u.Email })
                    .FirstOrDefaultAsync();
                // … or a live guest whose sign-up is waiting on this address
                // (the newest, if several guests typed the same one).
                target ??= await sdb.Users.AsNoTracking()
                    .Where(u => u.IsGuest && u.PendingEmail == address && u.IsActive
                        && u.BannedAt == null && u.GuestExpiresAt > now)
                    .OrderByDescending(u => u.CreatedAt)
                    .Select(u => new { u.Id, To = u.PendingEmail! })
                    .FirstOrDefaultAsync();
                if (target is null) return;

                await SendVerificationEmailAsync(
                    sp.GetRequiredService<IEmailSender>(), sp.GetRequiredService<AuthTokenService>(),
                    sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<IWebHostEnvironment>(),
                    sp.GetRequiredService<ILoggerFactory>(), target.Id, target.To, localRequest,
                    CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Verification resend failed (background).");
            }
        }, CancellationToken.None);

        return generic;
    }

    // Sign-up bonus size = CreditPrices.SignupGrant — the same resolution the
    // pricing page shows (Credits:SignupGrant config → `signup_bonus_credits`
    // flag → default), so the advertised and granted amounts can't drift.
    // 0 / flag-read failure = no grant. Deliberately NOT gated on
    // credits_enabled: the credits sit in the ledger and simply don't matter
    // while the kill switch has everyone on premium.
    internal static async Task<int> SignupBonusAmountAsync(
        EntitlementService entitlements, ILoggerFactory lf, CancellationToken ct)
    {
        try
        {
            return (await entitlements.GetPricesAsync(ct)).SignupGrant;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            lf.CreateLogger("Auth").LogWarning(ex, "signup_bonus_credits flag unreadable — no sign-up bonus.");
            return 0;
        }
    }

    internal static bool IsUniqueViolation(Exception ex)
        => (ex is DbUpdateException due && DbViolations.IsUniqueViolation(due))
           || ex is Npgsql.PostgresException { SqlState: "23505" }
           || ex.InnerException is Npgsql.PostgresException { SqlState: "23505" };
}
