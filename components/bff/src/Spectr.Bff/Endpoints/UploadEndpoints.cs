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
        // Task D6 (spec D4) — init/complete carry the guest's one-upload quota;
        // abort is allowed unconditionally (it never creates a version).
        // Fix wave FW1 (I1) — the upload slot is charged ONCE, inside Init,
        // and Complete only claims that same slot; abort refunds it.
        g.MapPost("/init", Init).AllowGuestUpload().ChargesGuestUploadInHandler();
        g.MapPost("/complete", Complete).AllowGuestUpload().ChargesGuestUploadInHandler();
        g.MapPost("/abort", Abort).AllowGuest();
        // Story 3.2 — single-PUT presign for attachments (stems/.als/reference).
        // Task G1 — guests may presign stems/.als/reference now too (caps
        // enforced inside the handler; the stem branch calls CheckStemsAsync).
        g.MapPost("/attachments/init", AttachmentInit).AllowGuest();
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
        IRateLimiter limiter,
        GuestLimits guestLimits,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        // Story 4.5 (AC4/AR26): per-actor + per-IP limits on /uploads/init.
        // Today the actor is the authed user; 6.3's anon path passes
        // device:{id} through the same limiter. Same knob as the auth
        // endpoints: RateLimits:Enabled=false in Development (test volume).
        var cfg = httpCtx.RequestServices.GetRequiredService<IConfiguration>();
        if (!string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
        {
            var ip = httpCtx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            try
            {
                var verdict = await limiter.CheckAsync(
                    $"user:{currentUser.UserId()}", ip, "uploads_init", 10, TimeSpan.FromMinutes(1), ct);
                if (!verdict.Allowed)
                    return ErrorEnvelope.Build(429, "rate_limited", "Too many uploads — slow down.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // FAIL-OPEN (4.3 precedent): a Redis blip must not block uploads.
                httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Uploads").LogError(ex, "Rate limiter unavailable — failing OPEN.");
            }
        }

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

        // Fix wave FW1 (I1) — a guest's upload takes its slot HERE, keyed by
        // this upload's jobId, and its analysis arms are evaluated and charged
        // once — before any byte moves. The pending slot lapses on its own
        // shortly after the part URLs expire.
        var isGuest = currentUser.IsGuest();
        if (isGuest && await guestLimits.BeginPresignedUploadAsync(
                userId, jobId, httpCtx, TimeSpan.FromMinutes(s3Options.Value.UrlExpiryMinutes + 30), ct)
            is { } guestRefused)
            return guestRefused;

        // Story 12.3 (AC1) — S3 configured but unreachable (MinIO down) must be
        // a typed 503, never an unhandled 500: the client's proxy fallback keys
        // off init-stage 5xx. Catch broadly — connection failures, SDK errors,
        // and lazy AmazonS3Client construction on malformed config all mean the
        // same thing here.
        string uploadId;
        IReadOnlyList<PresignedPart> parts;
        try
        {
            uploadId = await store.InitiateMultipartAsync(key, contentType!, ct);
            parts = await store.PresignPartUrlsAsync(key, uploadId, partCount, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("Uploads").LogError(ex, "Storage unreachable during /uploads/init.");
            // No upload exists — the client falls back to the proxy path,
            // which charges its own slot.
            if (isGuest) await guestLimits.CancelPresignedUploadAsync(userId, jobId);
            return ErrorEnvelope.Build(503, "storage_unreachable",
                "Upload storage is unreachable; falling back to standard upload.");
        }

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
        GuestLimits guestLimits,
        HttpContext httpCtx,
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

        // Fix wave FW1 (I1) — a guest's /complete CLAIMS the slot its own
        // /init charged for this jobId (no second charge). No such slot → the
        // upload is refused before anything is finalized or created.
        var isGuest = currentUser.IsGuest();
        if (isGuest && await guestLimits.ClaimPresignedUploadAsync(userId, body.JobId, ct) is { } unclaimed)
            return unclaimed;

        Guid songGuid, versionId;
        var committed = false;
        try
        {
            // Story 12.3 (AC1) — same typed 503 as /init, but NO fallback semantics:
            // parts are already in the bucket (or lost), so the client must surface
            // the error, never silently re-upload the file through the proxy. If the
            // multipart actually completed before the failure, a retry mints a new
            // jobId/key at /init and the abandoned object is retention-swept (3.4).
            try
            {
                await store.CompleteMultipartAsync(
                    body.Key, body.UploadId,
                    body.Parts.Select(p => new CompletedPart(p.PartNumber, p.ETag)).ToList(), ct);

                // Belt-and-braces: the object must exist before we create DB rows.
                if (!await store.ObjectExistsAsync(body.Key, ct))
                    return ErrorEnvelope.Build(502, "upload_not_found",
                        "Finalized object not found in storage.");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                httpCtx.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Uploads").LogError(ex, "Storage unreachable during /uploads/complete.");
                return ErrorEnvelope.Build(503, "storage_unreachable",
                    "Upload storage is unreachable; the upload could not be finalized. Please retry.");
            }

            (songGuid, var songErr) = await VersionEndpoints.ResolveOrCreateSongAsync(
                db, userId, body.SongId, body.GenreHint, Path.GetFileName(body.Key), ct);
            if (songErr is not null) return songErr;

            versionId = await VersionEndpoints.InsertVersionRowAsync(db, songGuid, body.Key, ct);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (DbViolations.IsUniqueViolation(ex))
            {
                // Wave-2 (E3.2) — race-only residual after the auto-suffix probe.
                // Do NOT delete the finalized object: the parts are the user's only
                // copy and a retry mints a new jobId/key at /init; the zero-row
                // orphan is retention-swept (matches the 12.3 note above).
                return ErrorEnvelope.Build(409, "song_name_conflict",
                    "A song with that name already exists. Pick it from the song list or rename.");
            }
            committed = true;
        }
        finally
        {
            // FW1 (I1) — no version row committed: the claimed slot goes back
            // (the client restarts from /init).
            if (isGuest && !committed) await guestLimits.ReleaseClaimedUploadAsync(userId, body.JobId);
        }

        // FW1 (I1) — /init already charged this upload's analysis arms; the
        // version's first dispatch (below, or a later /analyze or
        // /stems/confirm when analysis is deferred) spends that charge.
        if (isGuest) await guestLimits.CreditPrechargedAnalysisAsync(userId, versionId);

        var shouldAnalyze = body.Analyze ?? true;
        if (shouldAnalyze)
        {
            var (jobId, err) = await VersionEndpoints.DispatchAnalysisAsync(
                userId, versionId, null, db, ents, credits, queue, httpCtx, ct, preallocatedJobId: body.JobId);
            if (err is not null) return err;
            return Results.Ok(new CompleteResponse(songGuid, versionId, jobId));
        }

        return Results.Ok(new CompleteResponse(songGuid, versionId, null));
    }

    public sealed record AttachmentInitRequest(string Kind, Guid? VersionId, string FileName, long FileSize);
    public sealed record AttachmentInitResponse(string Key, string Url, string? StemId, Guid? ReferenceId);

    private const long MaxAlsBytes = 50L * 1024 * 1024;
    private static readonly HashSet<string> StemExts =
        new(StringComparer.OrdinalIgnoreCase) { ".wav", ".flac" };
    private static readonly HashSet<string> AlsExts =
        new(StringComparer.OrdinalIgnoreCase) { ".als", ".gz" };
    private static readonly HashSet<string> ReferenceExts =
        new(StringComparer.OrdinalIgnoreCase) { ".wav", ".flac", ".mp3", ".aiff", ".aif", ".m4a", ".ogg" };

    // Story 3.2 (AR20) — the jobId embedded in a version's source key. Both
    // the 3.1 presigned layout (audio/{userId}/{jobId}/source.*) and the
    // legacy proxy layout (audio/upload/{jobId}/source.*) carry it at seg[2].
    internal static Guid? JobIdFromSourceKey(string? filePath)
    {
        if (string.IsNullOrEmpty(filePath)) return null;
        var seg = filePath.Split('/');
        if (seg.Length >= 4 && seg[0] == "audio" && Guid.TryParse(seg[2], out var jid)) return jid;
        return null;
    }

    // Story 3.2 review — a registered attachment key must be {prefix} plus ONE
    // final segment. Prefix-StartsWith alone would accept
    // "stems/{jobId}/../../audio/{victim}/..." — the worker's local resolve
    // normalizes `..` and would escape the storage root.
    internal static bool ValidSingleSegmentKey(string? key, string prefix)
        => !string.IsNullOrWhiteSpace(key)
           && key.StartsWith(prefix, StringComparison.Ordinal)
           && key.Length > prefix.Length
           && key.AsSpan(prefix.Length).IndexOfAny('/', '\\') < 0
           && !key.Contains("..", StringComparison.Ordinal);

    // ── POST /api/uploads/attachments/init ─────────────────────────────────
    // Mints a single presigned PUT for a stem/.als/reference (AR20 keys:
    // stems/{jobId}/…, als/{jobId}/project.*, reference/{refId}/source.*).
    // jobId is derived SERVER-SIDE from the caller's own version — never
    // trusted from the client. Registration (DB rows) happens on the
    // kind-specific endpoints AFTER the PUT (stage-keys / als-key /
    // references/complete-key), each of which re-verifies key prefix +
    // object existence.
    // Story 12.3 (AC1) — presigning is CPU-only signing, but the lazy
    // AmazonS3Client construction underneath can throw on malformed config;
    // answer the same typed 503 the multipart init does.
    private static IResult PresignPutOr503(
        IMultipartObjectStore store, string key, ILogger logger, CancellationToken ct,
        Func<string, IResult> ok)
    {
        string url;
        try
        {
            url = store.PresignPutUrl(key, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Storage unreachable during /uploads/attachments/init.");
            return ErrorEnvelope.Build(503, "storage_unreachable",
                "Upload storage is unreachable; falling back to standard upload.");
        }
        return ok(url);
    }

    private static async Task<IResult> AttachmentInit(
        AttachmentInitRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IMultipartObjectStore store,
        IFileStorage storage,
        GuestLimits limits,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var log = loggerFactory.CreateLogger("Uploads");

        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured; use the legacy upload endpoint.");

        if (string.IsNullOrWhiteSpace(body.FileName))
            return Results.BadRequest(new { error = "fileName required." });
        if (body.FileSize <= 0)
            return Results.BadRequest(new { error = "fileSize must be positive." });

        var userId = currentUser.UserId();

        // Fix round 1 item 3 — the mint itself must be capped: it counts only
        // REGISTERED entries downstream, but a script that never registers can
        // still mint unlimited presigned PUT URLs of bytes no row tracks and
        // no sweep finds. Checked BEFORE any URL is minted, for every kind.
        if (currentUser.IsGuest())
        {
            if (await limits.CheckAttachmentMintAsync(userId, ct) is { } mintDenied)
                return mintDenied;
        }

        var ext = Path.GetExtension(body.FileName).ToLowerInvariant();

        switch (body.Kind)
        {
            case "stem":
            case "als":
            {
                if (body.VersionId is not Guid vid)
                    return Results.BadRequest(new { error = "versionId required for this kind." });
                var version = await (
                    from v in db.SongVersions.AsNoTracking()
                    join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
                    where v.Id == vid && s.UserId == userId
                    select new { v.FilePath }).FirstOrDefaultAsync(ct);
                if (version is null) return Results.NotFound();
                var jobId = JobIdFromSourceKey(version.FilePath);
                if (jobId is null)
                    // Pre-AR20 version with no jobId in its key — the legacy
                    // proxy path still works; signal fallback like unconfigured S3.
                    return ErrorEnvelope.Build(501, "presigned_unavailable",
                        "This version predates the presigned key layout; use the legacy upload endpoint.");

                if (body.Kind == "stem")
                {
                    if (!StemExts.Contains(ext))
                        return Results.BadRequest(new { error = "Only .wav / .flac stems are supported." });
                    if (body.FileSize > MaxUploadBytes)
                        return Results.BadRequest(new { error = "File exceeds 250 MB limit." });
                    // Mint quota: staged entries already at the cap ⇒ no more
                    // presigns (stage-keys enforces the cap again at register).
                    var stagedJson = await db.SongVersions.AsNoTracking()
                        .Where(v => v.Id == vid).Select(v => v.StemPathsRaw).FirstOrDefaultAsync(ct);
                    var stagedEntries = VersionEndpoints.ReadRaw(stagedJson);
                    // Task G1 — the guest stems cap. `addBytes` here is the
                    // client-DECLARED size (the PUT hasn't happened yet) —
                    // stage-keys re-checks the ACTUAL object size at register.
                    if (currentUser.IsGuest())
                    {
                        var existingBytes = await VersionEndpoints.SumStemBytesAsync(stagedEntries, storage, store, ct);
                        if (await limits.CheckStemsAsync(stagedEntries.Count, existingBytes, addFiles: 1, addBytes: body.FileSize, ct) is { } denied)
                            return denied;
                    }
                    if (stagedEntries.Count >= 100)
                        return Results.BadRequest(new { error = "Up to 100 stems per version." });
                    var stemId = Guid.NewGuid().ToString();
                    var stemKey = $"stems/{jobId}/{stemId}{ext}";
                    return PresignPutOr503(store, stemKey, log, ct, url =>
                        Results.Ok(new AttachmentInitResponse(stemKey, url, stemId, null)));
                }

                if (!AlsExts.Contains(ext))
                    return Results.BadRequest(new { error = ".als (or gzip-compressed) file required." });
                if (body.FileSize > MaxAlsBytes)
                    return Results.BadRequest(new { error = "File exceeds 50 MB limit." });
                var alsKey = $"als/{jobId}/project{ext}";
                return PresignPutOr503(store, alsKey, log, ct, url =>
                    Results.Ok(new AttachmentInitResponse(alsKey, url, null, null)));
            }
            case "reference":
            {
                // Fix round 1 item 3 — this branch had no guest cap at all
                // beyond the general mint budget above; the per-guest
                // reference COUNT cap must also apply at init, not just on
                // the direct multipart upload route.
                if (currentUser.IsGuest())
                {
                    if (await limits.CheckReferenceAsync(userId, ct) is { } refDenied)
                        return refDenied;
                }
                if (!ReferenceExts.Contains(ext))
                    return Results.BadRequest(new { error = "Unsupported reference audio format." });
                if (body.FileSize > MaxUploadBytes)
                    return Results.BadRequest(new { error = "File exceeds 250 MB limit." });
                var refId = Guid.NewGuid();
                var refKey = $"reference/{refId}/source{ext}";
                return PresignPutOr503(store, refKey, log, ct, url =>
                    Results.Ok(new AttachmentInitResponse(refKey, url, null, refId)));
            }
            default:
                return Results.BadRequest(new { error = "kind must be stem, als, or reference." });
        }
    }

    // ── POST /api/uploads/abort ─────────────────────────────────────────────
    private static async Task<IResult> Abort(
        AbortRequest body,
        ClaimsPrincipal currentUser,
        IMultipartObjectStore store,
        GuestLimits guestLimits,
        CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured.");

        var userId = currentUser.UserId();
        if (string.IsNullOrWhiteSpace(body.Key) ||
            !body.Key.StartsWith($"audio/{userId}/", StringComparison.Ordinal))
            return Results.BadRequest(new { error = "Key does not match this user." });

        // Fix wave FW1 (I1) — an aborted guest upload gives its PENDING slot
        // back, before the storage abort (so it can no longer be completed).
        // An upload already completed holds a `done` slot, which this never
        // refunds.
        if (currentUser.IsGuest() && JobIdFromSourceKey(body.Key) is Guid abortedJobId)
            await guestLimits.CancelPresignedUploadAsync(userId, abortedJobId);

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
