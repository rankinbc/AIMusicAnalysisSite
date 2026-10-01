namespace Spectr.Bff.Services;

// Fix wave FW2 (final review I5) — where the demo snapshot exporter reads its
// SOURCE assets from. IFileStorage is LocalDisk only (Program.cs), but in
// production a mix is uploaded straight to R2 over presigned URLs and never
// touches local disk (the worker downloads it to a temp file), so a
// local-only read refused every production export with snapshot_not_ready.
//
// Where each source asset lives in production:
//   - the mix (song_versions.file_path): R2 for a presigned upload, local
//     disk for the proxy fallback upload;
//   - spectrogram / waveform images (analyses.*_image_path): written by the
//     worker to the /data volume the BFF shares (compose.prod.yml), plus a
//     best-effort durable copy in R2;
//   - waveform peaks (analyses.waveform_peaks_path): not written today.
// Every asset therefore goes local-first, then R2 when it is configured.
// The DESTINATION is always local disk: the snapshot's own assets are served
// local-first by MediaDelivery in every environment.
public static class DemoSnapshotSources
{
    public static async Task<bool> ExistsAsync(
        IFileStorage storage, IMultipartObjectStore s3, string key, CancellationToken ct)
    {
        if (await storage.ExistsAsync(key, ct)) return true;
        return s3.IsConfigured && await s3.ObjectExistsAsync(key, ct);
    }

    // Throws when the key is in neither store — check ExistsAsync first.
    public static async Task CopyToLocalAsync(
        IFileStorage storage, IMultipartObjectStore s3, string sourceKey, string destKey,
        string contentType, CancellationToken ct)
    {
        await using var source = await storage.ExistsAsync(sourceKey, ct)
            ? await storage.OpenReadAsync(sourceKey, ct)
            : await s3.OpenReadAsync(sourceKey, ct);
        await storage.WriteAsync(destKey, source, contentType, ct);
    }

    // The optional-asset sibling: false (nothing written) for a null/empty
    // key or one found in neither store.
    public static async Task<bool> CopyToLocalIfPresentAsync(
        IFileStorage storage, IMultipartObjectStore s3, string? sourceKey, string destKey,
        string contentType, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(sourceKey)) return false;
        if (!await ExistsAsync(storage, s3, sourceKey, ct)) return false;
        await CopyToLocalAsync(storage, s3, sourceKey, destKey, contentType, ct);
        return true;
    }
}
