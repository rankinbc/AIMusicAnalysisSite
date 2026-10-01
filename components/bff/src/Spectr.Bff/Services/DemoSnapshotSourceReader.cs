namespace Spectr.Bff.Services;

// I5 (final fix wave FW2) — the demo snapshot exporter (AdminEndpoints.
// DemoSnapshot.cs) previously read every source asset through IFileStorage
// (LocalDisk) only. Program.cs registers LocalDiskFileStorage as the ONLY
// IFileStorage; in production the mix upload goes straight to R2 over a
// presigned URL (Storage:S3 in compose.prod.yml) and NEVER touches local
// disk — the worker downloads it to a temp file and cleans up. So
// storage.ExistsAsync(version.FilePath) always returned false for a
// production track and the export 409'd with snapshot_not_ready on every
// attempt; CopyAsync could not have read the file either.
//
// The result images (spectrogram/waveform webp) ARE written to local disk by
// the worker (tasks_dramatiq.py:_render_and_store_images, under the SAME
// /data volume the BFF's Storage:LocalRoot resolves — shared per
// compose.prod.yml) with a best-effort durable copy also pushed to R2
// (_try_upload_durables) — so in practice they already existed locally. The
// waveform-peaks key is never written by the worker today (always null).
// Every asset still goes through the same local-first-then-R2 fallback here
// for symmetry and so a missing local render (worker restart mid-write, a
// volume that didn't survive a redeploy, …) doesn't silently drop an
// otherwise-available asset.
public static class DemoSnapshotSourceReader
{
    // True when sourceKey can be read from EITHER store. Used by the
    // exporter's pre-write guard — never start writing if the source can't
    // actually be read.
    public static async Task<bool> ExistsAsync(
        IFileStorage storage, IMultipartObjectStore s3, string key, CancellationToken ct)
    {
        if (await storage.ExistsAsync(key, ct)) return true;
        return s3.IsConfigured && await s3.ObjectExistsAsync(key, ct);
    }

    // Copies sourceKey -> destKey, writing through IFileStorage (destKey
    // always lands on local disk — the snapshot's own assets live locally in
    // every environment; DemoSeeder/MediaDelivery serve them local-first).
    // Reads local disk first (today's fast path, zero R2 round trip for the
    // common in-dev case); falls back to R2 only when local disk doesn't
    // have the key. Throws if the key is in neither store — callers must
    // check ExistsAsync (or CopyIfPresentAsync's own check) first.
    public static async Task CopyAsync(
        IFileStorage storage, IMultipartObjectStore s3, string sourceKey, string destKey,
        string contentType, CancellationToken ct)
    {
        if (await storage.ExistsAsync(sourceKey, ct))
        {
            await using var local = await storage.OpenReadAsync(sourceKey, ct);
            await storage.WriteAsync(destKey, local, contentType, ct);
            return;
        }
        await using var remote = await s3.OpenReadAsync(sourceKey, ct);
        await storage.WriteAsync(destKey, remote, contentType, ct);
    }

    // CopyAsync's "optional asset" sibling — false (no-op) when sourceKey is
    // null/empty or absent from BOTH stores, matching the pre-fix behaviour
    // for a missing spectrogram/waveform/peaks key.
    public static async Task<bool> CopyIfPresentAsync(
        IFileStorage storage, IMultipartObjectStore s3, string? sourceKey, string destKey,
        string contentType, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(sourceKey)) return false;
        if (!await ExistsAsync(storage, s3, sourceKey, ct)) return false;
        await CopyAsync(storage, s3, sourceKey, destKey, contentType, ct);
        return true;
    }
}
