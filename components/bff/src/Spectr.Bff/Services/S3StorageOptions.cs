namespace Spectr.Bff.Services;

// Story 3.1 — S3-compatible object storage (Cloudflare R2 in prod, MinIO in
// dev/CI — AR17). Bound from "Storage:S3". Presigned multipart upload is
// ACTIVE only when ServiceUrl is set; otherwise POST /uploads/init returns
// 501 and the frontend falls back to the legacy proxy upload.
public sealed class S3StorageOptions
{
    public const string SectionName = "Storage:S3";

    public string? ServiceUrl { get; set; }          // R2: https://<account>.r2.cloudflarestorage.com ; MinIO: http://minio:9000
    public string? AccessKey { get; set; }
    public string? SecretKey { get; set; }
    public string Bucket { get; set; } = "spectr";
    public string Region { get; set; } = "auto";     // R2 = "auto"; MinIO conventionally "us-east-1"
    public bool ForcePathStyle { get; set; }          // MinIO REQUIRES true; R2 must stay false

    // AR18: uniform parts (R2 rejects uneven parts — all but last must match).
    // 16 MiB — within R2's 5 MiB..5 GiB per-part window; 250 MB => 16 parts.
    public long PartSizeBytes { get; set; } = 16L * 1024 * 1024;

    // Part-URL lifetime. Generous so a flaky consumer connection can retry
    // parts without a re-sign endpoint (story decision 5; revisited in 3.5).
    public int UrlExpiryMinutes { get; set; } = 120;

    // Story 3.3 (NFR5): presigned READ lifetime. Short — playback URLs are
    // minted per request via a 302 from the authorized media endpoints, and
    // the client transparently re-requests on expiry (AC4).
    public int ReadUrlExpiryMinutes { get; set; } = 15;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ServiceUrl);
}
