namespace Spectr.Bff.Endpoints;

// Story 2.1 review-fix P10 — shared AR38 error envelope helper. Previously
// duplicated in CoachConversationEndpoints + BillingEndpoints; now lives
// here so all endpoint groups emit the same `{ error: { code, message,
// details } }` shape with the same serializer behaviour.
//
// AR38 (architecture line 172): `{ "error": { "code": "...", "message":
// "...", "details": {...} } }`. Stable machine codes for gate types so
// the frontend keys off `code`, never the human-readable `message`.

internal static class ErrorEnvelope
{
    public static IResult Build(
        int status, string code, string message, object? details = null)
    {
        return Results.Json(
            new { error = new { code, message, details } },
            statusCode: status);
    }
}
