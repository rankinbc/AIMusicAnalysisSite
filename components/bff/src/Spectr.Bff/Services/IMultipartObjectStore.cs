using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace Spectr.Bff.Services;

// Story 3.1 — presigned multipart surface for browser-direct uploads (AR18).
// Deliberately separate from IFileStorage: local disk has no multipart
// analogue, and the legacy proxy endpoints keep using IFileStorage untouched.
public interface IMultipartObjectStore
{
    // False when Storage:S3 is unconfigured — endpoints answer 501 and the
    // frontend falls back to the legacy proxy upload.
    bool IsConfigured { get; }

    Task<string> InitiateMultipartAsync(string key, string contentType, CancellationToken ct = default);

    // One presigned PUT URL per part, 1-based part numbers, ascending.
    Task<IReadOnlyList<PresignedPart>> PresignPartUrlsAsync(
        string key, string uploadId, int partCount, CancellationToken ct = default);

    Task CompleteMultipartAsync(
        string key, string uploadId, IReadOnlyList<CompletedPart> parts, CancellationToken ct = default);

    Task AbortMultipartAsync(string key, string uploadId, CancellationToken ct = default);

    Task<bool> ObjectExistsAsync(string key, CancellationToken ct = default);

    // Story 3.2 — single-object presigned PUT for attachments (stems/.als/
    // reference are ≤250 MB and fit one PUT; multipart/resume was the mix).
    string PresignPutUrl(string key, CancellationToken ct = default);

    // Story 3.2 review — size of an object, null when missing. A presigned
    // PUT cannot bind Content-Length, so registration endpoints re-check the
    // ACTUAL object size against the per-kind caps (the client-declared
    // fileSize at init is advisory only).
    Task<long?> GetObjectSizeAsync(string key, CancellationToken ct = default);
}

public sealed record PresignedPart(int PartNumber, string Url);
public sealed record CompletedPart(int PartNumber, string ETag);

// AWSSDK.S3-backed implementation. Works against both Cloudflare R2 and MinIO
// (see S3StorageOptions for the per-backend config divergence).
internal sealed class S3ObjectStore : IMultipartObjectStore, IDisposable
{
    private readonly S3StorageOptions _opts;
    private readonly Lazy<IAmazonS3> _client;

    public S3ObjectStore(IOptions<S3StorageOptions> opts)
    {
        _opts = opts.Value;
        _client = new Lazy<IAmazonS3>(CreateClient);
    }

    // Test seam: lets unit tests inject a fake IAmazonS3.
    internal S3ObjectStore(S3StorageOptions opts, IAmazonS3 client)
    {
        _opts = opts;
        _client = new Lazy<IAmazonS3>(() => client);
    }

    public bool IsConfigured => _opts.IsConfigured;

    private IAmazonS3 CreateClient()
    {
        if (!_opts.IsConfigured)
            throw new InvalidOperationException("Storage:S3 is not configured.");

        var config = new AmazonS3Config
        {
            ServiceURL = _opts.ServiceUrl,
            AuthenticationRegion = _opts.Region,
            ForcePathStyle = _opts.ForcePathStyle,
            // FOOTGUN #1 (story 3.1): the SDK's default WHEN_SUPPORTED checksum
            // injection entangles with presigned-PUT signatures -> the browser's
            // PUT fails SignatureDoesNotMatch, and R2 rejects CRC32 outright.
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        };
        return new AmazonS3Client(_opts.AccessKey, _opts.SecretKey, config);
    }

    public async Task<string> InitiateMultipartAsync(string key, string contentType, CancellationToken ct = default)
    {
        var resp = await _client.Value.InitiateMultipartUploadAsync(new InitiateMultipartUploadRequest
        {
            BucketName = _opts.Bucket,
            Key = key,
            ContentType = contentType,
        }, ct);
        return resp.UploadId;
    }

    public Task<IReadOnlyList<PresignedPart>> PresignPartUrlsAsync(
        string key, string uploadId, int partCount, CancellationToken ct = default)
    {
        var expires = DateTime.UtcNow.AddMinutes(_opts.UrlExpiryMinutes);
        var parts = new List<PresignedPart>(partCount);
        for (var n = 1; n <= partCount; n++)
        {
            // GetPreSignedURLAsync is CPU-bound signing, no network round-trip.
            var url = _client.Value.GetPreSignedURL(new GetPreSignedUrlRequest
            {
                BucketName = _opts.Bucket,
                Key = key,
                Verb = HttpVerb.PUT,
                UploadId = uploadId,
                PartNumber = n,
                Expires = expires,
            });
            parts.Add(new PresignedPart(n, url));
        }
        return Task.FromResult<IReadOnlyList<PresignedPart>>(parts);
    }

    public async Task CompleteMultipartAsync(
        string key, string uploadId, IReadOnlyList<CompletedPart> parts, CancellationToken ct = default)
    {
        await _client.Value.CompleteMultipartUploadAsync(new CompleteMultipartUploadRequest
        {
            BucketName = _opts.Bucket,
            Key = key,
            UploadId = uploadId,
            // Ascending PartNumber order is required by the S3 API.
            PartETags = parts.OrderBy(p => p.PartNumber)
                             .Select(p => new PartETag(p.PartNumber, p.ETag))
                             .ToList(),
        }, ct);
    }

    public async Task AbortMultipartAsync(string key, string uploadId, CancellationToken ct = default)
    {
        await _client.Value.AbortMultipartUploadAsync(new AbortMultipartUploadRequest
        {
            BucketName = _opts.Bucket,
            Key = key,
            UploadId = uploadId,
        }, ct);
    }

    public string PresignPutUrl(string key, CancellationToken ct = default)
    {
        // Same checksum footgun as part presigns: the client must PUT raw
        // bytes with no checksum headers (config disables SDK injection).
        return _client.Value.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = _opts.Bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.AddMinutes(_opts.UrlExpiryMinutes),
        });
    }

    public async Task<bool> ObjectExistsAsync(string key, CancellationToken ct = default)
        => await GetObjectSizeAsync(key, ct) is not null;

    public async Task<long?> GetObjectSizeAsync(string key, CancellationToken ct = default)
    {
        try
        {
            var meta = await _client.Value.GetObjectMetadataAsync(new GetObjectMetadataRequest
            {
                BucketName = _opts.Bucket,
                Key = key,
            }, ct);
            return meta.ContentLength;
        }
        catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public void Dispose()
    {
        if (_client.IsValueCreated) _client.Value.Dispose();
    }
}
