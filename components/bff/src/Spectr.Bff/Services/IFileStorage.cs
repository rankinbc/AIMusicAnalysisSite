namespace Spectr.Bff.Services;

public interface IFileStorage
{
    Task<Stream> OpenReadAsync(string key, CancellationToken ct = default);
    Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default);
    Task<bool> DeleteAsync(string key, CancellationToken ct = default);

    // For R2 returns a signed URL; for local disk returns an internal authenticated route.
    Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry);

    Task<bool> ExistsAsync(string key, CancellationToken ct = default);

    // Returns the byte size of the stored object, or null if the key does not exist.
    Task<long?> GetFileSizeAsync(string key, CancellationToken ct = default);
}

// WHY: shared demo assets under DemoSnapshotStore.SharedPrefix ("audio/demo/")
// serve EVERY seeded account (registered users + guests) — one blob, many DB
// rows pointing at it. A row-owner's delete must remove their own DB rows but
// never the underlying blob, or the first person to delete their seeded demo
// song deletes the demo audio for everybody. Only the admin snapshot exporter
// (AdminEndpoints.DemoSnapshot.cs, via its own IsRetireableAssetKey guard) may
// remove those assets. Every other storage-cleanup site whose key can come
// from a SongVersion/Analysis row (version delete, song hard-delete, …) must
// route through this helper instead of calling storage.DeleteAsync directly.
public static class FileStorageExtensions
{
    public static async Task DeleteUnlessSharedAsync(
        this IFileStorage storage, string? key, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(key)) return;
        if (DemoSnapshotStore.IsSharedKey(key)) return;
        await storage.DeleteAsync(key, ct);
    }
}

internal sealed class LocalDiskFileStorage(IConfiguration config) : IFileStorage
{
    private readonly string _root = System.IO.Path.GetFullPath(
        config["Storage:LocalRoot"] ?? throw new InvalidOperationException("Storage:LocalRoot not set"));

    private string Resolve(string key) => System.IO.Path.Combine(_root, key);

    public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default)
        => Task.FromResult<Stream>(File.OpenRead(Resolve(key)));

    public async Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default)
    {
        var path = Resolve(key);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        await using var fs = File.Create(path);
        await content.CopyToAsync(fs, ct);
        return key;
    }

    public Task<bool> DeleteAsync(string key, CancellationToken ct = default)
    {
        var path = Resolve(key);
        if (!File.Exists(path)) return Task.FromResult(false);
        File.Delete(path);
        return Task.FromResult(true);
    }

    public Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry)
    {
        // Local disk has no signing; clients hit the authenticated /api/files/{key} route instead.
        return Task.FromResult(new Uri($"/api/files/{key}", UriKind.Relative));
    }

    public Task<bool> ExistsAsync(string key, CancellationToken ct = default)
        => Task.FromResult(File.Exists(Resolve(key)));

    public Task<long?> GetFileSizeAsync(string key, CancellationToken ct = default)
    {
        var path = Resolve(key);
        if (!File.Exists(path)) return Task.FromResult<long?>(null);
        return Task.FromResult<long?>(new FileInfo(path).Length);
    }
}
