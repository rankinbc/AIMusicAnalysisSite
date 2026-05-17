namespace Spectr.Bff.Infrastructure;

// Slice 1 has many endpoint stubs that just need to surface "not implemented
// yet" without owning a real handler. Minimal APIs don't ship a `Results.NotImplemented()`
// — this helper centralizes the 501 response so the stubs stay one line.
public static class NotImplementedResult
{
    public static IResult Stub() =>
        Results.Json(new { error = "Not implemented in slice 1." }, statusCode: StatusCodes.Status501NotImplemented);
}
