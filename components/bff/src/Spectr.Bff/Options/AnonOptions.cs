namespace Spectr.Bff.Options;

/// <summary>
/// Config for the durable anonymous identity. <c>Anon:SigningKey</c> HMAC-signs
/// the <c>spectr_anon</c> cookie so a client can't forge another's anonId. It is
/// intentionally SEPARATE from <c>Jwt:Key</c> (different blast radius) and must be
/// stable across restarts, or every anon cookie invalidates on redeploy.
/// </summary>
public sealed class AnonOptions
{
    public const string SectionName = "Anon";

    public string? SigningKey { get; init; }
}
