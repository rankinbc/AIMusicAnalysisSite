namespace Spectr.Bff.Options;

// Story 4.2 (AR27/NFR25) — Resend transactional email. Empty in dev: the
// send_email worker actor stubs (logs) without a key, so the dev stack needs
// no Resend account. SPECTR_REQUIRE_EMAIL=1 makes missing values a boot
// failure (SPECTR_REQUIRE_STRIPE precedent — not IsProduction(), see the
// Stripe review note in Program.cs).
public sealed class ResendOptions
{
    public const string SectionName = "Resend";

    /// <summary>Resend API key (re_...). Read by the WORKER actor via
    /// RESEND_API_KEY — this BFF copy exists only for IsConfigured gating
    /// and future BFF-side needs; the BFF never calls Resend directly.</summary>
    public string? ApiKey { get; init; }

    /// <summary>Svix signing secret (whsec_...) for POST /api/email/webhook.
    /// Unconfigured → webhook returns 503 (never processes unsigned events).</summary>
    public string? WebhookSecret { get; init; }

    /// <summary>Sender. Default is Resend's sandbox sender so dev/test sends
    /// (when a key IS set) work before the real domain's DNS lands (10.1).</summary>
    public string FromAddress { get; init; } = "SPECTR <onboarding@resend.dev>";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
