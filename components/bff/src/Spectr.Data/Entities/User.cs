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

    // Identity / public profile fields (added in v2 — see REQUIREMENTS_ARCHITECTURE.md §Identity)
    [Column("handle"), MaxLength(32)]
    public string? Handle { get; set; }

    [Column("display_name"), MaxLength(80)]
    public string? DisplayName { get; set; }

    [Column("bio"), MaxLength(500)]
    public string? Bio { get; set; }

    [Column("avatar_hue")]
    public short? AvatarHue { get; set; }

    [Column("banner_hue")]
    public short? BannerHue { get; set; }

    [Column("accent"), MaxLength(16)]
    public string? Accent { get; set; }

    [Column("public_link"), MaxLength(200)]
    public string? PublicLink { get; set; }

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
}
