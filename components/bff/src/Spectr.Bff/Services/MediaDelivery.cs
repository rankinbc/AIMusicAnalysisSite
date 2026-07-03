namespace Spectr.Bff.Services;

// Story 3.3 (FR5/NFR5) — the shared serve-tail for every media endpoint.
// Auth/ownership happens in the ENDPOINT before calling this; keys must come
// from the DB (never client-supplied — write-time guards own key hygiene).
//
// Local-first: a file under Storage:LocalRoot proxy-streams exactly as before
// (dev parity, zero S3 dependency). Otherwise, when S3 is configured and the
// object exists, answer a 302 to a short-lived presigned GET — the object is
// never public and the URL expires (ReadUrlExpiryMinutes); an expired URL on
// resume surfaces as a client media error handled by the AC4 retry. 301 is
// deliberately never used, and every 302 carries Cache-Control: no-store —
// the Location header is a bearer-equivalent grant that intermediaries
// (CDN default rules, misconfigured proxies) must never cache.
public static class MediaDelivery
{
    public static async Task<IResult> ServeAsync(
        IFileStorage storage,
        IMultipartObjectStore s3,
        string key,
        string contentType,
        HttpResponse response,
        CancellationToken ct,
        bool rangeProcessing = true,
        string? downloadName = null,
        bool immutableCacheOnLocal = false)
    {
        if (await storage.ExistsAsync(key, ct))
        {
            try
            {
                var stream = await storage.OpenReadAsync(key, ct);
                // Header decided from the SAME existence check that picked the
                // branch — a second check could race a deletion and stamp an
                // expiring 302 (or 404) immutable for a year.
                if (immutableCacheOnLocal)
                    response.Headers.CacheControl = "public, max-age=31536000, immutable";
                return downloadName is null
                    ? Results.File(stream, contentType, enableRangeProcessing: rangeProcessing)
                    : Results.File(stream, contentType, fileDownloadName: downloadName,
                        enableRangeProcessing: rangeProcessing);
            }
            catch (IOException)
            {
                // Deleted between Exists and Open (TOCTOU) — fall through to S3.
            }
            catch (UnauthorizedAccessException)
            {
                // Same race shape on Windows — fall through.
            }
        }

        if (s3.IsConfigured && await s3.ObjectExistsAsync(key, ct))
        {
            response.Headers.CacheControl = "no-store";
            return Results.Redirect(
                s3.PresignGetUrl(key, downloadName, contentType), permanent: false);
        }

        return Results.NotFound();
    }

    // The extension→content-type map previously duplicated across endpoints.
    public static string AudioContentType(string key) =>
        Path.GetExtension(key).ToLowerInvariant() switch
        {
            ".wav" => "audio/wav",
            ".flac" => "audio/flac",
            ".mp3" => "audio/mpeg",
            ".aif" or ".aiff" => "audio/aiff",
            ".ogg" or ".oga" => "audio/ogg",
            ".m4a" => "audio/mp4",
            _ => "application/octet-stream",
        };
}
