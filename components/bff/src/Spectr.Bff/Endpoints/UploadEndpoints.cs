using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Story 3.1 — direct-to-R2 presigned multipart upload (AR17/AR18/AR20).
//
// Flow: POST /uploads/init (entitlement CHECK + presigned part URLs) →
// browser PUTs parts straight to R2/MinIO → POST /uploads/complete
// (finalize multipart, create Song/SongVersion rows, dispatch via the
// story-2.4 gate). The BFF never proxies file bytes on this path.
//
// When Storage:S3 is unconfigured every route answers 501
// `presigned_unavailable` and the frontend falls back to the legacy
// proxy upload (mix stays uploadable with zero S3 dependency in dev).
public static class UploadEndpoints
{
    private const long MaxUploadBytes = 250L * 1024 * 1024;
    private const int MaxParts = 10_000; // S3/R2 hard limit; unreachable at 250 MB / 16 MiB

    public static IEndpointRouteBuilder MapUploadEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/uploads").WithTags("uploads").RequireAuthorization();
        g.MapPost("/init", Init);
        g.MapPost("/complete", Complete);
        g.MapPost("/abort", Abort);
        return app;
    }

    public sealed record InitRequest(string FileName, long FileSize, string? ContentType, string? SongId);
    public sealed record InitPartDto(int PartNumber, string Url);
    public sealed record InitResponse(
        Guid JobId, string Key, string UploadId, long PartSizeBytes, IReadOnlyList<InitPartDto> Parts);

    public sealed record CompletePartDto(int PartNumber, string ETag);
    public sealed record CompleteRequest(
        Guid JobId, string Key, string UploadId, List<CompletePartDto> Parts,
        string? SongId, string? GenreHint, bool? Analyze);
    public sealed record CompleteResponse(Guid SongId, Guid VersionId, Guid? JobId);

    public sealed record AbortRequest(string Key, string UploadId);

    // ── POST /api/uploads/init ──────────────────────────────────────────────
    private static async Task<IResult> Init(
        InitRequest body,
        ClaimsPrincipal currentUser,
        IMultipartObjectStore store,
        IOptions<S3StorageOptions> s3Options,
        EntitlementService ents,
        CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured; use the legacy upload endpoint.");

        if (string.IsNullOrWhiteSpace(body.FileName))
            return Results.BadRequest(new { error = "fileName required." });
        if (body.FileSize <= 0)
            return Results.BadRequest(new { error = "fileSize must be positive." });
        if (body.FileSize > MaxUploadBytes)
            return Results.BadRequest(new { error = "File exceeds 250 MB limit." });

        var userId = currentUser.UserId();

        // Entitlement CHECK only (AR16: the spend happens at dispatch inside
        // DispatchAnalysisAsync at /complete — init never consumes anything).
        EntitlementsDto ent;
        try
        {
            ent = await ents.ForAsync(userId, ct);
        }
        catch (Exception)
        {
            return ErrorEnvelope.Build(503, "entitlements_unavailable",
                "Entitlement service temporarily unavailable.");
        }
        if (ent.AnalysesRemaining == 0)
            return ErrorEnvelope.Build(409, "entitlement_exhausted",
                "You have used all your analyses for this billing period.");

        var jobId = Guid.NewGuid();
        var ext = Path.GetExtension(body.FileName).ToLowerInvariant();
        if (string.IsNullOrEmpty(ext)) ext = ".bin";
        // AR20 key layout: audio/{userOrDevice}/{jobId}/source.*
        var key = $"audio/{userId}/{jobId}/source{ext}";
        var contentType = string.IsNullOrWhiteSpace(body.ContentType)
            ? "application/octet-stream" : body.ContentType;

        // FOOTGUN #3: R2 requires uniform part size (all but last identical).
        var partSize = s3Options.Value.PartSizeBytes;
        var partCount = PartMath.PartCount(body.FileSize, partSize);
        if (partCount > MaxParts)
            return Results.BadRequest(new { error = "File requires too many parts." });

        var uploadId = await store.InitiateMultipartAsync(key, contentType!, ct);
        var parts = await store.PresignPartUrlsAsync(key, uploadId, partCount, ct);

        return Results.Ok(new InitResponse(
            jobId, key, uploadId, partSize,
            parts.Select(p => new InitPartDto(p.PartNumber, p.Url)).ToList()));
    }

    // ── POST /api/uploads/complete ──────────────────────────────────────────
    private static async Task<IResult> Complete(
        CompleteRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IMultipartObjectStore store,
        IJobQueue queue,
        EntitlementService ents,
        CreditLedgerService credits,
        CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured; use the legacy upload endpoint.");

        var userId = currentUser.UserId();

        // The key was minted at /init as audio/{userId}/{jobId}/source.* —
        // reject any key outside the caller's own prefix (IDOR/key-forgery guard).
        var expectedPrefix = $"audio/{userId}/{body.JobId}/";
        if (string.IsNullOrWhiteSpace(body.Key) || !body.Key.StartsWith(expectedPrefix, StringComparison.Ordinal))
            return Results.BadRequest(new { error = "Key does not match this upload." });

        if (body.Parts is null || body.Parts.Count == 0)
            return Results.BadRequest(new { error = "At least one part required." });

        await store.CompleteMultipartAsync(
            body.Key, body.UploadId,
            body.Parts.Select(p => new CompletedPart(p.PartNumber, p.ETag)).ToList(), ct);

        // Belt-and-braces: the object must exist before we create DB rows.
        if (!await store.ObjectExistsAsync(body.Key, ct))
            return ErrorEnvelope.Build(502, "upload_not_found",
                "Finalized object not found in storage.");

        var (songGuid, songErr) = await VersionEndpoints.ResolveOrCreateSongAsync(
            db, userId, body.SongId, body.GenreHint, Path.GetFileName(body.Key), ct);
        if (songErr is not null) return songErr;

        var versionId = await VersionEndpoints.InsertVersionRowAsync(db, songGuid, body.Key, ct);
        var shouldAnalyze = body.Analyze ?? true;
        await db.SaveChangesAsync(ct);

        if (shouldAnalyze)
        {
            var (jobId, err) = await VersionEndpoints.DispatchAnalysisAsync(
                userId, versionId, null, db, ents, credits, queue, ct, preallocatedJobId: body.JobId);
            if (err is not null) return err;
            return Results.Ok(new CompleteResponse(songGuid, versionId, jobId));
        }

        return Results.Ok(new CompleteResponse(songGuid, versionId, null));
    }

    // ── POST /api/uploads/abort ─────────────────────────────────────────────
    private static async Task<IResult> Abort(
        AbortRequest body,
        ClaimsPrincipal currentUser,
        IMultipartObjectStore store,
        CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured.");

        var userId = currentUser.UserId();
        if (string.IsNullOrWhiteSpace(body.Key) ||
            !body.Key.StartsWith($"audio/{userId}/", StringComparison.Ordinal))
            return Results.BadRequest(new { error = "Key does not match this user." });

        await store.AbortMultipartAsync(body.Key, body.UploadId, ct);
        return Results.NoContent();
    }
}

// Uniform-part math shared by endpoint + tests. FOOTGUN #3: R2 requires all
// parts except the last to be the same size — one fixed size, last = remainder.
internal static class PartMath
{
    public static int PartCount(long fileSize, long partSize)
        => (int)((fileSize + partSize - 1) / partSize);
}
