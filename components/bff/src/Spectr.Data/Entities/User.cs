using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("users")]
public sealed class User
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("email"), MaxLength(255)]
    public required string Email { get; set; }

    [Column("hashed_password"), MaxLength(255)]
    public required string HashedPassword { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    // Story 4.3 (FR26): set when the verification link is consumed.
    // Timestamp (not bool) for audit. Since 2026-10 (verify-before-sign-in)
    // it GATES login + refresh for permanent accounts: null = pending
    // account, refused with 403 email_unverified. Guests are stamped at mint.
    [Column("email_verified_at")]
    public DateTimeOffset? EmailVerifiedAt { get; set; }

    // Story 4.4 (FR44/AR27): the analysis-complete email opt-out. Default ON;
    // the profile Settings tab owns the toggle. Scoped to completion emails
    // only — verification/reset/dunning/retention are not optional.
    [Column("notify_analysis_complete")]
    public bool NotifyAnalysisComplete { get; set; } = true;

    // Story 4.6 (4.3 commitment) — JWT token-versioning: stamped into every
    // access token as `tver`; OnTokenValidated rejects stale versions.
    // Bumped on password reset and account deletion so outstanding access
    // JWTs die within the 60 s validation-cache window instead of living
    // out their 15-minute TTL.
    [Column("token_version")]
    public int TokenVersion { get; set; } = 1;

    // Story 10.5 — operator ban (FR46/10.6 AC2). Non-null = banned. Bans bump
    // TokenVersion (sessions die ≤60 s) and block login/refresh with 403.
    [Column("banned_at")]
    public DateTimeOffset? BannedAt { get; set; }

    [Column("ban_reason"), MaxLength(500)]
    public string? BanReason { get; set; }

    // Display name only — solo fork: handle/bio/avatar_hue/banner_hue/accent/
    // public_link (public-profile fields) dropped by RemoveSocial.
    [Column("display_name"), MaxLength(80)]
    public string? DisplayName { get; set; }

    [Column("ui_prefs", TypeName = "jsonb")]
    public string? UiPrefs { get; set; }    // { density, ... }

    // Story 2.1 / Stripe Customer mirror. Set once by the checkout
    // endpoint after Stripe.Customer.create; reused on every subsequent
    // checkout so we don't create duplicate Stripe customers per user.
    // Unique-where-non-null (partial index added in migration Up()).
    [Column("stripe_customer_id"), MaxLength(64)]
    public string? StripeCustomerId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    // Guest demo sandbox (D1) — a guest is a real users row so every
    // ownership join, the audio stream, coach, and Listen page work
    // unchanged; they key on users.id regardless of IsGuest.
    [Column("is_guest")]
    public bool IsGuest { get; set; } = false;

    [Column("guest_expires_at")]
    public DateTimeOffset? GuestExpiresAt { get; set; }

    [Column("guest_device_id"), MaxLength(26)]
    public string? GuestDeviceId { get; set; }

    // Verify-before-sign-in (2026-10): a GUEST who signs up keeps being a
    // guest (same session, same guest fences) until the emailed link is
    // clicked. The chosen address + password hash wait here; the verify
    // endpoint performs the real conversion (GuestConversion) from them and
    // clears both. Never read by login — `email` still holds the reserved
    // guest address, so a pending conversion can't be signed into.
    // NOT unique: the users.email unique index is the arbiter at verify time.
    [Column("pending_email"), MaxLength(255)]
    public string? PendingEmail { get; set; }

    [Column("pending_password_hash"), MaxLength(255)]
    public string? PendingPasswordHash { get; set; }
}
